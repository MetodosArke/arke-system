// Fase 16 (CLAUDE.md §9): agente de IA curador do acervo global.
//
// Principio do CLAUDE.md ("nunca fingir análise não feita",
// "automatizar a preparação, mantendo a decisão profissional onde é
// necessária"): a IA só produz RASCUNHOS. Nada aqui grava no acervo —
// quem chama essas funções (o router) devolve a sugestão para o Admin
// Arke revisar no formulário já existente e decidir se cadastra.
//
// Para o modelo de treino, a IA nunca pode inventar um exercício: ela só
// recebe os exercícios já cadastrados no acervo (id::nome) e é instruída a
// referenciar exclusivamente esses ids — e o backend ainda descarta
// qualquer id sugerido que não exista de fato, como segunda camada.

import { invokeLLM } from "./_core/llm";
import { listGlobalLibrary } from "./supabaseAdmin";

const MODEL = "gpt-4o-mini";

export async function sugerirExercicio(input: { nome: string; grupoMuscular: string; equipamento?: string }) {
  const result = await invokeLLM({
    model: MODEL,
    messages: [
      { role: "system", content: "Você é um assistente de curadoria de exercícios de musculação/treino físico para uma plataforma de academias no Brasil. Responda em português do Brasil, com linguagem curta, segura e profissional. Nunca invente contraindicação médica específica — oriente apenas boa execução geral." },
      { role: "user", content: `Exercício: ${input.nome}\nGrupo muscular: ${input.grupoMuscular}\nEquipamento informado pelo cadastrador: ${input.equipamento || "não informado"}\n\nSugira uma descrição curta (1-2 frases), instruções de execução (passo a passo, até 5 passos, separados por quebra de linha) e o equipamento necessário (se não informado, sugira o mais provável).` },
    ],
    outputSchema: {
      name: "sugestao_exercicio",
      schema: {
        type: "object",
        properties: {
          descricao: { type: "string" },
          instrucoes: { type: "string" },
          equipamento: { type: "string" },
        },
        required: ["descricao", "instrucoes", "equipamento"],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  const content = result.choices[0]?.message.content;
  if (!content) throw new Error("A IA não retornou sugestão.");
  return JSON.parse(content) as { descricao: string; instrucoes: string; equipamento: string };
}

export async function sugerirModeloTreino(input: { objetivo: string; categoria: string; divisoes: string[] }) {
  const { exercises } = await listGlobalLibrary();
  if (!exercises.length) throw new Error("Cadastre exercícios no acervo antes de gerar um modelo com IA.");
  const catalogo = exercises.map((ex) => `${ex.id}::${ex.nome} (${ex.grupo_muscular})`).join("\n");

  const result = await invokeLLM({
    model: MODEL,
    messages: [
      { role: "system", content: "Você é um assistente de curadoria de modelos de treino (fichas) para uma plataforma de academias no Brasil. Monte a ficha usando SOMENTE exercícios da lista fornecida, referenciando pelo id exato. Nunca invente um exercício que não está na lista — se a lista não cobrir bem alguma divisão, use os exercícios mais próximos disponíveis. Responda em português do Brasil." },
      { role: "user", content: `Objetivo do modelo: ${input.objetivo}\nCategoria: ${input.categoria}\nDivisões desejadas: ${input.divisoes.join(", ")}\n\nExercícios disponíveis no acervo (id::nome (grupo muscular)):\n${catalogo}\n\nMonte, para cada divisão, de 2 a 6 exercícios com id do exercício (copiado exatamente da lista), séries, repetições (ex.: "12" ou "8-12") e descanso em segundos. Inclua também uma descrição curta do modelo.` },
    ],
    outputSchema: {
      name: "sugestao_modelo_treino",
      schema: {
        type: "object",
        properties: {
          descricao: { type: "string" },
          divisoes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                divisao: { type: "string" },
                exercicios: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      exercicio_id: { type: "string" },
                      series: { type: "integer" },
                      repeticoes: { type: "string" },
                      descanso_seg: { type: "integer" },
                    },
                    required: ["exercicio_id", "series", "repeticoes", "descanso_seg"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["divisao", "exercicios"],
              additionalProperties: false,
            },
          },
        },
        required: ["descricao", "divisoes"],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  const content = result.choices[0]?.message.content;
  if (!content) throw new Error("A IA não retornou sugestão.");
  const parsed = JSON.parse(content) as { descricao: string; divisoes: Array<{ divisao: string; exercicios: Array<{ exercicio_id: string; series: number; repeticoes: string; descanso_seg: number }> }> };

  // Segunda camada de verificação: nunca confiar cegamente no que a IA
  // devolveu — descarta qualquer exercício sugerido que não exista de
  // fato no acervo (evita cadastrar referência quebrada).
  const validIds = new Set(exercises.map((ex) => ex.id));
  const divisoesValidadas = parsed.divisoes
    .map((divisao) => ({ divisao: divisao.divisao, exercicios: divisao.exercicios.filter((ex) => validIds.has(ex.exercicio_id)) }))
    .filter((divisao) => divisao.exercicios.length > 0);

  if (!divisoesValidadas.length) throw new Error("A IA não conseguiu montar um modelo válido com os exercícios já cadastrados.");

  return { titulo: `${input.categoria} — ${input.objetivo}`.slice(0, 160), categoria: input.categoria, descricao: parsed.descricao, divisoes: divisoesValidadas };
}
