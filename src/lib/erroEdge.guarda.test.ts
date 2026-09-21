import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Trava estrutural contra a volta do defeito corrigido em 21/09/2026.
 *
 * Com status não-2xx, `supabase.functions.invoke` devolve `data: null` e um
 * erro de mensagem fixa em inglês; o texto que a edge function escreveu fica
 * em `error.context`. Relançar o erro cru (`if (error) throw error`) ou ler
 * `error.message` direto mostra ao usuário "Edge Function returned a non-2xx
 * status code" no lugar de "Já existe uma conta com esse e-mail". Estava em
 * 20 das 22 chamadas do app — inclusive na importação de alunos, onde cada
 * linha com falha perdia o motivo real.
 *
 * Tem a cara do vínculo duplo: parece certo, e por isso volta a cada tela
 * nova. Em vez de confiar em lembrar, este teste lê o código.
 */

const RAIZ = join(__dirname, "..");
const TETO = 3000; // salvaguarda caso a contagem de chaves não feche

/**
 * O resto do bloco em que a chamada está — até a chave que o fecha. Uma
 * janela fixa de caracteres alcançaria o `onError` do useMutation logo
 * abaixo, onde `error.message` é o certo: ali `error` já é o Error montado
 * com a mensagem real.
 */
function restoDoBloco(codigo: string, inicio: number): string {
  let profundidade = 0;
  const fim = Math.min(codigo.length, inicio + TETO);
  for (let k = inicio; k < fim; k++) {
    const c = codigo[k];
    if (c === "{") profundidade++;
    else if (c === "}") {
      if (profundidade === 0) return codigo.slice(inicio, k);
      profundidade--;
    }
  }
  return codigo.slice(inicio, fim);
}

// Chamadas que não mostram erro a ninguém, de propósito.
const EXCECOES = new Set([
  "lib/sendChatPush.ts", // disparo em segundo plano, ignora falha por desenho
  "pages/app/Onboarding.tsx", // só registra no console
  "lib/erroEdge.ts", // o próprio helper, que cita o padrão errado no comentário
]);

/**
 * Nome da variável de erro que *esta* chamada devolveu: `error`, ou o apelido
 * da desestruturação (`error: billingError`). Olhar para qualquer `xError`
 * pegaria o erro do login ou de outra consulta logo abaixo — falso positivo.
 */
function variavelDeErro(codigo: string, posicaoInvoke: number): string | null {
  const antes = codigo.slice(Math.max(0, posicaoInvoke - 200), posicaoInvoke);
  const destruct = antes.match(/const\s*\{([^}]*)\}\s*=\s*await\s+supabase\.$/);
  if (!destruct) return null;
  const campo = destruct[1].match(/\berror\b(?:\s*:\s*(\w+))?/);
  if (!campo) return null;
  return campo[1] ?? "error";
}

function arquivosFonte(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosFonte(caminho);
    return /\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

describe("chamadas de edge function", () => {
  it("nunca relançam o erro cru nem leem error.message direto", () => {
    const violacoes: string[] = [];

    for (const arquivo of arquivosFonte(RAIZ)) {
      const rel = relative(RAIZ, arquivo).replace(/\\/g, "/");
      if (EXCECOES.has(rel)) continue;

      const codigo = readFileSync(arquivo, "utf8");
      let i = codigo.indexOf("functions.invoke");
      while (i !== -1) {
        const trecho = restoDoBloco(codigo, i);
        const proxima = trecho.indexOf("functions.invoke", 1);
        const alvo = proxima === -1 ? trecho : trecho.slice(0, proxima);
        const linha = codigo.slice(0, i).split("\n").length;
        const v = variavelDeErro(codigo, i);

        if (v) {
          if (new RegExp(`if \\(${v}\\) throw ${v};`).test(alvo)) {
            violacoes.push(`${rel}:${linha} relança o erro cru`);
          }
          if (new RegExp(`(?<![\\w.])${v}\\??\\.message`).test(alvo)) {
            violacoes.push(`${rel}:${linha} lê ${v}.message em vez de mensagemDeErroEdge`);
          }
        }
        i = codigo.indexOf("functions.invoke", i + 1);
      }
    }

    expect(violacoes, "use mensagemDeErroEdge() de src/lib/erroEdge.ts").toEqual([]);
  });
});
