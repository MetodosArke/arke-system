import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Asaas sandbox credentials", () => {
  it("reaches the account endpoint with the configured sandbox key", async () => {
    const key = process.env.ASAAS_API_KEY || readFileSync("/home/ubuntu/arke-work/asaas-test-secret.txt", "utf8").trim();
    const url = (process.env.ASAAS_API_URL || "https://api-sandbox.asaas.com/v3").replace(/\/$/, "");
    if (!key) throw new Error("ASAAS_API_KEY is not configured");
    const response = await fetch(`${url}/myAccount`, { headers: { access_token: key, "Content-Type": "application/json" } });
    expect(response.ok).toBe(true);
  }, 15000);
});
