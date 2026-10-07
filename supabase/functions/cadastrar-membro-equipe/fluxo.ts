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

// ── A conta de quem entra na equipe (auditoria de prontidão, 06/10/2026) ────
//
// Até aqui o cadastro criava a conta com o e-mail já confirmado e uma senha
// temporária que voltava para quem cadastrava: a gestão ficava com a senha da
// conta de outra pessoa, e o e-mail nunca era provado. Quem tivesse a senha
// seguia com a conta depois (o pré-sequestro), e uma academia que mais tarde
// matriculasse o dono do e-mail ligaria a matrícula a essa conta. E a
// parceria do autônomo ligava na hora a conta que já existia, só pelo e-mail.
//
// Agora, no molde da gestão (20261362010000):
//   * e-mail sem conta: o convite do Auth, sem senha. A senha nasce no link
//     do e-mail, que é a prova de posse; até lá ninguém entra na conta;
//   * e-mail com conta: o vínculo nasce PENDENTE, vai o link de definir a
//     senha, e o vínculo só vale quando a pessoa entra por ele
//     (`ativar_gestao_pendente`, depois de encerrar as outras sessões).
//     Olhando a conta não dá para saber se o e-mail foi provado, então a regra
//     vale para toda conta que já existe.

export type ContaExistente = { user_id: string; ultimo_acesso: string | null } | null;
export type VinculoNaAcademia = { role: string; status: string } | null;

export type DecisaoCadastro =
  | { acao: "convidar" }
  | { acao: "pendente"; reenvio: boolean }
  | { acao: "recusar"; status: 400 | 409; erro: string; precisaNome?: boolean };

const PAPEIS_DA_EQUIPE = new Set(["professor", "nutricionista", "recepcao"]);

export function decidirCadastro(
  conta: ContaExistente,
  vinculo: VinculoNaAcademia,
  nome: string | null | undefined,
): DecisaoCadastro {
  if (!conta) {
    if (!nome?.trim()) {
      return {
        acao: "recusar",
        status: 400,
        erro: "Essa pessoa ainda não tem conta no ArkeFit. Informe o nome completo para mandar o convite.",
        precisaNome: true,
      };
    }
    return { acao: "convidar" };
  }
  if (!vinculo) return { acao: "pendente", reenvio: false };
  if (vinculo.role === "aluno") {
    return { acao: "recusar", status: 409, erro: "Essa pessoa é aluna desta academia. Fale com a ArkeFit para ela também entrar na equipe." };
  }
  if (!PAPEIS_DA_EQUIPE.has(vinculo.role)) {
    return { acao: "recusar", status: 409, erro: "Essa pessoa já está na gestão desta academia." };
  }
  if (vinculo.status === "active") {
    return { acao: "recusar", status: 409, erro: "Essa pessoa já está na equipe desta academia." };
  }
  // Pendente (o link vai de novo) ou inativa (volta só com a prova do e-mail).
  return { acao: "pendente", reenvio: vinculo.status === "pending" };
}
