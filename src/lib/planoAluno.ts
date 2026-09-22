/**
 * Plano do aluno e situação na academia — a regra do plano Free (rodada 3).
 *
 * Todo aluno matriculado e em dia com a academia usa o app no plano Free
 * (treinos, calendário, rotina, diário de água e dieta, chat com os
 * professores da academia). O Método ARKE pago — Integrado e Elite — soma o
 * acolhimento M.A.P.A.®, as fases da jornada, o chat com a nutricionista e,
 * no Elite, o acolhimento expandido. O antigo Essencial virou o Free.
 *
 * Espelha `public.plano_do_aluno()` do banco: nível gravado em quem não está
 * no Método é só intenção, não plano.
 */

export type PlanoAluno = "free" | "integrado" | "elite";
export type SituacaoAcademia = "em_dia" | "inadimplente" | "pausado";

export const ROTULO_PLANO: Record<PlanoAluno, string> = {
  free: "Free",
  integrado: "Método Integrado",
  elite: "Método Elite",
};

export const ROTULO_SITUACAO: Record<SituacaoAcademia, string> = {
  em_dia: "Em dia",
  inadimplente: "Inadimplente",
  pausado: "Pausado",
};

export const SITUACOES: SituacaoAcademia[] = ["em_dia", "inadimplente", "pausado"];

/** Dias de tolerância do aluno marcado como inadimplente (decisão de 22/09/2026). */
export const TOLERANCIA_INADIMPLENTE_DIAS = 5;

/**
 * Se a situação deixa o aluno usar o app — espelho de public.situacao_permite_app().
 * Pausado sai na hora; inadimplente usa por 5 dias corridos a contar da marcação.
 * Devolve também quantos dias de tolerância restam, para o aviso na tela.
 */
export function acessoPelaSituacao(
  situacao: SituacaoAcademia | null,
  desde: string | null,
  agora = new Date()
): { liberado: boolean; diasRestantes: number | null } {
  if (!situacao || situacao === "em_dia") return { liberado: true, diasRestantes: null };
  if (situacao === "pausado") return { liberado: false, diasRestantes: null };
  const inicio = desde ? new Date(desde).getTime() : agora.getTime();
  const restanteMs = inicio + TOLERANCIA_INADIMPLENTE_DIAS * 86_400_000 - agora.getTime();
  return restanteMs > 0
    ? { liberado: true, diasRestantes: Math.ceil(restanteMs / 86_400_000) }
    : { liberado: false, diasRestantes: 0 };
}

export function planoDoAluno(aluno: { metodo_arke_status: string | null; nivel_atacado: string | null }): PlanoAluno {
  if (aluno.metodo_arke_status !== "ativo") return "free";
  if (aluno.nivel_atacado === "elite") return "elite";
  if (aluno.nivel_atacado === "integrado") return "integrado";
  return "free";
}

/** Chat com a nutricionista e acompanhamento nutricional são do Método. */
export function temNutricaoNoPlano(plano: PlanoAluno): boolean {
  return plano !== "free";
}

/** Ordem na Caixa de Mensagens: o Elite fura a fila, o Integrado vem antes do Free. */
export function prioridadeDoPlano(plano: string | null | undefined): number {
  return plano === "elite" ? 2 : plano === "integrado" ? 1 : 0;
}

/**
 * Situação escrita numa planilha de outro sistema. Devolve `null` quando não
 * reconhece — a linha falha com a mensagem, em vez de o aluno entrar "em dia"
 * por engano. Vazio conta como em dia: a maioria das exportações nem traz a
 * coluna, e quem está na lista de alunos ativos está, por padrão, em dia.
 */
export function situacaoDoTexto(texto: string | null | undefined): SituacaoAcademia | null {
  const t = (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!t) return "em_dia";
  if (/inadimpl|atras|devedor|vencid|debito|pendente|bloque/.test(t)) return "inadimplente";
  if (/paus|tranc|congel|suspen|ferias|licenca/.test(t)) return "pausado";
  // Inativo ou cancelado não é aluno da academia: não entra, nem como "em dia".
  if (/inativ|cancel|desist|encerr/.test(t)) return null;
  if (/em dia|adimpl|ativ|regular|pago|\bok\b|^sim$/.test(t)) return "em_dia";
  return null;
}

/**
 * Venda do Método ARKE pela academia (adesão e cobrança do aluno). Desligada
 * até o lançamento do Método: hoje o app mostra "breve lançamento" e só o
 * Super Admin atribui o Método, em trial, para homologar. Liga com
 * `VITE_METODO_ARKE_VENDA=true` na Vercel, sem mudar código.
 */
export function vendaMetodoArkeLiberada(): boolean {
  return import.meta.env.VITE_METODO_ARKE_VENDA === "true";
}
