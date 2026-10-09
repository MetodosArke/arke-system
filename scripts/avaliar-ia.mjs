// Avaliação repetível das IAs (menos o Sentinela, que segue congelado):
// Letícia, assistente da academia, leitura de dieta em PDF e, com --vigia, o
// Vigia pelo simulado.
//
//   BEDROCK_ACCESS_KEY_ID=... BEDROCK_SECRET_ACCESS_KEY=... npm run avaliar:ia
//   ... npm run avaliar:ia -- --vigia      (também precisa de SUPABASE_ACCESS_TOKEN)
//   ... npm run avaliar:ia -- --so leticia
//
// Cada caso passa pelo MESMO código de produção: o roteiro, a porta de IA
// (_shared/ia.ts) e a trava de cada uma. Os casos são inventados
// (scripts/avaliacao-ia/casos.mjs) e dizem o que conta como acerto. O
// resultado vai para docs/avaliacoes-ia/<data>.json com a assinatura do
// roteiro e do modelo de cada IA; src/lib/avaliacaoIA.guarda.test.ts exige
// avaliação nova quando um dos dois muda.
//
// Custo: umas 25 chamadas, perto de US$ 0,10 sem o Vigia.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { conversarComIA, consultarAssistente } from "../supabase/functions/_shared/ia.ts";
import {
  entradaDoModelo,
  espelhoRecusado,
  lerRespostaModelo,
  SISTEMA_ESPELHO,
} from "../supabase/functions/agente-comercial/fluxo.ts";
import {
  buscarTrechos,
  diagnosticoAceito,
  normalizar,
  publicosDoPapel,
  SISTEMA_ASSISTENTE,
} from "../supabase/functions/assistente-academia/fluxo.ts";
import {
  avaliarLeitura,
  conferirNoOriginal,
  lerResposta,
  SISTEMA as SISTEMA_DIETA,
  tirarIdentificacao,
} from "../supabase/functions/importar-dieta-pdf/fluxo.ts";
import { CASOS_ASSISTENTE, CASOS_DIETA, CASOS_LETICIA } from "./avaliacao-ia/casos.mjs";
import { assinatura, IAS } from "./avaliacao-ia/roteiros.mjs";

const env = (n) => process.env[n];
if (!env("BEDROCK_ACCESS_KEY_ID") || !env("BEDROCK_SECRET_ACCESS_KEY")) {
  console.error("Defina BEDROCK_ACCESS_KEY_ID e BEDROCK_SECRET_ACCESS_KEY.");
  process.exit(2);
}
const arg = (nome) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const COM_VIGIA = process.argv.includes("--vigia");
const SO = arg("so");
const indice = JSON.parse(readFileSync(new URL("../supabase/functions/assistente-academia/artigos.json", import.meta.url), "utf8"));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chama de novo quando o modelo não respondeu: a cota da conta na AWS é baixa
 * (o Haiku de São Paulo devolve 429 com poucas chamadas seguidas), e a
 * avaliação mede o modelo, não a cota.
 */
async function comNovaTentativa(chamar) {
  let r = await chamar();
  for (const espera of [10_000, 20_000, 40_000]) {
    if (r.ok) return r;
    await dormir(espera);
    r = await chamar();
  }
  return r;
}

/** O começo da resposta do modelo, guardado só no caso que errou, para entender o erro. Os casos são inventados. */
const trecho = (texto) => String(texto ?? "").replace(/\s+/g, " ").slice(0, 400);

// "Não é algo que a Central cobre" também é dizer que não encontrou: em 09/10/2026
// o Sonnet 4.6 recusou o imposto de renda assim, e a regra antiga contou como erro.
const NAO_ENCONTREI =
  /n[aã]o (encontrei|achei|h[aá]|tem|consta|est[aá] n|cobre|trata|aparece)|n[aã]o [eé] (algo|assunto|um assunto|tema|um tema) que a central|fora d[oa]s? (artigos?|central|trechos?)|n[aã]o sei/i;

async function avaliarLeticia() {
  const casos = [];
  for (const c of CASOS_LETICIA) {
    const r = await comNovaTentativa(() =>
      conversarComIA(env, {
        sistema: SISTEMA_ESPELHO,
        usuario: entradaDoModelo({ mensagem: c.mensagem, alunos_faixa: "201-500", sistema_atual: null }),
        maxTokens: 300,
        temperatura: 0.3,
      }),
    );
    if (!r.ok) {
      casos.push({ id: c.id, ok: false, motivo: "modelo indisponível" });
      continue;
    }
    const lido = lerRespostaModelo(r.texto);
    const recusado = espelhoRecusado(r.texto);
    const falhas = [];
    if (c.categoria && lido.categoria !== c.categoria) falhas.push(`assunto ${lido.categoria ?? "nenhum"} (esperado ${c.categoria})`);
    if (recusado) falhas.push("a trava recusou o espelho");
    if (c.espelho === true && !lido.espelho) falhas.push("sem espelho");
    if (c.espelho === false && lido.espelho) falhas.push("espelho onde não havia o que espelhar");
    casos.push({ id: c.id, ok: falhas.length === 0, motivo: falhas.join("; ") || null, ...(falhas.length ? { resposta: trecho(r.texto) } : {}), ...uso(r) });
    await dormir(3_000);
  }
  return casos;
}

async function avaliarAssistente() {
  const casos = [];
  const publicos = publicosDoPapel("gestor", false, null);
  for (const c of CASOS_ASSISTENTE) {
    const achados = buscarTrechos(indice, c.pergunta, publicos);
    const achouArtigo = c.artigo ? achados.some((a) => a.slug === c.artigo) : null;
    if (achados.length === 0) {
      // Sem trecho, o modelo não é chamado e a tela diz que não achou.
      casos.push({ id: c.id, ok: c.tipo === "fora", motivo: c.tipo === "fora" ? null : "a busca não achou trecho nenhum" });
      continue;
    }
    const r = await comNovaTentativa(() =>
      consultarAssistente(env, {
        sistema: SISTEMA_ASSISTENTE,
        pergunta: c.pergunta,
        trechos: achados,
        situacao: "Nada consultado no sistema para esta pergunta.",
        nomes: [],
      }),
    );
    if (!r.ok) {
      casos.push({ id: c.id, ok: false, motivo: "modelo indisponível" });
      continue;
    }
    const aceito = diagnosticoAceito(r.texto, r.entrada);
    const texto = normalizar(r.texto);
    const disseQueNaoAchou = NAO_ENCONTREI.test(r.texto);
    const falhas = [];
    if (c.tipo === "fora") {
      if (!disseQueNaoAchou) falhas.push("respondeu o que a Central não cobre, em vez de dizer que não encontrou");
    } else {
      if (!achouArtigo) falhas.push(`a busca não trouxe o artigo ${c.artigo}`);
      if (!aceito) falhas.push("a trava recusou a resposta");
      if (disseQueNaoAchou) falhas.push("disse que não encontrou, e o artigo existe");
      if (!c.termos.some((t) => texto.includes(normalizar(t)))) falhas.push(`a resposta não fala de ${c.termos.join(" ou ")}`);
    }
    casos.push({ id: c.id, ok: falhas.length === 0, motivo: falhas.join("; ") || null, ...(falhas.length ? { resposta: trecho(r.texto) } : {}), ...uso(r) });
    await dormir(3_000);
  }
  return casos;
}

async function avaliarDieta() {
  const casos = [];
  for (const c of CASOS_DIETA) {
    const r = await comNovaTentativa(() =>
      conversarComIA(env, {
        sistema: SISTEMA_DIETA,
        usuario: tirarIdentificacao(c.texto).texto,
        maxTokens: 4000,
        temperatura: 0,
        prazoMs: 90_000,
      }),
    );
    if (!r.ok) {
      casos.push({ id: c.id, ok: false, motivo: "modelo indisponível" });
      continue;
    }
    let dieta = null;
    try {
      dieta = lerResposta(r.texto);
    } catch {
      dieta = null;
    }
    const conferida = dieta ? conferirNoOriginal(dieta, c.texto) : null;
    const veredito = conferida ? avaliarLeitura(conferida.itens, conferida.semAncora) : { ok: false };
    const refeicoes = conferida?.dieta?.refeicoes?.length ?? 0;
    const falhas = [];
    if (c.espera === "ok") {
      if (!veredito.ok) falhas.push("a leitura foi descartada");
      if (refeicoes < c.refeicoesMinimo) falhas.push(`${refeicoes} refeição(ões), esperado ao menos ${c.refeicoesMinimo}`);
      if (conferida?.semAncora?.length) falhas.push(`${conferida.semAncora.length} item(ns) sem âncora no PDF`);
    } else if (veredito.ok && refeicoes > 0) {
      falhas.push("leu refeições num texto que não é dieta");
    }
    casos.push({ id: c.id, ok: falhas.length === 0, motivo: falhas.join("; ") || null, ...(falhas.length ? { resposta: trecho(r.texto) } : {}), ...uso(r) });
    await dormir(3_000);
  }
  return casos;
}

function avaliarVigia() {
  if (!env("SUPABASE_ACCESS_TOKEN")) throw new Error("--vigia precisa de SUPABASE_ACCESS_TOKEN.");
  const saida = join(tmpdir(), `vigia-simulado-${Date.now()}.json`);
  const r = spawnSync(process.execPath, ["scripts/vigia-simulado.mjs", "--rodadas", "1", "--saida", saida], { stdio: "inherit", env: process.env });
  if (r.status !== 0 || !existsSync(saida)) throw new Error("o simulado do Vigia falhou");
  const { resultados } = JSON.parse(readFileSync(saida, "utf8"));
  return resultados.flatMap((cenario) =>
    cenario.rodadas.map((x) => ({
      id: cenario.id ?? cenario.cenario,
      ok: !x.falhou && x.causa_ok && x.acao_ok && !(x.erradas ?? []).length,
      motivo: x.falhou ? `rodada falhou: ${x.falhou}` : [!x.causa_ok && "causa errada", !x.acao_ok && "ação esperada faltando", (x.erradas ?? []).length && "ação fora de lugar"].filter(Boolean).join("; ") || null,
      modelo: x.modelo ?? null,
      latencia_ms: x.latencia_ms ?? null,
      tokens_entrada: x.tokens?.[0] ?? null,
      tokens_saida: x.tokens?.[1] ?? null,
    })),
  );
}

/** O uso de cada caso, com o modelo que de fato respondeu (a API da Anthropic ou a reserva na AWS). */
function uso(r) {
  return {
    modelo: r.uso?.modelo ?? null,
    latencia_ms: r.uso?.latenciaMs ?? null,
    tokens_entrada: r.uso?.tokensEntrada ?? null,
    tokens_saida: r.uso?.tokensSaida ?? null,
  };
}

const AVALIACOES = { leticia: avaliarLeticia, assistente: avaliarAssistente, dieta_pdf: avaliarDieta };
if (COM_VIGIA) AVALIACOES.vigia = avaliarVigia;

const resultados = {};
for (const [agente, avaliar] of Object.entries(AVALIACOES)) {
  if (SO && SO !== agente) continue;
  console.log(`\n── ${agente}`);
  let casos;
  try {
    casos = await avaliar();
  } catch (erro) {
    // Uma IA que não deu para avaliar não apaga a avaliação das outras.
    console.log(`  a avaliação não rodou: ${erro instanceof Error ? erro.message : String(erro)}`);
    continue;
  }
  const acertos = casos.filter((c) => c.ok).length;
  for (const c of casos) console.log(`  ${c.ok ? "ok    " : "ERROU "} ${c.id}${c.motivo ? `  (${c.motivo})` : ""}`);
  console.log(`  ${acertos} de ${casos.length}`);
  resultados[agente] = { assinatura: assinatura(agente), modelo: IAS[agente].modelo, acertos, total: casos.length, casos };
}

const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const pasta = new URL("../docs/avaliacoes-ia/", import.meta.url);
mkdirSync(pasta, { recursive: true });
const arquivo = new URL(`${hoje}.json`, pasta);
// Avaliação parcial (--so) no mesmo dia completa a do dia, sem apagar as outras IAs.
const anterior = existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, "utf8")) : { resultados: {} };
const registro = { data: hoje, resultados: { ...anterior.resultados, ...resultados } };
writeFileSync(arquivo, JSON.stringify(registro, null, 2) + "\n");
console.log(`\nRegistro: docs/avaliacoes-ia/${hoje}.json`);
