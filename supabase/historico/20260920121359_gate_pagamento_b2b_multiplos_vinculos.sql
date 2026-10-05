-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

create or replace function public.get_bloqueio_organizacao()
returns table (
  organization_id uuid,
  organizacao_nome text,
  bloqueada boolean,
  cobrancas_vencidas bigint,
  valor_em_aberto numeric,
  vencimento_mais_antigo date,
  invoice_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke') then
    return;
  end if;

  return query
  with orgs_equipe as (
    select o.id, o.nome, o.status
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.user_id = auth.uid()
      and om.status = 'active'
      and om.role in ('gestor', 'professor', 'nutricionista')
  ),
  vencidas as (
    select c.organization_id,
           count(*) as qtd,
           sum(c.valor) as valor,
           min(c.vencimento) as venc,
           (array_agg(c.invoice_url order by c.vencimento nulls last, c.created_at))[1] as link
    from public.cobrancas_b2b c
    join orgs_equipe oe on oe.id = c.organization_id
    where c.status <> 'confirmado'
      and (c.status = 'atrasado' or (c.vencimento is not null and c.vencimento < current_date))
    group by c.organization_id
  ),
  avaliadas as (
    select oe.id, oe.nome,
      (oe.status <> 'trial' and v.organization_id is not null) as bloqueada,
      coalesce(v.qtd, 0) as qtd,
      coalesce(v.valor, 0) as valor,
      v.venc, v.link
    from orgs_equipe oe
    left join vencidas v on v.organization_id = oe.id
  )
  select a.id, a.nome, a.bloqueada, a.qtd, a.valor, a.venc, a.link
  from avaliadas a
  -- Quem é equipe em mais de uma academia: a bloqueada manda. Sem isto,
  -- um `limit 1` arbitrário deixaria passar quem é gestor de uma unidade
  -- inadimplente só porque também tem vínculo com outra em dia.
  order by a.bloqueada desc, a.venc asc nulls last
  limit 1;
end;
$$;
