// Curadoria em lote do Acervo Global via IA (CLAUDE.md §4 "Acervo Global",
// §9 Fase 16 "Agente de IA curador do acervo").
//
// Gera com a OpenAI: 150 exercícios cobrindo todos os grupos musculares já
// cadastrados, 8 modelos de treino (um por objetivo) e 5 modelos de plano
// alimentar (um por perfil calórico). Tudo é gravado com
// estado_publicacao = 'rascunho' — nada fica visível na prescrição real
// (listExercisesCatalog só lê publicado) nem é publicado automaticamente.
// A aprovação em lote é feita pelo Admin Arke na tela "Acervo Global" →
// aba "Revisar rascunhos" (client/src/components/GlobalLibraryAdmin.tsx).
//
// Uso: pnpm tsx scripts/seed-acervo.ts
// Requer as mesmas variáveis de ambiente do servidor: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_KEY) e OPENAI_API_KEY.

import "dotenv/config";
import { gerarExerciciosEmLote, sugerirModeloTreino, sugerirPlanoAlimentarPerfil } from "../server/acervoAi";
import { openaiConfigured } from "../server/_core/llm";
import { createGlobalExercise, createGlobalNutritionPlan, createGlobalTemplate, createGlobalTemplateExercise, hasSupabaseConfig, listGlobalLibrary } from "../server/supabaseAdmin";

const TOTAL_EXERCICIOS = 150;

const OBJETIVOS_TREINO: Array<{ objetivo: string; divisoes: string[] }> = [
  { objetivo: "Hipertrofia", divisoes: ["A", "B", "C", "D"] },
  { objetivo: "Emagrecimento", divisoes: ["A", "B"] },
  { objetivo: "Condicionamento físico", divisoes: ["A", "B"] },
  { objetivo: "Força", divisoes: ["A", "B", "C"] },
  { objetivo: "Resistência muscular", divisoes: ["A", "B"] },
  { objetivo: "Mobilidade e flexibilidade", divisoes: ["Full Body"] },
  { objetivo: "Recomposição corporal", divisoes: ["A", "B", "C"] },
  { objetivo: "Adaptação (iniciante)", divisoes: ["Full Body"] },
];

const PERFIS_CALORICOS: Array<{ perfil: string; contexto: string }> = [
  { perfil: "Hipocalórico (déficit calórico)", contexto: "Foco em perda de peso com déficit calórico moderado, preservando massa magra." },
  { perfil: "Normocalórico (manutenção)", contexto: "Foco em manutenção do peso e da composição corporal atual." },
  { perfil: "Hipercalórico (superávit / bulking)", contexto: "Foco em ganho de peso e massa muscular com superávit calórico." },
  { perfil: "Hiperproteico (foco em massa magra)", contexto: "Foco em maior ingestão de proteína para preservar ou ganhar massa magra." },
  { perfil: "Low carb", contexto: "Foco em redução de carboidratos, mantendo proteína e gorduras boas." },
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function distribuirCotas(total: number, grupos: number) {
  const base = Math.floor(total / grupos);
  const resto = total % grupos;
  return Array.from({ length: grupos }, (_, i) => base + (i < resto ? 1 : 0));
}

async function seedExercicios() {
  console.log(`\n=== Exercícios (meta: ${TOTAL_EXERCICIOS}) ===`);
  const { groups, exercises } = await listGlobalLibrary();
  if (!groups.length) throw new Error("Nenhum grupo muscular cadastrado em grupos_musculares — cadastre os grupos antes de gerar exercícios.");

  const cotas = distribuirCotas(TOTAL_EXERCICIOS, groups.length);
  let totalCriado = 0;

  for (let i = 0; i < groups.length; i++) {
    const grupo = groups[i];
    const quantidade = cotas[i];
    const jaExistentes = exercises.filter((ex) => ex.grupo_muscular === grupo.nome).map((ex) => ex.nome);
    console.log(`- ${grupo.nome}: gerando ${quantidade} exercício(s)...`);
    const gerados = await gerarExerciciosEmLote({ grupoMuscular: grupo.nome, quantidade, jaExistentes });
    if (gerados.length < quantidade) console.warn(`  aviso: a IA retornou ${gerados.length}/${quantidade} exercícios distintos para "${grupo.nome}".`);
    for (const ex of gerados) {
      await createGlobalExercise({ nome: ex.nome, grupo_muscular: grupo.nome, descricao: ex.descricao, instrucoes: ex.instrucoes, equipamento: ex.equipamento, estado_publicacao: "rascunho" });
      totalCriado++;
      jaExistentes.push(ex.nome);
    }
    await sleep(300);
  }

  console.log(`Exercícios criados como rascunho: ${totalCriado}/${TOTAL_EXERCICIOS}`);
  return totalCriado;
}

async function seedModelosTreino() {
  console.log(`\n=== Modelos de treino (${OBJETIVOS_TREINO.length} objetivos) ===`);
  let totalCriado = 0;

  for (const { objetivo, divisoes } of OBJETIVOS_TREINO) {
    console.log(`- ${objetivo}...`);
    try {
      const sugestao = await sugerirModeloTreino({ objetivo, categoria: objetivo, divisoes });
      const divisoesReais = sugestao.divisoes.map((d) => d.divisao);
      const template = await createGlobalTemplate({ titulo: sugestao.titulo, categoria: sugestao.categoria, descricao: sugestao.descricao, divisoes: divisoesReais, estado_publicacao: "rascunho" });
      let ordem = 0;
      for (const divisao of sugestao.divisoes) {
        for (const ex of divisao.exercicios) {
          await createGlobalTemplateExercise({ template_id: template.id, divisao: divisao.divisao, exercicio_id: ex.exercicio_id, ordem: ordem++, series: ex.series, repeticoes: ex.repeticoes, descanso_seg: ex.descanso_seg });
        }
      }
      totalCriado++;
    } catch (error) {
      console.warn(`  aviso: não foi possível gerar o modelo de "${objetivo}": ${error instanceof Error ? error.message : error}`);
    }
    await sleep(300);
  }

  console.log(`Modelos de treino criados como rascunho: ${totalCriado}/${OBJETIVOS_TREINO.length}`);
  return totalCriado;
}

async function seedPlanosAlimentares() {
  console.log(`\n=== Planos alimentares (${PERFIS_CALORICOS.length} perfis calóricos) ===`);
  let totalCriado = 0;

  for (const { perfil, contexto } of PERFIS_CALORICOS) {
    console.log(`- ${perfil}...`);
    const sugestao = await sugerirPlanoAlimentarPerfil({ perfilCalorico: perfil, descricaoPerfil: contexto });
    await createGlobalNutritionPlan({ titulo: sugestao.titulo, categoria: perfil, objetivo: sugestao.objetivo, descricao: sugestao.descricao, instrucoes: sugestao.instrucoes, estado_publicacao: "rascunho" });
    totalCriado++;
    await sleep(300);
  }

  console.log(`Planos alimentares criados como rascunho: ${totalCriado}/${PERFIS_CALORICOS.length}`);
  return totalCriado;
}

async function main() {
  if (!hasSupabaseConfig()) throw new Error("Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  if (!openaiConfigured()) throw new Error("OPENAI_API_KEY não configurada.");

  const exercicios = await seedExercicios();
  const modelos = await seedModelosTreino();
  const planos = await seedPlanosAlimentares();

  console.log("\n=== Resumo ===");
  console.log(`Exercícios: ${exercicios}`);
  console.log(`Modelos de treino: ${modelos}`);
  console.log(`Planos alimentares: ${planos}`);
  console.log("\nTudo gravado como rascunho — nada foi publicado automaticamente.");
  console.log("Revise e aprove em lote no Painel Admin: Acervo Global → aba \"Revisar rascunhos\".");
}

main().catch((error) => {
  console.error("\nFalha ao gerar o acervo:", error instanceof Error ? error.message : error);
  process.exit(1);
});
