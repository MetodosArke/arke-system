import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Os cabeçalhos de segurança do app (vercel.json).
 *
 * A CSP libera o script embutido do index.html pelo hash dele. Mudar o script
 * sem mudar o hash faria o navegador recusá-lo quando a CSP passar a valer, e
 * é ele que conserta os links de convite e de senha. O hash é do texto com
 * quebra de linha LF, que é como o arquivo sai do git para o build da Vercel.
 */
const RAIZ = join(__dirname, "..", "..");
const vercel = JSON.parse(readFileSync(join(RAIZ, "vercel.json"), "utf8")) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const geral = vercel.headers.find((h) => h.source === "/(.*)")?.headers ?? [];
const valor = (chave: string) => geral.find((h) => h.key.toLowerCase() === chave.toLowerCase())?.value ?? "";
const csp = valor("Content-Security-Policy") || valor("Content-Security-Policy-Report-Only");

describe("cabeçalhos de segurança", () => {
  it("todo script embutido do index.html está liberado pelo hash na CSP", () => {
    const html = readFileSync(join(RAIZ, "index.html"), "utf8").replace(/\r\n/g, "\n");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) {
      const hash = createHash("sha256").update(s, "utf8").digest("base64");
      expect(csp, "atualize o sha256 do script-src no vercel.json").toContain(`'sha256-${hash}'`);
    }
  });

  it("a CSP fecha o que não usamos e manda os relatos ao Sentry", () => {
    for (const diretiva of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) {
      expect(csp).toContain(diretiva);
    }
    expect(csp).toMatch(/report-uri https:\/\/[^ ;]+ingest\.us\.sentry\.io\/api\/\d+\/security\//);
  });

  it("os outros cabeçalhos estão lá", () => {
    expect(valor("X-Content-Type-Options")).toBe("nosniff");
    expect(valor("X-Frame-Options")).toBe("DENY");
    expect(valor("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(valor("Permissions-Policy")).toContain("microphone=()");
  });
});
