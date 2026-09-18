-- criar-organizacao-superadmin precisa vincular um gestor JÁ EXISTENTE no
-- Supabase Auth a uma organização nova (em vez de tentar inviteUserByEmail
-- de novo, que retorna erro para e-mail já cadastrado). auth.users não é
-- exposta via PostgREST, então essa busca por e-mail precisa de uma RPC
-- SECURITY DEFINER — mesmo padrão já usado nas demais funções que leem
-- auth.users (ex.: get_superadmin_tenants, get_superadmin_perfis_simulaveis).
create or replace function public.buscar_user_id_por_email(_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(_email) limit 1;
$$;

-- Só a Edge Function (service_role) pode chamar — não expõe a existência
-- de um e-mail cadastrado para anon/authenticated via RPC direta.
revoke execute on function public.buscar_user_id_por_email(text) from public;
grant execute on function public.buscar_user_id_por_email(text) to service_role;
