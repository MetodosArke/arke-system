// Compara a contagem de linhas das tabelas GLOBAIS — as que pertencem à
// ArkeFit e não a uma academia — entre origem e destino.
//
// Por que só as globais: os dados de academia não são migrados. A única
// organização do projeto antigo é a Tietê Fitness, que é de testes e será
// excluída; levar as 11 contas de teste junto seria carregar lixo para dentro
// da produção nova. O que precisa atravessar é o acervo e a configuração da
// plataforma — biblioteca de exercícios e alimentos, planos, preços, textos
// legais, listas de apoio, SLA.
//
// A maior parte disso é semeada pelas próprias migrations, então a expectativa
// é que já bata. O que não bater sai listado para trazer linha a linha.
//
// Uso:  ARKE_CHAVES=... node scripts/migracao/dados-globais.mjs

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
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

// Tabelas sem `organization_id`: por construção, são as da ArkeFit. A lista é
// descoberta, não digitada, para uma tabela global nova entrar aqui sozinha.
const consulta = `
  select t.table_name
    from information_schema.tables t
   where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
     and not exists (
       select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = t.table_name
          and c.column_name in ('organization_id','academia_id')
     )
   order by 1`;

const tabelas = (await sql(ORIGEM, consulta)).map((r) => r.table_name);

const contar = (t) =>
  `select ${t.map((n) => `(select count(*) from public."${n}") as "${n}"`).join(", ")}`;

const [a] = await sql(ORIGEM, contar(tabelas));
const [b] = await sql(DESTINO, contar(tabelas));

let diferentes = 0;
console.log(`${"tabela".padEnd(38)} origem  destino`);
for (const t of tabelas) {
  const x = Number(a[t]);
  const y = Number(b[t]);
  if (x === y) continue;
  diferentes++;
  console.log(`${t.padEnd(38)} ${String(x).padStart(6)}  ${String(y).padStart(7)}   DIFERE`);
}
const iguais = tabelas.length - diferentes;
console.log(`\n${iguais} tabelas globais com a mesma contagem, ${diferentes} diferentes.`);
