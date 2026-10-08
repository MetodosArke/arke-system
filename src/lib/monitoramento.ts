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
 * - **Token de link sai de qualquer endereço**: o `#access_token=` e o
 *   `refresh_token` do link de senha que o Supabase manda por e-mail, o `code`
 *   do retorno do login e o token do link do responsável legal. Quem tem o
 *   endereço tem a sessão (07/10/2026).
 * - **Texto livre é limpo**: a mensagem do erro, o `exception.value`, a
 *   mensagem das migalhas e os textos dos dados extras perdem e-mail, CPF,
 *   telefone e token. O erro do Postgres repete a linha que falhou ("Key
 *   (email)=(maria@…) already exists"), e o `beforeSend` antigo só limpava pela
 *   chave dos objetos, nunca o texto (achado da auditoria de prontidão).
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
  // Cartão de crédito (asaas-cartao-assinatura): o objeto inteiro sai, porque
  // a chave-mãe já é sensível — número, validade e CVV vão junto.
  "cartao", "card", "cvv", "ccv", "titular", "holder", "expiry", "validade",
];

function pareceSensivel(chave: string): boolean {
  const k = chave.toLowerCase();
  return CAMPOS_PROIBIDOS.some((proibido) => k.includes(proibido));
}

/**
 * O que sai de qualquer texto do evento, na ordem: primeiro o que é maior e
 * contém os outros (o JWT tem pontos e números; o e-mail, números).
 *
 * - Token de link e de sessão, em endereço ou em mensagem: `access_token=`,
 *   `refresh_token=`, `token_hash=`, `code=`, `t=` do "não quero mais receber"
 *   e o `apikey` da API.
 * - JWT solto (`eyJ…`), `Bearer …` e a chave do Asaas (`$aact_…`).
 * - E-mail.
 * - CPF, com ou sem máscara, e telefone com DDD, com ou sem máscara. Sequência
 *   solta de 10 ou 11 dígitos sai junto: é o CPF e o celular sem máscara, e um
 *   id do ARKE nunca é só número (é UUID).
 */
const TEXTO_PROIBIDO: [RegExp, string][] = [
  [/\b(access_token|refresh_token|provider_token|provider_refresh_token|token_hash|token|apikey|api_key|t)=[^&#\s"']*/gi, "$1=[removido]"],
  // O `code` do retorno do login é longo; "code=23505" é o código do erro do
  // Postgres, que ajuda a entender o erro e fica.
  [/\bcode=[^&#\s"']{16,}/gi, "code=[removido]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[token removido]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [removido]"],
  [/\$aact_[A-Za-z0-9_:$.-]+/g, "[chave removida]"],
  [/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[A-Za-z]{2,}/g, "[e-mail removido]"],
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[cpf removido]"],
  [/(\+?55\s?)?\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]\d{4}\b/g, "[telefone removido]"],
  [/\b\d{10,11}\b/g, "[número removido]"],
];

/** Tira de um texto livre o que identifica alguém ou dá acesso: ver `TEXTO_PROIBIDO`. */
export function limparTexto(texto: string): string {
  let saida = texto.replace(/(#\/responsavel\/)[^?#/\s]+/g, "$1[removido]");
  for (const [padrao, troca] of TEXTO_PROIBIDO) saida = saida.replace(padrao, troca);
  return saida;
}

/**
 * Remove valores sensíveis de qualquer objeto do evento, em profundidade.
 * Mantém a chave e troca o valor, porque saber *que* havia um campo `cpf`
 * ajuda a entender o erro; saber *qual* CPF não ajuda nada e é o problema.
 * O texto que sobra passa por `limparTexto`.
 */
function limpar(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 6 || valor == null) return valor;
  if (typeof valor === "string") return limparTexto(valor);
  if (Array.isArray(valor)) return valor.map((v) => limpar(v, profundidade + 1));
  if (typeof valor !== "object") return valor;

  const saida: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    saida[chave] = pareceSensivel(chave) ? "[removido]" : limpar(v, profundidade + 1);
  }
  return saida;
}

/**
 * Limpa um endereço: corta a query string, onde vazam ids e termos digitados
 * em busca, e tira os tokens do resto (o `#access_token=` do link de senha, que
 * não tem `?`, e o token do link do responsável legal, `#/responsavel/<token>`):
 * quem tem o endereço tem a sessão, ou aceita pelo responsável.
 */
export function limparUrl(url?: string): string | undefined {
  if (!url) return url;
  const semToken = limparTexto(url);
  const corte = semToken.indexOf("?");
  return corte === -1 ? semToken : `${semToken.slice(0, corte)}?[removido]`;
}

type Quadro = { filename?: string; abs_path?: string; vars?: unknown };
type Migalha = { message?: string; data?: Record<string, unknown> };

function limparQuadros(quadros?: Quadro[]): void {
  for (const q of quadros ?? []) {
    // O quadro de um erro em script da própria página traz o endereço dela.
    if (q.filename) q.filename = limparUrl(q.filename);
    if (q.abs_path) q.abs_path = limparUrl(q.abs_path);
    delete q.vars;
  }
}

function limparMigalha<T extends Migalha>(migalha: T): T {
  if (migalha.message) migalha.message = limparTexto(migalha.message);
  if (migalha.data?.url) migalha.data.url = limparUrl(String(migalha.data.url));
  if (migalha.data) migalha.data = limpar(migalha.data) as T["data"];
  return migalha;
}

/** O evento inteiro, antes de sair: o `beforeSend`. Exportado para a guarda. */
export function limparEvento<T extends Record<string, unknown>>(evento: T): T {
  const e = evento as Record<string, unknown> & {
    message?: string;
    transaction?: string;
    logentry?: { message?: string; formatted?: string; params?: unknown[] };
    request?: { url?: string; query_string?: unknown; data?: unknown; cookies?: unknown; headers?: unknown };
    exception?: { values?: { value?: string; stacktrace?: { frames?: Quadro[] } }[] };
    threads?: { values?: { stacktrace?: { frames?: Quadro[] } }[] };
    breadcrumbs?: Migalha[];
    user?: { id?: string } | null;
    extra?: unknown;
    contexts?: unknown;
    tags?: unknown;
  };
  if (e.message) e.message = limparTexto(e.message);
  if (e.transaction) e.transaction = limparTexto(e.transaction);
  if (e.logentry) {
    if (e.logentry.message) e.logentry.message = limparTexto(e.logentry.message);
    if (e.logentry.formatted) e.logentry.formatted = limparTexto(e.logentry.formatted);
    if (e.logentry.params) e.logentry.params = limpar(e.logentry.params) as unknown[];
  }
  if (e.request) {
    e.request.url = limparUrl(e.request.url);
    delete e.request.query_string;
    delete e.request.data;
    delete e.request.cookies;
    delete e.request.headers;
  }
  for (const v of e.exception?.values ?? []) {
    if (v.value) v.value = limparTexto(v.value);
    limparQuadros(v.stacktrace?.frames);
  }
  for (const t of e.threads?.values ?? []) limparQuadros(t.stacktrace?.frames);
  if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.map((m) => limparMigalha(m));
  // Só o UUID: o SDK pode juntar e-mail, nome ou IP ao usuário.
  if (e.user) e.user = e.user.id ? { id: e.user.id } : null;
  if (e.extra) e.extra = limpar(e.extra);
  if (e.contexts) e.contexts = limpar(e.contexts);
  if (e.tags) e.tags = limpar(e.tags);
  return evento;
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
      return limparEvento(evento as unknown as Record<string, unknown>) as unknown as typeof evento;
    },

    beforeBreadcrumb(migalha) {
      if (migalha.category === "console") return null;
      return limparMigalha(migalha as Migalha) as typeof migalha;
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
