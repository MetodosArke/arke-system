// Grava no repositório o histórico do banco de produção: a ordem em que as
// migrations rodaram e o texto que de fato rodou em cada uma.
//
// Por que existe: o repositório renumerou boa parte das migrations, juntou
// algumas que foram aplicadas em partes, e tem arquivos com texto um pouco
// diferente do que rodou. Achado de 04/10/2026: 32 migrations aplicadas no
// banco não tinham arquivo nenhum. Enquanto o banco existe, isso não pesa;
// se um dia for preciso recriá-lo do zero, sem backup, o repositório tem de
// bastar.
//
// O que ele escreve em `supabase/historico/`:
//   * `ordem.json`: cada migration desde `reset_schema_public`, na ordem de
//     versão, com o arquivo que tem o texto que rodou. É o arquivo de
//     `supabase/migrations/` quando o texto bate (sem contar comentário,
//     espaço e maiúscula), ou uma cópia fiel do banco em `supabase/historico/`
//     quando falta ou difere;
//   * as cópias fiéis, uma por migration, com a versão do banco no nome;
//   * em `fora_da_ordem`, os arquivos de `supabase/migrations/` que o
//     histórico não usa, com o motivo.
//
// Migration nova, aplicada depois deste retrato, entra na reconstrução pela
// versão (maior que `ultima_versao`). Rode de novo quando quiser renovar o
// retrato; `src/lib/historicoBanco.guarda.test.ts` confere a consistência.
//
// Uso: ARKE_CHAVES=... node scripts/migracao/historico.mjs
// O token sai de SUPABASE_ACCESS_TOKEN ou da linha `sbp_` do arquivo de chaves,
// e nunca é impresso.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const MIGRATIONS = join(RAIZ, "supabase", "migrations");
const HISTORICO = join(RAIZ, "supabase", "historico");
const PROJETO = process.env.ARKE_ORIGEM ?? "lzyxqjibkfblrrjboylp";
const MARCO_ZERO = "reset_schema_public";

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const arquivo = process.env.ARKE_CHAVES;
  if (!arquivo || !existsSync(arquivo)) throw new Error("Sem token: defina SUPABASE_ACCESS_TOKEN ou ARKE_CHAVES.");
  const linha = readFileSync(arquivo, "utf8").split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("sbp_"));
  if (!linha) throw new Error(`Nenhum token sbp_ em ${arquivo}.`);
  return linha;
}

async function consultar(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJETO}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 400)}`);
  return JSON.parse(t);
}

/** O texto que importa: sem comentário de linha, sem diferença de espaço nem de maiúscula. */
function normalizar(sql) {
  return sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const nomeDoArquivo = (f) => f.replace(/^\d+_/, "").replace(/\.sql$/, "");
const versaoDoArquivo = (f) => f.split("_")[0];

async function principal() {
  const arquivos = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const porVersao = new Map(arquivos.map((f) => [versaoDoArquivo(f), f]));
  const porNome = new Map();
  for (const f of arquivos) porNome.set(nomeDoArquivo(f), [...(porNome.get(nomeDoArquivo(f)) ?? []), f]);

  const [marco] = await consultar(`select version from supabase_migrations.schema_migrations where name = '${MARCO_ZERO}' limit 1`);
  if (!marco) throw new Error(`Não achei ${MARCO_ZERO} no banco.`);
  const lista = await consultar(
    `select version, name, coalesce(array_to_string(statements, E';\\n'), '') as sql
       from supabase_migrations.schema_migrations where version >= '${marco.version}' order by version`,
  );

  rmSync(HISTORICO, { recursive: true, force: true });
  mkdirSync(HISTORICO, { recursive: true });
  const passos = [];
  const usados = new Set();
  let copias = 0;
  for (const m of lista) {
    const candidatos = [porVersao.get(m.version), ...(porNome.get(m.name) ?? [])].filter(Boolean);
    const temSql = m.sql.trim().length > 0;
    let arquivo = null;
    if (!temSql) {
      // Aplicada sem gravar o SQL no banco: o texto é o do arquivo da mesma versão ou do mesmo nome.
      arquivo = candidatos[0] ?? null;
      if (!arquivo) throw new Error(`${m.version} ${m.name}: sem SQL no banco e sem arquivo no repositório.`);
    } else {
      const alvo = normalizar(m.sql);
      arquivo = candidatos.find((f) => normalizar(readFileSync(join(MIGRATIONS, f), "utf8")) === alvo) ?? null;
    }
    if (arquivo) {
      usados.add(arquivo);
      passos.push({ versao: m.version, nome: m.name, arquivo: `supabase/migrations/${arquivo}` });
    } else {
      const copia = `${m.version}_${m.name}.sql`;
      const cabecalho = `-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).\n-- Gerada por scripts/migracao/historico.mjs; não editar à mão.\n\n`;
      writeFileSync(join(HISTORICO, copia), cabecalho + m.sql.trim() + "\n");
      passos.push({ versao: m.version, nome: m.name, arquivo: `supabase/historico/${copia}` });
      copias++;
    }
  }

  const ultima = passos.at(-1).versao;
  const foraDaOrdem = arquivos
    .filter((f) => !usados.has(f) && versaoDoArquivo(f) <= ultima)
    .map((f) => {
      const mesmoNome = passos.find((p) => p.nome === nomeDoArquivo(f));
      return {
        arquivo: `supabase/migrations/${f}`,
        motivo: mesmoNome
          ? `o texto difere do que rodou; vale ${mesmoNome.arquivo}`
          : "não rodou com este nome: o conteúdo entrou no banco em outras migrations do histórico",
      };
    });

  const ordem = {
    explicacao: "Ordem e texto das migrations que construíram o banco de produção. Ver supabase/historico/README.md.",
    gerado_em: new Date().toISOString().slice(0, 10),
    projeto: PROJETO,
    desde: MARCO_ZERO,
    ultima_versao: ultima,
    passos,
    fora_da_ordem: foraDaOrdem,
  };
  writeFileSync(join(HISTORICO, "ordem.json"), JSON.stringify(ordem, null, 2) + "\n");
  writeFileSync(join(HISTORICO, "README.md"), LEIA_ME);
  console.log(`${passos.length} migrations no histórico, até ${ultima}`);
  console.log(`  ${passos.length - copias} pelo arquivo de supabase/migrations`);
  console.log(`  ${copias} copiadas do banco para supabase/historico`);
  console.log(`  ${foraDaOrdem.length} arquivos de supabase/migrations fora da ordem`);
}

const LEIA_ME = `# Histórico do banco

O banco de produção foi construído por uma sequência de migrations cuja ordem e cujo texto nem sempre batem com \`supabase/migrations/\`: o repositório renumerou boa parte delas, juntou algumas que rodaram em partes, e alguns arquivos ficaram com texto um pouco diferente do que rodou. Esta pasta guarda o retrato fiel, para o repositório bastar se um dia for preciso recriar o banco do zero, sem backup.

- \`ordem.json\`: cada migration desde \`reset_schema_public\`, em ordem de versão, apontando para o arquivo com o texto que rodou. É o arquivo de \`supabase/migrations/\` quando o texto bate, ou a cópia fiel desta pasta quando faltava ou diferia.
- \`<versão>_<nome>.sql\`: as cópias fiéis, tiradas de \`supabase_migrations.schema_migrations\`. Não editar à mão.
- \`fora_da_ordem\` (em \`ordem.json\`): os arquivos de \`supabase/migrations/\` que a reconstrução não usa, com o motivo.

Migration nova, aplicada depois do retrato, entra pela versão: tudo em \`supabase/migrations/\` com versão maior que \`ultima_versao\`, em ordem.

**Para renovar o retrato:** \`ARKE_CHAVES=... node scripts/migracao/historico.mjs\`. O teste \`src/lib/historicoBanco.guarda.test.ts\` confere que todo arquivo citado existe e que todo arquivo de \`supabase/migrations/\` está no histórico, fora da ordem com motivo, ou depois do retrato.

**Para reconstruir:** num projeto vazio, as extensões de \`scripts/migracao/01-antes-da-restauracao.sql\`, depois \`ARKE_ORIGEM=repositorio ARKE_DESTINO=<projeto> node scripts/migracao/replicar-schema.mjs --aplicar\`, e por fim \`02-depois-da-restauracao.sql\` (buckets, rotinas do pg_cron e tokens do Vault, que não saem em migration). Dados não estão aqui: vêm do backup.
`;

principal().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
