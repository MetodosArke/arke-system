/**
 * Quem prescreve o quê, do lado da tela.
 *
 * Na academia, gestor e professor prescrevem treino, e gestor e nutricionista,
 * dieta. No painel do profissional autônomo, cada um prescreve a sua parte: o
 * dono segue a especialidade dele, e o parceiro convidado, o papel dele. O
 * banco garante a mesma regra (`papel_prescreve_no_autonomo`); a tela só não
 * oferece o que seria recusado.
 */

export type ContextoPrescricao = {
  tipoOrganizacao: string | null | undefined;
  especialidade: string | null | undefined;
  papel: string | null | undefined;
  adminArke?: boolean;
};

export function podePrescrever(o_que: "treino" | "dieta", c: ContextoPrescricao): boolean {
  const papelDaParte = o_que === "treino" ? "professor" : "nutricionista";
  if (c.tipoOrganizacao === "profissional_autonomo") {
    if (c.papel === "gestor") {
      // Sem especialidade gravada, o painel é de personal: é o caso mais comum.
      return (c.especialidade ?? "professor") === papelDaParte;
    }
    return c.papel === papelDaParte;
  }
  return !!c.adminArke || c.papel === "gestor" || c.papel === papelDaParte;
}
