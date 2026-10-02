import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava das chaves de cache do React Query: a mesma chave não pode ser usada
 * por duas consultas diferentes.
 *
 * O cache é guardado pela chave, não pela consulta. Quando duas telas usam a
 * mesma chave com consultas diferentes, a segunda tela recebe primeiro o que
 * a outra guardou. Foi o que deixou o botão "Iniciar treino" sem exercício
 * nenhum (02/10/2026): a tela inicial guardava `aluno-treino-ativo` sem os
 * exercícios, e a execução lia esse cache. Mesmo quando a consulta completa
 * voltava, o id do treino era o mesmo e a tela não recalculava a lista. Na
 * mesma varredura, `aluno-registro-hoje` fazia as marcações de exercício
 * sumirem depois de passar pela tela inicial.
 *
 * O defeito não dá erro: a tela abre, só que com dado pela metade, e só
 * aparece para quem navega na ordem certa. Por isso a trava é este teste.
 *
 * Assinatura de uma consulta = as tabelas (`.from`) e funções (`.rpc`) que
 * ela chama, as colunas do `.select` e as colunas dos filtros, na ordem.
 * Mesma chave exige a mesma assinatura.
 */
const SRC = join(__dirname, "..");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

/** O trecho entre o "(" em `inicio` e o ")" que fecha ele, sem contar parênteses em texto. */
function argumentos(texto: string, inicio: number): string {
  let profundidade = 0;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"' || c === "'" || c === "`") {
      const fecha = c;
      for (i++; i < texto.length && texto[i] !== fecha; i++) if (texto[i] === "\\") i++;
      continue;
    }
    if (c === "/" && texto[i + 1] === "/") {
      i = texto.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (c === "/" && texto[i + 1] === "*") {
      i = texto.indexOf("*/", i) + 1;
      continue;
    }
    if (c === "(") profundidade++;
    if (c === ")" && --profundidade === 0) return texto.slice(inicio, i + 1);
  }
  return texto.slice(inicio);
}

function assinatura(corpo: string): string {
  const partes: string[] = [];
  const re = /\.(from|rpc|select|eq|neq|in|is|gt|gte|lt|lte|order|limit)\(\s*(?:"([^"]*)"|(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(corpo))) partes.push(`${m[1]}(${m[2] ?? m[3] ?? ""})`);
  return partes.join(" ");
}

type Uso = { arquivo: string; assinatura: string };

function consultasPorChave(): Map<string, Uso[]> {
  const mapa = new Map<string, Uso[]>();
  for (const caminho of arquivos(SRC)) {
    const texto = readFileSync(caminho, "utf8");
    const re = /\buseQuery(?:<[^>]*>)?\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) {
      const corpo = argumentos(texto, m.index + m[0].length - 1);
      const chave = corpo.match(/queryKey:\s*\[\s*["']([^"']+)["']/)?.[1];
      if (!chave) continue;
      const usos = mapa.get(chave) ?? [];
      usos.push({ arquivo: relative(SRC, caminho).split("\\").join("/"), assinatura: assinatura(corpo) });
      mapa.set(chave, usos);
    }
  }
  return mapa;
}

describe("chaves de cache do React Query", () => {
  it("a mesma chave nunca é usada por consultas diferentes", () => {
    const conflitos: string[] = [];
    for (const [chave, usos] of consultasPorChave()) {
      const assinaturas = new Set(usos.map((u) => u.assinatura));
      if (assinaturas.size > 1) {
        conflitos.push(`${chave}:\n${usos.map((u) => `  ${u.arquivo} → ${u.assinatura}`).join("\n")}`);
      }
    }
    expect(conflitos, conflitos.join("\n\n")).toEqual([]);
  });

  it("a varredura enxerga as consultas do app", () => {
    // Sem isto, um erro no leitor passaria a trava sem olhar nada.
    expect(consultasPorChave().size).toBeGreaterThan(100);
  });
});
