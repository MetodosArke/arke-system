/**
 * O que a tela diz depois de retirar a autorização da biometria: só o que o
 * banco de fato agendou.
 *
 * Até 06/10/2026 a ficha dizia "Abrimos uma tarefa na fila" sempre que a
 * academia não tinha Gateway com gestão remota — e a tarefa podia não nascer
 * (aluno sem número, academia sem catraca cadastrada, ou sem consentimento
 * registrado). Agora a ficha conta as ordens de apagar e as tarefas abertas
 * do aluno depois da retirada, e a frase sai delas.
 */
export function mensagemDaRemocao(r: { numero: string | null; ordens: number; tarefas: number }): string {
  if (!r.numero) return "O aluno não tinha número na catraca: não há o que apagar dos equipamentos.";
  const catracas = r.ordens === 1 ? "1 catraca" : `${r.ordens} catracas`;
  if (r.ordens > 0 && r.tarefas > 0) {
    return `O Gateway vai apagar o aluno de ${catracas}, e a fila tem uma tarefa para apagar nas catracas sem gestão remota.`;
  }
  if (r.ordens > 0) return `O Gateway vai apagar o aluno de ${catracas}. Acompanhe aqui a data da exclusão.`;
  if (r.tarefas > 0) return "Abrimos uma tarefa na fila para apagar o aluno do equipamento da catraca.";
  return "Autorização retirada.";
}
