import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { avisoDeTrocaDeCarteira, ehTrocaDeCarteira, finalDaCarteira } from "../../supabase/functions/asaas-conta-academia/fluxo";
import { impedimentoDaCarteira } from "../../supabase/functions/nfse-emitir/fluxo";

const A = "aaaaaaaa-1111-2222-3333-444444abcdef";
const B = "bbbbbbbb-1111-2222-3333-444444123456";
const RAIZ = join(__dirname, "..", "..");

describe("troca da carteira de recebimento (o mesmo código da edge function)", () => {
  it("é troca só quando já havia carteira e a nova é outra", () => {
    expect(ehTrocaDeCarteira(null, A)).toBe(false);
    expect(ehTrocaDeCarteira(undefined, A)).toBe(false);
    expect(ehTrocaDeCarteira(A, A)).toBe(false);
    expect(ehTrocaDeCarteira(A.toUpperCase(), A)).toBe(false);
    expect(ehTrocaDeCarteira(A, B)).toBe(true);
  });

  it("o e-mail para a ArkeFit leva só o fim das carteiras, e escapa o nome da academia", () => {
    const m = avisoDeTrocaDeCarteira({
      academia: "Academia <b>Teste</b>",
      papel: "gestor",
      anterior: A,
      nova: B,
      quando: "06/10/2026 09:00",
      painel: "https://app.arkefit.com.br/#/superadmin",
    });
    expect(m.assunto).toContain("carteira de recebimento trocada");
    expect(m.texto).toContain(`Antes: ${finalDaCarteira(A)}. Agora: ${finalDaCarteira(B)}.`);
    expect(m.texto).toContain("com as duas etapas");
    expect(m.texto).not.toContain(A);
    expect(m.texto).not.toContain(B);
    expect(m.html).not.toContain("<b>Teste</b>");
    expect(m.html).toContain("&lt;b&gt;Teste&lt;/b&gt;");
    expect(finalDaCarteira(null)).toBe("nenhuma");
  });
});

describe("a nota fiscal confere a carteira antes de emitir", () => {
  it("chave de outra conta, ou que o Asaas não confirma, segura a emissão", () => {
    expect(impedimentoDaCarteira(A, A)).toBeNull();
    expect(impedimentoDaCarteira(A.toUpperCase(), A)).toBeNull();
    expect(impedimentoDaCarteira(A, B)).toMatch(/outra conta Asaas/);
    expect(impedimentoDaCarteira(null, A)).toMatch(/não foi possível conferir/);
    expect(impedimentoDaCarteira(A, null)).toMatch(/conta de recebimentos não configurada/);
  });

  it("nfse-emitir confere a carteira, e só para nota nova", () => {
    const funcao = readFileSync(join(RAIZ, "supabase", "functions", "nfse-emitir", "index.ts"), "utf8");
    expect(funcao).toMatch(/impedimentoEmissao = impedimentoDaCarteira\(carteira, /);
    // A carteira de hoje (e, desde 06/10/2026, o modo da cobrança na conta da academia).
    expect(funcao).toMatch(/select\("status, asaas_wallet_id[^"]*"\)/);
  });

  it("a tela fiscal também confere, e pede a chave da conta nova", () => {
    const funcao = readFileSync(join(RAIZ, "supabase", "functions", "asaas-fiscal-academia", "index.ts"), "utf8");
    const confere = funcao.indexOf("impedimentoDaCarteira(carteira,");
    expect(confere).toBeGreaterThan(0);
    expect(confere).toBeLessThan(funcao.indexOf('if (acao === "situacao") return jsonResponse(await situacao('));
  });
});

describe("asaas-conta-academia: a troca", () => {
  const funcao = readFileSync(join(RAIZ, "supabase", "functions", "asaas-conta-academia", "index.ts"), "utf8");
  const existente = funcao.slice(funcao.indexOf('if (acao === "existente")'), funcao.indexOf('if (acao === "situacao")'));

  it("pede as duas etapas antes de gravar", () => {
    const trava = existente.indexOf("if (troca && !verificada(claims?.claims))");
    expect(trava).toBeGreaterThan(0);
    expect(trava).toBeLessThan(existente.indexOf('admin.rpc("definir_carteira_recebimento"'));
  });

  it("grava pela função que registra na auditoria, e não direto na coluna", () => {
    expect(existente).toContain('admin.rpc("definir_carteira_recebimento"');
    expect(existente).not.toMatch(/\.update\(\{\s*asaas_wallet_id/);
    const sql = readFileSync(join(RAIZ, "supabase", "migrations", "20261367010000_carteira_de_recebimento_auditada.sql"), "utf8");
    expect(sql).toMatch(/perform public\.registrar_auditoria\(/);
    expect(sql).toMatch(/'organizacao\.carteira_trocada'/);
    expect(sql).toMatch(/revoke execute on function public\.definir_carteira_recebimento\(uuid, text, uuid, text\) from public, anon, authenticated/);
  });

  it("avisa a ArkeFit pelo canal dos alertas", () => {
    expect(existente).toMatch(/if \(troca\) \{[\s\S]*await avisarArkefit\(admin, aviso\)/);
    expect(funcao).toMatch(/admin\.rpc\("emails_superadmin"\)/);
  });
});
