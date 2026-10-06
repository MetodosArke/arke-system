// As rotinas do pg_cron do banco, lidas de onde elas moram: as migrations que
// as agendam.
//
// O `cron.job` pertence à extensão, e nem o dump do schema nem a cópia dos
// dados o trazem. Por isso o roteiro `02-depois-da-restauracao.sql` recria as
// rotinas — e, até 06/10/2026, recriava uma lista escrita à mão, com 14
// (uma já desagendada): depois de desagendar tudo, ficava de fora mais da
// metade das que as migrations agendam, entre elas a retenção dos logs da catraca, os históricos, os leads, o Vigia
// e os encerramentos.
//
// Agora a lista não é escrita à mão em lugar nenhum. Este módulo percorre a
// mesma ordem da reconstrução do banco (o retrato de `supabase/historico/` e,
// depois dele, as migrations mais novas), aplica cada `cron.schedule` e
// `cron.unschedule` na ordem em que aparecem, e devolve o que sobra. O bloco
// de rotinas do roteiro é gerado daqui (`--escrever`), e
// `src/lib/rotinasBanco.guarda.test.ts` falha quando uma rotina nova não
// entrou nele.
//
// Uso:
//   node scripts/migracao/rotinas.mjs            confere o roteiro e lista as rotinas
//   node scripts/migracao/rotinas.mjs --escrever reescreve os blocos gerados do roteiro

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ_PADRAO = join(AQUI, "..", "..");
export const ROTEIRO = join("scripts", "migracao", "02-depois-da-restauracao.sql");

export const MARCAS = {
  tokens: ["-- >>> tokens do Vault (gerado por scripts/migracao/rotinas.mjs; não editar à mão)", "-- <<< tokens do Vault"],
  rotinas: ["-- >>> rotinas (gerado por scripts/migracao/rotinas.mjs; não editar à mão)", "-- <<< rotinas"],
};

/** O texto de um arquivo com fim de linha `\n`: no Windows, o git entrega `\r\n`. */
export const lerTexto = (caminho) => readFileSync(caminho, "utf8").replace(/\r\n/g, "\n");

/** Os arquivos da reconstrução, na ordem: o retrato do histórico e as migrations depois dele. */
export function arquivosDaReconstrucao(raiz = RAIZ_PADRAO) {
  const ordem = JSON.parse(readFileSync(join(raiz, "supabase", "historico", "ordem.json"), "utf8"));
  const arquivos = ordem.passos.map((p) => p.arquivo);
  const pasta = join(raiz, "supabase", "migrations");
  for (const f of readdirSync(pasta).filter((x) => x.endsWith(".sql")).sort()) {
    if (f.split("_")[0] > ordem.ultima_versao) arquivos.push(`supabase/migrations/${f}`);
  }
  return arquivos;
}

/** Tira os comentários de linha (`-- ...`) fora de texto entre aspas simples. */
function semComentarios(sql) {
  return sql
    .split("\n")
    .map((linha) => {
      let aspas = false;
      for (let i = 0; i < linha.length - 1; i++) {
        if (linha[i] === "'") aspas = !aspas;
        else if (!aspas && linha[i] === "-" && linha[i + 1] === "-") return linha.slice(0, i);
      }
      return linha;
    })
    .join("\n");
}

/** Lê um literal na posição `i`: `'...'` (com `''`) ou `$tag$...$tag$`. */
function lerLiteral(texto, i) {
  while (/\s/.test(texto[i] ?? "")) i++;
  if (texto[i] === "'") {
    let valor = "";
    let j = i + 1;
    for (;;) {
      if (j >= texto.length) return null;
      if (texto[j] === "'") {
        if (texto[j + 1] === "'") {
          valor += "'";
          j += 2;
          continue;
        }
        return { valor, fim: j + 1 };
      }
      valor += texto[j++];
    }
  }
  const tag = /^\$[A-Za-z_]*\$/.exec(texto.slice(i));
  if (tag) {
    const fim = texto.indexOf(tag[0], i + tag[0].length);
    if (fim < 0) return null;
    return { valor: texto.slice(i + tag[0].length, fim), fim: fim + tag[0].length };
  }
  return null;
}

function lerSimbolo(texto, i, simbolo) {
  while (/\s/.test(texto[i] ?? "")) i++;
  return texto[i] === simbolo ? i + 1 : -1;
}

const linhaDe = (texto, i) => texto.slice(0, i).split("\n").length;

/**
 * As chamadas ao pg_cron de um arquivo, na ordem: agendar, desagendar uma, ou
 * desagendar todas. Forma desconhecida é erro, e não silêncio: uma rotina
 * que o leitor não entende é exatamente a que sumiria da reconstrução.
 */
export function chamadasCron(sql, arquivo = "(sql)") {
  const texto = semComentarios(sql);
  const chamadas = [];
  const re = /cron\.(schedule|unschedule)\s*\(/gi;
  let m;
  while ((m = re.exec(texto))) {
    const onde = `${arquivo}:${linhaDe(texto, m.index)}`;
    let i = m.index + m[0].length;
    if (m[1].toLowerCase() === "schedule") {
      const nome = lerLiteral(texto, i);
      if (!nome) throw new Error(`${onde}: cron.schedule sem nome literal`);
      i = lerSimbolo(texto, nome.fim, ",");
      const agendamento = i < 0 ? null : lerLiteral(texto, i);
      if (!agendamento) throw new Error(`${onde}: cron.schedule('${nome.valor}') sem agendamento literal`);
      i = lerSimbolo(texto, agendamento.fim, ",");
      const comando = i < 0 ? null : lerLiteral(texto, i);
      if (!comando) throw new Error(`${onde}: cron.schedule('${nome.valor}') sem comando literal`);
      if (lerSimbolo(texto, comando.fim, ")") < 0) throw new Error(`${onde}: cron.schedule('${nome.valor}') com argumento a mais`);
      if (!/^[a-z0-9_-]+$/i.test(nome.valor)) throw new Error(`${onde}: nome de rotina inesperado '${nome.valor}'`);
      chamadas.push({ tipo: "agendar", nome: nome.valor, agendamento: agendamento.valor, comando: comando.valor, arquivo });
      re.lastIndex = comando.fim;
      continue;
    }
    const literal = lerLiteral(texto, i);
    if (literal) {
      chamadas.push({ tipo: "desagendar", nome: literal.valor, arquivo });
      re.lastIndex = literal.fim;
      continue;
    }
    const resto = texto.slice(i, i + 200);
    const porNome = /^\s*jobid\s*\)\s*from\s+cron\.job\s+where\s+jobname\s*=\s*'([^']+)'/i.exec(resto);
    if (porNome) {
      chamadas.push({ tipo: "desagendar", nome: porNome[1], arquivo });
      continue;
    }
    if (/^\s*jobid\s*\)\s*from\s+cron\.job\s*;/i.test(resto)) {
      chamadas.push({ tipo: "desagendar_todas", arquivo });
      continue;
    }
    throw new Error(`${onde}: cron.unschedule numa forma que este leitor não conhece`);
  }
  return chamadas;
}

/** As rotinas que existem depois da reconstrução, por nome, na ordem em que nasceram. */
export function rotinasDoRepositorio(raiz = RAIZ_PADRAO) {
  const rotinas = new Map();
  for (const arquivo of arquivosDaReconstrucao(raiz)) {
    for (const c of chamadasCron(lerTexto(join(raiz, arquivo)), arquivo)) {
      if (c.tipo === "agendar") {
        rotinas.delete(c.nome);
        rotinas.set(c.nome, { nome: c.nome, agendamento: c.agendamento, comando: c.comando, arquivo: c.arquivo });
      } else if (c.tipo === "desagendar") {
        rotinas.delete(c.nome);
      } else {
        rotinas.clear();
      }
    }
  }
  return [...rotinas.values()];
}

/** Os tokens do Vault que as rotinas leem. */
export function tokensDasRotinas(rotinas) {
  const nomes = new Set();
  for (const r of rotinas) {
    for (const m of r.comando.matchAll(/vault\.decrypted_secrets\s+where\s+name\s*=\s*'([^']+)'/gi)) nomes.add(m[1]);
  }
  return [...nomes].sort();
}

const comandoSql = (comando) => {
  // O comando volta entre $cmd$, que nenhuma rotina usa dentro do texto.
  if (comando.includes("$cmd$")) throw new Error("comando de rotina com $cmd$ no texto");
  return `$cmd$${comando}$cmd$`;
};

/** O bloco do roteiro com a criação de cada rotina, gerado a partir da lista. */
export function blocoRotinas(rotinas) {
  const linhas = [
    MARCAS.rotinas[0],
    `-- ${rotinas.length} rotinas, as mesmas que as migrations deixam agendadas. Horários em UTC,`,
    "-- como o pg_cron os guarda. Cada uma diz de que migration veio.",
    "select cron.unschedule(jobid) from cron.job;",
    "",
  ];
  for (const r of rotinas) {
    linhas.push(`-- ${r.arquivo}`);
    linhas.push(`select cron.schedule('${r.nome}', '${r.agendamento}', ${comandoSql(r.comando)});`);
    linhas.push("");
  }
  linhas.push(MARCAS.rotinas[1]);
  return linhas.join("\n");
}

/** O bloco do roteiro que recria os tokens que as rotinas leem. */
export function blocoTokens(tokens) {
  const linhas = [
    MARCAS.tokens[0],
    `-- Os ${tokens.length} tokens que as rotinas leem. Nascem novos: os do projeto antigo não`,
    "-- decifram aqui, e é exatamente o desejado.",
    `delete from vault.secrets where name in (${tokens.map((t) => `'${t}'`).join(", ")});`,
    "",
  ];
  for (const t of tokens) {
    linhas.push(`select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), '${t}', 'Autentica o pg_cron nas edge functions.');`);
  }
  linhas.push("", MARCAS.tokens[1]);
  return linhas.join("\n");
}

/** O texto entre as marcas de um bloco gerado, marcas incluídas; nulo se faltar marca. */
export function blocoNoRoteiro(roteiro, marcas) {
  const inicio = roteiro.indexOf(marcas[0]);
  const fim = roteiro.indexOf(marcas[1]);
  if (inicio < 0 || fim < inicio) return null;
  return roteiro.slice(inicio, fim + marcas[1].length);
}

/** As rotinas que um texto de roteiro cria (lidas do mesmo jeito que as das migrations). */
export function rotinasDoTexto(sql) {
  return rotinasDeChamadas(chamadasCron(sql, ROTEIRO));
}

function rotinasDeChamadas(chamadas) {
  const rotinas = new Map();
  for (const c of chamadas) {
    if (c.tipo === "agendar") rotinas.set(c.nome, { nome: c.nome, agendamento: c.agendamento, comando: c.comando });
    else if (c.tipo === "desagendar") rotinas.delete(c.nome);
    else rotinas.clear();
  }
  return [...rotinas.values()];
}

function principal() {
  const raiz = RAIZ_PADRAO;
  const caminho = join(raiz, ROTEIRO);
  const rotinas = rotinasDoRepositorio(raiz);
  const tokens = tokensDasRotinas(rotinas);
  let roteiro = lerTexto(caminho);

  if (process.argv.includes("--escrever")) {
    for (const [marcas, novo] of [
      [MARCAS.tokens, blocoTokens(tokens)],
      [MARCAS.rotinas, blocoRotinas(rotinas)],
    ]) {
      const atual = blocoNoRoteiro(roteiro, marcas);
      if (atual === null) throw new Error(`O roteiro não tem as marcas ${marcas[0]}`);
      roteiro = roteiro.replace(atual, novo);
    }
    writeFileSync(caminho, roteiro);
    console.log(`Roteiro reescrito: ${rotinas.length} rotinas e ${tokens.length} tokens.`);
    return;
  }

  for (const r of rotinas) console.log(`${r.nome.padEnd(34)} ${r.agendamento.padEnd(14)} ${r.arquivo}`);
  const emDia =
    blocoNoRoteiro(roteiro, MARCAS.rotinas) === blocoRotinas(rotinas) && blocoNoRoteiro(roteiro, MARCAS.tokens) === blocoTokens(tokens);
  console.log(`\n${rotinas.length} rotinas, ${tokens.length} tokens. Roteiro ${emDia ? "em dia" : "DESATUALIZADO: rode com --escrever"}.`);
  if (!emDia) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) principal();
