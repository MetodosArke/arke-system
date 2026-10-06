import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { academiaDoCadastro, decidirCadastro } from "../../supabase/functions/cadastrar-membro-equipe/fluxo";
import { emailEquipePendente } from "../../supabase/functions/cadastrar-membro-equipe/email";

/**
 * Achado da auditoria de 05/10/2026: o cadastro direto da equipe ignorava a
 * unidade escolhida na tela e usava o vínculo de gestor mais antigo. O gestor
 * de duas unidades cadastrava um professor para a unidade B, e ele nascia na
 * A, vendo os alunos de A.
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const RAIZ = join(__dirname, "..", "..");

describe("cadastro da equipe: a academia é a da tela", () => {
  it("gestor de duas unidades cadastra na unidade que a tela mandou", () => {
    expect(academiaDoCadastro(B, [A, B])).toEqual({ ok: true, organizationId: B });
    expect(academiaDoCadastro(A, [A, B])).toEqual({ ok: true, organizationId: A });
  });

  it("academia de que quem chama não é gestor é recusada", () => {
    expect(academiaDoCadastro(B, [A])).toMatchObject({ ok: false, status: 403 });
    expect(academiaDoCadastro(B, [])).toMatchObject({ ok: false, status: 403 });
  });

  it("academia que não é id é pedido inválido", () => {
    expect(academiaDoCadastro("academia-b", [A])).toMatchObject({ ok: false, status: 400 });
    expect(academiaDoCadastro(42, [A])).toMatchObject({ ok: false, status: 400 });
  });

  it("sem a academia no pedido (tela antiga), só decide quando não há escolha", () => {
    expect(academiaDoCadastro(undefined, [A])).toEqual({ ok: true, organizationId: A });
    expect(academiaDoCadastro(undefined, [A, B])).toMatchObject({ ok: false, status: 400 });
    expect(academiaDoCadastro(undefined, [])).toMatchObject({ ok: false, status: 403 });
  });

  it("as três telas que cadastram mandam a academia escolhida", () => {
    for (const arquivo of [
      "src/pages/admin/AdminEquipe.tsx",
      "src/components/admin/onboarding/EtapaEquipe.tsx",
      "src/components/admin/ParceriaAutonomo.tsx",
    ]) {
      const fonte = readFileSync(join(RAIZ, arquivo), "utf8");
      const chamada = fonte.slice(fonte.indexOf('"cadastrar-membro-equipe"'), fonte.indexOf('"cadastrar-membro-equipe"') + 600);
      expect(chamada, arquivo).toMatch(/organization_id:/);
    }
  });

  it("a função não volta ao vínculo de gestor mais antigo", () => {
    const funcao = readFileSync(join(RAIZ, "supabase", "functions", "cadastrar-membro-equipe", "index.ts"), "utf8");
    expect(funcao).toContain("academiaDoCadastro(");
    expect(funcao).not.toMatch(/\.order\("created_at", \{ ascending: true \}\)\s*\.limit\(1\)/);
  });
});

/**
 * Pré-sequestro de conta (auditoria de prontidão de 06/10/2026): o cadastro
 * da equipe criava a conta com uma senha que voltava para quem cadastrava, e a
 * parceria do autônomo ligava na hora a conta que já existia. Agora, como na
 * gestão: e-mail novo recebe o convite e cria a senha pelo link; conta que já
 * existe fica pendente até a pessoa definir a senha pelo link do e-mail.
 */
describe("cadastro da equipe: a conta é de quem prova o e-mail", () => {
  const CONTA = { user_id: "u-1", ultimo_acesso: null };

  it("e-mail sem conta: convite, e o nome é obrigatório", () => {
    expect(decidirCadastro(null, null, "Ana Souza")).toEqual({ acao: "convidar" });
    expect(decidirCadastro(null, null, "  ")).toMatchObject({ acao: "recusar", status: 400, precisaNome: true });
    expect(decidirCadastro(null, null, undefined)).toMatchObject({ acao: "recusar", precisaNome: true });
  });

  it("conta que já existe, sem vínculo aqui: pendente, mesmo sem o nome", () => {
    expect(decidirCadastro(CONTA, null, null)).toEqual({ acao: "pendente", reenvio: false });
  });

  it("pendente de novo reenvia; inativo volta só pela prova do e-mail", () => {
    expect(decidirCadastro(CONTA, { role: "professor", status: "pending" }, null)).toEqual({ acao: "pendente", reenvio: true });
    expect(decidirCadastro(CONTA, { role: "recepcao", status: "inactive" }, null)).toEqual({ acao: "pendente", reenvio: false });
  });

  it("já na equipe, na gestão ou aluna daqui: recusado", () => {
    expect(decidirCadastro(CONTA, { role: "nutricionista", status: "active" }, "x")).toMatchObject({ acao: "recusar", status: 409 });
    expect(decidirCadastro(CONTA, { role: "gestor", status: "active" }, "x")).toMatchObject({ acao: "recusar", status: 409 });
    expect(decidirCadastro(CONTA, { role: "aluno", status: "active" }, "x")).toMatchObject({ acao: "recusar", status: 409 });
  });

  it("o e-mail de quem já tinha conta diz que o acesso só vale pelo link, sem senha nenhuma", () => {
    const m = emailEquipePendente({ nome: "Ana Souza", academia: "Academia <A>", papel: "recepcao", link: "https://app.arkefit.com.br/#/x?a=1&b=2" });
    expect(m.assunto).toContain("Academia <A>");
    expect(m.texto).toContain("Olá, Ana.");
    expect(m.texto).toContain("como recepção");
    expect(m.texto).toContain("só vale depois que você definir a sua senha");
    expect(m.html).toContain("Academia &lt;A&gt;");
    expect(m.html).toContain('href="https://app.arkefit.com.br/#/x?a=1&amp;b=2"');
    expect(m.texto.toLowerCase()).not.toContain("senha temporária");
  });
});
