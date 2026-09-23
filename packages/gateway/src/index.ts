import path from "node:path";
import fs from "node:fs";
import { carregarConfig, ConfigError } from "./config";
import { CloudClient } from "./cloud/client";
import { AlunosCache } from "./offline/alunosCache";
import { LogsQueue } from "./offline/logsQueue";
import { criarDriver } from "./drivers";
import { GatewayService } from "./core/gatewayService";
import { criarServidorLocal, criarServidorReceptor } from "./server/localServer";
import { logger } from "./logger";

async function main() {
  let config;
  try {
    config = carregarConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.fatal(err.message);
      process.exit(1);
    }
    throw err;
  }

  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const cloud = new CloudClient(config);
  const alunosCache = new AlunosCache(dataDir);
  const logsQueue = new LogsQueue(dataDir);
  const driver = criarDriver(config);

  const gateway = new GatewayService(config, driver, cloud, alunosCache, logsQueue);

  const servidorLocal = criarServidorLocal(gateway);
  await servidorLocal.iniciar();

  // Modelos de escuta: o equipamento disca para nós. Sem esta porta aberta
  // na rede da academia a catraca não tem como validar nada, então uma
  // falha aqui derruba a inicialização em vez de virar aviso — subir o
  // gateway "quase funcionando" seria pior do que não subir.
  // Topdata entra aqui apesar de a DLL ser da ponte .NET: o que o gateway
  // precisa abrir é a mesma porta de escuta, só que o cliente passa a ser
  // a ponte em vez do equipamento.
  const MODELOS_RECEPTOR = ["controlid", "topdata"];
  if (MODELOS_RECEPTOR.includes(config.modelo_catraca)) {
    const receptor = criarServidorReceptor(gateway, {
      host: config.escuta_host,
      porta: config.escuta_porta,
      modelo: config.modelo_catraca,
      confirmacaoGiro: config.confirmacao_giro,
      timeoutGiroMs: config.timeout_giro_ms,
      leitorDeEntrada: config.topdata_leitor_entrada,
    });
    await receptor.iniciar();
  }

  await gateway.iniciar();
  logger.info({ modelo: config.modelo_catraca, catraca: `${config.catraca_ip}:${config.catraca_porta}` }, "ARKE® Gateway Local iniciado");

  // A bandeja do sistema depende de um ambiente com GUI (Windows/desktop
  // Linux) — em servidores/CI (como este processo pode rodar durante
  // testes) ela simplesmente não existe, então isso nunca deve derrubar o
  // serviço principal.
  if (process.env.GATEWAY_DISABLE_TRAY !== "1") {
    try {
      const { criarSystray } = await import("./tray/tray");
      criarSystray(gateway);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Bandeja do sistema indisponível neste ambiente — gateway segue rodando sem ícone");
    }
  }

  const encerrar = async () => {
    logger.info("Encerrando ARKE® Gateway Local...");
    await gateway.parar();
    process.exit(0);
  };
  process.on("SIGINT", encerrar);
  process.on("SIGTERM", encerrar);
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message, stack: (err as Error).stack }, "Falha fatal ao iniciar o gateway");
  process.exit(1);
});
