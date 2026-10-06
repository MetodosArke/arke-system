// A academia do cadastro direto da equipe, sem Deno nem Supabase, para o
// teste do app exercitar o código real (src/lib/cadastroEquipe.test.ts).
//
// Até 06/10/2026 a função ignorava a unidade escolhida na tela e usava o
// vínculo de gestor mais antigo de quem chamava: o gestor de duas unidades
// cadastrava um professor para a unidade B, e ele nascia na A, vendo os
// alunos de A. Agora a academia é a que a tela manda, e quem chama tem de ser
// gestor dela.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Escolha = { ok: true; organizationId: string } | { ok: false; status: 400 | 403; erro: string };

/**
 * @param pedida a academia que a tela mandou (`organization_id`), ou nada
 *   (tela antiga, publicada antes desta regra)
 * @param academiasDoGestor as academias em que quem chama é gestor ativo
 */
export function academiaDoCadastro(pedida: unknown, academiasDoGestor: string[]): Escolha {
  const unicas = [...new Set(academiasDoGestor)];
  if (pedida !== undefined && pedida !== null && pedida !== "") {
    if (typeof pedida !== "string" || !UUID.test(pedida.trim())) {
      return { ok: false, status: 400, erro: "Academia inválida." };
    }
    const id = pedida.trim().toLowerCase();
    if (!unicas.some((o) => o.toLowerCase() === id)) {
      return { ok: false, status: 403, erro: "Apenas o gestor desta academia pode cadastrar a equipe dela." };
    }
    return { ok: true, organizationId: unicas.find((o) => o.toLowerCase() === id)! };
  }
  if (unicas.length === 0) return { ok: false, status: 403, erro: "Apenas o gestor da organização pode cadastrar a equipe." };
  // Sem a academia no pedido, só dá para decidir quando não há escolha.
  if (unicas.length === 1) return { ok: true, organizationId: unicas[0] };
  return { ok: false, status: 400, erro: "Você é gestor de mais de uma academia: escolha a unidade no seletor do cabeçalho e cadastre de novo." };
}
