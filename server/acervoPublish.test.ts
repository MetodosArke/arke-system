import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishGlobalExercises } from "./supabaseAdmin";

// Regressão: o filtro em lote usava "id.in.(...)" (ponto) em vez de
// "id=in.(...)" (igual), que é a sintaxe real do PostgREST. Sem o "=" a
// query string não é um filtro válido, o PATCH chega sem WHERE nenhum e o
// Supabase recusa com "UPDATE requires a WHERE clause" — só apareceu
// quando o Acervo Global deixou de estar vazio e alguém aprovou rascunhos
// pela primeira vez.
describe("publishGlobalExercises", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("filters by id using the PostgREST 'in' syntax with an equals sign", async () => {
    let capturedUrl = "";
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    await publishGlobalExercises(["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"], "user-1");

    expect(capturedUrl).toContain("id=in.(11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222)");
    expect(capturedUrl).not.toContain("id.in.(");
  });

  it("does nothing when the id list is empty", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await publishGlobalExercises([], "user-1");

    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
