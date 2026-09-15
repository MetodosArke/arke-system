import { describe, expect, it } from "vitest";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY;

// Smoke test de conectividade real — não deve rodar (nem falhar) em ambientes
// sem as credenciais configuradas, como CI público, onde não faz sentido
// expor a service role key a um runner de terceiros.
describe("Supabase Auth credentials", () => {
  it.skipIf(!url || !key)("reaches the Auth settings endpoint with the configured server key", async () => {
    const response = await fetch(`${(url as string).replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: key as string, Authorization: `Bearer ${key}` } });
    expect(response.ok).toBe(true);
  }, 15000);
});
