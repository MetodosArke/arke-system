import type { FastifyInstance } from "fastify";
import { credencialDaLeitura } from "../../core/credencial";
import type { GatewayService } from "../../core/gatewayService";
import { logger } from "../../logger";
import { ipDoEquipamento } from "../../receptores/controlid";
import type { Credencial } from "../../types";
import {
  CAMINHO_EVENTOS,
  acessoDoEvento,
  classificarAcesso,
  ehPedidoDeAgora,
  eventosDoCorpo,
  numeroDoAcesso,
  respostaDaDecisao,
  type AcessoHikvision,
} from "./protocolo";

/**
 * Receptor dos aparelhos Hikvision, na mesma porta de escuta da Control iD
 * e da Intelbras: o caminho não colide.
 *
 * POR QUE O SERVIDOR DE ESCUTA, E NÃO O `alertStream`. O Gateway é o
 * servidor das marcas em que o equipamento disca (Control iD, Intelbras), e
 * a Hikvision faz o mesmo no servidor de escuta (`httpHosts`): cada acesso
 * chega num POST, passa pelo filtro de IP do receptor como os outros, e a
 * decisão volta na resposta do mesmo POST (a verificação remota síncrona). O
 * `alertStream` é o contrário, uma conexão aberta pelo Gateway em cada
 * aparelho, que precisaria de reconexão própria e de outro caminho para a
 * decisão (um PUT separado, depois). E, com o servidor de escuta, o aparelho
 * guarda o que aconteceu sem o Gateway e reenvia quando ele volta.
 *
 * O que chega aqui:
 *   - o pedido de decisão (`remoteCheck`): o aparelho reconheceu a pessoa e
 *     espera a resposta. A decisão é da nuvem, pela mesma regra do app;
 *   - o aviso do resultado, depois da decisão: já foi registrado, não conta
 *     de novo;
 *   - o acesso que o aparelho decidiu sozinho (a digital, que a
 *     documentação não deixa perguntar; o aparelho sem verificação remota; o
 *     que aconteceu sem o Gateway): a entrada aceita vira presença na hora
 *     em que aconteceu;
 *   - os outros eventos (porta, alarme): não pedem nada.
 *
 * O que fica fora, e por quê:
 *   - a foto que pode vir junto é descartada na leitura (`eventosDoCorpo`);
 *   - a saída passa sem consultar ninguém: barrar a saída prenderia lá dentro
 *     justamente quem está barrado na entrada;
 *   - QR e código de barras não identificam aluno (`core/credencial.ts`);
 *   - sem confirmação de giro: a presença conta pela liberação, como na
 *     Intelbras e no leitor facial da Topdata.
 */
export interface OpcoesReceptorHikvision {
  /** O nome do aparelho pelo IP de quem chamou (o do config); sem ele, "Hikvision <ip>". */
  nomePorIp?: (ip: string) => string | null;
  /** Os leitores de saída do aparelho que chamou. */
  leitoresDeSaida?: (ip: string) => number[];
}

/** Quantos números de evento lembrar por aparelho, para o reenvio não contar presença duas vezes. */
const LEMBRAR_EVENTOS = 500;

export function registrarReceptorHikvision(app: FastifyInstance, gateway: GatewayService, opcoes: OpcoesReceptorHikvision = {}) {
  // O corpo vem em multipart/form-data (com a foto, quando vem): até 4 MB, lido como bytes.
  for (const tipo of ["multipart/form-data", "multipart/mixed"]) {
    if (!app.hasContentTypeParser(tipo)) {
      app.addContentTypeParser(tipo, { parseAs: "buffer", bodyLimit: 4 * 1024 * 1024 }, (_req, corpo, done) => done(null, corpo));
    }
  }
  for (const tipo of ["application/xml", "text/xml"]) {
    if (!app.hasContentTypeParser(tipo)) {
      app.addContentTypeParser(tipo, { parseAs: "buffer", bodyLimit: 1024 * 1024 }, (_req, corpo, done) => done(null, corpo));
    }
  }

  const nomeDe = (ip: string) => opcoes.nomePorIp?.(ipDoEquipamento(ip)) ?? `Hikvision ${ipDoEquipamento(ip)}`;
  const vistos = new Map<string, string[]>();
  /** O evento já foi tratado? O aparelho reenvia o que não teve resposta. */
  const jaVisto = (aparelho: string, a: AcessoHikvision): boolean => {
    if (a.serial === null) return false;
    const chave = `${a.serial}:${a.quando?.getTime() ?? ""}`;
    const lista = vistos.get(aparelho) ?? [];
    if (lista.includes(chave)) return true;
    lista.push(chave);
    if (lista.length > LEMBRAR_EVENTOS) lista.shift();
    vistos.set(aparelho, lista);
    return false;
  };

  /** A credencial do acesso, pela regra de todas as marcas. */
  const credencialDe = (a: AcessoHikvision): Credencial | null => {
    if (a.employeeNo && a.employeeNo !== "0") return credencialDaLeitura("biometria", a.employeeNo);
    if (a.codigo) return credencialDaLeitura("qrcode", "");
    const cartao = numeroDoAcesso(a);
    return cartao ? credencialDaLeitura("cartao", cartao) : null;
  };

  app.post(CAMINHO_EVENTOS, async (req, reply) => {
    const ip = ipDoEquipamento(req.ip);
    const aparelho = nomeDe(ip);
    gateway.equipamentos.hikvisionVisto(aparelho);
    const b = req.body;
    const corpo = Buffer.isBuffer(b) ? b : Buffer.from(typeof b === "string" ? b : JSON.stringify(b ?? {}));
    const contentType = req.headers["content-type"] ?? (Buffer.isBuffer(b) ? null : "application/json");
    const acessos = eventosDoCorpo(corpo, contentType)
      .map(acessoDoEvento)
      .filter((a): a is AcessoHikvision => a !== null);
    // Porta, alarme, batimento: avisos que não pedem decisão.
    if (!acessos.length) return reply.code(200).send();

    const saida = (a: AcessoHikvision) => a.leitor !== null && (opcoes.leitoresDeSaida?.(ip) ?? []).includes(a.leitor);
    const pedido = acessos.find((a) => ehPedidoDeAgora(a));

    if (pedido) {
      // Lembrado para o reenvio deste mesmo pedido, mais tarde, não virar presença.
      jaVisto(aparelho, pedido);
      const decisao = await decidir(pedido);
      return reply.code(200).type("application/json").send(decisao);
    }

    let registrados = 0;
    for (const a of acessos) {
      // O resultado da decisão que o Gateway acabou de dar: já está registrado.
      if (a.resultadoDaDecisao) continue;
      if (classificarAcesso(a) !== "aceito" || saida(a) || !a.quando) continue;
      const credencial = credencialDe(a);
      if (!credencial || credencial.tipo !== "identificador_catraca" || jaVisto(aparelho, a)) continue;
      await gateway.registrarBilheteEquipamento(credencial.valor, a.quando.toISOString()).catch(() => undefined);
      registrados++;
    }
    if (registrados) logger.info({ aparelho, registrados }, "Acessos que o aparelho Hikvision decidiu sozinho viraram presença");
    return reply.code(200).send();

    async function decidir(a: AcessoHikvision) {
      if (saida(a)) {
        logger.info({ aparelho, leitor: a.leitor }, "Saída pelo aparelho Hikvision: liberada sem consulta");
        return respostaDaDecisao(a.serial, true);
      }
      const credencial = credencialDe(a);
      if (!credencial) {
        logger.warn({ aparelho, evento: a.menor, codigo: a.codigo }, "Aparelho Hikvision pediu decisão sem aluno nem cartão — negado");
        return respostaDaDecisao(a.serial, false, a.codigo ? "" : "credencial não cadastrada");
      }
      try {
        const resultado = await gateway.validarCredencial(credencial, { aguardarGiro: false });
        // Na contingência a decisão é do cache, e o registro sobe depois.
        await gateway.registrarAcessoOffline(`id:${credencial.valor}`, resultado);
        logger.info(
          { aparelho, identificador: credencial.valor, liberado: resultado.liberado, offline: resultado.validadoOffline, evento: a.menor },
          "Decisão de acesso devolvida ao aparelho Hikvision"
        );
        return respostaDaDecisao(a.serial, resultado.liberado, resultado.mensagem ?? "");
      } catch (err) {
        // O aparelho está esperando: na dúvida, nega, e a frase não expõe nada.
        logger.error({ err: (err as Error).message, aparelho }, "Falha ao decidir o acesso do aparelho Hikvision — negado");
        return respostaDaDecisao(a.serial, false, "");
      }
    }
  });
}
