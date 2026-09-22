/**
 * Etapas do onboarding da academia (Rodada 4). O que está concluído vem do
 * banco (`get_onboarding_organizacao`), lido do estado real; aqui fica só o
 * que é de tela: nome, tempo estimado e ordem.
 *
 * Decisão D5: o painel funciona desde o primeiro dia, mas alunos no app e
 * cobranças só são liberados com todas as etapas concluídas.
 */

export type EtapaOnboarding = "dados" | "recebimentos" | "planos" | "equipe" | "alunos";

export type StatusEtapa = { etapa: EtapaOnboarding; concluida: boolean; detalhe: string | null };

export const ETAPAS: { etapa: EtapaOnboarding; titulo: string; minutos: number; resumo: string }[] = [
  { etapa: "dados", titulo: "Dados da academia", minutos: 2, resumo: "CNPJ e CEP preenchem o resto sozinhos." },
  {
    etapa: "recebimentos",
    titulo: "Conta de recebimentos",
    minutos: 3,
    resumo: "Conta Asaas para receber as mensalidades dos alunos, com a parte da academia caindo direto nela.",
  },
  { etapa: "planos", titulo: "Planos e preços", minutos: 2, resumo: "Mensal, trimestral e anual já vêm prontos para ajustar." },
  { etapa: "equipe", titulo: "Equipe", minutos: 3, resumo: "Professores, nutricionista e recepção — ou siga sozinho." },
  { etapa: "alunos", titulo: "Alunos", minutos: 5, resumo: "Importe a planilha do sistema anterior ou cadastre." },
];

export function percentualConcluido(status: StatusEtapa[]): number {
  if (!status.length) return 0;
  return Math.round((status.filter((s) => s.concluida).length / status.length) * 100);
}

/** Primeira etapa pendente, na ordem do checklist. */
export function proximaEtapa(status: StatusEtapa[]): EtapaOnboarding | null {
  const pendentes = new Set(status.filter((s) => !s.concluida).map((s) => s.etapa));
  return ETAPAS.find((e) => pendentes.has(e.etapa))?.etapa ?? null;
}

export function minutosRestantes(status: StatusEtapa[]): number {
  const pendentes = new Set(status.filter((s) => !s.concluida).map((s) => s.etapa));
  return ETAPAS.filter((e) => pendentes.has(e.etapa)).reduce((soma, e) => soma + e.minutos, 0);
}

export const ROTULO_SITUACAO_ASAAS: Record<string, string> = {
  PENDING: "Aguardando documentos",
  AWAITING_APPROVAL: "Em análise no Asaas",
  APPROVED: "Aprovada",
  REJECTED: "Recusada — veja o motivo no Asaas",
};
