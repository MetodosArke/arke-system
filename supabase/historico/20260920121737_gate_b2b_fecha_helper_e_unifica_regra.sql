-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- A função é regra de negócio interna, não endpoint: aceita qualquer
-- organization_id e responder por REST deixaria qualquer um consultar a
-- situação financeira de qualquer academia.
revoke all on function public.organizacao_inadimplente_b2b(uuid) from public, anon, authenticated;
grant execute on function public.organizacao_inadimplente_b2b(uuid) to service_role;

-- A decisão de bloquear passa a ter uma origem só: o gate chama a função em
-- vez de repetir o predicado. O CTE abaixo continua existindo, mas só para
-- montar os números exibidos (quantas, quanto, vencimento, link) — se ele
-- divergir da regra, o pior que acontece é um detalhe impreciso na tela, não
-- alguém bloqueado ou liberado por engano.
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
  detalhe as (
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
      (oe.status <> 'trial' and public.organizacao_inadimplente_b2b(oe.id)) as bloqueada,
      coalesce(d.qtd, 0) as qtd,
      coalesce(d.valor, 0) as valor,
      d.venc, d.link
    from orgs_equipe oe
    left join detalhe d on d.organization_id = oe.id
  )
  select a.id, a.nome, a.bloqueada, a.qtd, a.valor, a.venc, a.link
  from avaliadas a
  order by a.bloqueada desc, a.venc asc nulls last
  limit 1;
end;
$$;
