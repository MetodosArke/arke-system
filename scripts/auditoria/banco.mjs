// Auditoria — camadas 1 e 2 (fundação do banco e acesso aos dados).
// Só lê. Cada checagem imprime o que achou; nada é alterado.
// Uso: ARKE_CHAVES=... node scripts/auditoria/banco.mjs > <fora do repositório>/saida-banco.txt
import { readFileSync, existsSync } from "node:fs";

// O token da API de gerenciamento sai de SUPABASE_ACCESS_TOKEN ou da linha
// `sbp_` do arquivo apontado por ARKE_CHAVES; nunca é impresso. O resultado
// descreve pontos fracos: não vai para o git, porque o repositório é público.
const P = process.env.ARKE_PROJETO ?? "lzyxqjibkfblrrjboylp";
function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const arquivo = process.env.ARKE_CHAVES;
  if (!arquivo || !existsSync(arquivo)) throw new Error("Sem token: defina SUPABASE_ACCESS_TOKEN ou ARKE_CHAVES.");
  const linha = readFileSync(arquivo, "utf8").split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("sbp_"));
  if (!linha) throw new Error(`Nenhum token sbp_ em ${arquivo}.`);
  return linha;
}
const TOKEN = token();
async function sql(consulta) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${P}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: consulta }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 600));
  return t.trim() ? JSON.parse(t) : [];
}

const checagens = {
  "1.1 tabelas sem organization_id (fora das exceções da plataforma)": `
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and not exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name in ('organization_id','academia_id'))
     order by 1`,
  "1.2 tabelas sem chave primária": `
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'p') order by 1`,
  "1.3 colunas timestamp sem fuso": `
    select table_name, column_name from information_schema.columns
     where table_schema = 'public' and data_type = 'timestamp without time zone' order by 1, 2`,
  "1.4 linhas órfãs (organização apagada por fora)": `
    do $$ declare r record; n bigint; saida text := ''; begin
      for r in select c.conrelid::regclass tabela, a.attname coluna from pg_constraint c
                 join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
                where c.contype = 'f' and c.confrelid = 'public.organizations'::regclass loop
        execute format('select count(*) from %s t where t.%I is not null and not exists (select 1 from public.organizations o where o.id = t.%I)', r.tabela, r.coluna, r.coluna) into n;
        if n > 0 then saida := saida || r.tabela || '.' || r.coluna || '=' || n || ' '; end if;
      end loop;
      perform set_config('auditoria.orfaos', coalesce(nullif(saida, ''), 'nenhuma'), false);
    end $$; select current_setting('auditoria.orfaos') orfaos`,
  "1.5 fuso e configuração do banco": `
    select current_setting('TimeZone') fuso, (select setting from pg_settings where name = 'cron.timezone') fuso_cron,
           pg_size_pretty(pg_database_size(current_database())) tamanho, version()`,
  "2.1 tabelas sem RLS": `
    select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
  "2.2 RLS ligada e nenhuma regra (só service role; conferir se é de propósito)": `
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
       and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) order by 1`,
  "2.3 mais de uma regra permissiva para a mesma tabela e operação": `
    with r as (
      select tablename, unnest(case when cmd = 'ALL' then array['SELECT','INSERT','UPDATE','DELETE'] else array[cmd] end) op, policyname, roles
        from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE')
    select tablename, op, count(*) n, string_agg(policyname, ' | ') regras from r group by 1, 2 having count(*) > 1 order by 1, 2`,
  "2.4 regras que valem para o anon": `
    select tablename, policyname, cmd from pg_policies where schemaname = 'public' and ('anon' = any(roles) or 'public' = any(roles)) order by 1`,
  "2.5 views sem security_invoker (leem com o dono e passam por cima da RLS)": `
    select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v','m')
       and not coalesce(c.reloptions::text ilike '%security_invoker=true%', false)`,
  "2.6 privilégio de tabela para o anon": `
    select table_name, string_agg(privilege_type, ',') from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon' group by 1 order by 1`,
  "2.7 funções security definer executáveis por anon": `
    select p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') order by 1`,
  "2.8 security definer para authenticated que recebe id e não confere quem chama (candidatas a revisão)": `
    select p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('authenticated', p.oid, 'execute')
       and pg_get_function_identity_arguments(p.oid) ~* '(_aluno_id|_organization_id|_org|_alvo|_user_id|_id) uuid'
       and pg_get_functiondef(p.oid) !~* '(auth\\.uid\\(\\)|has_role|is_org_staff|pertence|e_da_equipe|sessao_verificada|eh_gestor|is_member|e_gestor|equipe_metodo|pode_)'
     order by 1`,
  "2.9 funções de gatilho executáveis por anon ou authenticated": `
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`,
  "2.10 funções sem search_path fixo": `
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
  "2.11 buckets do Storage": `
    select id, public, file_size_limit, allowed_mime_types from storage.buckets order by 1`,
  "2.12 regras do Storage": `
    select policyname, cmd, roles from pg_policies where schemaname = 'storage' order by 1`,
  "2.13 sequências sem uso para a service_role": `
    with s as materialized (select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S')
    select relname from s where not has_sequence_privilege('service_role', s.oid, 'usage')`,
  "5.1 rotinas do pg_cron: agenda e últimas 7 dias": `
    select j.jobname, j.schedule, j.active,
           count(d.*) filter (where d.status = 'succeeded') ok, count(d.*) filter (where d.status = 'failed') falhas,
           max(d.start_time) ultima
      from cron.job j left join cron.job_run_details d on d.jobid = j.jobid and d.start_time > now() - interval '7 days'
     group by 1, 2, 3 order by 1`,
};

for (const [nome, consulta] of Object.entries(checagens)) {
  try {
    const linhas = await sql(consulta);
    console.log(`\n### ${nome} — ${linhas.length} linha(s)`);
    for (const l of linhas.slice(0, 80)) console.log("  " + JSON.stringify(l));
    if (linhas.length > 80) console.log(`  … e mais ${linhas.length - 80}`);
  } catch (e) {
    console.log(`\n### ${nome} — ERRO: ${e.message.slice(0, 200)}`);
  }
}

// Conselheiros do Supabase (segurança e desempenho), resumidos.
for (const tipo of ["security", "performance"]) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${P}/advisors/${tipo}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const j = await r.json();
  const resumo = {};
  for (const l of j.lints ?? []) resumo[`${l.level} ${l.name}`] = (resumo[`${l.level} ${l.name}`] ?? 0) + 1;
  console.log(`\n### conselheiro ${tipo}`, JSON.stringify(resumo));
}

// Configuração do Auth (sem segredos: só nomes e limites).
const auth = await (await fetch(`https://api.supabase.com/v1/projects/${P}/config/auth`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const chavesAuth = ["site_url", "uri_allow_list", "password_min_length", "password_required_characters", "mfa_totp_enroll_enabled", "mfa_totp_verify_enabled",
  "rate_limit_email_sent", "rate_limit_otp", "rate_limit_token_refresh", "rate_limit_verify", "rate_limit_anonymous_users", "external_email_enabled",
  "mailer_autoconfirm", "disable_signup", "jwt_exp", "refresh_token_rotation_enabled", "security_refresh_token_reuse_interval", "hook_send_email_enabled",
  "sessions_timebox", "sessions_inactivity_timeout", "security_captcha_enabled", "password_hibp_enabled"];
console.log("\n### configuração do Auth");
for (const k of chavesAuth) console.log(`  ${k}: ${JSON.stringify(auth[k])}`);
