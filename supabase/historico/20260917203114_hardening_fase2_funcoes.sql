-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

revoke execute on function public.gerar_tarefas_ativacao_pendente() from anon, authenticated;
revoke execute on function public.has_role(uuid, public.app_role) from anon, authenticated;
revoke execute on function public.is_org_member(uuid, uuid) from anon, authenticated;
revoke execute on function public.has_org_role(uuid, uuid, public.app_role) from anon, authenticated;
revoke execute on function public.is_org_staff(uuid, uuid) from anon, authenticated;
