import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { academiaDoCadastro } from "../../supabase/functions/cadastrar-membro-equipe/fluxo";

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
