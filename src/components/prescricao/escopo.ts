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

/** Filtro e valores de gravação dos modelos, conforme a biblioteca. */
export function bibliotecaDoEscopo(escopo: EscopoPrescricao) {
  return escopo.tipo === "academia"
    ? { chave: escopo.organizationId, organization_id: escopo.organizationId, biblioteca: "academia" as const }
    : { chave: "metodo", organization_id: null, biblioteca: "metodo" as const };
}
