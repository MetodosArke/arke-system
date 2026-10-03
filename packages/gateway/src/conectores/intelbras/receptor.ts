import type { FastifyInstance } from "fastify";
import type { GatewayService } from "../../core/gatewayService";
import { logger } from "../../logger";
import { ipDoEquipamento } from "../../receptores/controlid";
import {
  acessoDoEvento,
  ehPedidoDeAcesso,
  extrairEventos,
  identificadorDoAcesso,
  respostaNeutra,
  respostaOnline,
} from "./protocolo";

/**
 * Receptor do Modo Online dos terminais Intelbras (linha Bio-T), na mesma
 * porta de escuta da Control iD — os caminhos não colidem.
 *
 *   - `GET /keepalive`: o terminal pergunta se o servidor está lá. 200 o
 *     mantém Online; sem resposta ele passa a decidir sozinho.
 *   - `POST /notification`: cada tentativa de acesso, com o evento em JSON e
 *     a foto da pessoa num multipart. A resposta é a decisão.
 *
 * O que fica fora, e por quê:
 *   - a foto é descartada na leitura (`extrairEventos`);
 *   - a saída passa sem consultar ninguém: barrar a saída prenderia lá
 *     dentro justamente quem está barrado na entrada;
 *   - sem confirmação de giro: o terminal só avisa a passagem com catraca
 *     da própria Intelbras ("Modo Catraca"), e a presença conta pela
 *     liberação, como no leitor facial da Topdata.
 */
export interface OpcoesReceptorIntelbras {
  /** O nome do terminal pelo IP de quem chamou (o do config); sem ele, "Intelbras <ip>". */
  nomePorIp?: (ip: string) => string | null;
}

export function registrarReceptorIntelbras(app: FastifyInstance, gateway: GatewayService, opcoes: OpcoesReceptorIntelbras = {}) {
  // O corpo vem como multipart/mixed, com a foto: até 4 MB, lido como bytes.
  for (const tipo of ["multipart/mixed", "multipart/form-data"]) {
    if (!app.hasContentTypeParser(tipo)) {
      app.addContentTypeParser(tipo, { parseAs: "buffer", bodyLimit: 4 * 1024 * 1024 }, (_req, corpo, done) => done(null, corpo));
    }
  }

  const nomeDe = (ip: string) => opcoes.nomePorIp?.(ipDoEquipamento(ip)) ?? `Intelbras ${ipDoEquipamento(ip)}`;

  app.get("/keepalive", async (req, reply) => {
    gateway.equipamentos.intelbrasVisto(nomeDe(req.ip));
    return reply.code(200).type("text/plain").send("OK");
  });

  app.post("/notification", async (req) => {
    const terminal = nomeDe(req.ip);
    gateway.equipamentos.intelbrasVisto(terminal);
    const b = req.body;
    const corpo = Buffer.isBuffer(b) ? b : Buffer.from(typeof b === "string" ? b : JSON.stringify(b ?? {}));
    const eventos = extrairEventos(corpo, req.headers["content-type"] ?? null);

    const evento = eventos.find((e) => e.code === "AccessControl");
    // Porta, arrombamento, cadastro: avisos que não pedem decisão.
    if (!evento) return respostaNeutra();
    const acesso = acessoDoEvento(evento)!;

    if (!ehPedidoDeAcesso(eventos, acesso)) {
      // O terminal guardou estes enquanto estava sem o Gateway e decidiu
      // sozinho. Ninguém espera resposta; as entradas aceitas viram presença
      // na hora em que aconteceram.
      let registrados = 0;
      for (const ev of eventos) {
        const a = acessoDoEvento(ev);
        const id = a ? identificadorDoAcesso(a) : null;
        if (!a || !id || !a.entrada || a.status !== 1 || !a.quando) continue;
        await gateway.registrarBilheteEquipamento(id, a.quando.toISOString()).catch(() => undefined);
        registrados++;
      }
      logger.info({ terminal, eventos: eventos.length, registrados }, "Registros que o terminal guardou sem o Gateway");
      return respostaNeutra();
    }

    if (!acesso.entrada) {
      logger.info({ terminal }, "Saída pelo terminal Intelbras: liberada sem consulta");
      return respostaOnline(true, "");
    }

    const identificador = identificadorDoAcesso(acesso);
    if (!identificador) {
      logger.warn({ terminal, metodo: acesso.metodo }, "Terminal Intelbras mandou acesso sem usuário nem cartão — negado");
      return respostaOnline(false, "credencial não cadastrada");
    }

    try {
      const resultado = await gateway.validarCredencial({ tipo: "identificador_catraca", valor: identificador }, { aguardarGiro: false });
      // Na contingência a decisão é do cache, e o registro sobe depois.
      await gateway.registrarAcessoOffline(`id:${identificador}`, resultado);
      logger.info(
        { terminal, identificador, liberado: resultado.liberado, offline: resultado.validadoOffline, metodo: acesso.metodo },
        "Decisão de acesso devolvida ao terminal Intelbras"
      );
      return respostaOnline(resultado.liberado, resultado.mensagem ?? "");
    } catch (err) {
      // O terminal está esperando: na dúvida, nega, e a mensagem não expõe nada.
      logger.error({ err: (err as Error).message, terminal }, "Falha ao decidir o acesso do terminal Intelbras — negado");
      return respostaOnline(false, "");
    }
  });
}
