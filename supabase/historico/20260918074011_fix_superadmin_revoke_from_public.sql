-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

revoke execute on function public.get_superadmin_overview() from public;
revoke execute on function public.get_superadmin_tenants() from public;
grant execute on function public.get_superadmin_overview() to authenticated;
grant execute on function public.get_superadmin_tenants() to authenticated;
