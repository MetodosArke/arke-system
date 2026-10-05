import Fastify from "fastify";
import type { GatewayService } from "../core/gatewayService";
import { registrarReceptorControlId, type OpcoesReceptorControlId } from "../receptores/controlid";
import { registrarReceptorTopdata, type OpcoesReceptorTopdata } from "../receptores/topdata";
import { registrarReceptorIntelbras, type OpcoesReceptorIntelbras } from "../conectores/intelbras/receptor";
import { logger } from "../logger";
import { origemPermitida, rotaSemFiltro } from "./origemEquipamento";
import { VERSAO_GATEWAY } from "../versao";

/**
 * Servidor HTTP local (não exposto fora de localhost) para diagnóstico:
 * a bandeja do sistema e ferramentas de suporte podem consultar
 * /status sem precisar ler os logs.
 */
export function criarServidorLocal(gateway: GatewayService, porta = 4570) {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true }));

  // O que o técnico precisa na instalação sem abrir log: a nuvem responde?
  // a fila offline está andando? a catraca chegou até aqui? Nada de aluno —
  // só contagens — porque qualquer programa da própria máquina lê isto.
  app.get("/status", async () => ({
    ...(await gateway.estado()),
    ...gateway.equipamentos.paraTelemetria(),
    versao: VERSAO_GATEWAY,
    verificadoEm: new Date().toISOString(),
  }));

  const iniciar = async () => {
    try {
      await app.listen({ port: porta, host: "127.0.0.1" });
      logger.info({ porta }, "Servidor local de diagnóstico no ar");
    } catch (err) {
      logger.warn({ err: (err as Error).message, porta }, "Não foi possível abrir o servidor local de diagnóstico");
    }
  };

  return { app, iniciar };
}

/**
 * Servidor que ESCUTA o equipamento.
 *
 * Instância separada da de diagnóstico de propósito. O diagnóstico é
 * deliberadamente preso em 127.0.0.1; a catraca precisa alcançar o gateway
 * pela rede da academia. Servir as duas coisas no mesmo listener
 * significaria expor /status para qualquer máquina da LAN — regressão de
 * postura em troca de nada.
 */
export function criarServidorReceptor(
  gateway: GatewayService,
  opcoes: {
    host?: string;
    porta?: number;
    modelo?: string;
    intelbras?: OpcoesReceptorIntelbras;
    /** IPs dos equipamentos (ver origemEquipamento.ts). Ausente: sem filtro. */
    ipsPermitidos?: ReadonlySet<string>;
  } & OpcoesReceptorControlId &
    OpcoesReceptorTopdata = {}
) {
  const host = opcoes.host ?? "0.0.0.0";
  const porta = opcoes.porta ?? 4571;
  const app = Fastify({ logger: false });

  // Só os equipamentos do config falam com o receptor. A recusa vai ao log
  // uma vez a cada 10 minutos por IP, para um aparelho insistente não encher
  // o disco da recepção.
  if (opcoes.ipsPermitidos) {
    const permitidos = opcoes.ipsPermitidos;
    const ultimoAviso = new Map<string, number>();
    app.addHook("onRequest", async (req, reply) => {
      if (rotaSemFiltro(req.url) || origemPermitida(permitidos, req.ip)) return;
      const agora = Date.now();
      if ((ultimoAviso.get(req.ip) ?? 0) + 600_000 < agora) {
        ultimoAviso.set(req.ip, agora);
        logger.warn(
          { ip: req.ip, rota: req.url.split("?")[0] },
          "Chamada ao receptor de um aparelho fora da lista de equipamentos — recusada"
        );
      }
      return reply.code(403).send();
    });
  }

  // As rotas dos dois fabricantes não colidem — Control iD usa os
  // caminhos .fcgi que o próprio equipamento chama, e a ponte Topdata usa
  // /topdata/*. Registrar ambas evita um segundo servidor e deixa uma
  // academia com catracas de marcas diferentes funcionar sem ajuste.
  registrarReceptorControlId(app, gateway, opcoes);
  registrarReceptorTopdata(app, gateway, opcoes);
  // Intelbras (Modo Online): /keepalive e /notification, na mesma porta.
  if (opcoes.intelbras) registrarReceptorIntelbras(app, gateway, opcoes.intelbras);

  // Sonda de vida da própria porta do receptor: o técnico de instalação
  // precisa confirmar da rede que o gateway está alcançável, sem depender
  // de ter a catraca já configurada.
  app.get("/health", async () => ({ ok: true, receptor: opcoes.modelo ?? "controlid", versao: VERSAO_GATEWAY }));

  const iniciar = async () => {
    try {
      await app.listen({ port: porta, host });
      logger.info({ host, porta }, "Receptor de catraca no ar — aguardando o equipamento");
    } catch (err) {
      logger.error(
        { err: (err as Error).message, host, porta },
        "Não foi possível abrir o receptor de catraca — o equipamento não vai conseguir validar acesso"
      );
      throw err;
    }
  };

  return { app, iniciar };
}
