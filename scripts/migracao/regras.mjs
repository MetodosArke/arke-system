// As regras de acesso (RLS) como as migrations as deixam, na ordem da
// reconstrução do banco (o retrato de `supabase/historico/` e, depois dele,
// as migrations mais novas).
//
// Serve às guardas que precisam da versão VIGENTE de uma regra, e não da
// primeira que aparece: `alter policy ... using` troca só o `using`, e a
// regra de hoje é a soma do que cada migration mudou. Ler a migration mais
// recente que cita a tabela já enganou (a metade `with check` ficava velha).
//
// Lê `create policy`, `alter policy` e `drop policy` escritos por extenso,
// inclusive dentro de bloco `do $$ ... $$`. A regra montada por `format(...)`
// dentro de um texto entre aspas (a "duas etapas") fica de fora: o texto dela
// não é a regra, é um molde.

import { join } from "node:path";
import { arquivosDaReconstrucao, lerTexto, RAIZ_PADRAO, semComentarios } from "./rotinas.mjs";

/** O texto com o conteúdo entre aspas simples trocado por espaços (mesmo comprimento). */
export function mascararAspas(sql) {
  let saida = "";
  let aspas = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      if (aspas && sql[i + 1] === "'") {
        saida += "  ";
        i++;
        continue;
      }
      aspas = !aspas;
      saida += c;
      continue;
    }
    saida += aspas && c !== "\n" ? " " : c;
  }
  return saida;
}

/** Do parêntese aberto em `inicio` até o que o fecha, sem contar o que está entre aspas. */
function parenteses(original, mascarado, inicio) {
  let nivel = 0;
  for (let i = inicio; i < mascarado.length; i++) {
    if (mascarado[i] === "(") nivel++;
    else if (mascarado[i] === ")") {
      nivel--;
      if (nivel === 0) return { texto: original.slice(inicio + 1, i), fim: i + 1 };
    }
  }
  return null;
}

/** O fim do comando: o `;` fora de parênteses e de aspas. */
function fimDoComando(mascarado, inicio) {
  let nivel = 0;
  for (let i = inicio; i < mascarado.length; i++) {
    const c = mascarado[i];
    if (c === "(") nivel++;
    else if (c === ")") nivel--;
    else if (c === ";" && nivel <= 0) return i;
  }
  return mascarado.length;
}

/**
 * O nome como o Postgres guarda: identificador com mais de 63 bytes é
 * cortado (sem partir um caractere). Uma regra antiga foi apagada pelo nome
 * já cortado, e sem isto ela pareceria viva.
 */
export function nomeNoBanco(nome) {
  const bytes = Buffer.from(nome, "utf8");
  if (bytes.length <= 63) return nome;
  let fim = 63;
  while (fim > 0 && (bytes[fim] & 0xc0) === 0x80) fim--;
  return bytes.subarray(0, fim).toString("utf8");
}

const NOME = String.raw`("[^"]+"|[a-z_][a-z0-9_]*)`;
const TABELA = String.raw`((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)`;

/**
 * Os comandos de regra de um texto SQL, na ordem.
 * @returns {{tipo: "create"|"alter"|"drop", nome: string, tabela: string, restritiva: boolean, comando: string|null, using: string|null, withCheck: string|null}[]}
 */
export function comandosDeRegra(sql) {
  const original = semComentarios(sql);
  const mascarado = mascararAspas(original);
  const minusculo = mascarado.toLowerCase();
  const re = new RegExp(String.raw`\b(create|alter|drop)\s+policy\s+(?:if\s+exists\s+)?${NOME}\s+on\s+${TABELA}`, "g");
  const achados = [];
  let m;
  while ((m = re.exec(minusculo))) {
    const fim = fimDoComando(mascarado, re.lastIndex);
    // O nome entre aspas guarda maiúsculas e acentos: lido do original.
    const inicioNome = m.index + m[0].indexOf(m[2]);
    const nome = nomeNoBanco(original.slice(inicioNome, inicioNome + m[2].length).replace(/^"|"$/g, ""));
    const tabela = m[3].includes(".") ? m[3] : `public.${m[3]}`;
    const corpoMasc = minusculo.slice(re.lastIndex, fim);
    const deslocamento = re.lastIndex;
    const regra = {
      tipo: m[1],
      nome,
      tabela,
      restritiva: /\bas\s+restrictive\b/.test(corpoMasc),
      comando: /\bfor\s+(all|select|insert|update|delete)\b/.exec(corpoMasc)?.[1] ?? null,
      using: null,
      withCheck: null,
    };
    const using = /\busing\s*\(/.exec(corpoMasc);
    if (using) regra.using = parenteses(original, mascarado, deslocamento + using.index + using[0].length - 1)?.texto ?? null;
    const check = /\bwith\s+check\s*\(/.exec(corpoMasc);
    if (check) regra.withCheck = parenteses(original, mascarado, deslocamento + check.index + check[0].length - 1)?.texto ?? null;
    achados.push(regra);
    re.lastIndex = fim;
  }
  return achados;
}

/**
 * As regras vigentes de uma tabela depois de aplicar, em ordem, os comandos
 * de todos os textos. `alter` muda só a metade que traz.
 * @param {string[]} textos
 * @param {string} tabela ex.: "public.tarefas", "storage.objects"
 * @returns {Map<string, {restritiva: boolean, comando: string|null, using: string|null, withCheck: string|null}>}
 */
export function regrasVigentes(textos, tabela) {
  const regras = new Map();
  for (const texto of textos) {
    for (const c of comandosDeRegra(texto)) {
      if (c.tabela !== tabela) continue;
      if (c.tipo === "drop") {
        regras.delete(c.nome);
        continue;
      }
      if (c.tipo === "create") {
        regras.set(c.nome, { restritiva: c.restritiva, comando: c.comando ?? "all", using: c.using, withCheck: c.withCheck });
        continue;
      }
      const atual = regras.get(c.nome);
      if (!atual) throw new Error(`alter policy "${c.nome}" on ${tabela} sem a regra criada antes`);
      if (c.using !== null) atual.using = c.using;
      if (c.withCheck !== null) atual.withCheck = c.withCheck;
    }
  }
  return regras;
}

/**
 * O último `grant` ou `revoke` que dá ou tira de um papel um privilégio na
 * tabela (pelo nome do privilégio ou por `all`), na ordem dos textos; vazio
 * se nenhum. Sem nenhum, vale o padrão do Supabase, que dá o privilégio.
 * Devolve o comando em minúsculas e numa linha só.
 * @param {string[]} textos
 * @param {string} tabela o nome sem o schema, ex.: "alunos"
 * @param {string} privilegio ex.: "delete"
 * @param {string} [papel]
 */
export function ultimaPermissao(textos, tabela, privilegio, papel = "authenticated") {
  let ultimo = "";
  const re = /\b(grant|revoke)\s+([^;]*?)\s+on\s+(?:table\s+)?([^;]*?)\s+(to|from)\s+([^;]*);/gi;
  const alvo = new RegExp(String.raw`(?:^|[\s,])(?:public\.)?${tabela}(?![\w.])`);
  for (const texto of textos) {
    for (const m of semComentarios(texto).matchAll(re)) {
      if (!new RegExp(String.raw`\b(${privilegio}|all)\b`).test(m[2].toLowerCase())) continue;
      if (!alvo.test(m[3].toLowerCase())) continue;
      if (!new RegExp(String.raw`\b${papel}\b`, "i").test(m[5])) continue;
      ultimo = m[0].replace(/\s+/g, " ").toLowerCase();
    }
  }
  return ultimo;
}

/** Os textos da reconstrução do banco, na ordem. */
export function textosDaReconstrucao(raiz = RAIZ_PADRAO) {
  return arquivosDaReconstrucao(raiz).map((arquivo) => lerTexto(join(raiz, arquivo)));
}

/** A expressão sem diferença de forma: minúsculas, espaços, casts e o `public.` de cada função. */
export function normalizar(expressao) {
  let e = String(expressao ?? "")
    .toLowerCase()
    .replace(/::(public\.)?app_role\b/g, "")
    .replace(/::text\b/g, "")
    .replace(/\bpublic\./g, "")
    .replace(/\(\s*select\s+auth\.uid\(\)\s+as\s+uid\s*\)/g, "(select auth.uid())")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
  for (;;) {
    const sem = semParentesesExternos(e);
    if (sem === e) return e;
    e = sem;
  }
}

/** Tira um par de parênteses que envolve a expressão inteira. */
function semParentesesExternos(e) {
  const t = e.trim();
  if (!t.startsWith("(") || !t.endsWith(")")) return t;
  const masc = mascararAspas(t);
  let nivel = 0;
  for (let i = 0; i < masc.length; i++) {
    if (masc[i] === "(") nivel++;
    else if (masc[i] === ")") {
      nivel--;
      if (nivel === 0 && i < masc.length - 1) return t;
    }
  }
  return t.slice(1, -1).trim();
}

/** Divide a expressão pelo operador (`or` ou `and`) no nível de fora. */
export function dividir(expressao, operador) {
  const e = normalizar(expressao);
  const masc = mascararAspas(e);
  const partes = [];
  let nivel = 0;
  let desde = 0;
  const re = new RegExp(String.raw`^\s${operador}\s`);
  for (let i = 0; i < masc.length; i++) {
    const c = masc[i];
    if (c === "(") nivel++;
    else if (c === ")") nivel--;
    else if (nivel === 0 && re.test(masc.slice(i, i + operador.length + 2))) {
      partes.push(e.slice(desde, i));
      desde = i + operador.length + 2;
      i = desde - 1;
    }
  }
  partes.push(e.slice(desde));
  return partes.map((p) => normalizar(p)).filter(Boolean);
}
