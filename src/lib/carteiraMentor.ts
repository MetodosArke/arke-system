/**
 * Regras de exibição da carteira do mentor (Visão Master → Mentoria → Alunos).
 *
 * Os sinais de atenção vêm prontos de `get_carteira_mentor()`; aqui ficam só o
 * texto de cada um e os filtros da tela, para a regra ficar testável sem
 * subir Supabase.
 */

export type SinalAtencao =
  | "anamnese"
  | "sem_treino"
  | "sem_dieta"
  | "dor"
  | "chamado_atrasado"
  | "mensagem"
  | "treino_vencendo"
  | "sem_mentor";

export const ROTULO_ATENCAO: Record<SinalAtencao, string> = {
  anamnese: "Acolhimento pendente",
  sem_treino: "Sem treino",
  sem_dieta: "Sem dieta",
  dor: "Relato de dor",
  chamado_atrasado: "Chamado atrasado",
  mensagem: "Mensagem sem resposta",
  treino_vencendo: "Treino vencendo",
  sem_mentor: "Sem mentor",
};

/** Os que travam o aluno: sem eles resolvidos, ele não segue a jornada. */
export const SINAIS_QUE_TRAVAM: SinalAtencao[] = ["anamnese", "sem_treino", "dor", "chamado_atrasado"];

export const ROTULO_FASE: Record<string, string> = {
  mapa: "M.A.P.A.®",
  base: "B.A.S.E.®",
  rota: "R.O.T.A.®",
  apex: "A.P.E.X.®",
  legado: "L.E.G.A.D.O.®",
};

export type AlunoCarteira = {
  aluno_id: string;
  aluno_nome: string;
  organizacao_nome: string;
  mentor_id: string | null;
  atencao: string[] | null;
};

export type FiltroCarteira = "todos" | "meus" | "sem_mentor" | "atencao";

export function rotuloAtencao(sinal: string): string {
  return ROTULO_ATENCAO[sinal as SinalAtencao] ?? sinal;
}

export function travaOAluno(sinal: string): boolean {
  return SINAIS_QUE_TRAVAM.includes(sinal as SinalAtencao);
}

/** Busca sem acento e sem diferenciar maiúsculas, pelo nome do aluno ou da academia. */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function filtrarCarteira<T extends AlunoCarteira>(
  alunos: T[],
  filtro: FiltroCarteira,
  usuarioId: string | null,
  busca = ""
): T[] {
  const termo = normalizar(busca);
  return alunos.filter((a) => {
    if (filtro === "meus" && (!usuarioId || a.mentor_id !== usuarioId)) return false;
    if (filtro === "sem_mentor" && a.mentor_id) return false;
    if (filtro === "atencao" && !(a.atencao ?? []).length) return false;
    if (!termo) return true;
    return normalizar(a.aluno_nome).includes(termo) || normalizar(a.organizacao_nome).includes(termo);
  });
}
