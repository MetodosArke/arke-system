import type { FastifyInstance } from "fastify";
import type { GatewayService } from "../core/gatewayService";
import { logger } from "../logger";
import type { Giro } from "../types";
import { credencialDaLeitura, displayDaLeituraRecusada, type OrigemLeitura } from "../core/credencial";
import { mensagemDoDisplay } from "../core/display";

/**
 * Receptor Topdata — lado do gateway.
 *
 * Diferente da Control iD, a Topdata não expõe protocolo de fio. A
 * integração sancionada é a `EasyInner.dll`, e o manual oficial do SDK
 * Inner Acesso é explícito sobre três coisas que decidem a arquitetura:
 *
 *   1. a DLL é Windows **32 bits** e exige .NET Framework 3.5;
 *   2. ela é **bloqueante** — `ReceberDadosOnLine()` pausa a thread até
 *      chegar evento ou estourar timeout;
 *   3. ela **não é thread-safe** — o acesso precisa ser serializado numa
 *      única thread dedicada.
 *
 * Nenhuma das três combina com Node. Uma chamada bloqueante via FFI
 * congelaria o event loop, e com ele o receptor HTTP da Control iD, o
 * servidor de diagnóstico e os timers de sincronização — o gateway
 * inteiro pararia a cada leitura de cartão. O próprio manual indica a
 * saída (§1.2.1): construir uma camada intermediária que traduz
 * requisições web para chamadas da DLL.
 *
 * É o que esta rota atende. Um processo-ponte em .NET (`ArkeInnerBridge`)
 * possui a DLL, roda a máquina de estados documentada no manual numa
 * thread só, e conversa com o gateway por HTTP local. O gateway continua
 * sendo quem decide o acesso — a ponte não conhece regra de negócio.
 *
 * O ganho da correção de arquitetura feita antes aparece aqui: a Topdata
 * entra como mais um cliente do modelo de escuta que já existe, sem tocar
 * em `GatewayService`, no cache offline nem na fila de logs.
 */

/**
 * Códigos de origem do evento, transcritos da tabela do manual (§4.3.2).
 * Não são invenção nossa: são o vocabulário que a DLL devolve no
 * parâmetro `Origem` de `ReceberDadosOnLine()`.
 */
export const ORIGEM_TOPDATA = {
  TECLADO: 1,
  LEITOR1: 2,
  LEITOR2: 3,
  FIM_TEMPO_ACIONAMENTO: 5,
  GIRO_CONFIRMADO: 6,
  SENSOR_BIOMETRICO: 12,
  QRCODE: 21,
} as const;

export type SentidoCatraca = "entrada" | "saida" | "ambos";

/** O que a ponte manda ao gateway a cada evento vindo da DLL. */
interface EventoTopdata {
  /** Número do Inner (1 a 99), que identifica o equipamento na rede. */
  inner?: number | string;
  origem?: number | string;
  /** Conteúdo lido: número do cartão, dígitos do teclado ou id do usuário na biometria. */
  valor?: string;
  /**
   * O `tipo_leitor` do `ponte.config.json` (desde a ponte da 1.9): diz se os
   * leitores 1 e 2 leem cartão ou código de barras. A origem sozinha não diz.
   */
  tipo_leitor?: number | string;
}

/**
 * Tipos de leitor do SDK que leem código impresso (§ConfigurarTipoLeitor):
 * 0 barras, 5 barras serial, 7 barras/proximidade/QR. No 7 a leitura de
 * cartão e a de código chegam pela mesma origem, sem como separar; vale a
 * regra mais segura.
 */
const TIPOS_LEITOR_DE_CODIGO = new Set([0, 5, 7]);

/**
 * A origem do evento no vocabulário comum das marcas (`core/credencial.ts`).
 * Origem que o manual não lista para leitura não identifica ninguém.
 */
export function origemDaLeitura(origem: number, tipoLeitor?: number): OrigemLeitura | null {
  switch (origem) {
    case ORIGEM_TOPDATA.TECLADO:
      return "teclado";
    case ORIGEM_TOPDATA.SENSOR_BIOMETRICO:
      return "biometria";
    case ORIGEM_TOPDATA.QRCODE:
      return "qrcode";
    case ORIGEM_TOPDATA.LEITOR1:
    case ORIGEM_TOPDATA.LEITOR2:
      // Ponte anterior à 1.9 não manda o tipo: vale o padrão dela (Wiegand).
      return tipoLeitor !== undefined && TIPOS_LEITOR_DE_CODIGO.has(tipoLeitor) ? "codigo_barras" : "cartao";
    default:
      return null;
  }
}

/**
 * Resposta que a ponte traduz em chamada da DLL:
 * `liberar: true` vira `LiberarCatracaEntrada/Saida/DoisSentidos`,
 * `liberar: false` vira mensagem de negado no display.
 *
 * `motivo` é o texto do display, que é público: "Bem-vindo!" ou uma
 * negativa curta que não fala de dinheiro (`mensagemDoDisplay`). O nome do
 * aluno não vai: até a 1.8 ia, e a ponte o escrevia no display.
 */
interface DecisaoTopdata {
  liberar: boolean;
  sentido?: SentidoCatraca;
  motivo: string;
}

export interface OpcoesReceptorTopdata {
  /**
   * Qual leitor físico é a entrada. O manual deixa isso a cargo de
   * `ConfigurarLeitor1/2`, então é decisão de instalação — e um dos itens
   * que só a bancada confirma.
   */
  leitorDeEntrada?: 1 | 2;
  /**
   * Quanto esperar o aviso de giro (origem 5 ou 6) antes de fechar o acesso
   * como "sem confirmação". A ponte desiste antes (20 s); este é o limite de
   * quem esquece — sem ele um aviso perdido deixaria o acesso pendurado.
   */
  timeoutGiroMs?: number;
}

/**
 * Decide o sentido do giro a partir de qual leitor originou o evento.
 *
 * Exportada porque é a única regra com ramificação real aqui, e testá-la
 * isolada vale mais do que exercitá-la por acidente através da rota.
 */
export function sentidoPorOrigem(
  origem: number,
  leitorDeEntrada: 1 | 2 = 1
): SentidoCatraca {
  if (origem === ORIGEM_TOPDATA.LEITOR1) return leitorDeEntrada === 1 ? "entrada" : "saida";
  if (origem === ORIGEM_TOPDATA.LEITOR2) return leitorDeEntrada === 1 ? "saida" : "entrada";
  // Biometria, QR e teclado não dizem por qual lado a pessoa veio: o
  // equipamento resolve pela configuração dos leitores. Liberar nos dois
  // sentidos deixa a catraca decidir, em vez de nós chutarmos.
  return "ambos";
}

/** Acesso liberado esperando o aviso de giro daquele Inner. */
type GiroPendente = { logId?: string; localId?: string | null; timer: NodeJS.Timeout };

/**
 * A ponte roda na mesma máquina, por desenho: é ela que carrega a DLL, e a
 * DLL fica no computador em que a catraca disca. O receptor escuta na rede
 * da academia por causa da Control iD, mas as rotas da ponte não têm por
 * que atender outro endereço — sem isto, qualquer aparelho da rede poderia
 * perguntar "o identificador 123 é de quem?" e colher nomes de alunos.
 */
function daPropriaMaquina(ip: string | undefined): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

export function registrarReceptorTopdata(
  app: FastifyInstance,
  gateway: GatewayService,
  opcoes: OpcoesReceptorTopdata = {}
): void {
  const leitorDeEntrada = opcoes.leitorDeEntrada ?? 1;
  const timeoutGiroMs = opcoes.timeoutGiroMs ?? 30_000;

  // Um acesso por vez em cada Inner: numa borboleta passa uma pessoa por
  // vez, e a ponte só lê a próxima depois de o giro terminar. Por isso a
  // chave é o número do equipamento, sem precisar de id de transação.
  const pendentes = new Map<string, GiroPendente>();

  const fechar = (inner: string, giro: Giro, origem: string) => {
    const p = pendentes.get(inner);
    if (!p) return;
    clearTimeout(p.timer);
    pendentes.delete(inner);
    logger.info({ inner, giro, origem }, "Giro da catraca Topdata registrado");
    void gateway.concluirGiro({ logId: p.logId, localId: p.localId }, giro);
  };

  app.addHook("onClose", async () => {
    for (const p of pendentes.values()) clearTimeout(p.timer);
    pendentes.clear();
  });

  app.post("/topdata/evento", async (req, reply) => {
    if (!daPropriaMaquina(req.ip)) return reply.code(403).send({ error: "Só a ponte local." });
    const corpo = (req.body ?? {}) as EventoTopdata;
    const origem = Number(corpo.origem);
    const inner = String(corpo.inner ?? "");
    const valor = (corpo.valor ?? "").trim();

    // Eventos que não pedem decisão: encerram o ciclo do giro. A Topdata
    // sempre avisa — giro (6) ou tempo esgotado (5) —, então é aqui que o
    // acesso liberado vira presença ou desistência, como o catra_event da
    // Control iD. Devolver "negado" faria a ponte exibir acesso negado a
    // quem já passou.
    if (origem === ORIGEM_TOPDATA.GIRO_CONFIRMADO) {
      fechar(inner, "confirmado", "giro");
      return { liberar: false, motivo: "giro_confirmado" } satisfies DecisaoTopdata;
    }
    if (origem === ORIGEM_TOPDATA.FIM_TEMPO_ACIONAMENTO) {
      fechar(inner, "desistencia", "tempo esgotado sem giro");
      return { liberar: false, motivo: "giro_nao_ocorreu" } satisfies DecisaoTopdata;
    }

    if (!valor) {
      logger.warn({ inner, origem }, "Evento Topdata sem conteúdo lido");
      return { liberar: false, motivo: "Leitura vazia" } satisfies DecisaoTopdata;
    }

    // A regra de todas as marcas (core/credencial.ts): no teclado só o CPF,
    // porque os números do equipamento são pequenos e sequenciais e a catraca
    // não tem senha para conferir; código de barras e QR não identificam
    // ninguém, pela mesma razão; cartão e biometria são o número do equipamento.
    const tipoLeitor = corpo.tipo_leitor === undefined || corpo.tipo_leitor === "" ? undefined : Number(corpo.tipo_leitor);
    const deOnde = origemDaLeitura(origem, Number.isInteger(tipoLeitor) ? tipoLeitor : undefined);
    const credencial = deOnde ? credencialDaLeitura(deOnde, valor) : null;
    if (!credencial) {
      logger.info(
        { inner, origem, tipoLeitor },
        deOnde === "teclado"
          ? "Teclado sem CPF: negado sem consultar a nuvem"
          : "Leitura que não identifica aluno (código de barras, QR ou origem desconhecida): negado sem consultar a nuvem"
      );
      return { liberar: false, motivo: displayDaLeituraRecusada(deOnde ?? "") } satisfies DecisaoTopdata;
    }

    // Leitura nova com um giro ainda aberto no mesmo Inner: o aviso do
    // anterior se perdeu. Fecha como sem confirmação (conta presença) antes
    // de abrir o próximo, senão o novo aviso fecharia o acesso errado.
    if (pendentes.has(inner)) fechar(inner, "sem_confirmacao", "nova leitura antes do aviso");

    const resultado = await gateway.validarCredencial(credencial, { aguardarGiro: true });

    logger.info(
      { inner, origem, liberado: resultado.liberado, offline: resultado.validadoOffline },
      "Decisão de acesso devolvida à ponte Topdata"
    );

    // Na contingência ninguém gravou nada ainda: sem isto, o acesso decidido
    // pelo cache durante uma queda de internet se perdia — o mesmo defeito
    // que a Control iD tinha.
    const localId = await gateway.registrarAcessoOffline(
      credencial.tipo === "cpf" ? credencial.valor : `id:${credencial.valor}`,
      resultado,
      resultado.liberado ? "pendente" : undefined
    );

    if (resultado.liberado) {
      const timer = setTimeout(() => fechar(inner, "sem_confirmacao", "prazo esgotado"), timeoutGiroMs);
      timer.unref?.();
      pendentes.set(inner, { logId: resultado.logId, localId, timer });
    }

    // O display é público: a ponte escreve `motivo` nele, então vai a frase
    // de todas as marcas, e não o texto da nuvem nem o nome do aluno.
    return (
      resultado.liberado
        ? {
            liberar: true,
            sentido: sentidoPorOrigem(origem, leitorDeEntrada),
            motivo: mensagemDoDisplay(true, resultado.mensagem),
          }
        : { liberar: false, motivo: mensagemDoDisplay(false, resultado.mensagem) }
    ) satisfies DecisaoTopdata;
  });

  /**
   * Passagens que a catraca guardou sozinha (bilhetes), coletadas pela ponte
   * quando o equipamento volta a falar com ela. A ponte só as apaga do
   * arquivo dela depois deste 200.
   */
  app.post("/topdata/bilhetes", async (req, reply) => {
    if (!daPropriaMaquina(req.ip)) return reply.code(403).send({ error: "Só a ponte local." });
    const corpo = (req.body ?? {}) as {
      inner?: number;
      bilhetes?: { tipo?: number; valor?: string; ocorrido_em?: string }[];
    };
    const bilhetes = Array.isArray(corpo.bilhetes) ? corpo.bilhetes : [];
    let registrados = 0;
    for (const b of bilhetes) {
      const quando = b.ocorrido_em && !Number.isNaN(Date.parse(b.ocorrido_em)) ? b.ocorrido_em : new Date().toISOString();
      await gateway.registrarBilheteEquipamento(String(b.valor ?? "").trim(), quando);
      registrados++;
    }
    if (registrados > 0) {
      // Com a configuração da ponte a catraca não deveria liberar ninguém
      // sozinha. Bilhete existindo é informação que alguém precisa ver.
      logger.warn({ inner: corpo.inner, registrados }, "Catraca Topdata tinha passagens registradas por conta própria");
    }
    return { registrados };
  });

  /**
   * Sinal de vida da ponte. Não é o `PingOnline` do manual — esse a ponte
   * envia à catraca por conta própria. Este diz ao gateway que a ponte
   * está de pé e quais equipamentos estão conectados, para o diagnóstico
   * distinguir "catraca parada" de "ponte caída", que exigem providências
   * diferentes. Registra só quando muda, para não encher o log a cada 30 s.
   */
  let ultimoEstado = "";
  app.post("/topdata/ponte-viva", async (req, reply) => {
    if (!daPropriaMaquina(req.ip)) return reply.code(403).send({ error: "Só a ponte local." });
    const corpo = (req.body ?? {}) as { inners?: number[]; conectados?: number[] };
    const numeros = (l: unknown) => (Array.isArray(l) ? l.map(Number).filter((n) => Number.isInteger(n)) : []);
    gateway.equipamentos.ponteViva(numeros(corpo.inners), numeros(corpo.conectados));
    const estado = JSON.stringify({ inners: corpo.inners ?? [], conectados: corpo.conectados ?? [] });
    if (estado !== ultimoEstado) {
      ultimoEstado = estado;
      logger.info({ inners: corpo.inners, conectados: corpo.conectados }, "Ponte Topdata: equipamentos conectados");
    }
    return reply.code(200).send({ ok: true });
  });
}
