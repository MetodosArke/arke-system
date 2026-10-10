import type { PlanoAluno } from "@/lib/planoAluno";

/**
 * Para onde leva o cartão "Próximo Evento de Acompanhamento" da home do aluno.
 *
 * O cartão mostra um tipo de evento só: o encontro de Acolhimento M.A.P.A.®, a
 * tarefa `anamnese` que a equipe agenda na fila (`obter_proximo_evento_aluno()`).
 * Ele não tem tela própria nem aparece em calendário do app: a Agenda é a das
 * aulas da academia, e o Calendário do treino é o dos treinos feitos. Mandar o
 * aluno para lá seria mandá-lo procurar o que não existe.
 *
 * - No Método, o acolhimento abre a Jornada: é lá que o aluno vê e prepara os
 *   objetivos de que o encontro trata.
 * - No Free a Jornada é só o convite do Método; o evento leva à conversa com a
 *   academia, que é quem marcou e com quem se remarca.
 *
 * `rolarPara` é o id do bloco na tela de destino (a navegação é por
 * HashRouter, então a âncora vai no estado da rota, e não na URL).
 */
export type DestinoNoApp = { rota: string; rolarPara?: string };

export const CONVERSA_COM_O_MENTOR = "conversa-mentor";
export const CONVERSA_COM_A_ACADEMIA = "conversa-academia";

export function destinoDoEvento(plano: PlanoAluno): DestinoNoApp {
  if (plano === "free") return { rota: "/app/treinos", rolarPara: CONVERSA_COM_A_ACADEMIA };
  return { rota: "/app/jornada" };
}

/**
 * O atalho de conversa do cartão: só o mentor, e só no Método. No Free não há
 * atalho: o chat da academia já está a um toque (Treino de Hoje), a resposta
 * nova vira a Próxima Ação, e um botão de conversa num cartão que no Free quase
 * sempre está vazio seria uma segunda chamada disputando com a Próxima Ação.
 */
export function atalhoDeConversa(plano: PlanoAluno): DestinoNoApp | null {
  if (plano === "free") return null;
  return { rota: "/app/treinos", rolarPara: CONVERSA_COM_O_MENTOR };
}
