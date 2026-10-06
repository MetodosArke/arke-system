/**
 * O que o display da catraca mostra. Vale para todas as marcas: o display é
 * público, quem está na fila lê.
 *
 * - Liberado: "Bem-vindo!", nunca o nome do aluno.
 * - Negado: uma frase curta (até 16 caracteres, sem acento) que não fala de
 *   dinheiro nem diz quem foi barrado. O motivo completo fica nos Últimos
 *   acessos, para a recepção.
 *
 * Até a 1.8 a Topdata Inner era a exceção: a ponte escrevia o primeiro nome e
 * o motivo da nuvem ("Mensalidade da academia em atraso.") no display.
 */
export function mensagemDoDisplay(liberado: boolean, motivo: string): string {
  if (liberado) return "Bem-vindo!";
  const m = motivo.toLowerCase();
  if (m.includes("não encontrado") || m.includes("nao encontrado")) return "Nao cadastrado";
  // Falha nossa ao conferir não é "sem agendamento": diria ao aluno algo falso.
  if (m.includes("tente novamente")) return "Tente novamente";
  if (m.includes("agendamento")) return "Sem agendamento";
  if (m.includes("sem conexão") || m.includes("sem conexao")) return "Sem conexao";
  if (m.includes("dispositivo")) return "Catraca inativa";
  // Pausado, inadimplente e matrícula encerrada: a recepção resolve. "atraso"
  // e "pausad" ficam pelo texto das nuvens e dos Gateways anteriores à 1.9.
  if (m.includes("pausad") || m.includes("atraso") || m.includes("recepç") || m.includes("recepc")) {
    return "Fale c/ recepcao";
  }
  return "Acesso negado";
}
