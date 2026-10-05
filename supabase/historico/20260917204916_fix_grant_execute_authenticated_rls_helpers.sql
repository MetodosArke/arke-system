-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- As policies de RLS chamam essas funções dentro de USING/WITH CHECK,
-- então a role `authenticated` (usada pelo PostgREST/Supabase) PRECISA
-- de EXECUTE nelas, senão toda policy que as usa falha com
-- "permission denied for function" para qualquer usuário autenticado.
-- Mantemos apenas `anon` e `PUBLIC` revogados (nenhuma policy é `to anon`).
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_org_member(uuid, uuid) to authenticated;
grant execute on function public.has_org_role(uuid, uuid, public.app_role) to authenticated;
grant execute on function public.is_org_staff(uuid, uuid) to authenticated;
