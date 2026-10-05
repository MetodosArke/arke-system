-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

create or replace function public.escalar_tarefas_vencidas()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tarefas t
  set responsavel_id = (
        select om.user_id
        from public.organization_members om
        where om.organization_id = t.organization_id
          and om.role = 'gestor'
          and om.status = 'active'
        limit 1
      ),
      escalada_em = now()
  where t.status not in ('concluida', 'cancelada')
    and t.sla_prazo < now()
    and t.escalada_em is null
    and exists (
      select 1 from public.organization_members om
      where om.organization_id = t.organization_id
        and om.role = 'gestor'
        and om.status = 'active'
    );
end;
$$;

revoke execute on function public.escalar_tarefas_vencidas() from public, anon, authenticated;
