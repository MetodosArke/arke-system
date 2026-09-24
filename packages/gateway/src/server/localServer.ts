import Fastify from "fastify";
import type { GatewayService } from "../core/gatewayService";
import { registrarReceptorControlId, type OpcoesReceptorControlId } from "../receptores/controlid";
import { registrarReceptorTopdata, type OpcoesReceptorTopdata } from "../receptores/topdata";
import { logger } from "../logger";
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
  opcoes: { host?: string; porta?: number; modelo?: string } & OpcoesReceptorControlId &
    OpcoesReceptorTopdata = {}
) {
  const host = opcoes.host ?? "0.0.0.0";
  const porta = opcoes.porta ?? 4571;
  const app = Fastify({ logger: false });

  // As rotas dos dois fabricantes não colidem — Control iD usa os
  // caminhos .fcgi que o próprio equipamento chama, e a ponte Topdata usa
  // /topdata/*. Registrar ambas evita um segundo servidor e deixa uma
  // academia com catracas de marcas diferentes funcionar sem ajuste.
  registrarReceptorControlId(app, gateway, opcoes);
  registrarReceptorTopdata(app, gateway, opcoes);

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
