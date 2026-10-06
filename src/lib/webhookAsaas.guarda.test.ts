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
    const consulta = codigo.slice(codigo.indexOf("const statusDasOrganizacoesDoAviso"), codigo.indexOf("  try {\n    // Sem payment.id"));
    expect(consulta.match(/admin\.from\(/g)?.length).toBe(consulta.match(/exigir\(admin\.from\(/g)?.length);
    // E alcançam a cobrança que já existe no banco com aquele id de pagamento.
    for (const tabela of ["cobrancas_b2b", "cobrancas_avulsas", "mensalidades", "pagamentos"]) {
      expect(consulta).toContain(`exigir(admin.from("${tabela}").select("organization_id").eq("asaas_payment_id", asaasPaymentId))`);
    }
  });

  it("a assinatura só muda de status a partir de ativa ou atrasada", () => {
    const mudancas = [...processamento.matchAll(/\.from\("aluno_assinaturas"\)\s*\.update\(\{ status:[\s\S]*?\)\);/g)].map((m) => m[0]);
    expect(mudancas.length).toBe(4);
    for (const m of mudancas) expect(m).toMatch(/\.in\("status", \["ativa", "atrasada"\]\)/);
  });
});
