import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Trava estrutural sobre o roteamento de ambiente do Asaas (23/09/2026).
 *
 * `_shared/asaas.ts` decide, pelo status da organização, se a chamada vai ao
 * sandbox ou à produção. O defeito que ele previne não dá erro: uma função
 * nova que leia `ASAAS_API_KEY` direto funciona perfeitamente em todo teste —
 * e cobra dinheiro de verdade quando alguém exercita a homologação. É o tipo
 * de engano que só aparece no extrato, e por isso é verificado por leitura do
 * código, como o `erroEdge.guarda` e o `colunasConsultas.guarda`.
 *
 * Dois invariantes:
 *   1. função que fala com o gateway obtém URL e chave de `ambienteAsaas`;
 *   2. ninguém mais lê `ASAAS_API_KEY`/`ASAAS_API_URL` do ambiente.
 */

const FUNCOES = join(__dirname, "..", "..", "supabase", "functions");

/**
 * `asaas-reconciliar` não roteia: ele **exclui** a homologação da varredura
 * (`foraDeHomologacao()`), porque a varredura diária é uma consulta só sobre
 * todas as organizações e perguntar à produção por uma cobrança que só existe
 * no sandbox devolveria "não encontrada" — divergência falsa em vez de rede de
 * segurança. Organização em trial é de teste e não precisa da rede.
 */
const SEM_ROTEAMENTO = new Set(["asaas-reconciliar"]);

function arquivosTs(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosTs(caminho, achados);
    else if (nome.endsWith(".ts")) achados.push(caminho);
  }
  return achados;
}

const arquivos = arquivosTs(FUNCOES).map((caminho) => ({
  caminho,
  funcao: caminho.slice(FUNCOES.length + 1).split(/[\\/]/)[0],
  nome: caminho.slice(FUNCOES.length + 1).replace(/\\/g, "/"),
  codigo: readFileSync(caminho, "utf8"),
}));

// Comentário citando o nome do secret não é leitura dele.
const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("roteamento de ambiente do Asaas", () => {
  it("encontra as funções que falam com o gateway", () => {
    const falam = arquivos.filter((a) => /asaasApiUrl|asaasApiKey/.test(a.codigo));
    // Se esta lista esvaziar, o detector deixou de detectar e os testes
    // abaixo passariam sem verificar nada.
    expect(falam.length).toBeGreaterThan(0);
  });

  it("toda função que fala com o gateway passa por ambienteAsaas", () => {
    const faltando = arquivos
      .filter((a) => /asaasApiUrl|asaasApiKey/.test(a.codigo))
      .filter((a) => !SEM_ROTEAMENTO.has(a.funcao))
      // O `fluxo.ts` de cada função recebe URL e chave por parâmetro de
      // propósito — é o que o torna exercitável em sandbox. Quem escolhe o
      // ambiente é o `index.ts`.
      .filter((a) => a.nome.endsWith("/index.ts"))
      .filter((a) => !/ambienteAsaas\s*\(/.test(a.codigo))
      .map((a) => a.nome);

    expect(faltando, `Estas funções montam a chamada ao Asaas sem escolher o ambiente pelo status da organização. Sem isso, exercitar a homologação cobra na conta de produção. Use ambienteAsaas de "../_shared/asaas.ts".`).toEqual([]);
  });

  it("só _shared/asaas.ts lê ASAAS_API_KEY e ASAAS_API_URL do ambiente", () => {
    const leem = arquivos
      .filter((a) => /Deno\.env\.get\(\s*["'`]ASAAS_API_(KEY|URL)["'`]\s*\)/.test(semComentarios(a.codigo)))
      .filter((a) => a.nome !== "_shared/asaas.ts")
      .filter((a) => !SEM_ROTEAMENTO.has(a.funcao))
      .map((a) => a.nome);

    expect(leem, "A chave de produção só pode ser lida pelo roteador de ambiente; lida direto, a homologação cobra de verdade.").toEqual([]);
  });

  it("a chave do sandbox nunca é lida fora do roteador", () => {
    const leem = arquivos
      .filter((a) => /ASAAS_SANDBOX_KEY/.test(semComentarios(a.codigo)))
      .filter((a) => a.nome !== "_shared/asaas.ts")
      .map((a) => a.nome);

    expect(leem).toEqual([]);
  });
});
