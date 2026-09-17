-- =====================================================================
-- CORREÇÃO: `UPDATE ... FROM LATERAL` não pode referenciar a própria
-- tabela alvo (t) dentro da subquery LATERAL no Postgres — erro
-- "invalid reference to FROM-clause entry for table t". Reescrito com
-- subquery correlacionada diretamente no SET, com um EXISTS de guarda
-- para nunca limpar `responsavel_id` quando a organização não tiver
-- nenhum gestor ativo.
-- =====================================================================

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
