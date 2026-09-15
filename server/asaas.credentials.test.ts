import { describe, expect, it } from "vitest";

const key = process.env.ASAAS_API_KEY;
const url = (process.env.ASAAS_API_URL || "https://api-sandbox.asaas.com/v3").replace(/\/$/, "");

// Smoke test de conectividade real — não deve rodar (nem falhar) em ambientes
// sem a credencial configurada, como CI público, onde não faz sentido expor
// a chave da Asaas a um runner de terceiros.
describe("Asaas sandbox credentials", () => {
  it.skipIf(!key)("reaches the account endpoint with the configured sandbox key", async () => {
    const response = await fetch(`${url}/myAccount`, { headers: { access_token: key as string, "Content-Type": "application/json" } });
    expect(response.ok).toBe(true);
  }, 15000);
});
