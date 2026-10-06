import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava do aviso do Asaas guardado no mínimo (auditoria de 05/10/2026).
 *
 * O `asaas-webhook` gravava o aviso inteiro — com o `creditCardToken`, os
 * links do boleto e do comprovante — e ele ficava 90 dias assim. Desde
 * `20261375010000`, o gatilho `trg_minimizar_aviso_asaas` reduz o aviso, na
 * gravação, ao que o processamento lê, mais os 4 dígitos e a bandeira (o que
 * a Política de Privacidade promete). Duas coisas desfariam isso sem erro:
 *
 *   * o webhook passar a ler um campo novo que a redução descarta: o aviso
 *     reprocessado (o Vigia reenvia o aviso guardado) chegaria sem ele, e a
 *     cobrança ficaria errada só no reprocessamento;
 *   * a redução voltar a guardar o token ou os links.
 */
const RAIZ = join(__dirname, "..", "..");
const MIGRATIONS = join(RAIZ, "supabase", "migrations");
const webhook = readFileSync(join(RAIZ, "supabase", "functions", "asaas-webhook", "index.ts"), "utf8");

/** A última definição de uma função SQL, entre todas as migrations. */
function ultimaDefinicao(funcao: string): string {
  let ultima = "";
  for (const arquivo of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, arquivo), "utf8");
    const re = new RegExp(`create or replace function public\\.${funcao}\\s*\\([\\s\\S]*?\\n\\$(function)?\\$;`, "gi");
    for (const m of sql.match(re) ?? []) ultima = m;
  }
  return ultima;
}

const reducao = ultimaDefinicao("minimizar_aviso_asaas");
/** As chaves que a redução guarda: as do aviso e as da cobrança. */
const guardaNoAviso = new Set([...reducao.matchAll(/'(\w+)',\s*_payload\s*->/g)].map((m) => m[1]));
// A cobrança é montada à parte, a partir de `p` (o `payment` do aviso).
if (/'payment',\s*case when jsonb_typeof\(p\) = 'object'/.test(reducao)) guardaNoAviso.add("payment");
const guardaNaCobranca = new Set([...reducao.matchAll(/'(\w+)',\s*p\s*->/g)].map((m) => m[1]));

describe("aviso do Asaas no mínimo", () => {
  it("a redução foi achada", () => {
    expect(reducao, "minimizar_aviso_asaas existe").not.toBe("");
    expect(guardaNaCobranca.size).toBeGreaterThan(10);
  });

  it("todo campo que o webhook lê sobrevive à redução (o reprocessamento depende disso)", () => {
    const daCobranca = new Set([...webhook.matchAll(/\bpayment\??\.(\w+)/g)].map((m) => m[1]));
    const doAviso = new Set([...webhook.matchAll(/\bpayload\??\.(\w+)/g)].map((m) => m[1]));
    expect(daCobranca.size, "o detector detecta").toBeGreaterThan(8);
    expect([...daCobranca].filter((c) => !guardaNaCobranca.has(c)), "campo da cobrança que o webhook lê e a redução descarta").toEqual([]);
    expect([...doAviso].filter((c) => !guardaNoAviso.has(c)), "campo do aviso que o webhook lê e a redução descarta").toEqual([]);
  });

  it("do cartão, só os 4 dígitos e a bandeira; nada de token nem de link do boleto", () => {
    for (const sensivel of ["creditCardToken", "bankSlipUrl", "transactionReceiptUrl", "nossoNumero", "pixQrCodeId", "pixTransaction", "split"]) {
      expect(reducao, sensivel).not.toMatch(new RegExp(`'${sensivel}'`));
    }
    expect(reducao).toMatch(/'creditCardNumber',\s*to_jsonb\(right\(p -> 'creditCard' ->> 'creditCardNumber', 4\)\)/);
  });

  it("a redução vale para toda gravação", () => {
    const todas = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
      .join("\n");
    expect(todas).toMatch(
      /create trigger trg_minimizar_aviso_asaas\s+before insert or update of payload on public\.asaas_webhook_events\s+for each row execute function public\.minimizar_aviso_asaas_ao_gravar\(\)/,
    );
  });

  it("o resumo do aviso chega em até 30 dias", () => {
    const limpeza = ultimaDefinicao("limpar_historicos_antigos");
    const prazo = limpeza.match(/update public\.asaas_webhook_events[\s\S]*?interval '(\d+) days'/)?.[1];
    expect(Number(prazo), "dias até o resumo").toBeLessThanOrEqual(30);
  });
});
