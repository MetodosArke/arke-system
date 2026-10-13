import { describe, expect, it } from "vitest";
import {
  cabecalhosDoResend,
  chaveDeIdempotencia,
  envioAceito,
  LIMITE_DA_CHAVE,
  resumoParaChave,
} from "../../supabase/functions/_shared/idempotenciaEmail";

/**
 * A chave de idempotência dos e-mails pelo Resend (13/10/2026). A regra é a
 * do arquivo publicado, não uma cópia.
 */
describe("chave de idempotência do e-mail", () => {
  it("junta o tipo e as partes com barra", () => {
    expect(chaveDeIdempotencia("briefing-semanal", "6f1e0c3a-0000-4000-8000-000000000001", "2026-10-13")).toBe(
      "briefing-semanal/6f1e0c3a-0000-4000-8000-000000000001/2026-10-13",
    );
    expect(chaveDeIdempotencia("lead-site", 42)).toBe("lead-site/42");
  });

  it("o mesmo evento dá a mesma chave, e outro evento dá outra", () => {
    const a = chaveDeIdempotencia("vigia-resumo", "2026-10-13");
    expect(chaveDeIdempotencia("vigia-resumo", "2026-10-13")).toBe(a);
    expect(chaveDeIdempotencia("vigia-resumo", "2026-10-14")).not.toBe(a);
  });

  it("recusa e-mail, nome com espaço, barra e parte vazia", () => {
    expect(() => chaveDeIdempotencia("convite", "fulana@exemplo.com")).toThrow();
    expect(() => chaveDeIdempotencia("convite", "Maria Silva")).toThrow();
    expect(() => chaveDeIdempotencia("convite", "a/b")).toThrow();
    expect(() => chaveDeIdempotencia("convite", "")).toThrow();
    expect(() => chaveDeIdempotencia("convite")).toThrow();
  });

  it("não passa do limite do Resend", () => {
    expect(() => chaveDeIdempotencia("t", "a".repeat(LIMITE_DA_CHAVE))).toThrow();
    expect(chaveDeIdempotencia("t", "a".repeat(LIMITE_DA_CHAVE - 2))).toHaveLength(LIMITE_DA_CHAVE);
  });

  it("o resumo é estável, curto e muda com o conteúdo", async () => {
    const r = await resumoParaChave("assunto", "<p>link 1</p>");
    expect(r).toMatch(/^[0-9a-f]{40}$/);
    expect(await resumoParaChave("assunto", "<p>link 1</p>")).toBe(r);
    expect(await resumoParaChave("assunto", "<p>link 2</p>")).not.toBe(r);
    // A fronteira entre os textos conta: ("ab", "c") não é ("a", "bc").
    expect(await resumoParaChave("ab", "c")).not.toBe(await resumoParaChave("a", "bc"));
    expect(chaveDeIdempotencia("painel-pronto", r)).toBe(`painel-pronto/${r}`);
  });

  it("os cabeçalhos levam a chave", () => {
    expect(cabecalhosDoResend("re_teste", "lead-site/1")).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer re_teste",
      "Idempotency-Key": "lead-site/1",
    });
  });

  it("o 409 conta como enviado: a mesma chave já saiu ou está saindo", () => {
    expect(envioAceito(200)).toBe(true);
    expect(envioAceito(409)).toBe(true);
    expect(envioAceito(429)).toBe(false);
    expect(envioAceito(422)).toBe(false);
    expect(envioAceito(500)).toBe(false);
  });
});
