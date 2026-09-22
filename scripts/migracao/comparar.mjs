// Compara origem e destino objeto a objeto, pela API de gerenciamento.
//
// A contagem bater não prova nada: 232 regras de um lado e 232 do outro podem
// ser conjuntos diferentes. Aqui a comparação é por nome e, nas regras de RLS,
// também pela condição — que é onde mora o acesso. Qualquer diferença é
// impressa dos dois lados.
//
// Uso:  ARKE_CHAVES=... node scripts/migracao/comparar.mjs

import { readFileSync, existsSync } from "node:fs";

const ORIGEM = process.env.ARKE_ORIGEM ?? "jbkrxrfdrmrkyldrrdpq";
const DESTINO = process.env.ARKE_DESTINO ?? "lzyxqjibkfblrrjboylp";

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const arquivo = process.env.ARKE_CHAVES;
  if (!arquivo || !existsSync(arquivo)) throw new Error("Sem token: SUPABASE_ACCESS_TOKEN ou ARKE_CHAVES.");
  const linha = readFileSync(arquivo, "utf8").split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("sbp_"));
  if (!linha) throw new Error(`Nenhum token sbp_ em ${arquivo}.`);
  return linha;
}
const TOKEN = token();

async function consultar(ref, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 500)}`);
  return JSON.parse(t);
}

// Cada consulta devolve uma coluna `chave`: a identidade do objeto. Onde a
// definição importa (regra de RLS, gatilho, coluna), ela entra na chave, senão
// uma condição trocada passaria batido.
const COMPARACOES = {
  tabelas: `select table_name as chave from information_schema.tables
             where table_schema='public' and table_type='BASE TABLE'`,

  colunas: `select table_name||'.'||column_name||' '||data_type||
                   case when is_nullable='NO' then ' not null' else '' end||
                   coalesce(' default '||column_default,'') as chave
              from information_schema.columns where table_schema='public'`,

  funcoes: `select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as chave
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`,

  corpo_das_funcoes: `select p.proname||'('||pg_get_function_identity_arguments(p.oid)||') md5:'||
                             md5(pg_get_functiondef(p.oid)) as chave
                        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                       where n.nspname='public' and p.prokind='f'`,

  regras_rls: `select schemaname||'.'||tablename||' ['||cmd||'] '||policyname||
                      ' para '||roles::text||
                      ' usando:'||md5(coalesce(qual,''))||
                      ' check:'||md5(coalesce(with_check,'')) as chave
                 from pg_policies where schemaname in ('public','storage')`,

  gatilhos: `select c.relname||'.'||t.tgname||' -> '||p.proname as chave
               from pg_trigger t
               join pg_class c on c.oid=t.tgrelid
               join pg_namespace n on n.oid=c.relnamespace
               join pg_proc p on p.oid=t.tgfoid
              where n.nspname='public' and not t.tgisinternal`,

  indices: `select indexname||': '||indexdef as chave from pg_indexes where schemaname='public'`,

  restricoes: `select c.conrelid::regclass||' '||c.conname||' '||pg_get_constraintdef(c.oid) as chave
                 from pg_constraint c join pg_namespace n on n.oid=c.connamespace
                where n.nspname='public'`,

  enums: `select t.typname||': '||string_agg(e.enumlabel, ',' order by e.enumsortorder) as chave
            from pg_type t join pg_namespace n on n.oid=t.typnamespace
            join pg_enum e on e.enumtypid=t.oid
           where n.nspname='public' group by t.typname`,

  privilegios: `select table_name||' '||grantee||' '||privilege_type as chave
                  from information_schema.role_table_grants
                 where table_schema='public' and grantee in ('anon','authenticated','service_role')`,

  // EXECUTE por função e por papel.
  //
  // A primeira versão desta consulta tinha um furo que escondeu uma divergência
  // real: em `aclexplode`, a concessão ao PUBLIC vem com `grantee = 0`, e
  // `pg_get_userbyid(0)` não devolve 'public' — devolve um rótulo que o filtro
  // `in ('anon','authenticated','service_role','public')` descartava. Resultado:
  // toda concessão ao PUBLIC — justamente a que o projeto revoga de propósito —
  // ficava fora da comparação, e os dois bancos pareciam iguais onde não eram.
  execute_nas_funcoes: `select p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||
                               case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as chave
                          from pg_proc p
                          join pg_namespace n on n.oid=p.pronamespace
                          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         where n.nspname='public' and a.privilege_type='EXECUTE'
                           and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon','authenticated','service_role'))`,

  buckets: `select id||' publico='||public||' limite='||coalesce(file_size_limit::text,'sem')||
                   ' tipos='||coalesce(array_to_string(allowed_mime_types,','),'todos') as chave
              from storage.buckets`,

  rotinas: `select jobname||' '||schedule||' ativo='||active as chave from cron.job`,

  realtime: `select c.relname as chave
               from pg_publication p join pg_publication_rel pr on pr.prpubid=p.oid
               join pg_class c on c.oid=pr.prrelid
              where p.pubname='supabase_realtime'`,
};

const conjunto = (linhas) => new Set(linhas.map((l) => l.chave));

let divergencias = 0;
for (const [nome, sql] of Object.entries(COMPARACOES)) {
  let a, b;
  try {
    [a, b] = await Promise.all([consultar(ORIGEM, sql), consultar(DESTINO, sql)]);
  } catch (e) {
    console.log(`\n### ${nome}: ERRO na consulta — ${e.message}`);
    divergencias++;
    continue;
  }
  const sa = conjunto(a);
  const sb = conjunto(b);
  const soNaOrigem = [...sa].filter((x) => !sb.has(x));
  const soNoDestino = [...sb].filter((x) => !sa.has(x));
  if (!soNaOrigem.length && !soNoDestino.length) {
    console.log(`ok  ${nome.padEnd(22)} ${sa.size}`);
    continue;
  }
  divergencias += soNaOrigem.length + soNoDestino.length;
  console.log(`\nDIFERE  ${nome}  (origem ${sa.size}, destino ${sb.size})`);
  for (const x of soNaOrigem.slice(0, 40)) console.log(`   só na origem:  ${x}`);
  if (soNaOrigem.length > 40) console.log(`   ... e mais ${soNaOrigem.length - 40}`);
  for (const x of soNoDestino.slice(0, 40)) console.log(`   só no destino: ${x}`);
  if (soNoDestino.length > 40) console.log(`   ... e mais ${soNoDestino.length - 40}`);
}

console.log(
  divergencias === 0
    ? "\nOs dois bancos têm o mesmo schema."
    : `\n${divergencias} divergências.`,
);
process.exit(divergencias === 0 ? 0 : 1);
