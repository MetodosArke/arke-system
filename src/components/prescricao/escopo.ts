/**
 * De onde vêm os modelos e para quem se publica.
 *
 * A academia trabalha com a biblioteca dela e publica para os alunos dela. O
 * mentor da ArkeFit trabalha com a biblioteca do Método, que só a ArkeFit vê,
 * e publica para um aluno do Método de cada vez, de dentro da ficha dele. As
 * duas telas são o mesmo editor: o que muda é só isto.
 */
export type EscopoPrescricao =
  | { tipo: "academia"; organizationId: string }
  | { tipo: "metodo"; aluno: { id: string; nome: string; organizationId: string } };

/**
 * O exercício do acervo entra no seletor da prescrição? O acervo padrão
 * (`organization_id` nulo) sempre; o próprio de uma academia, só o da academia
 * do aluno. A regra de acesso devolve os exercícios próprios de todas as
 * academias da pessoa (e de todas, para a ArkeFit), e o professor de duas
 * academias via os das duas misturados (07/10/2026, `vinculos.guarda`).
 */
export function exercicioDoEscopo(escopo: EscopoPrescricao, organizationIdDoExercicio: string | null): boolean {
  if (organizationIdDoExercicio === null) return true;
  const academia = escopo.tipo === "academia" ? escopo.organizationId : escopo.aluno.organizationId;
  return organizationIdDoExercicio === academia;
}

/** Filtro e valores de gravação dos modelos, conforme a biblioteca. */
export function bibliotecaDoEscopo(escopo: EscopoPrescricao) {
  return escopo.tipo === "academia"
    ? { chave: escopo.organizationId, organization_id: escopo.organizationId, biblioteca: "academia" as const }
    : { chave: "metodo", organization_id: null, biblioteca: "metodo" as const };
}
