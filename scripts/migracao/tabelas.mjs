// As tabelas do schema `public` como as migrations as deixam, na ordem da
// reconstrução do banco (o retrato de `supabase/historico/` e, depois dele,
// as migrations mais novas): se o RLS está ligado, quais regras de acesso
// cada uma tem, e as sequências das colunas que se numeram sozinhas
// (`serial`, `bigserial`, `generated ... as identity`), com quem pode usá-las.
//
// Serve a duas guardas (frente D, 07/10/2026):
//   * `rlsSemRegra.guarda`: tabela com o RLS ligado e sem regra nenhuma é de
//     propósito (só o servidor lê e grava), e diz por quê;
//   * `sequencias.guarda`: a service role usa a sequência de toda coluna que
//     se numera sozinha. Ela pula o RLS, mas não a permissão, e o insert da
//     edge function levava 403 (`20261201020000`).
//
// A regra segue a tabela quando ela troca de nome, como no Postgres:
// `leads_site_mensagens` virou `leads_comerciais_mensagens` com a regra de
// leitura que tinha. A sequência também fica com o nome de antes.
//
// Lê os comandos escritos por extenso. O que mora entre aspas simples (o
// molde de um `format(...)`) fica de fora, como em `regras.mjs`.

import { join } from "node:path";
import { mascararAspas, nomeNoBanco } from "./regras.mjs";
import { arquivosDaReconstrucao, lerTexto, RAIZ_PADRAO, semComentarios } from "./rotinas.mjs";

const ID = String.raw`[a-z_][a-z0-9_]*`;
const ALTER = String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?(${ID})`;
const NUMERA = String.raw`(?:(?:big|small)?serial[248]?\b|[a-z][^,;]*?\bgenerated\s+(?:always|by\s+default)\s+as\s+identity\b)`;

/** Do parêntese aberto em `inicio` até o que o fecha (texto já mascarado). */
function dentroDosParenteses(texto, inicio) {
  let nivel = 0;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === "(") nivel++;
    else if (texto[i] === ")" && --nivel === 0) return texto.slice(inicio + 1, i);
  }
  return "";
}

/** Divide pelas vírgulas de fora dos parênteses. */
function porVirgula(texto) {
  const partes = [];
  let nivel = 0;
  let desde = 0;
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === "(") nivel++;
    else if (texto[i] === ")") nivel--;
    else if (texto[i] === "," && nivel === 0) {
      partes.push(texto.slice(desde, i));
      desde = i + 1;
    }
  }
  partes.push(texto.slice(desde));
  return partes.map((p) => p.trim()).filter(Boolean);
}

/** O nome de uma regra como o Postgres guarda: entre aspas, como está; sem aspas, em minúsculas. */
const nomeDaRegra = (bruto) => nomeNoBanco(bruto.startsWith('"') ? bruto.slice(1, -1) : bruto.toLowerCase());

/** Os nomes de uma lista de papéis (`to a, b`), sem o que vem depois (`with grant option`). */
const papeis = (lista) =>
  lista
    .replace(/\bwith\s+grant\s+option\b|\bgranted\s+by\b.*$|\bcascade\b|\brestrict\b/g, "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * Os comandos de um texto que mudam tabela, regra ou permissão de sequência,
 * na ordem em que aparecem.
 */
export function eventosDoTexto(sql) {
  const original = semComentarios(sql);
  const texto = mascararAspas(original).toLowerCase();
  const eventos = [];
  const achar = (re, fn) => {
    for (const m of texto.matchAll(re)) {
      const e = fn(m);
      if (e) eventos.push({ i: m.index, ...e });
    }
  };

  achar(new RegExp(String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(${ID})\s*\(`, "g"), (m) => {
    const corpo = dentroDosParenteses(texto, m.index + m[0].length - 1);
    const numeradas = porVirgula(corpo)
      .map((coluna) => new RegExp(String.raw`^"?(${ID})"?\s+${NUMERA}`).exec(coluna)?.[1])
      .filter(Boolean);
    return { tipo: "criar", tabela: m[1], numeradas };
  });
  achar(new RegExp(String.raw`\bdrop\s+table\s+(?:if\s+exists\s+)?([^;]*)`, "g"), (m) => ({
    tipo: "apagar",
    tabelas: m[1]
      .replace(/\b(cascade|restrict)\b/g, "")
      .split(",")
      .map((t) => t.trim().replace(/^public\./, ""))
      .filter((t) => new RegExp(`^${ID}$`).test(t)),
  }));
  achar(new RegExp(String.raw`${ALTER}\s+rename\s+to\s+(${ID})`, "g"), (m) => ({ tipo: "renomear", tabela: m[1], novo: m[2] }));
  achar(new RegExp(String.raw`${ALTER}\s+(enable|disable)\s+row\s+level\s+security`, "g"), (m) => ({
    tipo: "rls",
    tabela: m[1],
    ligado: m[2] === "enable",
  }));
  achar(new RegExp(String.raw`${ALTER}\s+([^;]*)`, "g"), (m) => {
    const numeradas = [...m[2].matchAll(new RegExp(String.raw`\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?(${ID})"?\s+${NUMERA}`, "g"))].map(
      (c) => c[1],
    );
    return numeradas.length ? { tipo: "colunas", tabela: m[1], numeradas } : null;
  });
  achar(new RegExp(String.raw`\b(create|drop)\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|${ID})\s+on\s+(?:public\.)?(${ID})(?![\w.])`, "gd"), (m) => {
    // O nome entre aspas guarda maiúsculas e acentos: lido do original.
    const [inicio, fim] = m.indices[2];
    const ponto = texto.indexOf(";", m.index);
    const comando = texto.slice(m.index, ponto < 0 ? undefined : ponto);
    return {
      tipo: m[1] === "create" ? "criarRegra" : "apagarRegra",
      tabela: m[3],
      nome: nomeDaRegra(original.slice(inicio, fim)),
      restritiva: /\bas\s+restrictive\b/.test(comando),
    };
  });
  achar(/\b(grant|revoke)\s+([^;]*?)\s+on\s+(sequence\s+([^;]*?)|all\s+sequences\s+in\s+schema\s+public)\s+(to|from)\s+([^;]*);/g, (m) => {
    if (!/\b(usage|all)\b/.test(m[2])) return null;
    const sequencias = m[4] ? m[4].split(",").map((s) => s.trim().replace(/^public\./, "")) : "todas";
    return { tipo: m[1] === "grant" ? "darUso" : "tirarUso", sequencias, papeis: papeis(m[6]) };
  });

  return eventos.sort((a, b) => a.i - b.i);
}

/**
 * As tabelas e as sequências depois de aplicar, em ordem, os comandos de
 * todos os textos.
 * @param {string[]} textos
 * @returns {{
 *   tabelas: Map<string, {rls: boolean, regras: Map<string, {restritiva: boolean}>, sequencias: string[]}>,
 *   sequencias: Map<string, {tabela: string, uso: Set<string>}>
 * }}
 */
export function tabelasDosTextos(textos) {
  const tabelas = new Map();
  const sequencias = new Map();
  const numerar = (tabela, colunas) => {
    for (const coluna of colunas) {
      const nome = nomeNoBanco(`${tabela}_${coluna}_seq`);
      tabelas.get(tabela).sequencias.push(nome);
      sequencias.set(nome, { tabela, uso: new Set() });
    }
  };
  for (const texto of textos) {
    for (const e of eventosDoTexto(texto)) {
      const t = tabelas.get(e.tabela);
      if (e.tipo === "criar") {
        if (t) continue; // `create table if not exists` de uma tabela que já existe
        tabelas.set(e.tabela, { rls: false, regras: new Map(), sequencias: [] });
        numerar(e.tabela, e.numeradas);
      } else if (e.tipo === "apagar") {
        for (const nome of e.tabelas) {
          for (const s of tabelas.get(nome)?.sequencias ?? []) sequencias.delete(s);
          tabelas.delete(nome);
        }
      } else if (e.tipo === "renomear" && t) {
        tabelas.delete(e.tabela);
        tabelas.set(e.novo, t);
        for (const s of t.sequencias) sequencias.get(s).tabela = e.novo;
      } else if (e.tipo === "rls" && t) {
        t.rls = e.ligado;
      } else if (e.tipo === "colunas" && t) {
        numerar(e.tabela, e.numeradas);
      } else if (e.tipo === "criarRegra" && t) {
        t.regras.set(e.nome, { restritiva: e.restritiva });
      } else if (e.tipo === "apagarRegra" && t) {
        t.regras.delete(e.nome);
      } else if (e.tipo === "darUso" || e.tipo === "tirarUso") {
        const alvos = e.sequencias === "todas" ? [...sequencias.keys()] : e.sequencias;
        for (const s of alvos) {
          const seq = sequencias.get(s);
          if (!seq) continue;
          for (const p of e.papeis) e.tipo === "darUso" ? seq.uso.add(p) : seq.uso.delete(p);
        }
      }
    }
  }
  return { tabelas, sequencias };
}

/** As tabelas e as sequências do repositório, na ordem da reconstrução. */
export function tabelasDoRepositorio(raiz = RAIZ_PADRAO) {
  return tabelasDosTextos(arquivosDaReconstrucao(raiz).map((arquivo) => lerTexto(join(raiz, arquivo))));
}
