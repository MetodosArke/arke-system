import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { modeloRodaNaRegiao } from "../../supabase/functions/_shared/ia";

/**
 * Trava estrutural: a IA do Sentinela processa no Brasil.
 *
 * A Política de Privacidade (2026-09-23.3) e o termo de consentimento dizem ao
 * aluno que a análise da anamnese e o rascunho de resposta são feitos em São
 * Paulo, sem transferência internacional. Duas mudanças desfariam isso **sem
 * dar erro nenhum** — a chamada funcionaria, o recurso seguiria no ar, e só o
 * lugar do processamento estaria errado, com os documentos afirmando o
 * contrário:
 *
 * 1. tornar a região configurável (ou trocá-la) em `_shared/ia.ts`;
 * 2. usar um modelo com prefixo de roteamento (`global.`, `us.`…), que no
 *    Bedrock manda a requisição para outra região — e em São Paulo, na data,
 *    era a ÚNICA forma de invocar os modelos modernos da Anthropic, ou seja,
 *    exatamente a "atualização" que alguém faria de boa-fé.
 *
 * A segunda é barrada em tempo de execução, porque o id do modelo vive num
 * secret que teste nenhum enxerga. Este teste garante que a barreira existe.
 */

const RAIZ = join(__dirname, "..", "..");
const IA = readFileSync(join(RAIZ, "supabase/functions/_shared/ia.ts"), "utf8");

function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivosTs(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("IA processada no Brasil", () => {
  it("a região é fixa em São Paulo, no código", () => {
    expect(IA).toMatch(/const REGIAO = "sa-east-1";/);
  });

  it("nenhuma variável de ambiente escolhe a região", () => {
    expect(IA).not.toMatch(/env\(\s*["'][A-Z_]*REGION[A-Z_]*["']\s*\)/);
  });

  it("o modelo é conferido antes de qualquer envio", () => {
    const corpo = IA.slice(IA.indexOf("export async function conversarComIA"));
    const guarda = corpo.indexOf("modeloRodaNaRegiao(");
    const envio = corpo.indexOf("fetch(");
    expect(guarda).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(envio);
  });

  it("modelo com prefixo de roteamento é recusado", () => {
    expect(modeloRodaNaRegiao("anthropic.claude-3-haiku-20240307-v1:0")).toBe(true);
    for (const id of [
      "global.anthropic.claude-sonnet-5",
      "us.anthropic.claude-3-5-sonnet-20240620-v1:0",
      "sa.anthropic.claude-haiku-4-5-20251001-v1:0",
      "eu.anthropic.claude-sonnet-4-6",
      "arn:aws:bedrock:sa-east-1:123:inference-profile/global.anthropic.claude-opus-5",
    ]) {
      expect(modeloRodaNaRegiao(id), id).toBe(false);
    }
  });

  it("nenhuma edge function fala com provedor de IA fora do Brasil", () => {
    const fora = arquivosTs(join(RAIZ, "supabase/functions")).filter((p) =>
      /api\.openai\.com|openai\.azure\.com|api\.anthropic\.com/.test(readFileSync(p, "utf8")),
    );
    expect(fora, `chamam provedor de IA fora do Brasil: ${fora.join(", ")}`).toEqual([]);
  });
});

/**
 * A exceção, e as travas dela: o Vigia (saúde técnica, não alunos) usa um
 * modelo pelo perfil `global.`, que processa fora do Brasil. Isso só não
 * contraria a Política porque o que ele manda não é dado pessoal — e isso só
 * é verdade enquanto:
 *
 * 1. o único modelo global do código for o do Vigia, constante e não secret;
 * 2. a porta do Vigia validar o quadro (lista do que é permitido) ANTES de
 *    qualquer envio — dentro da própria função, sem caminho que a pule;
 * 3. só a edge function `vigia` usar essa porta.
 *
 * Um "atalho" que alguém fizesse de boa-fé — chamar consultarVigia de outra
 * função com um texto qualquer, ou pôr outro `global.` no código — funcionaria
 * sem erro nenhum e mandaria dado de aluno para fora do país.
 */
describe("Vigia: o perfil global só com telemetria validada", () => {
  const funcoes = arquivosTs(join(RAIZ, "supabase/functions"));

  it("o único modelo global do código é a constante do Vigia", () => {
    const comGlobal = funcoes.filter((p) => /["'`]global\.anthropic/.test(readFileSync(p, "utf8")));
    expect(comGlobal.map((p) => p.replace(RAIZ, "").replace(/\\/g, "/"))).toEqual(["/supabase/functions/_shared/ia.ts"]);
    expect(IA).toMatch(/export const MODELO_VIGIA = "global\.anthropic\.[a-z0-9.-]+";/);
    expect(IA).not.toMatch(/MODELO_VIGIA\s*=\s*env\(/);
  });

  it("a porta do Vigia valida o quadro antes de qualquer envio", () => {
    const corpo = IA.slice(IA.indexOf("export async function consultarVigia"));
    const valida = corpo.indexOf("validarQuadro(");
    const monta = corpo.indexOf("montarPedido(validado.quadro)");
    const envio = corpo.indexOf("fetch(");
    expect(valida).toBeGreaterThan(-1);
    expect(valida).toBeLessThan(monta);
    expect(monta).toBeLessThan(envio);
  });

  it("o Sentinela não usa o modelo do Vigia", () => {
    const sentinela = IA.slice(IA.indexOf("export async function conversarComIA"), IA.indexOf("// ── Vigia"));
    expect(sentinela).not.toContain("MODELO_VIGIA");
  });

  it("só a edge function do Vigia usa a porta dele", () => {
    const usam = funcoes
      .filter((p) => !p.endsWith("_shared/ia.ts") && !p.endsWith("_shared\\ia.ts"))
      .filter((p) => /consultarVigia/.test(readFileSync(p, "utf8")))
      .map((p) => p.replace(RAIZ, "").replace(/\\/g, "/"));
    expect(usam).toEqual(["/supabase/functions/vigia/index.ts"]);
  });
});
