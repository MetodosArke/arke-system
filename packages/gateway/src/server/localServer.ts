import Fastify from "fastify";
import type { GatewayService } from "../core/gatewayService";
import { logger } from "../logger";

/**
 * Servidor HTTP local (não exposto fora de localhost) para diagnóstico:
 * a bandeja do sistema e ferramentas de suporte podem consultar
 * /status sem precisar ler os logs.
 */
export function criarServidorLocal(gateway: GatewayService, porta = 4570) {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true }));

  app.get("/status", async () => ({
    status: gateway.getStatus(),
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
