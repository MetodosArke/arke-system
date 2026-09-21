/**
 * Rastreamento de erro em produção, via Sentry.
 *
 * Sem isto, um erro de JavaScript numa tela deixa o aluno travado e ninguém
 * fica sabendo — o defeito só aparece quando alguém liga para a academia, ou
 * quando uma varredura manual tropeça nele. Com várias academias em produção
 * isso deixa de ser sustentável.
 *
 * ## O que este arquivo é, na maior parte: uma lista do que NÃO enviar
 *
 * O ARKE carrega dado pessoal sensível na acepção do art. 5º, II da LGPD —
 * anamnese, dobras cutâneas, dores relatadas, histórico clínico, fotos de
 * avaliação corporal. Um SDK de monitoramento configurado no padrão manda
 * muito mais coisa do que se imagina para um terceiro, e a diferença entre
 * "ferramenta de operação" e "vazamento contínuo" mora inteira na
 * configuração. Por isso, aqui:
 *
 * - **Session Replay fica desligado.** É o item mais perigoso da lista: numa
 *   tela de avaliação física, o replay gravaria peso, dobras e queixas do
 *   aluno e mandaria para fora. Nenhuma máscara compensa o risco; o recurso
 *   simplesmente não entra.
 * - **`sendDefaultPii` fica falso**, explicitamente, mesmo sendo o padrão:
 *   é o tipo de coisa que não pode mudar por descuido numa atualização de
 *   SDK.
 * - **Breadcrumb de console sai.** O app tem `console.error` com objeto de
 *   erro do Supabase, e esses objetos carregam trechos da linha que falhou.
 * - **Query string é cortada** de URLs e breadcrumbs. É onde vazam ids e,
 *   em telas de busca, o que a pessoa digitou.
 * - **Corpo de requisição nunca é anexado.**
 *
 * O que **é** enviado de identificação: `organization_id` e `user_id`, ambos
 * UUID. São pseudônimos — não dizem nome, e-mail nem CPF — e sem eles não dá
 * para responder "esse erro atinge uma academia ou todas", que é a pergunta
 * que justifica ter monitoramento. Nome, e-mail e CPF não são enviados nunca.
 */
import * as Sentry from "@sentry/react";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const AMBIENTE = (import.meta.env.MODE ?? "development") as string;

/** Chaves cujo valor nunca deve sair daqui, em qualquer nível do evento. */
const CAMPOS_PROIBIDOS = [
  "senha", "password", "token", "access_token", "refresh_token", "apikey", "api_key",
  "cpf", "email", "telefone", "phone", "full_name", "nome",
  "anamnese", "dobras", "peso", "dor", "dores", "observacoes", "historico_clinico",
];

function pareceSensivel(chave: string): boolean {
  const k = chave.toLowerCase();
  return CAMPOS_PROIBIDOS.some((proibido) => k.includes(proibido));
}

/**
 * Remove valores sensíveis de qualquer objeto do evento, em profundidade.
 * Mantém a chave e troca o valor, porque saber *que* havia um campo `cpf`
 * ajuda a entender o erro; saber *qual* CPF não ajuda nada e é o problema.
 */
function limpar(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 6 || valor == null) return valor;
  if (Array.isArray(valor)) return valor.map((v) => limpar(v, profundidade + 1));
  if (typeof valor !== "object") return valor;

  const saida: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    saida[chave] = pareceSensivel(chave) ? "[removido]" : limpar(v, profundidade + 1);
  }
  return saida;
}

/** Corta a query string, onde vazam ids e termos digitados em busca. */
function semQueryString(url?: string): string | undefined {
  if (!url) return url;
  const corte = url.indexOf("?");
  return corte === -1 ? url : `${url.slice(0, corte)}?[removido]`;
}

export function iniciarMonitoramento(): void {
  // Sem DSN o monitoramento simplesmente não existe — é assim que se roda em
  // desenvolvimento e é assim que se desliga em produção sem precisar de
  // deploy de código.
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: AMBIENTE,

    // Explícito de propósito: é o padrão, mas é justamente o que não pode
    // mudar sem alguém perceber.
    sendDefaultPii: false,

    // Só erro. Sem performance e, sobretudo, **sem Session Replay** — ver o
    // comentário no topo do arquivo.
    tracesSampleRate: 0,

    integrations: (padrao) =>
      padrao.filter(
        (i) =>
          // O app registra erro do Supabase no console com o objeto inteiro,
          // que carrega trecho da consulta que falhou.
          i.name !== "Breadcrumbs" &&
          i.name !== "Replay" &&
          i.name !== "ReplayCanvas" &&
          // Anexa o corpo da requisição ao evento.
          i.name !== "RequestData"
      ),

    beforeSend(evento) {
      if (evento.request) {
        evento.request.url = semQueryString(evento.request.url);
        delete evento.request.data;
        delete evento.request.cookies;
        delete evento.request.headers;
      }
      if (evento.extra) evento.extra = limpar(evento.extra) as typeof evento.extra;
      if (evento.contexts) evento.contexts = limpar(evento.contexts) as typeof evento.contexts;
      return evento;
    },

    beforeBreadcrumb(migalha) {
      if (migalha.category === "console") return null;
      if (migalha.data?.url) migalha.data.url = semQueryString(String(migalha.data.url));
      if (migalha.data) migalha.data = limpar(migalha.data) as typeof migalha.data;
      return migalha;
    },

    // Ruído que não é defeito nosso: extensão de navegador, rede do aluno
    // caindo no meio de uma requisição, e o erro que todo app que atualiza
    // sozinho produz quando o deploy troca os arquivos debaixo da aba aberta.
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Failed to fetch dynamically imported module",
      "Importing a module script failed",
      "NetworkError when attempting to fetch resource",
      "AbortError",
    ],
  });
}

/**
 * Diz de qual academia e de qual pessoa é a sessão, para separar "quebrou
 * para uma academia" de "quebrou para todo mundo" — que é a diferença entre
 * um dado ruim numa organização e um defeito de produto.
 *
 * Só UUID. Nome, e-mail e CPF ficam de fora por decisão, não por esquecimento.
 */
export function identificarSessao(dados: {
  userId?: string | null;
  organizationId?: string | null;
  papel?: string | null;
}): void {
  if (!DSN) return;
  Sentry.setUser(dados.userId ? { id: dados.userId } : null);
  Sentry.setTag("organization_id", dados.organizationId ?? "sem_organizacao");
  Sentry.setTag("papel", dados.papel ?? "desconhecido");
}

/** Reporta um erro já capturado, sem interromper o fluxo de quem chamou. */
export function reportarErro(erro: unknown, contexto?: Record<string, unknown>): void {
  if (!DSN) {
    console.error("[monitoramento]", erro, contexto);
    return;
  }
  Sentry.captureException(erro, contexto ? { extra: limpar(contexto) as Record<string, unknown> } : undefined);
}
