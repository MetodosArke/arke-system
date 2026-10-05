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
 *   cobrança antiga não reativa uma assinatura pausada ou cancelada.
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

  it("a assinatura só muda de status a partir de ativa ou atrasada", () => {
    const mudancas = [...processamento.matchAll(/\.from\("aluno_assinaturas"\)\s*\.update\(\{ status:[\s\S]*?\)\);/g)].map((m) => m[0]);
    expect(mudancas.length).toBe(4);
    for (const m of mudancas) expect(m).toMatch(/\.in\("status", \["ativa", "atrasada"\]\)/);
  });
});
