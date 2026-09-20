import type { FastifyInstance } from "fastify";
import type { GatewayService } from "../core/gatewayService";
import { logger } from "../logger";

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
}

/**
 * Resposta que a ponte traduz em chamada da DLL:
 * `liberar: true` vira `LiberarCatracaEntrada/Saida/DoisSentidos`,
 * `liberar: false` vira mensagem de negado no display.
 */
interface DecisaoTopdata {
  liberar: boolean;
  sentido?: SentidoCatraca;
  nome?: string;
  motivo: string;
}

export interface OpcoesReceptorTopdata {
  /**
   * Qual leitor físico é a entrada. O manual deixa isso a cargo de
   * `ConfigurarLeitor1/2`, então é decisão de instalação — e um dos itens
   * que só a bancada confirma.
   */
  leitorDeEntrada?: 1 | 2;
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

export function registrarReceptorTopdata(
  app: FastifyInstance,
  gateway: GatewayService,
  opcoes: OpcoesReceptorTopdata = {}
): void {
  const leitorDeEntrada = opcoes.leitorDeEntrada ?? 1;

  app.post("/topdata/evento", async (req): Promise<DecisaoTopdata> => {
    const corpo = (req.body ?? {}) as EventoTopdata;
    const origem = Number(corpo.origem);
    const valor = (corpo.valor ?? "").trim();

    // Eventos que não pedem decisão: só encerram o ciclo do giro. O
    // registro do acesso liberado já foi gravado na validação, então
    // aqui não há o que decidir — devolver isso como "negado" faria a
    // ponte exibir acesso negado depois de a pessoa já ter passado.
    if (origem === ORIGEM_TOPDATA.GIRO_CONFIRMADO) {
      logger.info({ inner: corpo.inner }, "Giro confirmado na catraca Topdata");
      return { liberar: false, motivo: "giro_confirmado" };
    }
    if (origem === ORIGEM_TOPDATA.FIM_TEMPO_ACIONAMENTO) {
      logger.warn({ inner: corpo.inner }, "Tempo de liberação expirou sem giro na catraca Topdata");
      return { liberar: false, motivo: "giro_nao_ocorreu" };
    }

    if (!valor) {
      logger.warn({ inner: corpo.inner, origem }, "Evento Topdata sem conteúdo lido");
      return { liberar: false, motivo: "Leitura vazia." };
    }

    // Só os dígitos: o teclado devolve o que a pessoa digitou, e em
    // academia isso costuma ser o CPF. Onze dígitos que fecham o
    // verificador são tratados como CPF; o resto é identificador do
    // equipamento, igual ao caminho da Control iD.
    const somenteDigitos = valor.replace(/\D/g, "");
    const ehCpf = origem === ORIGEM_TOPDATA.TECLADO && somenteDigitos.length === 11;

    const resultado = await gateway.validarCredencial(
      ehCpf
        ? { tipo: "cpf", valor: somenteDigitos }
        : { tipo: "identificador_catraca", valor }
    );

    logger.info(
      { inner: corpo.inner, origem, liberado: resultado.liberado, offline: resultado.validadoOffline },
      "Decisão de acesso devolvida à ponte Topdata"
    );

    return resultado.liberado
      ? {
          liberar: true,
          sentido: sentidoPorOrigem(origem, leitorDeEntrada),
          nome: resultado.nomeAluno,
          motivo: resultado.mensagem,
        }
      : { liberar: false, nome: resultado.nomeAluno, motivo: resultado.mensagem };
  });

  /**
   * Sinal de vida da ponte. Não é o `PingOnline` do manual — esse a ponte
   * envia à catraca por conta própria. Este diz ao gateway que a ponte
   * está de pé, para o diagnóstico distinguir "catraca parada" de "ponte
   * caída", que exigem providências diferentes.
   */
  app.post("/topdata/ponte-viva", async (req, reply) => {
    const corpo = (req.body ?? {}) as { inners?: number[] };
    logger.info({ inners: corpo.inners }, "Ponte Topdata reportando atividade");
    return reply.code(200).send({ ok: true });
  });
}
