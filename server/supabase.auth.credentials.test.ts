import { describe, expect, it } from "vitest";

describe("Supabase Auth credentials", () => {
  it("reaches the Auth settings endpoint with the configured server key", async () => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY;
    if (!url || !key) throw new Error("Supabase secrets are not configured");
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    expect(response.ok).toBe(true);
  }, 15000);
});
