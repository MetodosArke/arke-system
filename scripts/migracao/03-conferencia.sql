-- MIGRAÇÃO — passo 3: conferência. Rode o MESMO arquivo nos dois projetos e
-- compare as saídas. Divergência aqui é migração incompleta.
--
-- A conferência é por contagem e por nome, não por "parece que subiu": 88
-- tabelas, 136 funções e 232 regras de RLS não se conferem de olho, e o jeito
-- de uma restauração falhar é parcialmente — um erro no meio do arquivo, o
-- psql segue, e o que faltou só aparece quando um gestor clica no botão.

\echo '=== contagens ==='
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE')                      as tabelas,
  (select count(*) from information_schema.views where table_schema='public')     as views,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public')                                                     as funcoes,
  (select count(*) from pg_policies where schemaname='public')                    as regras_rls,
  (select count(*) from pg_policies where schemaname='storage')                   as regras_storage,
  (select count(*) from pg_trigger where not tgisinternal)                        as gatilhos,
  (select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typtype='e')                                   as enums,
  (select count(*) from storage.buckets)                                          as buckets,
  (select count(*) from cron.job)                                                 as rotinas,
  (select count(*) from vault.secrets)                                            as segredos_vault;

\echo '=== tabelas sem RLS ligado (deve vir vazio) ==='
select c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
 order by 1;

\echo '=== tabelas do public sem organization_id (regra 1 do projeto) ==='
-- Nem toda tabela precisa ter: as globais da ArkeFit (planos, listas de apoio,
-- configuração) são de propósito. A lista serve para comparar entre os dois
-- projetos, não para dar zero.
select t.table_name
  from information_schema.tables t
 where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
   and not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = t.table_name
        and c.column_name in ('organization_id','academia_id')
   )
 order by 1;

\echo '=== mais de uma regra permissiva na mesma tabela e operação (deve vir vazio) ==='
select schemaname, tablename, cmd, count(*) as regras
  from pg_policies
 where schemaname in ('public','storage') and permissive = 'PERMISSIVE'
 group by schemaname, tablename, cmd, roles
having count(*) > 1
 order by 1, 2, 3;

\echo '=== rotinas agendadas ==='
select jobname, schedule, active,
       command like '%http_post%' as chama_edge_function,
       substring(command from 'https://([a-z]+)\.supabase\.co') as projeto_na_url
  from cron.job
 order by jobname;

\echo '=== buckets ==='
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

\echo '=== segredos do Vault (nome só; o valor não sai daqui) ==='
select name, description from vault.secrets order by name;

\echo '=== extensões ==='
select extname, extversion from pg_extension order by extname;
