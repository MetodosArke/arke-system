// Replica o schema do projeto de origem no projeto de destino, sem pg_dump e
// sem senha de banco.
//
// Como: o Supabase guarda o SQL de cada migration aplicada em
// `supabase_migrations.schema_migrations.statements`. A partir de
// `reset_schema_public` — que derrubou o schema antigo inteiro — essa lista é a
// história completa do banco atual. O script lê essa lista na origem e aplica
// no destino, na mesma ordem, pela API de gerenciamento.
//
// As últimas migrations foram aplicadas por `supabase db query`, que não grava
// o SQL na tabela. Para essas, o script usa o arquivo do repositório. Se faltar
// arquivo para alguma, ele PARA antes de tocar no destino — migrar sem saber o
// que falta é pior do que não migrar.
//
// O que este script NÃO faz, de propósito:
//   * dados (linhas das tabelas) — ver o README desta pasta;
//   * buckets, regras de storage, rotinas do pg_cron e tokens do Vault, que não
//     saem em migration e estão em 02-depois-da-restauracao.sql;
//   * extensões, que estão em 01-antes-da-restauracao.sql e precisam vir antes.
//
// Uso:
//   node scripts/migracao/replicar-schema.mjs --conferir
//   node scripts/migracao/replicar-schema.mjs --aplicar
//
// O token da API sai de SUPABASE_ACCESS_TOKEN ou do arquivo apontado por
// ARKE_CHAVES (a primeira linha que começar com `sbp_`). O valor nunca é
// impresso.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const MIGRATIONS = join(RAIZ, "supabase", "migrations");

const ORIGEM = process.env.ARKE_ORIGEM ?? "jbkrxrfdrmrkyldrrdpq";
const DESTINO = process.env.ARKE_DESTINO ?? "lzyxqjibkfblrrjboylp";
const MARCO_ZERO = "reset_schema_public";

const aplicar = process.argv.includes("--aplicar");
const conferir = process.argv.includes("--conferir");
// Retoma uma aplicação interrompida, pulando o que o destino já registrou.
const continuar = process.argv.includes("--continuar");
if (!aplicar && !conferir) {
  console.error("Escolha --conferir (não escreve nada) ou --aplicar [--continuar].");
  process.exit(2);
}

// O banco de produção acumulou mudanças feitas fora de migration — uma regra de
// RLS renomeada à mão, por exemplo. Uma migration posterior, gerada a partir do
// estado real, manda remover a regra pelo nome novo; na reconstrução, esse nome
// nunca existiu e o `drop` aborta a migration inteira.
//
// Remover algo que não está lá é um no-op: o `if exists` deixa a reconstrução
// seguir sem mudar o que cada migration faz. O que o `if exists` NÃO garante é
// que o estado final bata com o da origem — por isso a comparação de regras,
// gatilhos e funções no fim é obrigatória, não opcional.
function tolerarAusencia(sql) {
  return sql.replace(
    /\bdrop\s+(policy|trigger|index|function|view|materialized\s+view|type|table|sequence|schema)\s+(?!if\s+exists)/gi,
    (_m, tipo) => `drop ${tipo} if exists `,
  );
}

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const arquivo = process.env.ARKE_CHAVES;
  if (!arquivo || !existsSync(arquivo)) {
    throw new Error(
      "Sem token: defina SUPABASE_ACCESS_TOKEN ou aponte ARKE_CHAVES para o arquivo de chaves.",
    );
  }
  // O arquivo de chaves tem rótulo e valor em linhas separadas, então a busca é
  // pelo prefixo do próprio token, que é inequívoco.
  const linha = readFileSync(arquivo, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith("sbp_"));
  if (!linha) throw new Error(`Nenhum token sbp_ encontrado em ${arquivo}.`);
  return linha;
}

const TOKEN = token();

async function consultar(ref, sql) {
  const resposta = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const texto = await resposta.text();
  if (!resposta.ok) {
    // A mensagem do Postgres importa para diagnosticar; o token não aparece aqui.
    throw new Error(`HTTP ${resposta.status}: ${texto.slice(0, 600)}`);
  }
  try {
    return JSON.parse(texto);
  } catch {
    return [];
  }
}

const aspas = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// Casa a migration do banco com o arquivo do repositório. Os nomes batem; os
// prefixos de data, não (o repositório renumerou), então a busca é pelo nome.
function arquivoDaMigration(nome) {
  const candidatos = readdirSync(MIGRATIONS).filter(
    (f) => f.endsWith(".sql") && f.replace(/^\d+_/, "").replace(/\.sql$/, "") === nome,
  );
  return candidatos.length === 1 ? join(MIGRATIONS, candidatos[0]) : null;
}

async function principal() {
  console.log(`origem  ${ORIGEM}`);
  console.log(`destino ${DESTINO}\n`);

  const marco = await consultar(
    ORIGEM,
    `select version from supabase_migrations.schema_migrations where name = ${aspas(MARCO_ZERO)} limit 1`,
  );
  if (!marco.length) throw new Error(`Não achei a migration ${MARCO_ZERO} na origem.`);
  const desde = marco[0].version;

  const lista = await consultar(
    ORIGEM,
    `select version, name, coalesce(array_to_string(statements, E';\\n'), '') as sql
       from supabase_migrations.schema_migrations
      where version >= ${aspas(desde)}
      order by version`,
  );

  const passos = [];
  const semSql = [];
  for (const m of lista) {
    if (m.sql && m.sql.trim().length > 0) {
      passos.push({ ...m, origem: "banco" });
      continue;
    }
    const arquivo = arquivoDaMigration(m.name);
    if (!arquivo) {
      semSql.push(m.name);
      continue;
    }
    passos.push({ ...m, sql: readFileSync(arquivo, "utf8"), origem: "arquivo" });
  }

  if (semSql.length) {
    console.error("PARADO: migrations sem SQL no banco e sem arquivo no repositório:");
    for (const n of semSql) console.error(`  - ${n}`);
    process.exit(1);
  }

  const doBanco = passos.filter((p) => p.origem === "banco").length;
  const doArquivo = passos.filter((p) => p.origem === "arquivo").length;
  const bytes = passos.reduce((t, p) => t + p.sql.length, 0);
  console.log(`${passos.length} migrations desde ${MARCO_ZERO} (${desde})`);
  console.log(`  ${doBanco} com SQL guardado no banco`);
  console.log(`  ${doArquivo} lidas do repositório`);
  console.log(`  ${(bytes / 1024).toFixed(0)} KB de SQL no total\n`);
  for (const p of passos.filter((x) => x.origem === "arquivo")) {
    console.log(`  do repositório: ${p.version}  ${p.name}`);
  }

  if (conferir) {
    console.log("\n--conferir: nada foi escrito no destino.");
    return;
  }

  if (!continuar) {
    const jaExistem = await consultar(
      DESTINO,
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    if ((jaExistem[0]?.n ?? 0) > 0) {
      throw new Error(
        `O destino já tem ${jaExistem[0].n} tabelas em public. Rode 01-antes-da-restauracao.sql, ` +
          `ou use --continuar para retomar uma aplicação interrompida.`,
      );
    }
  }

  await consultar(
    DESTINO,
    `create schema if not exists supabase_migrations;
     create table if not exists supabase_migrations.schema_migrations (
       version text primary key,
       statements text[],
       name text
     );`,
  );

  let feitas = new Set();
  if (continuar) {
    const registradas = await consultar(
      DESTINO,
      `select version from supabase_migrations.schema_migrations`,
    );
    feitas = new Set(registradas.map((r) => r.version));
    console.log(`\n--continuar: ${feitas.size} já registradas no destino, serão puladas.`);
  }

  console.log("\naplicando:");
  let i = 0;
  for (const p of passos) {
    i++;
    const etiqueta = `${String(i).padStart(3)}/${passos.length}  ${p.version}  ${p.name}`;
    if (feitas.has(p.version)) continue;
    try {
      await consultar(DESTINO, tolerarAusencia(p.sql));
      await consultar(
        DESTINO,
        `insert into supabase_migrations.schema_migrations (version, name, statements)
         values (${aspas(p.version)}, ${aspas(p.name)}, array[${aspas(p.sql)}])
         on conflict (version) do nothing`,
      );
      console.log(`  ok   ${etiqueta}`);
    } catch (erro) {
      console.error(`  FALHA ${etiqueta}`);
      console.error(`  ${erro.message}`);
      console.error("\nParei aqui. O destino ficou no estado desta migration.");
      process.exit(1);
    }
  }
  console.log("\nSchema replicado. Rode 02-depois-da-restauracao.sql e depois 03-conferencia.sql nos dois projetos.");
}

principal().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
