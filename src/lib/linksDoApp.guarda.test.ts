import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_PADRAO, linkDoApp } from "../../supabase/functions/_shared/linkDoApp";

/**
 * Trava do achado de 05/10/2026: o "Ver o relatório completo" do resumo
 * semanal montava `${APP_URL}/admin/relatorio-semanal`, sem o `#` do
 * HashRouter — o link abria a raiz, nunca o relatório. E o APP_URL não estava
 * em docs/INFRAESTRUTURA.md, com o site de vendas como padrão.
 *
 * Duas regras, para todas as edge functions:
 *  - link para uma tela do app leva o `#` (`${SITE_URL}/#/admin/...`);
 *  - toda variável de ambiente que uma função lê está documentada.
 */
const RAIZ = join(__dirname, "..", "..");
const FUNCOES = join(RAIZ, "supabase", "functions");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return nome.endsWith(".ts") ? [caminho] : [];
  });
}
const fontes = arquivos(FUNCOES).map((caminho) => ({
  arquivo: relative(RAIZ, caminho).replace(/\\/g, "/"),
  texto: readFileSync(caminho, "utf8"),
}));

// As rotas de primeiro nível do app (src/App.tsx).
const ROTAS = "admin|app|superadmin|auth|p|responsavel|contato|privacidade|termos";

describe("links do app nos e-mails e avisos", () => {
  it("linkDoApp põe o # e usa o app como padrão", () => {
    expect(linkDoApp(undefined, "/admin/relatorio-semanal")).toBe(`${APP_PADRAO}/#/admin/relatorio-semanal`);
    expect(linkDoApp("https://app.arkefit.com.br/", "/#/admin/relatorio-semanal")).toBe(
      "https://app.arkefit.com.br/#/admin/relatorio-semanal",
    );
    expect(linkDoApp("  ", "app")).toBe(`${APP_PADRAO}/#/app`);
  });

  it("nenhuma função monta link de tela do app sem o #", () => {
    // `/auth/v1/...` é a API do Auth do Supabase, não a tela de login do app.
    const semHash = new RegExp(`\\$\\{[^}]+\\}/(${ROTAS})(?!/v1/)(/|\\b)`);
    const pushSemHash = new RegExp(`url:\\s*["'\`]/(${ROTAS})(/|["'\`])`);
    const achados = fontes.flatMap(({ arquivo, texto }) =>
      texto
        .split("\n")
        .map((linha, i) => ({ linha, n: i + 1 }))
        .filter(({ linha }) => !linha.trim().startsWith("//") && (semHash.test(linha) || pushSemHash.test(linha)))
        .map(({ n }) => `${arquivo}:${n}`),
    );
    expect(achados).toEqual([]);
  });

  it("o resumo semanal abre o relatório", () => {
    const briefing = fontes.find((f) => f.arquivo.endsWith("briefing-semanal/index.ts"))!.texto;
    expect(briefing).toContain('const RELATORIO = "/#/admin/relatorio-semanal"');
    expect(briefing).toContain('linkDoApp(Deno.env.get("SITE_URL"), RELATORIO)');
    expect(briefing).not.toMatch(/Deno\.env\.get\("APP_URL"\)/);
  });
});

describe("variáveis das funções documentadas", () => {
  it("toda variável que uma função lê está em docs/INFRAESTRUTURA.md", () => {
    const doc = readFileSync(join(RAIZ, "docs", "INFRAESTRUTURA.md"), "utf8");
    const lidas = new Set<string>();
    for (const { texto } of fontes) {
      for (const m of texto.matchAll(/(?:Deno\.env\.get|\benv)\(\s*["']([A-Z][A-Z0-9_]+)["']\s*\)/g)) lidas.add(m[1]);
    }
    expect(lidas.size).toBeGreaterThan(10);
    const documentada = (nome: string) =>
      doc.includes(`\`${nome}\``) || (nome.startsWith("SUPABASE_") && doc.includes("`SUPABASE_*`"));
    expect([...lidas].filter((n) => !documentada(n)).sort()).toEqual([]);
  });
});
