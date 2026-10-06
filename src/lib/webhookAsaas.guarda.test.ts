import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava do webhook do Asaas, com três regras que já falharam em silêncio:
 *
 * - o supabase-js não lança erro: toda leitura e gravação do processamento
 *   passa por `exigir(...)`, senão uma gravação que falha marca o aviso como
 *   processado e nada acusa;
 * - a data do pagamento é a do Asaas (`dataDoPagamento`), e não a do relógio:
 *   aviso reenviado pela conferência diária ou o segundo aviso do cartão
 *   mudavam o pagamento de mês;
 * - a assinatura só muda de status a partir de ativa ou atrasada: pagar uma
 *   cobrança antiga não reativa uma assinatura pausada ou cancelada;
 * - a trava de ambiente vale também para o aviso que não acha organização, e
 *   a consulta que falha recusa em vez de liberar (06/10/2026).
 */
const WEBHOOK = join(__dirname, "..", "..", "supabase", "functions", "asaas-webhook", "index.ts");
const codigo = readFileSync(WEBHOOK, "utf8").replace(/\r\n/g, "\n");
const processamento = codigo.slice(codigo.indexOf("  try {\n    // Sem payment.id"), codigo.lastIndexOf("  } catch (error) {"));

describe("webhook do Asaas", () => {
  it("o trecho do processamento foi achado", () => {
    expect(processamento.length).toBeGreaterThan(5000);
  });

  it("toda chamada ao banco no processamento confere o erro", () => {
    expect(processamento.match(/await admin\b/g) ?? [], "use await exigir(admin...)").toEqual([]);
    expect((processamento.match(/await exigir\(admin/g) ?? []).length).toBeGreaterThan(20);
  });

  it("a data do pagamento vem do Asaas", () => {
    const linhas = codigo.split("\n").filter((l) => /data_pagamento:/.test(l));
    expect(linhas.length).toBeGreaterThan(5);
    expect(linhas.filter((l) => /hojeBrasilia\(\)/.test(l))).toEqual([]);
  });

  it("a trava de ambiente vem antes de qualquer gravação e não depende de achar a organização", () => {
    const trava = processamento.indexOf("ambienteDoAviso(origemEvento");
    expect(trava, "a trava está no processamento").toBeGreaterThan(0);
    const primeiraGravacao = processamento.search(/\.(update|upsert|insert)\(/);
    expect(trava).toBeLessThan(primeiraGravacao);
    // A versão antiga pulava a trava quando não achava organização.
    expect(codigo).not.toMatch(/if \(statusOrg !== null\)/);
    // As consultas que descobrem a organização conferem o erro.
    const consulta = codigo.slice(codigo.indexOf("const alcanceDoAviso"), codigo.indexOf("  try {\n    // Sem payment.id"));
    expect(consulta.length).toBeGreaterThan(500);
    expect(consulta.match(/admin\.from\(/g)?.length).toBe(consulta.match(/exigir\(admin\.from\(/g)?.length);
    // E alcançam a cobrança que já existe no banco com aquele id de pagamento.
    for (const tabela of ["cobrancas_b2b", "cobrancas_avulsas", "mensalidades", "pagamentos"]) {
      expect(consulta).toMatch(new RegExp(`exigir\\(admin\\.from\\("${tabela}"\\)\\.select\\("organization_id[^"]*"\\)\\.eq\\("asaas_payment_id", asaasPaymentId\\)\\)`));
    }
  });

  // Cobrança na conta da academia (06/10/2026): o aviso vem da conta dela, em
  // `asaas-webhook?org=<id>`, com o token dela.
  it("com ?org=, só vale o token daquela academia, conferido pelo hash, e não o segredo da ArkeFit", () => {
    const ramoDaAcademia = codigo.slice(codigo.indexOf("  if (orgDoToken) {\n    if (tokenRecebido)"), codigo.indexOf("  } else {\n    origemEvento = !tokenRecebido"));
    expect(ramoDaAcademia.length, "o ramo da academia existe").toBeGreaterThan(200);
    expect(ramoDaAcademia).toMatch(/from\("asaas_webhook_academia"\)/);
    expect(ramoDaAcademia).toMatch(/iguaisEmTempoConstante\(await hashDoTokenWebhook\(tokenRecebido\), String\(registro\.token_hash\)\)/);
    expect(ramoDaAcademia, "o segredo da ArkeFit não abre o webhook da academia").not.toMatch(/webhookSecret/);
    // `org` que não é UUID é recusa, e não "sem org" (que cairia nos segredos da ArkeFit).
    expect(codigo).toMatch(/if \("invalido" in endereco\) \{\n\s+return jsonResponse\(\{ error: "Assinatura do webhook inválida." \}, 401\);/);
  });

  it("o aviso da conta da academia que não é do ARKE não é gravado, e o que é passa pelo escopo antes de tudo", () => {
    const naoGrava = codigo.indexOf("if (orgDoToken && !referenciaDaContaDaAcademia(");
    expect(naoGrava, "a cobrança que a academia fez por fora não entra").toBeGreaterThan(0);
    expect(naoGrava).toBeLessThan(codigo.indexOf('.from("asaas_webhook_events")\n    .upsert('));
    const escopo = processamento.indexOf("escopoDoAvisoDaAcademia({");
    expect(escopo, "o escopo está no processamento").toBeGreaterThan(0);
    expect(escopo).toBeLessThan(processamento.indexOf("ambienteDoAviso(origemEvento"));
    expect(escopo).toBeLessThan(processamento.search(/\.(update|upsert|insert)\(/));
    // O escopo sabe do Método, do B2B e da conta de cada cobrança.
    expect(processamento).toMatch(/tocaB2b: alcance\.tocaB2b,\n\s+tocaMetodo: alcance\.tocaMetodo,\n\s+contasDasCobrancas: alcance\.contas,/);
  });

  it("a assinatura só muda de status a partir de ativa ou atrasada", () => {
    const mudancas = [...processamento.matchAll(/\.from\("aluno_assinaturas"\)\s*\.update\(\{ status:[\s\S]*?\)\);/g)].map((m) => m[0]);
    expect(mudancas.length).toBe(4);
    for (const m of mudancas) expect(m).toMatch(/\.in\("status", \["ativa", "atrasada"\]\)/);
  });
});
