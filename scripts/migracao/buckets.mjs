// Os buckets do Storage como as migrations os deixam, e os do roteiro de
// reconstrução (`02-depois-da-restauracao.sql`).
//
// O bucket é uma linha em `storage.buckets`: dado, e não schema. O dump do
// schema não o traz, e o roteiro o cria de novo. Até 06/10/2026 a lista do
// roteiro era escrita à mão e esquecia `termos-biometria` (20261250010000):
// numa reconstrução, o termo da digital assinado no papel não teria onde
// morar, e a recepção não conseguiria registrar a autorização.
//
// Este módulo lê as migrations na ordem da reconstrução (o retrato de
// `supabase/historico/` e, depois dele, as migrations mais novas), aplica cada
// `insert into storage.buckets` e `update storage.buckets`, e devolve o que
// cada bucket ficou sendo nos campos que as migrations dizem. Cinco buckets
// nasceram pelo painel do Supabase, antes das migrations: para eles, o
// roteiro é o registro, conferido contra o retrato de produção na guarda
// (`src/lib/bucketsBanco.guarda.test.ts`).
//
// Uso: node scripts/migracao/buckets.mjs   lista os buckets e confere o roteiro

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { arquivosDaReconstrucao, lerTexto, RAIZ_PADRAO, ROTEIRO, semComentarios } from "./rotinas.mjs";

/** Divide no nível de fora pela vírgula, sem contar parênteses, colchetes e aspas. */
function dividirVirgulas(texto) {
  const partes = [];
  let nivel = 0;
  let aspas = false;
  let desde = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === "'") {
      if (aspas && texto[i + 1] === "'") {
        i++;
        continue;
      }
      aspas = !aspas;
    } else if (!aspas && (c === "(" || c === "[")) nivel++;
    else if (!aspas && (c === ")" || c === "]")) nivel--;
    else if (!aspas && nivel === 0 && c === ",") {
      partes.push(texto.slice(desde, i).trim());
      desde = i + 1;
    }
  }
  partes.push(texto.slice(desde).trim());
  return partes.filter((p) => p !== "");
}

/** Um valor SQL literal: texto, número, booleano, nulo ou `array['a', ...]`. */
export function valorSql(texto) {
  const t = texto.trim();
  if (/^null$/i.test(t)) return null;
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  const texto1 = /^'((?:[^']|'')*)'$/.exec(t);
  if (texto1) return texto1[1].replace(/''/g, "'");
  const lista = /^array\s*\[([\s\S]*)\](?:::text\[\])?$/i.exec(t);
  if (lista) return dividirVirgulas(lista[1]).map(valorSql);
  throw new Error(`valor SQL que o leitor não entende: ${t}`);
}

/** Do parêntese aberto em `inicio` até o que o fecha. */
function parenteses(texto, inicio) {
  let nivel = 0;
  let aspas = false;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (c === "'") aspas = !aspas;
    else if (!aspas && c === "(") nivel++;
    else if (!aspas && c === ")") {
      nivel--;
      if (nivel === 0) return { texto: texto.slice(inicio + 1, i), fim: i + 1 };
    }
  }
  throw new Error("parêntese sem fechar");
}

const CAMPOS = ["public", "file_size_limit", "allowed_mime_types"];

/**
 * Os comandos sobre `storage.buckets` de um texto, na ordem.
 * @returns {{tipo: "inserir"|"alterar", linhas?: object[], seConflito?: "nada"|"atualizar", atualiza?: object, ids?: string[], campos?: object}[]}
 */
export function comandosDeBucket(sql) {
  const texto = semComentarios(sql);
  const comandos = [];
  const re = /\b(insert\s+into|update)\s+storage\.buckets\b/gi;
  let m;
  while ((m = re.exec(texto))) {
    const fim = texto.indexOf(";", m.index);
    const corpo = texto.slice(m.index + m[0].length, fim < 0 ? texto.length : fim);
    if (/^insert/i.test(m[1])) {
      const cols = parenteses(corpo, corpo.indexOf("("));
      const colunas = dividirVirgulas(cols.texto).map((c) => c.toLowerCase());
      const depois = corpo.slice(cols.fim);
      const inicioValores = depois.search(/\bvalues\b/i);
      if (inicioValores < 0) throw new Error("insert em storage.buckets sem values");
      const linhas = [];
      let i = depois.indexOf("(", inicioValores);
      let ultimoFim = i;
      while (i >= 0) {
        const tupla = parenteses(depois, i);
        const valores = dividirVirgulas(tupla.texto).map(valorSql);
        linhas.push(Object.fromEntries(colunas.map((c, k) => [c, valores[k]])));
        ultimoFim = tupla.fim;
        const resto = depois.slice(tupla.fim);
        const virgula = /^\s*,\s*\(/.exec(resto);
        i = virgula ? tupla.fim + virgula[0].length - 1 : -1;
      }
      const conflito = depois.slice(ultimoFim);
      let seConflito = null;
      const atualiza = {};
      if (/on\s+conflict[\s\S]*do\s+nothing/i.test(conflito)) seConflito = "nada";
      else if (/on\s+conflict[\s\S]*do\s+update\s+set/i.test(conflito)) {
        seConflito = "atualizar";
        const sets = conflito.slice(conflito.search(/\bset\b/i) + 3).replace(/\bwhere\b[\s\S]*$/i, "");
        for (const a of dividirVirgulas(sets)) {
          const [campo, ...valor] = a.split("=");
          const v = valor.join("=").trim();
          atualiza[campo.trim().toLowerCase()] = /^excluded\./i.test(v) ? { doInserido: v.replace(/^excluded\./i, "").toLowerCase() } : valorSql(v);
        }
      }
      comandos.push({ tipo: "inserir", linhas, seConflito, atualiza });
    } else {
      const set = corpo.search(/\bset\b/i);
      const where = corpo.search(/\bwhere\b/i);
      const campos = {};
      for (const a of dividirVirgulas(corpo.slice(set + 3, where))) {
        const [campo, ...valor] = a.split("=");
        campos[campo.trim().toLowerCase()] = valorSql(valor.join("="));
      }
      const condicao = corpo.slice(where + 5).trim();
      let ids;
      const um = /^id\s*=\s*'([^']+)'$/i.exec(condicao);
      const varios = /^id\s+in\s*\(([\s\S]*)\)$/i.exec(condicao);
      if (um) ids = [um[1]];
      else if (varios) ids = dividirVirgulas(varios[1]).map(valorSql);
      else throw new Error(`update em storage.buckets com condição que o leitor não entende: ${condicao}`);
      comandos.push({ tipo: "alterar", ids, campos });
    }
    re.lastIndex = fim < 0 ? texto.length : fim;
  }
  return comandos;
}

/**
 * Aplica os comandos em ordem. Devolve, por bucket, os campos que algum
 * comando definiu (o que não foi dito não aparece) e se algum comando o criou.
 */
export function bucketsDosTextos(textos) {
  const buckets = new Map();
  const pegar = (id) => {
    if (!buckets.has(id)) buckets.set(id, { criado: false, campos: {} });
    return buckets.get(id);
  };
  for (const texto of textos) {
    for (const c of comandosDeBucket(texto)) {
      if (c.tipo === "alterar") {
        for (const id of c.ids) {
          const b = pegar(id);
          for (const campo of CAMPOS) if (campo in c.campos) b.campos[campo] = c.campos[campo];
        }
        continue;
      }
      for (const linha of c.linhas) {
        const existia = buckets.has(linha.id) && buckets.get(linha.id).criado;
        const b = pegar(linha.id);
        if (!existia || c.seConflito === null) {
          b.criado = true;
          for (const campo of CAMPOS) if (campo in linha) b.campos[campo] = linha[campo];
        } else if (c.seConflito === "atualizar") {
          for (const [campo, v] of Object.entries(c.atualiza)) {
            if (!CAMPOS.includes(campo)) continue;
            b.campos[campo] = v && typeof v === "object" && "doInserido" in v ? linha[v.doInserido] : v;
          }
        }
      }
    }
  }
  return buckets;
}

/** Os buckets das migrations e do histórico, na ordem da reconstrução. */
export function bucketsDoRepositorio(raiz = RAIZ_PADRAO) {
  return bucketsDosTextos(arquivosDaReconstrucao(raiz).map((a) => lerTexto(join(raiz, a))));
}

/** Os buckets que o roteiro cria, com os campos de cada um. */
export function bucketsDoRoteiro(roteiro) {
  return bucketsDosTextos([roteiro]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const repo = bucketsDoRepositorio();
  const roteiro = bucketsDoRoteiro(lerTexto(join(RAIZ_PADRAO, ROTEIRO)));
  let divergencias = 0;
  for (const [id, b] of [...repo].sort()) {
    const r = roteiro.get(id);
    const campos = Object.entries(b.campos).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
    const falta = !r ? " ← FALTA NO ROTEIRO" : Object.entries(b.campos).some(([k, v]) => JSON.stringify(r.campos[k]) !== JSON.stringify(v)) ? " ← DIVERGE" : "";
    if (falta) divergencias++;
    console.log(`${id}${b.criado ? "" : " (só alterado)"}: ${campos}${falta}`);
  }
  console.log(`roteiro: ${[...roteiro.keys()].sort().join(", ")}`);
  process.exitCode = divergencias ? 1 : 0;
}
