-- MIGRAÇÃO — passo 1, no projeto NOVO, antes de restaurar o schema.
--
-- Deixa o `public` vazio e cria o que o dump não cria.
--
-- Por que zerar o `public`: a restauração precisa começar do nada. Metade
-- restaurada sobre metade antiga é o pior estado possível — não dá erro, dá
-- comportamento errado depois. Isto só é seguro num projeto ainda sem nada;
-- confira antes com a consulta do fim do arquivo.
--
-- Por que as extensões vêm antes: um projeto Supabase novo já traz pgcrypto,
-- uuid-ossp e o Vault, mas NÃO traz pg_cron nem pg_net. As duas se registram no
-- schema `public`, então precisam ser criadas depois de ele existir e antes de
-- qualquer coisa que dependa delas. Cada uma cria o próprio schema de uso
-- (`cron` e `net`), que é de onde as chamadas saem.

-- 1) Confirme que o destino está vazio. Se isto devolver mais que zero, PARE.
select count(*) as tabelas_ja_existentes
  from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE';

-- 2) Zera o schema.
drop schema if exists public cascade;
create schema public;
alter schema public owner to postgres;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

-- 3) Extensões.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 4) Confere antes de seguir. As cinco precisam aparecer, e `net.http_post`
-- precisa existir — é dela que dependem as três rotinas que chamam edge
-- function.
select extname, extversion from pg_extension
 where extname in ('pg_cron','pg_net','pgcrypto','uuid-ossp','supabase_vault')
 order by extname;

select count(*) as tem_http_post
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'net' and p.proname = 'http_post';
