import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  MODELO_ASSISTENTE_API,
  MODELO_VIGIA,
  MODELO_VIGIA_API,
  PRAZO_ASSISTENTE_API_MS,
  PRAZO_ASSISTENTE_MS,
  PRAZO_VIGIA_API_MS,
  PRAZO_VIGIA_MS,
} from "../../supabase/functions/_shared/ia";
import { AGENTES_ANTHROPIC } from "../../supabase/functions/_shared/iaAnthropic";

/**
 * Trava estrutural: a API da Anthropic é só do Vigia e do assistente da
 * academia (decisão do responsável, 09/10/2026).
 *
 * A API da Anthropic processa fora do Brasil, e a IA com dado de aluno (o
 * Sentinela, a dieta em PDF, a Letícia) fica no Bedrock em São Paulo, como
 * a Política e o Contrato dizem. O atalho de boa-fé que desfaria isso sem
 * erro nenhum é uma função de dado de aluno importar o módulo da API (ou
 * ler a chave, ou chamar a URL) "porque o crédito já está pago". Este teste
 * falha nesse dia.
 */

const RAIZ = join(__dirname, "..", "..");
const FUNCOES = join(RAIZ, "supabase", "functions");
const IA = readFileSync(join(FUNCOES, "_shared", "ia.ts"), "utf8");
const MODULO = readFileSync(join(FUNCOES, "_shared", "iaAnthropic.ts"), "utf8");

function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivosTs(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const todos = arquivosTs(FUNCOES).map((p) => ({ arquivo: relative(FUNCOES, p).replace(/\\/g, "/"), codigo: readFileSync(p, "utf8") }));

describe("API da Anthropic: só o Vigia e o assistente", () => {
  it("só _shared/iaAnthropic.ts lê a chave, o interruptor ou chama a API", () => {
    const tocam = todos
      .filter((f) => /api\.anthropic\.com|["'](ANTHROPIC_API_KEY|IA_ANTHROPIC_AGENTES|ANTHROPIC_WORKSPACE_ID|x-api-key)["']/.test(f.codigo))
      .map((f) => f.arquivo);
    expect(tocam).toEqual(["_shared/iaAnthropic.ts"]);
  });

  it("só _shared/ia.ts importa o módulo da API, e nenhuma função usa as peças dele", () => {
    const importam = todos.filter((f) => /["'`][^"'`]*\/iaAnthropic(\.ts)?["'`]/.test(f.codigo)).map((f) => f.arquivo);
    expect(importam).toEqual(["_shared/ia.ts"]);
    const usam = todos
      .filter((f) => /\b(tentarAnthropic|agenteNaAnthropic|paraMessages|deMessages)\b/.test(f.codigo))
      .map((f) => f.arquivo)
      .sort();
    expect(usam).toEqual(["_shared/ia.ts", "_shared/iaAnthropic.ts"]);
    expect(IA).not.toMatch(/export\s*(\*|\{[^}]*\b(tentarAnthropic|agenteNaAnthropic)\b)/);
  });

  it("os agentes ligáveis são só o Vigia e o assistente", () => {
    expect([...AGENTES_ANTHROPIC]).toEqual(["vigia", "assistente"]);
  });

  it("em ia.ts, a API só é chamada pelas portas do Vigia e do assistente, depois da trava de cada uma", () => {
    expect(IA.match(/tentarAnthropic\(/g)).toHaveLength(2);

    const sentinela = IA.slice(IA.indexOf("export async function conversarComIA"), IA.indexOf("// ── Vigia"));
    expect(sentinela).not.toMatch(/tentarAnthropic|MODELO_\w+_API/);

    const vigia = IA.slice(IA.indexOf("export async function consultarVigia"), IA.indexOf("// ── Assistente da academia"));
    const chamaVigia = vigia.indexOf('tentarAnthropic(env, "vigia", MODELO_VIGIA_API, pedido,');
    expect(chamaVigia).toBeGreaterThan(-1);
    expect(vigia.indexOf("validarQuadro(")).toBeLessThan(chamaVigia);
    expect(vigia.indexOf("const pedido = montarPedido(validado.quadro)")).toBeLessThan(chamaVigia);

    const assistente = IA.slice(IA.indexOf("export async function consultarAssistente"));
    const chamaAssistente = assistente.indexOf('tentarAnthropic(env, "assistente", MODELO_ASSISTENTE_API, pedido,');
    expect(chamaAssistente).toBeGreaterThan(-1);
    expect(assistente.indexOf("montarEntrada(dados.pergunta")).toBeLessThan(chamaAssistente);
    expect(assistente.slice(0, chamaAssistente)).toContain("text: entrada");
  });

  it("o modelo da API é o mesmo do Bedrock, sem o perfil da AWS", () => {
    expect(MODELO_VIGIA).toBe(`global.anthropic.${MODELO_VIGIA_API}`);
    expect(MODELO_ASSISTENTE_API).toBe(MODELO_VIGIA_API);
    expect(IA).not.toMatch(/MODELO_\w+_API\s*=\s*env\(/);
  });

  it("o prazo da API deixa a reserva na AWS caber no prazo do assistente, que é interativo", () => {
    expect(PRAZO_ASSISTENTE_API_MS).toBeLessThan(PRAZO_ASSISTENTE_MS);
    expect(PRAZO_ASSISTENTE_MS - PRAZO_ASSISTENTE_API_MS).toBeGreaterThanOrEqual(10_000);
    expect(PRAZO_ASSISTENTE_MS).toBeLessThanOrEqual(20_000);
    // O Vigia é rotina: as duas tentativas cabem com folga no limite da plataforma.
    expect(PRAZO_VIGIA_API_MS + PRAZO_VIGIA_MS).toBeLessThanOrEqual(60_000);
    expect(IA).toMatch(/PRAZO_ASSISTENTE_MS - \(Date\.now\(\) - inicio\)/);
  });

  it("a falha da API não vai ao log com o corpo", () => {
    expect(MODULO).not.toMatch(/\.text\(\)/);
    const logs = MODULO.match(/console\.\w+\((?:[^()]|\([^()]*\))*\)/g) ?? [];
    expect(logs.length).toBeGreaterThanOrEqual(3);
    for (const log of logs) {
      // Fora o texto fixo da mensagem, só o agente, o status e o resumo do erro.
      const args = log.replace(/"[^"]*"/g, '""');
      expect(args).toMatch(/^console\.error\("", agente(, (resposta\.status|resumoDoErro\(erro\)))?\)$/);
    }
  });
});
