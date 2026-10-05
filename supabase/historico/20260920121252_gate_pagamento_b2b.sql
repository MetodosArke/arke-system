-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

alter table public.cobrancas_b2b
  add column if not exists vencimento date;

comment on column public.cobrancas_b2b.vencimento is
  'Data de vencimento enviada ao Asaas na emissão. Permite avaliar atraso sem depender da entrega do webhook.';

update public.cobrancas_b2b
   set vencimento = created_at::date
 where vencimento is null;

create or replace function public.organizacao_inadimplente_b2b(_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.cobrancas_b2b c
    where c.organization_id = _organization_id
      and c.status <> 'confirmado'
      and (
        c.status = 'atrasado'
        or (c.vencimento is not null and c.vencimento < current_date)
      )
  );
$$;

comment on function public.organizacao_inadimplente_b2b(uuid) is
  'True quando a organização tem cobrança da ARKE emitida e vencida sem confirmação de pagamento.';

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
declare
  v_org uuid;
begin
  if public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke') then
    return;
  end if;

  select om.organization_id into v_org
  from public.organization_members om
  where om.user_id = auth.uid()
    and om.role in ('gestor', 'professor', 'nutricionista')
  limit 1;

  if v_org is null then
    return;
  end if;

  return query
  with vencidas as (
    select c.*
    from public.cobrancas_b2b c
    where c.organization_id = v_org
      and c.status <> 'confirmado'
      and (c.status = 'atrasado' or (c.vencimento is not null and c.vencimento < current_date))
  )
  select
    o.id,
    o.nome,
    (o.status <> 'trial' and exists (select 1 from vencidas)),
    (select count(*) from vencidas),
    coalesce((select sum(v.valor) from vencidas v), 0),
    (select min(v.vencimento) from vencidas v),
    (select v.invoice_url from vencidas v order by v.vencimento nulls last, v.created_at limit 1)
  from public.organizations o
  where o.id = v_org;
end;
$$;
