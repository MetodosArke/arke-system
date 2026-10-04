import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Trava: imagem que vai para o Storage sai reduzida do aparelho.
 *
 * A foto do celular sobe com 3 a 10 MB, e cada tela que a mostra baixa tudo de
 * novo. Esquecer a redução não dá erro nenhum: a imagem aparece, só que pesada,
 * e o custo chega no fim do mês como saída de dados. Foi assim no feed e no
 * logo da academia até 04/10/2026.
 *
 * Todo arquivo do app que chama `.upload(` passa por `reduzirImagem` ou está na
 * lista abaixo, com o motivo de não passar.
 */
const SEM_REDUCAO: Record<string, string> = {
  "src/components/admin/MarcaAppAluno.tsx": "os ícones do app já nascem no canvas, em 192 e 512 px",
  "src/components/aluno/DocumentosMatricula.tsx": "atestado é documento: sobe como veio, porque é prova e precisa ser legível",
  "src/components/catraca/TermoImpressoBiometria.tsx": "termo assinado é prova: sobe como veio",
  "src/components/chat/ChatPanel.tsx": "vídeo do chat, com limite de 10 MB no bucket",
};

const RAIZ = join(__dirname, "..", "..");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("imagem enviada ao Storage", () => {
  const comEnvio = arquivos(join(RAIZ, "src"))
    .filter((p) => /\.upload\(/.test(readFileSync(p, "utf8")))
    .map((p) => relative(RAIZ, p).replace(/\\/g, "/"));

  it("passa por reduzirImagem, ou tem motivo escrito para não passar", () => {
    const semMotivo = comEnvio.filter((p) => !SEM_REDUCAO[p] && !/reduzirImagem\(/.test(readFileSync(join(RAIZ, p), "utf8")));
    expect(semMotivo, `envio de arquivo sem reduzirImagem: ${semMotivo.join(", ")}`).toEqual([]);
  });

  it("a lista de exceções não guarda arquivo que já não envia nada", () => {
    expect(Object.keys(SEM_REDUCAO).filter((p) => !comEnvio.includes(p))).toEqual([]);
  });
});
