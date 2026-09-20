import type { FastifyInstance } from "fastify";
import type { GatewayService } from "../core/gatewayService";
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

export interface OpcoesReceptorControlId {
  /**
   * Sentido em que a borboleta libera. Depende de como a catraca foi
   * montada fisicamente (qual lado é a entrada), então é configuração de
   * instalação — e é um dos itens que só a bancada com equipamento
   * confirma de verdade.
   */
  sentidoGiro?: SentidoGiro;
  portalId?: number;
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

function respostaLiberado(
  userId: number | undefined,
  nome: string | undefined,
  opcoes: Required<OpcoesReceptorControlId>
): RespostaControlId {
  return {
    result: {
      event: EVENTO.ACESSO_CONCEDIDO,
      user_id: userId,
      user_name: nome,
      user_image: false,
      portal_id: opcoes.portalId,
      actions: [{ action: "catra", parameters: `allow=${opcoes.sentidoGiro}` }],
    },
  };
}

function respostaNegado(
  userId: number | undefined,
  nome: string | undefined,
  identificado: boolean,
  opcoes: Required<OpcoesReceptorControlId>
): RespostaControlId {
  // Sem `actions`: a borboleta fica travada. O nome vai junto quando
  // conhecido para o display dizer a quem está negando — recepção
  // conseguir resolver na hora vale mais que a economia de um campo.
  return {
    result: {
      event: identificado ? EVENTO.ACESSO_NEGADO : EVENTO.NAO_IDENTIFICADO,
      user_id: userId,
      user_name: nome,
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
    sentidoGiro: opcoes.sentidoGiro ?? "clockwise",
    portalId: opcoes.portalId ?? 1,
  };

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

    if (!userId || userId === "0") {
      logger.warn({ corpo }, "Catraca enviou identificação sem user_id");
      return respostaNegado(undefined, undefined, false, cfg);
    }

    const resultado = await gateway.validarCredencial({
      tipo: "identificador_catraca",
      valor: String(userId),
    });

    logger.info(
      { userId, liberado: resultado.liberado, offline: resultado.validadoOffline },
      "Decisão de acesso devolvida à catraca"
    );

    return resultado.liberado
      ? respostaLiberado(Number(userId), resultado.nomeAluno, cfg)
      : respostaNegado(Number(userId), resultado.nomeAluno, true, cfg);
  });

  /**
   * Cartão e QR chegam com o valor bruto lido, não com o usuário resolvido.
   * Ainda não existe mapeamento desses valores para aluno no ARKE, então
   * negamos com log em vez de adivinhar a que aluno o número pertence —
   * mesmo critério que o gateway já aplicava para credencial não suportada.
   */
  const credencialSemMapeamento = (rota: string, campo: string) => {
    app.post(rota, async (req) => {
      const corpo = (req.body ?? {}) as Record<string, string>;
      logger.warn(
        { rota, valor: corpo[campo] },
        "Credencial lida sem mapeamento para aluno no ARKE — acesso negado"
      );
      return respostaNegado(undefined, undefined, false, cfg);
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
    const corpo = (req.body ?? {}) as { access_logs?: number };
    logger.info({ logsNoEquipamento: corpo.access_logs }, "Catraca em contingência pedindo o servidor de volta");
    return reply.code(200).send();
  });
}
