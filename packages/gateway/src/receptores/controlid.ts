import type { FastifyInstance } from "fastify";
import type { GatewayService } from "../core/gatewayService";
import type { ConfirmacaoGiro, GatewayConfig, Giro } from "../types";
import { logger } from "../logger";

/**
 * Receptor do modo Pro da Control iD.
 *
 * Aqui mora a correção de direção que a documentação do fabricante nos
 * obrigou a fazer. O desenho original do gateway assumia que NÓS
 * discaríamos para a catraca por socket TCP. É o contrário: o equipamento
 * é o cliente HTTP e nós somos o servidor. Ele faz POST a cada leitura e
 * espera, na resposta da MESMA requisição, o comando que gira (ou não) a
 * borboleta.
 *
 * Divisão de trabalho no modo Pro, que é o que serve para academia:
 *   - a digital é comparada DENTRO do equipamento (1:N local);
 *   - o equipamento manda "identifiquei o usuário N";
 *   - nós respondemos liberado/negado pela regra de adimplência.
 *
 * Isso mantém dado biométrico fora da rede e ainda assim põe a decisão
 * comercial do lado de cá, que é a razão de o ARKE existir nesse fluxo.
 *
 * Referência: https://www.controlid.com.br/docs/access-api-pt/modos-de-operacao/eventos-de-identificacao-online/
 */

/** Códigos de evento do protocolo. Nomeados para o corpo do código não virar números soltos. */
const EVENTO = {
  NAO_IDENTIFICADO: 3,
  ACESSO_NEGADO: 6,
  ACESSO_CONCEDIDO: 7,
} as const;

export type SentidoGiro = "clockwise" | "anticlockwise" | "both";

/**
 * Como cada equipamento Control iD libera a passagem. A ação muda por
 * modelo, conforme a documentação ("Abertura remota de porta e catraca" e
 * "Eventos de identificação online"):
 *   - "catraca": iDBlock e iDBlock Next giram a própria borboleta (`catra`,
 *     com o sentido);
 *   - "rele": iDAccess, iDFit e iDBox fecham o relé (`door`) — é como um
 *     leitor Control iD libera a catraca de outra marca, pelo contato seco;
 *   - "secbox": iDFlex, iDAccess Pro e iDAccess Nano acionam o módulo
 *     externo SecBox (`sec_box`, id 65793).
 * O iDFace não aparece em nenhuma das listas da documentação: aceita relé
 * ou SecBox, conforme a instalação, e por isso o jeito é configuração.
 */
export type LiberacaoControlId = "catraca" | "rele" | "secbox";

export interface ComoLiberar {
  liberacao: LiberacaoControlId;
  /** Sentido da borboleta que é a entrada — só vale na catraca da Control iD. */
  sentidoEntrada: "clockwise" | "anticlockwise";
  /** Qual relé fecha — só vale no "rele". */
  rele: 1 | 2;
}

/** O identificador do módulo SecBox na documentação da Control iD. */
export const SECBOX_ID = 65793;

/**
 * As ações que liberam a passagem naquele equipamento. `motivo` vai no
 * SecBox (1 autorizado, 3 comando web), como a documentação pede; o sentido
 * vale só na catraca (entrada é o comum; a liberação remota pode pedir a
 * saída ou os dois).
 */
export function acoesDeLiberacao(
  como: ComoLiberar,
  opcoes: { motivo?: "acesso" | "remoto"; sentido?: SentidoGiro } = {}
): { action: string; parameters: string }[] {
  switch (como.liberacao) {
    case "rele":
      return [{ action: "door", parameters: `door=${como.rele}` }];
    case "secbox":
      return [{ action: "sec_box", parameters: `id=${SECBOX_ID}, reason=${opcoes.motivo === "remoto" ? 3 : 1}` }];
    default:
      return [{ action: "catra", parameters: `allow=${opcoes.sentido ?? como.sentidoEntrada}` }];
  }
}

/** "::ffff:192.168.0.10" (IPv4 dentro de IPv6, como o Node às vezes entrega) vira "192.168.0.10". */
export function ipDoEquipamento(ip: string | undefined): string {
  return String(ip ?? "").replace(/^::ffff:/i, "").trim();
}

/**
 * Quem é o equipamento que chamou, pelo IP: o listado em
 * `controlid_equipamentos` com aquele IP leva a configuração dele; o
 * resto, a padrão (`controlid_liberacao`, `controlid_sentido_entrada`,
 * `controlid_rele`), que serve à academia com um equipamento só e sem
 * gestão remota.
 */
export function resolverComoLiberar(config: Pick<GatewayConfig, "controlid_equipamentos" | "controlid_liberacao" | "controlid_sentido_entrada" | "controlid_rele">) {
  const padrao: ComoLiberar = {
    liberacao: config.controlid_liberacao ?? "catraca",
    sentidoEntrada: config.controlid_sentido_entrada ?? "clockwise",
    rele: config.controlid_rele ?? 1,
  };
  return (ip: string | undefined): ComoLiberar => {
    const eq = (config.controlid_equipamentos ?? []).find((e) => ipDoEquipamento(e.ip) === ipDoEquipamento(ip));
    if (!eq) return padrao;
    return { liberacao: eq.liberacao ?? "catraca", sentidoEntrada: eq.sentido_entrada, rele: eq.rele ?? 1 };
  };
}

export interface OpcoesReceptorControlId {
  /**
   * Como liberar, por equipamento (pelo IP de quem chamou). Sem isto, todo
   * equipamento é catraca Control iD com entrada no sentido horário.
   */
  comoLiberar?: (ip: string | undefined) => ComoLiberar;
  portalId?: number;
  /** Ver GatewayConfig.confirmacao_giro. */
  confirmacaoGiro?: ConfirmacaoGiro;
  timeoutGiroMs?: number;
}

/**
 * Um acesso liberado esperando o catra_event. Guarda o que for preciso para
 * fechar o giro nos dois caminhos: o id do registro na nuvem (online) ou o
 * id local da fila (contingência).
 */
type GiroPendente = {
  deviceId: string;
  logId?: string;
  localId?: string | null;
  timer: NodeJS.Timeout;
};

/**
 * Traduz o evento do Monitor. A documentação dá os nomes (EVENT_TURN_LEFT,
 * EVENT_TURN_RIGHT, EVENT_GIVE_UP) e um exemplo com `"name": "TURN LEFT"`;
 * casamos pelo nome, com e sem o prefixo, em vez de por código numérico —
 * só o exemplo do TURN LEFT (type 7) está documentado.
 */
export function giroDoEvento(nome: unknown): Giro | null {
  const n = String(nome ?? "").toUpperCase().replace(/^EVENT_/, "").replace(/_/g, " ").trim();
  if (n === "GIVE UP") return "desistencia";
  if (n === "TURN LEFT" || n === "TURN RIGHT") return "confirmado";
  return null;
}

type RespostaControlId = {
  result: {
    event: number;
    user_id?: number;
    user_name?: string;
    user_image: boolean;
    portal_id: number;
    actions?: { action: string; parameters: string }[];
  };
};

/**
 * O display é público: quem está na fila lê. Ele mostra "Aluno", nunca o
 * nome, como o cadastro no equipamento (decisão da versão 1.0). Até a 1.6 a
 * resposta mandava o nome do aluno, inclusive ao lado de "acesso negado",
 * dizendo à fila quem estava barrado. O motivo fica nos Últimos acessos.
 */
const NOME_NO_DISPLAY = "Aluno";

function respostaLiberado(
  userId: number | undefined,
  como: ComoLiberar,
  opcoes: Required<OpcoesReceptorControlId>
): RespostaControlId {
  return {
    result: {
      event: EVENTO.ACESSO_CONCEDIDO,
      user_id: userId,
      user_name: userId === undefined ? undefined : NOME_NO_DISPLAY,
      user_image: false,
      portal_id: opcoes.portalId,
      actions: acoesDeLiberacao(como),
    },
  };
}

function respostaNegado(
  userId: number | undefined,
  identificado: boolean,
  opcoes: Required<OpcoesReceptorControlId>
): RespostaControlId {
  // Sem `actions`: a borboleta fica travada.
  return {
    result: {
      event: identificado ? EVENTO.ACESSO_NEGADO : EVENTO.NAO_IDENTIFICADO,
      user_id: userId,
      user_name: userId === undefined ? undefined : NOME_NO_DISPLAY,
      user_image: false,
      portal_id: opcoes.portalId,
    },
  };
}

/**
 * Registra as rotas que o equipamento chama. Recebe a instância do Fastify
 * já criada para que o mesmo processo sirva diagnóstico e equipamento sem
 * subir dois servidores.
 */
export function registrarReceptorControlId(
  app: FastifyInstance,
  gateway: GatewayService,
  opcoes: OpcoesReceptorControlId = {}
): void {
  const cfg: Required<OpcoesReceptorControlId> = {
    comoLiberar: opcoes.comoLiberar ?? (() => ({ liberacao: "catraca", sentidoEntrada: "clockwise", rele: 1 })),
    portalId: opcoes.portalId ?? 1,
    confirmacaoGiro: opcoes.confirmacaoGiro ?? "decisao",
    timeoutGiroMs: opcoes.timeoutGiroMs ?? 30_000,
  };
  // O catra_event só existe na catraca da Control iD. Leitor que libera a
  // catraca de outra marca, pelo relé ou pelo SecBox, não avisa giro
  // nenhum: esperar por ele só atrasaria a presença até o prazo.
  const esperaGiro = (como: ComoLiberar) => cfg.confirmacaoGiro === "catra_event" && como.liberacao === "catraca";

  // Acessos liberados esperando o giro, por `device_id:uuid`.
  const pendentes = new Map<string, GiroPendente>();

  const fechar = (chave: string, giro: Giro, origem: string) => {
    const p = pendentes.get(chave);
    if (!p) return;
    clearTimeout(p.timer);
    pendentes.delete(chave);
    logger.info({ giro, origem }, "Giro da catraca registrado");
    void gateway.concluirGiro({ logId: p.logId, localId: p.localId }, giro);
  };

  app.addHook("onClose", async () => {
    for (const p of pendentes.values()) clearTimeout(p.timer);
    pendentes.clear();
  });

  // O equipamento manda urlencoded na maior parte dos eventos. Parser
  // próprio em vez de mais uma dependência: são três linhas e evita
  // carregar @fastify/formbody dentro do executável empacotado.
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_req, corpo, done) => {
        try {
          done(null, Object.fromEntries(new URLSearchParams(corpo as string)));
        } catch (err) {
          done(err as Error, undefined);
        }
      }
    );
  }

  /**
   * Modo Pro: o equipamento já identificou (digital, facial, cartão...) e
   * manda o número do usuário dele. É o caminho principal da biometria.
   */
  app.post("/new_user_identified.fcgi", async (req) => {
    const corpo = (req.body ?? {}) as Record<string, string>;
    const userId = corpo.user_id;
    gateway.equipamentos.controlIdVisto(corpo.device_id);
    const como = cfg.comoLiberar(req.ip);
    const aguardarGiro = esperaGiro(como);

    if (!userId || userId === "0") {
      logger.warn({ corpo }, "Catraca enviou identificação sem user_id");
      return respostaNegado(undefined, false, cfg);
    }

    const resultado = await gateway.validarCredencial(
      { tipo: "identificador_catraca", valor: String(userId) },
      { aguardarGiro }
    );

    logger.info(
      { userId, liberado: resultado.liberado, offline: resultado.validadoOffline, liberacao: como.liberacao },
      "Decisão de acesso devolvida à catraca"
    );

    const esperarGiro = aguardarGiro && resultado.liberado;

    // Na contingência a decisão é do cache e ninguém gravou nada ainda: sem
    // isto, o acesso pela Control iD durante uma queda de internet se perdia.
    const localId = await gateway.registrarAcessoOffline(
      `id:${userId}`,
      resultado,
      esperarGiro ? "pendente" : undefined
    );

    if (esperarGiro) {
      const deviceId = String(corpo.device_id ?? "");
      const chave = `${deviceId}:${corpo.uuid ?? `sem-uuid-${Date.now()}`}`;
      // Sem o catra_event no prazo, conta como presença: a desistência chega
      // como evento próprio, então o silêncio é do Monitor, não do aluno.
      const timer = setTimeout(() => fechar(chave, "sem_confirmacao", "prazo esgotado"), cfg.timeoutGiroMs);
      timer.unref?.();
      pendentes.set(chave, { deviceId, logId: resultado.logId, localId, timer });
    }

    return resultado.liberado
      ? respostaLiberado(Number(userId), como, cfg)
      : respostaNegado(Number(userId), true, cfg);
  });

  /**
   * Cartão e QR que o equipamento NÃO reconheceu chegam com o valor bruto
   * lido, não com o usuário resolvido. O cartão cadastrado pelo ARKE
   * (cadastro remoto, versão 1.0) fica no próprio equipamento, ligado ao
   * número do aluno, e chega como new_user_identified — igual à digital. O
   * que cai aqui é cartão que ninguém cadastrou, e negamos com log em vez
   * de adivinhar a que aluno o número pertence. QR Code na catraca segue
   * negado: o QR do ARKE é o do check-in na recepção, que muda a cada 10
   * minutos e é lido pelo celular do aluno, não pela catraca.
   */
  const credencialSemMapeamento = (rota: string, campo: string) => {
    app.post(rota, async (req) => {
      const corpo = (req.body ?? {}) as Record<string, string>;
      gateway.equipamentos.controlIdVisto(corpo.device_id);
      logger.warn(
        { rota, valor: corpo[campo] },
        "Credencial lida sem mapeamento para aluno no ARKE — acesso negado"
      );
      return respostaNegado(undefined, false, cfg);
    });
  };

  credencialSemMapeamento("/new_card.fcgi", "card_value");
  credencialSemMapeamento("/new_qrcode.fcgi", "qrcode_value");

  /**
   * Heartbeat de contingência: o equipamento passa a chamar isto de minuto
   * em minuto depois de três tentativas sem nos alcançar, e volta ao modo
   * normal assim que receber HTTP OK. Responder aqui é o que tira a
   * catraca da contingência — por isso não há lógica nenhuma no caminho.
   */
  app.post("/device_is_alive.fcgi", async (req, reply) => {
    const corpo = (req.body ?? {}) as { access_logs?: number; device_id?: number | string };
    gateway.equipamentos.controlIdEmContingencia(corpo.device_id);
    logger.info({ logsNoEquipamento: corpo.access_logs }, "Catraca em contingência pedindo o servidor de volta");
    return reply.code(200).send();
  });

  /**
   * Monitor: a catraca confirma o que aconteceu DEPOIS da liberação —
   * girou para um lado, para o outro, ou a pessoa desistiu. Exclusivo da
   * iDBlock; configurado no equipamento com hostname/porta deste gateway e
   * `path` = "api/notifications".
   *
   * O casamento com a liberação é pelo `uuid` do evento, que a
   * identificação também traz. Se o uuid não bater mas houver exatamente
   * um acesso esperando giro naquele equipamento, é ele: numa borboleta
   * passa uma pessoa por vez. Com mais de um, não se adivinha — o prazo
   * fecha cada um como sem confirmação. Confirmar que o uuid dos dois
   * eventos é o mesmo é item de bancada.
   */
  app.post("/api/notifications/catra_event", async (req, reply) => {
    const corpo = (req.body ?? {}) as {
      event?: { type?: number; name?: string; uuid?: string };
      device_id?: number | string;
    };
    const giro = giroDoEvento(corpo.event?.name);
    const deviceId = String(corpo.device_id ?? "");
    gateway.equipamentos.controlIdVisto(deviceId);
    if (!giro) {
      logger.warn({ evento: corpo.event?.name, tipo: corpo.event?.type }, "Evento de catraca não reconhecido — ignorado");
      return reply.code(200).send();
    }

    let chave = `${deviceId}:${corpo.event?.uuid ?? ""}`;
    if (!pendentes.has(chave)) {
      const doEquipamento = [...pendentes.entries()].filter(([, p]) => p.deviceId === deviceId);
      if (doEquipamento.length !== 1) {
        logger.warn(
          { deviceId, esperando: doEquipamento.length },
          "Giro sem acesso correspondente — não dá para saber de quem é"
        );
        return reply.code(200).send();
      }
      chave = doEquipamento[0][0];
    }

    fechar(chave, giro, "catra_event");
    return reply.code(200).send();
  });

  // O Monitor manda também outros avisos (portas, cadastros, trocas de
  // modo) para o mesmo caminho. Responder 200 a eles evita que o
  // equipamento fique reenviando o que não usamos.
  app.post("/api/notifications/*", async (_req, reply) => reply.code(200).send());
}
