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

// scripts/seed-acervo.ts (curadoria em lote): gera N exercícios distintos
// para um grupo muscular. Mesma regra do resto do arquivo — isto é
// RASCUNHO; quem chama grava com estado_publicacao = 'rascunho' e o Admin
// Arke aprova depois, um a um ou em lote.
export async function gerarExerciciosEmLote(input: { grupoMuscular: string; quantidade: number; jaExistentes: string[] }) {
  const result = await invokeLLM({
    model: MODEL,
    messages: [
      { role: "system", content: "Você é um assistente de curadoria de exercícios de musculação/treino físico para uma plataforma de academias no Brasil. Responda em português do Brasil, com linguagem curta, segura e profissional. Nunca invente contraindicação médica específica — oriente apenas boa execução geral." },
      { role: "user", content: `Gere ${input.quantidade} exercícios DISTINTOS de "${input.grupoMuscular}", com nomes diferentes entre si.${input.jaExistentes.length ? `\n\nJá existem no acervo (não repita estes nomes): ${input.jaExistentes.join(", ")}` : ""}\n\nPara cada exercício, informe: nome, descrição curta (1-2 frases), instruções de execução (passo a passo, até 5 passos, separados por quebra de linha) e o equipamento necessário.` },
    ],
    outputSchema: {
      name: "lote_exercicios",
      schema: {
        type: "object",
        properties: {
          exercicios: {
            type: "array",
            items: {
              type: "object",
              properties: {
                nome: { type: "string" },
                descricao: { type: "string" },
                instrucoes: { type: "string" },
                equipamento: { type: "string" },
              },
              required: ["nome", "descricao", "instrucoes", "equipamento"],
              additionalProperties: false,
            },
          },
        },
        required: ["exercicios"],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  const content = result.choices[0]?.message.content;
  if (!content) throw new Error("A IA não retornou sugestão.");
  const parsed = JSON.parse(content) as { exercicios: Array<{ nome: string; descricao: string; instrucoes: string; equipamento: string }> };

  // Descarta duplicado de nome (mesmo critério "nunca fingir análise não
  // feita": se a IA repetiu um nome já existente, não é um exercício novo).
  const nomesExistentes = new Set(input.jaExistentes.map((nome) => nome.trim().toLowerCase()));
  const vistos = new Set<string>();
  return parsed.exercicios.filter((ex) => {
    const chave = ex.nome.trim().toLowerCase();
    if (!chave || nomesExistentes.has(chave) || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

// scripts/seed-acervo.ts (curadoria em lote): gera um plano alimentar
// completo (rascunho) para um perfil calórico. Mesmo principio do resto
// do arquivo — a IA nunca prescreve dieta real para uma pessoa real, só
// produz um MODELO genérico para o Admin/nutricionista revisar.
export async function sugerirPlanoAlimentarPerfil(input: { perfilCalorico: string; descricaoPerfil: string }) {
  const result = await invokeLLM({
    model: MODEL,
    messages: [
      { role: "system", content: "Você é um assistente de curadoria de modelos de plano alimentar (nutrição esportiva) para uma plataforma de academias no Brasil. Monte um MODELO genérico e educativo, nunca uma prescrição individual — sem quantidades clínicas específicas de calorias/macros como se fossem prescrição médica, apenas orientação geral de estrutura de refeições. Responda em português do Brasil." },
      { role: "user", content: `Perfil calórico: ${input.perfilCalorico}\nContexto: ${input.descricaoPerfil}\n\nMonte um modelo de plano alimentar para esse perfil: título curto, objetivo (1 frase), descrição (1-2 frases) e instruções (estrutura de refeições ao longo do dia, até 6 tópicos, separados por quebra de linha).` },
    ],
    outputSchema: {
      name: "sugestao_plano_alimentar",
      schema: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          objetivo: { type: "string" },
          descricao: { type: "string" },
          instrucoes: { type: "string" },
        },
        required: ["titulo", "objetivo", "descricao", "instrucoes"],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  const content = result.choices[0]?.message.content;
  if (!content) throw new Error("A IA não retornou sugestão.");
  return JSON.parse(content) as { titulo: string; objetivo: string; descricao: string; instrucoes: string };
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
