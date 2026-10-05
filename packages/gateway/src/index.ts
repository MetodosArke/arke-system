import path from "node:path";
import fs from "node:fs";
import { carregarConfig, ConfigError, equipamentosToletus, leitoresFaciais } from "./config";
import { CloudClient } from "./cloud/client";
import { AlunosCache } from "./offline/alunosCache";
import { LogsQueue } from "./offline/logsQueue";
import { criarDriver } from "./drivers";
import { GatewayService } from "./core/gatewayService";
import { criarServidorLocal, criarServidorReceptor } from "./server/localServer";
import { resolverComoLiberar } from "./receptores/controlid";
import { ipsPermitidos } from "./server/origemEquipamento";
import { logger } from "./logger";
import { ExecutorComandos } from "./core/executorComandos";
import { GestaoControlId, type GestaoEquipamentos } from "./equipamentos/controlidGestao";
import { ConectorToletus, GestaoToletus } from "./conectores/toletus/conector";
import { ConectorFacialTopdata, GestaoTopdataFacial } from "./conectores/topdataFacial/conector";
import { ConectorIntelbras, GestaoIntelbras } from "./conectores/intelbras/conector";
import { VERSAO_GATEWAY } from "./versao";

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
  // Intelbras também: o terminal chama o Gateway no Modo Online, na mesma
  // porta. O conector existe antes do receptor para dar nome a cada terminal
  // pelo IP, e inicia depois da primeira sincronização (é ela que diz quem
  // desativar no terminal).
  const conectorIntelbras =
    config.modelo_catraca === "intelbras"
      ? new ConectorIntelbras(gateway, config.intelbras_equipamentos ?? [], {
          porta: config.escuta_porta,
          endereco: config.intelbras_endereco ?? null,
          configurar: config.intelbras_configurar ?? true,
        })
      : null;
  const MODELOS_RECEPTOR = ["controlid", "topdata", "intelbras"];
  // Só os equipamentos do config falam com o receptor (ver
  // origemEquipamento.ts). Na Topdata quem chama é a ponte, na própria máquina.
  const permitidos = ipsPermitidos(config);
  if (["controlid", "intelbras"].includes(config.modelo_catraca) && permitidos.size === 0) {
    logger.warn(
      "Nenhum equipamento listado no config: o receptor atende qualquer aparelho da rede. " +
        "Ponha o IP da catraca em equipamentos_permitidos (ou nas listas de equipamentos)."
    );
  }
  if (MODELOS_RECEPTOR.includes(config.modelo_catraca)) {
    const receptor = criarServidorReceptor(gateway, {
      host: config.escuta_host,
      porta: config.escuta_porta,
      modelo: config.modelo_catraca,
      confirmacaoGiro: config.confirmacao_giro,
      timeoutGiroMs: config.timeout_giro_ms,
      leitorDeEntrada: config.topdata_leitor_entrada,
      // Como cada Control iD libera (catraca, relé ou SecBox), pelo IP de
      // quem chama. Antes, toda resposta era a da catraca, no sentido
      // horário, mesmo com outra entrada configurada.
      comoLiberar: resolverComoLiberar(config),
      ...(conectorIntelbras ? { intelbras: { nomePorIp: (ip: string) => conectorIntelbras.nomePorIp(ip) } } : {}),
      ipsPermitidos: permitidos,
    });
    await receptor.iniciar();
  }

  await gateway.iniciar();
  if (conectorIntelbras) await conectorIntelbras.iniciar();

  // Toletus: na LiteNet2 a placa escuta na porta 7878 e quem disca é o
  // Gateway; na LiteNet3 o Gateway anuncia o endereço e a placa disca.
  // Sobe depois da primeira sincronização, para a primeira leitura já
  // encontrar o cache cheio se a nuvem cair. Placa fora do ar não derruba
  // nada: o conector tenta de novo sozinho. A porta da LiteNet3 ocupada,
  // sim: sem ela nenhuma placa LiteNet3 alcança o Gateway.
  let conectorToletus: ConectorToletus | null = null;
  if (config.modelo_catraca === "toletus") {
    conectorToletus = new ConectorToletus(gateway, equipamentosToletus(config), {
      timeoutGiroMs: config.timeout_giro_ms,
      litenet3: {
        host: config.escuta_host,
        porta: config.toletus_litenet3_porta,
        enderecoAnunciado: config.toletus_litenet3_endereco ?? null,
      },
    });
    const conector = conectorToletus;
    gateway.equipamentos.fonteToletus(() => conector.estados());
    await conector.iniciar();
  }

  // Leitores faciais da Topdata. Na linha Easy (modelo topdata_facial) eles
  // decidem com a nossa resposta; na Fit 4 Facial (modelo topdata, com a
  // ponte) só guardam o cadastro. Nos dois casos quem disca é o leitor, e a
  // porta ocupada derruba a inicialização, pelo mesmo motivo do receptor.
  let conectorFacial: ConectorFacialTopdata | null = null;
  const faciais = leitoresFaciais(config);
  if (faciais.length && (config.modelo_catraca === "topdata_facial" || config.modelo_catraca === "topdata")) {
    conectorFacial = new ConectorFacialTopdata(gateway, faciais, {
      funcao: config.modelo_catraca === "topdata_facial" ? "decide" : "identifica",
      host: config.escuta_host,
      porta: config.topdata_facial_porta,
    });
    const conector = conectorFacial;
    gateway.equipamentos.fonteFacial(() => conector.estados());
    await conector.iniciar();
  }

  // Canal de ida e volta com a nuvem: telemetria, "sincronize agora" e a
  // gestão do equipamento (cadastro e remoção do aluno, liberação remota).
  // Falha aqui nunca derruba o gateway — a catraca continua validando; o
  // canal tenta de novo sozinho, com espera crescente.
  const gestao: GestaoEquipamentos | null = config.controlid_equipamentos?.length
    ? new GestaoControlId(config.controlid_equipamentos)
    : conectorIntelbras?.nomes().length
      ? new GestaoIntelbras(conectorIntelbras)
      : conectorFacial
        ? new GestaoTopdataFacial(conectorFacial)
        : conectorToletus
          ? new GestaoToletus(conectorToletus)
          : null;
  const executor = new ExecutorComandos(cloud, gateway, gestao, { modelo: config.modelo_catraca });
  executor.iniciar();

  logger.info(
    {
      versao: VERSAO_GATEWAY,
      modelo: config.modelo_catraca,
      catraca: `${config.catraca_ip}:${config.catraca_porta}`,
      gestaoRemota: gestao?.nomes() ?? [],
    },
    "ARKE® Gateway Local iniciado"
  );

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
    executor.parar();
    conectorToletus?.parar();
    conectorFacial?.parar();
    conectorIntelbras?.parar();
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
