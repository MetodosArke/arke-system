import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// O script inline do index.html arruma os links de convite e de senha do
// Supabase para o HashRouter antes de o app subir. Ele roda a cada carga da
// página — inclusive a segunda, quando o link abre em arkefit.com.br e o
// main.tsx leva para app.arkefit.com.br. Aqui ele é executado como está no
// arquivo, com uma janela de mentira.
const html = readFileSync(join(__dirname, "..", "..", "index.html"), "utf8");
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("access_token"));

function normalizar(href: string): string {
  const url = new URL(href);
  let atual = href;
  const janela = {
    location: { href, origin: url.origin, pathname: url.pathname, search: url.search, hash: href.includes("#") ? href.slice(href.indexOf("#")) : "" },
    history: { replaceState: (_: unknown, __: string, novo: string) => { atual = novo; } },
  };
  new Function("window", "document", script!)(janela, { title: "" });
  return atual;
}

const TOKENS = "access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=invite";

describe("links do Supabase no index.html", () => {
  it("o script existe", () => {
    expect(script).toBeTruthy();
  });

  it("leva os tokens do segundo # para depois do ? da rota", () => {
    expect(normalizar(`https://app.arkefit.com.br/#/auth/definir-senha#${TOKENS}`)).toBe(`https://app.arkefit.com.br/#/auth/definir-senha?${TOKENS}`);
    expect(normalizar("https://app.arkefit.com.br/#access_token=abc&type=recovery")).toBe("https://app.arkefit.com.br/#/auth/reset-password?access_token=abc&type=recovery");
  });

  it("não mexe em link já arrumado — o access_token sobrevive à segunda carga", () => {
    // Era o defeito: vindo de www.arkefit.com.br, o link chegava ao app só com ?type=invite.
    const arrumado = `https://app.arkefit.com.br/#/auth/definir-senha?${TOKENS}`;
    expect(normalizar(arrumado)).toBe(arrumado);
    const erro = "https://app.arkefit.com.br/#/auth/reset-password?error=access_denied&error_description=expirou";
    expect(normalizar(erro)).toBe(erro);
  });

  it("de ponta a ponta: arrumado no www e carregado de novo no app", () => {
    const noWww = normalizar(`https://www.arkefit.com.br/#/auth/definir-senha#${TOKENS}`);
    const noApp = normalizar(noWww.replace("https://www.arkefit.com.br", "https://app.arkefit.com.br"));
    expect(noApp).toBe(`https://app.arkefit.com.br/#/auth/definir-senha?${TOKENS}`);
  });
});
