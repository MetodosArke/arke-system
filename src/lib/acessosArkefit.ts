/**
 * Os níveis de acesso da equipe da ArkeFit (convite pela Visão Master,
 * 08/10/2026).
 *
 * Até aqui as contas da ArkeFit nasciam direto no banco, com os papéis
 * `superadmin` e `admin_arke`. O convite pela tela Equipe ArkeFit
 * (`equipe-arkefit-convidar`) dá a quem entra um nível desta lista, e o nível
 * é só o conjunto de papéis de `user_roles` que a pessoa recebe.
 *
 * Hoje há um nível: **Sócio**, os dois papéis, como as contas dos sócios. Os
 * níveis da equipe contratada (suporte, comercial, mentoria, financeiro) entram
 * aqui como uma entrada a mais, quando cada área estiver definida
 * (docs/DECISOES_PENDENTES.md). Nível novo:
 *   1. uma entrada nesta lista e a mesma em
 *      `supabase/functions/equipe-arkefit-convidar/fluxo.ts` (o espelho, que o
 *      Deno lê; `acessosArkefit.test.ts` confere os dois);
 *   2. papel novo no enum `app_role`, se o nível pedir, entra também em
 *      `papeis_da_arkefit()` no banco (a lista que o convite pode dar e que a
 *      retirada tira) e em `has_role()`, que só aceita papel da ArkeFit com as
 *      duas etapas.
 */

export type PapelArkefit = "superadmin" | "admin_arke";

export type AcessoArkefit = {
  /** O que vai no pedido do convite e na auditoria. */
  id: string;
  /** Como a tela chama o nível. */
  nome: string;
  /** Uma frase para o formulário: o que a pessoa vê e faz. */
  descricao: string;
  /** Os papéis de `user_roles` que o nível dá. */
  papeis: readonly PapelArkefit[];
};

export const ACESSOS_ARKEFIT: readonly AcessoArkefit[] = [
  {
    id: "socio",
    nome: "Sócio",
    descricao:
      "A Visão Master inteira, inclusive a equipe e o dinheiro, e a gestão de qualquer academia. É o mesmo acesso dos sócios de hoje.",
    papeis: ["superadmin", "admin_arke"],
  },
];

/** A frase da tela sobre os níveis que ainda não existem. */
export const OUTROS_ACESSOS =
  "Por enquanto, só o acesso de Sócio. Os acessos da equipe contratada chegam quando a primeira contratação definir as áreas de cada um.";

/** Todos os papéis que algum nível dá: os que a ArkeFit concede e tira. */
export const PAPEIS_ARKEFIT: readonly PapelArkefit[] = [...new Set(ACESSOS_ARKEFIT.flatMap((a) => a.papeis))];

export function acessoPorId(id: unknown): AcessoArkefit | null {
  if (typeof id !== "string") return null;
  return ACESSOS_ARKEFIT.find((a) => a.id === id) ?? null;
}

/** O nível que tem exatamente estes papéis, ou nulo (conta montada à mão). */
export function acessoDosPapeis(papeis: readonly string[]): AcessoArkefit | null {
  const chave = (lista: readonly string[]) => [...new Set(lista)].sort().join(",");
  const procurado = chave(papeis);
  return ACESSOS_ARKEFIT.find((a) => chave(a.papeis) === procurado) ?? null;
}

/**
 * Onde a conta está no caminho de entrada, como o banco calcula
 * (`estado_conta_arkefit()`, migration 20261421010000):
 *   - `convite_enviado`: a pessoa ainda não criou a senha pelo link;
 *   - `sem_duas_etapas`: criou a senha, mas não cadastrou o aplicativo
 *     autenticador. Até lá, a conta não tem nenhum poder da ArkeFit
 *     (`has_role` exige a sessão verificada);
 *   - `ativo`: senha e duas etapas.
 */
export type EstadoContaArkefit = "convite_enviado" | "sem_duas_etapas" | "ativo";

export const ROTULO_ESTADO: Record<EstadoContaArkefit, string> = {
  convite_enviado: "Convite enviado",
  sem_duas_etapas: "Sem as duas etapas",
  ativo: "Ativo",
};

export const EXPLICACAO_ESTADO: Record<EstadoContaArkefit, string> = {
  convite_enviado: "Ainda não criou a senha pelo link do e-mail.",
  sem_duas_etapas: "Criou a senha, mas ainda não cadastrou o aplicativo autenticador. Até lá, não tem nenhum acesso da ArkeFit.",
  ativo: "Senha e duas etapas configuradas.",
};

/** O estado que veio do banco; a tela publicada antes desta coluna não a recebe. */
export function estadoDaConta(valor: unknown): EstadoContaArkefit | null {
  return valor === "convite_enviado" || valor === "sem_duas_etapas" || valor === "ativo" ? valor : null;
}
