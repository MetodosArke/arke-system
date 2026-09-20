-- Funil de conversão dos tenants (trial -> ativo -> cancelado).
--
-- Mesma limitação do MRR: organizations guarda só o status ATUAL, sem
-- histórico de transições. Então:
--   1) A análise de COORTE (safra de entrada x status de hoje) é calculável
--      retroativamente lendo organizations direto — funciona já.
--   2) As TRANSIÇÕES reais (quando um trial virou ativo, quando um ativo
--      cancelou) passam a ser gravadas por trigger daqui pra frente.

-- ---------------------------------------------------------------------
-- 1) Histórico de status
-- ---------------------------------------------------------------------
create table if not exists public.organizacao_status_historico (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- status_anterior nulo = registro de ENTRADA (não é uma transição).
  -- É assim que a consulta separa "entrou" de "mudou de status".
  status_anterior org_status,
  status_novo org_status not null,
  plano_b2b plano_b2b,
  alterado_por uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_org_status_hist_org
  on public.organizacao_status_historico (organization_id, created_at desc);
create index if not exists idx_org_status_hist_data
  on public.organizacao_status_historico (created_at);

alter table public.organizacao_status_historico enable row level security;

drop policy if exists "superadmin lê histórico de status" on public.organizacao_status_historico;
create policy "superadmin lê histórico de status"
  on public.organizacao_status_historico for select
  using (has_role((select auth.uid()), 'superadmin'::app_role));
-- Sem policy de escrita: quem grava é o trigger SECURITY DEFINER.

-- ---------------------------------------------------------------------
-- 2) Trigger que registra entrada e transições
-- ---------------------------------------------------------------------
create or replace function public.registrar_status_organizacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.organizacao_status_historico
      (organization_id, status_anterior, status_novo, plano_b2b, alterado_por)
    values (new.id, null, new.status, new.plano_b2b, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.organizacao_status_historico
      (organization_id, status_anterior, status_novo, plano_b2b, alterado_por)
    values (new.id, old.status, new.status, new.plano_b2b, auth.uid());
  end if;
  return null;
end;
$$;

-- Função de trigger não é endpoint: sem o revoke ela apareceria em
-- /rest/v1/rpc como as trg_comissao_* legadas.
revoke all on function public.registrar_status_organizacao() from public;
revoke all on function public.registrar_status_organizacao() from anon;
revoke all on function public.registrar_status_organizacao() from authenticated;

drop trigger if exists trg_organizations_status_historico on public.organizations;
create trigger trg_organizations_status_historico
  after insert or update of status on public.organizations
  for each row execute function public.registrar_status_organizacao();

-- Backfill: registra o status conhecido hoje como a ENTRADA de cada
-- organização já existente, datada da criação dela. Para quem já mudou de
-- status antes deste trigger existir, essa transição se perdeu de verdade
-- — não dá pra reconstruir, então não se inventa: fica só o registro do
-- primeiro status que a plataforma consegue afirmar.
insert into public.organizacao_status_historico
  (organization_id, status_anterior, status_novo, plano_b2b, alterado_por, created_at)
select o.id, null, o.status, o.plano_b2b, null, o.created_at
from public.organizations o
where not exists (
  select 1 from public.organizacao_status_historico h
  where h.organization_id = o.id
);

-- ---------------------------------------------------------------------
-- 3) Coorte de conversão por safra de entrada
-- ---------------------------------------------------------------------
create or replace function public.get_superadmin_funil_conversao(_meses integer default 12)
returns table (
  safra date,
  total_entradas bigint,
  em_trial bigint,
  ativos bigint,
  inadimplentes bigint,
  suspensos bigint,
  cancelados bigint,
  taxa_conversao_pct numeric,
  taxa_churn_pct numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_meses integer := least(greatest(coalesce(_meses, 12), 1), 36);
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.';
  end if;

  return query
  with meses as (
    select generate_series(
             date_trunc('month', current_date) - make_interval(months => v_meses - 1),
             date_trunc('month', current_date),
             interval '1 month'
           )::date as safra
  ),
  orgs as (
    select date_trunc('month', created_at)::date as safra, status
      from public.organizations
  )
  select
    m.safra,
    -- count(o.status) e não count(*): no LEFT JOIN sem match, count(*)
    -- contaria a linha nula e todo mês vazio viraria "1 entrada".
    count(o.status) as total_entradas,
    count(*) filter (where o.status = 'trial') as em_trial,
    count(*) filter (where o.status = 'ativo') as ativos,
    count(*) filter (where o.status = 'inadimplente') as inadimplentes,
    count(*) filter (where o.status = 'suspenso') as suspensos,
    count(*) filter (where o.status = 'cancelado') as cancelados,
    case when count(o.status) > 0
      then round(count(*) filter (where o.status = 'ativo')::numeric / count(o.status) * 100, 1)
      else 0 end as taxa_conversao_pct,
    case when count(o.status) > 0
      then round(count(*) filter (where o.status = 'cancelado')::numeric / count(o.status) * 100, 1)
      else 0 end as taxa_churn_pct
  from meses m
  left join orgs o on o.safra = m.safra
  group by m.safra
  order by m.safra;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Sinais de vazamento (estado de agora, acionável)
-- ---------------------------------------------------------------------
create or replace function public.get_superadmin_funil_sinais()
returns table (
  trials_total bigint,
  trials_sem_prazo bigint,
  trials_vencidos bigint,
  inadimplentes bigint,
  suspensos bigint,
  transicoes_30d bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.';
  end if;

  return query
  select
    (select count(*) from public.organizations where status = 'trial'),
    -- Trial sem data limite não vence, não cobra e não gera nenhuma
    -- pendência: fica parado até alguém lembrar dele na mão.
    (select count(*) from public.organizations
      where status = 'trial' and trial_vencimento is null),
    (select count(*) from public.organizations
      where status = 'trial' and trial_vencimento is not null
        and trial_vencimento < current_date),
    (select count(*) from public.organizations where status = 'inadimplente'),
    (select count(*) from public.organizations where status = 'suspenso'),
    (select count(*) from public.organizacao_status_historico
      where status_anterior is not null
        and created_at >= now() - interval '30 days');
end;
$$;
