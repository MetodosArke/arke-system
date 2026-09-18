-- =====================================================================
-- CORREÇÃO CRÍTICA: nenhuma tabela/view do schema public tinha GRANT de
-- privilégios (SELECT/INSERT/UPDATE/DELETE) para as roles `authenticated`
-- e `service_role` — só as policies de RLS existiam. No Postgres, o
-- privilégio de tabela é checado ANTES da RLS: sem o GRANT, toda query via
-- PostgREST (role `authenticated`) ou via Edge Function (role
-- `service_role`) falha com "permission denied for table X", mesmo que a
-- policy de RLS permitisse a linha.
--
-- Isso explica, por exemplo, o app sempre cair na visão do aluno mesmo
-- para admin_arke: a query a `user_roles`/`organization_members` no
-- AuthContext falhava silenciosamente (o cliente Supabase trata o erro
-- como "sem dados"), então `roles` ficava vazio e o redirecionamento por
-- papel nunca via o admin_arke.
--
-- `service_role` tem `rolbypassrls = true` (pula a checagem de RLS), mas
-- ainda precisa do GRANT de tabela para operar — por isso também estava
-- quebrado nas Edge Functions (asaas-webhook, asaas-create-subscription).
--
-- RLS continua sendo a camada real de autorização por linha; os GRANTs
-- abaixo apenas destravam o acesso à tabela em si, como o Postgres exige.
-- `anon` permanece sem nenhum GRANT: toda leitura de dado de negócio
-- exige autenticação.
-- =====================================================================

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
