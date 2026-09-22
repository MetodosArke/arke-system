// Compara o CONTEÚDO das tabelas globais entre origem e destino, não só a
// contagem: duas tabelas com 105 linhas podem ter 105 linhas diferentes.
//
// Cada linha vira JSON, menos `id`, `created_at` e `updated_at` — que são
// gerados na hora da semeadura e por isso diferem legitimamente entre projetos.
// O resto é hasheado e os hashes comparados como conjunto, para a ordem não
// influir.
//
// Uso:  ARKE_CHAVES=... node scripts/migracao/impressao-globais.mjs

import { readFileSync, existsSync } from "node:fs";

const ORIGEM = process.env.ARKE_ORIGEM ?? "jbkrxrfdrmrkyldrrdpq";
const DESTINO = process.env.ARKE_DESTINO ?? "lzyxqjibkfblrrjboylp";

const linhas = (() => {
  const a = process.env.ARKE_CHAVES;
  if (!a || !existsSync(a)) return [];
  return readFileSync(a, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
})();
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim() || linhas.find((l) => l.startsWith("sbp_"));

async function sql(ref, q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 400)}`);
  return JSON.parse(t);
}

// Tabelas globais (sem organization_id) que têm conteúdo dos dois lados.
const globais = (
  await sql(
    ORIGEM,
    `select t.table_name
       from information_schema.tables t
      where t.table_schema='public' and t.table_type='BASE TABLE'
        and not exists (select 1 from information_schema.columns c
                         where c.table_schema='public' and c.table_name=t.table_name
                           and c.column_name in ('organization_id','academia_id'))
      order by 1`,
  )
).map((r) => r.table_name);

const impressao = (t) => `
  select '${t}' as tabela,
         count(*)::int as linhas,
         coalesce(md5(string_agg(h, '|' order by h)), 'vazia') as impressao
    from (
      select md5((to_jsonb(x.*) - 'id' - 'created_at' - 'updated_at' - 'atualizado_em' - 'criado_em')::text) as h
        from public."${t}" x
    ) s`;

const consulta = globais.map(impressao).join("\nunion all\n") + "\norder by 1";

const [a, b] = await Promise.all([sql(ORIGEM, consulta), sql(DESTINO, consulta)]);
const mapa = Object.fromEntries(b.map((r) => [r.tabela, r]));

let diferentes = 0;
for (const r of a) {
  const d = mapa[r.tabela];
  const igual = d && d.linhas === r.linhas && d.impressao === r.impressao;
  if (igual) {
    if (r.linhas > 0) console.log(`ok      ${r.tabela.padEnd(34)} ${r.linhas} linhas, conteúdo idêntico`);
    continue;
  }
  diferentes++;
  console.log(
    `DIFERE  ${r.tabela.padEnd(34)} origem ${r.linhas}, destino ${d ? d.linhas : "?"}` +
      (d && d.linhas === r.linhas ? "  (mesma contagem, conteúdo diferente)" : ""),
  );
}
console.log(`\n${a.length - diferentes} de ${a.length} tabelas globais idênticas.`);
