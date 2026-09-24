import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { reais, decimal, lerReais } from "./numeros";

/**
 * Trava contra número escrito com ponto na tela.
 *
 * `toFixed` é o jeito mais curto de escrever "duas casas" e escreve no padrão
 * americano: a rodada de 24/09/2026 encontrou "R$ 125.53" no saldo do
 * financeiro da academia, "41.2%" na Visão Master e "R$ 49.05" na mensagem de
 * erro da cobrança — mais de 40 ocorrências em 21 arquivos, porque cada
 * tela nova copiava a vizinha. O caso legítimo é o valor posto num campo de
 * formulário, que já troca o ponto pela vírgula na mesma expressão.
 */

const RAIZ = join(__dirname, "..", "..");
const RAIZES = ["src", join("supabase", "functions")];

function arquivos(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

const fontes = RAIZES.flatMap((raiz) => arquivos(join(RAIZ, raiz))).map((caminho) => ({
  nome: caminho.slice(RAIZ.length + 1).replace(/\\/g, "/"),
  codigo: readFileSync(caminho, "utf8"),
}));

describe("números na tela usam vírgula decimal", () => {
  it("encontra os fontes", () => {
    expect(fontes.length).toBeGreaterThan(50);
  });

  it("nenhum toFixed vai para a tela", () => {
    const culpados = fontes.flatMap((f) =>
      f.codigo
        .split("\n")
        .map((linha, i) => ({ linha, i }))
        .filter(({ linha }) => /\.toFixed\(/.test(linha) && !/\.toFixed\([^)]*\)\.replace\("\.", ","\)/.test(linha))
        .map(({ i }) => `${f.nome}:${i + 1}`),
    );
    expect(culpados, 'toFixed escreve "125.53". Use reais() ou decimal() de "@/lib/numeros" (nas edge functions, toLocaleString("pt-BR")).').toEqual([]);
  });

  it("formata como o Brasil lê", () => {
    // O Intl separa "R$" do valor com espaço rígido (U+00A0).
    expect(reais(1234.5).replace(/\u00a0/g, " ")).toBe("R$ 1.234,50");
    expect(reais("125.53").replace(/\u00a0/g, " ")).toBe("R$ 125,53");
    expect(reais(null).replace(/\u00a0/g, " ")).toBe("R$ 0,00");
    expect(decimal(41.25, 1)).toBe("41,3");
    expect(decimal(1500, 0)).toBe("1.500");
    expect(decimal("0", 2)).toBe("0,00");
  });
});

describe("lerReais", () => {
  it("lê o valor como a pessoa digitou", () => {
    expect(lerReais("80,50")).toBe(80.5);
    expect(lerReais("80.50")).toBe(80.5);
    expect(lerReais("1.234,56")).toBe(1234.56);
    expect(lerReais("1.500")).toBe(1500);
    expect(lerReais("R$ 120")).toBe(120);
    expect(lerReais("12000")).toBe(12000);
  });

  it("não inventa número do que não é valor", () => {
    expect(lerReais("")).toBeNaN();
    expect(lerReais("abc")).toBeNaN();
    expect(lerReais("1,2,3")).toBeNaN();
    expect(lerReais("80.5055")).toBeNaN();
    // "80.505" é oitenta mil quinhentos e cinco na leitura brasileira, não erro.
    expect(lerReais("80.505")).toBe(80505);
  });
});
