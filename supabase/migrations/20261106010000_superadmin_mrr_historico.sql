-- Histórico de MRR/ARR e receita para a Visão Master.
--
-- Contexto importante: o MRR de hoje (get_superadmin_overview) é um
-- retrato do CONTRATADO — soma das assinaturas/matrículas com status
-- 'ativa' neste instante. Esse número NÃO é reconstruível para o passado,
-- porque aluno_assinaturas e aluno_matriculas_academia guardam só o status
-- atual, sem histórico de quando entrou/saiu. Por isso duas séries
-- complementares:
--   1) Receita REALIZADA por mês — vem das transações reais (pagamentos,
--      mensalidades, cobrancas_b2b) e já existe retroativamente.
--   2) MRR CONTRATADO por mês — exige snapshot diário, que passa a ser
--      capturado daqui pra frente.

-- ---------------------------------------------------------------------
-- 1) Snapshot diário do MRR contratado
-- ---------------------------------------------------------------------
create table if not exists public.metricas_mrr_snapshot (
  data date primary key,
  mrr_arke numeric not null default 0,
  mrr_academia numeric not null default 0,
  mrr_global numeric not null default 0,
  arr_global numeric not null default 0,
  assinaturas_ativas integer not null default 0,
  matriculas_ativas integer not null default 0,
  academias_ativas integer not null default 0,
  alunos_total integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.metricas_mrr_snapshot enable row level security;

drop policy if exists "superadmin lê snapshots de MRR" on public.metricas_mrr_snapshot;
create policy "superadmin lê snapshots de MRR"
  on public.metricas_mrr_snapshot for select
  using (has_role((select auth.uid()), 'superadmin'::app_role));
-- Sem policy de escrita de propósito: quem grava é capturar_snapshot_mrr(),
-- SECURITY DEFINER chamada pelo cron — nenhum cliente escreve aqui.

-- ---------------------------------------------------------------------
-- 2) Captura do snapshot (idempotente por dia)
-- ---------------------------------------------------------------------
create or replace function public.capturar_snapshot_mrr()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mrr_arke numeric;
  v_mrr_academia numeric;
  v_assinaturas integer;
  v_matriculas integer;
begin
  -- Mesmas fórmulas de get_superadmin_overview, para as duas séries
  -- baterem quando comparadas lado a lado.
  select coalesce(sum(valor_cobrado), 0), count(*)
    into v_mrr_arke, v_assinaturas
    from public.aluno_assinaturas
   where status = 'ativa';

  select coalesce(sum(
           case p.periodicidade
             when 'mensal' then m.valor_cobrado
             when 'trimestral' then m.valor_cobrado / 3
             when 'semestral' then m.valor_cobrado / 6
             when 'anual' then m.valor_cobrado / 12
           end
         ), 0), count(*)
    into v_mrr_academia, v_matriculas
    from public.aluno_matriculas_academia m
    join public.planos_academia p on p.id = m.plano_id
   where m.status = 'ativa';

  insert into public.metricas_mrr_snapshot (
    data, mrr_arke, mrr_academia, mrr_global, arr_global,
    assinaturas_ativas, matriculas_ativas, academias_ativas, alunos_total
  )
  values (
    current_date,
    v_mrr_arke,
    v_mrr_academia,
    v_mrr_arke + v_mrr_academia,
    (v_mrr_arke + v_mrr_academia) * 12,
    v_assinaturas,
    v_matriculas,
    (select count(*) from public.organizations where status = 'ativo'),
    (select count(*) from public.alunos)
  )
  on conflict (data) do update set
    mrr_arke = excluded.mrr_arke,
    mrr_academia = excluded.mrr_academia,
    mrr_global = excluded.mrr_global,
    arr_global = excluded.arr_global,
    assinaturas_ativas = excluded.assinaturas_ativas,
    matriculas_ativas = excluded.matriculas_ativas,
    academias_ativas = excluded.academias_ativas,
    alunos_total = excluded.alunos_total,
    created_at = now();
end;
$$;

-- Escrita de métricas não é operação de cliente: só o cron (postgres)
-- chama. Sem isso, a função ficaria exposta em /rest/v1/rpc para qualquer
-- usuário logado.
revoke all on function public.capturar_snapshot_mrr() from public;
revoke all on function public.capturar_snapshot_mrr() from anon;
revoke all on function public.capturar_snapshot_mrr() from authenticated;

-- ---------------------------------------------------------------------
-- 3) Data de pagamento da cobrança B2B
-- ---------------------------------------------------------------------
-- cobrancas_b2b só tinha created_at (emissão). Sem a data de liquidação, a
-- receita B2B cairia no mês da emissão, não no mês em que entrou de fato.
-- Preenchida pela edge function asaas-webhook ao confirmar a cobrança.
alter table public.cobrancas_b2b
  add column if not exists data_pagamento date;

-- ---------------------------------------------------------------------
-- 4) Série histórica consolidada
-- ---------------------------------------------------------------------
create or replace function public.get_superadmin_receita_historica(_meses integer default 12)
returns table (
  mes date,
  receita_metodo_arke numeric,
  receita_mensalidades numeric,
  receita_b2b numeric,
  receita_total numeric,
  repasse_arke numeric,
  mrr_contratado numeric,
  arr_contratado numeric
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
           )::date as mes
  ),
  pag as (
    select date_trunc('month', data_pagamento)::date as mes,
           sum(valor) as bruto,
           sum(coalesce(valor_repasse_arke, 0)) as repasse
      from public.pagamentos
     where status = 'confirmado' and data_pagamento is not null
     group by 1
  ),
  mens as (
    select date_trunc('month', data_pagamento)::date as mes,
           sum(valor) as bruto,
           sum(coalesce(valor_repasse_arke, 0)) as repasse
      from public.mensalidades
     where status = 'confirmado' and data_pagamento is not null
     group by 1
  ),
  b2b as (
    -- Cobrança B2B é a ARKE cobrando a academia: o valor inteiro é receita
    -- da ARKE, por isso entra também no repasse.
    select date_trunc('month', coalesce(data_pagamento, created_at::date))::date as mes,
           sum(valor) as bruto
      from public.cobrancas_b2b
     where status = 'confirmado'
     group by 1
  ),
  snap as (
    -- Último snapshot de cada mês representa o MRR contratado do mês.
    select distinct on (date_trunc('month', data))
           date_trunc('month', data)::date as mes,
           mrr_global,
           arr_global
      from public.metricas_mrr_snapshot
     order by date_trunc('month', data), data desc
  )
  select
    m.mes,
    coalesce(p.bruto, 0)::numeric,
    coalesce(mn.bruto, 0)::numeric,
    coalesce(b.bruto, 0)::numeric,
    (coalesce(p.bruto, 0) + coalesce(mn.bruto, 0) + coalesce(b.bruto, 0))::numeric,
    (coalesce(p.repasse, 0) + coalesce(mn.repasse, 0) + coalesce(b.bruto, 0))::numeric,
    s.mrr_global,
    s.arr_global
  from meses m
  left join pag p on p.mes = m.mes
  left join mens mn on mn.mes = m.mes
  left join b2b b on b.mes = m.mes
  left join snap s on s.mes = m.mes
  order by m.mes;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) Agendamento diário + primeiro ponto
-- ---------------------------------------------------------------------
-- Guardado pela presença do pg_cron para não quebrar ambientes locais que
-- não tenham a extensão instalada.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'snapshot-mrr-diario') then
      perform cron.unschedule('snapshot-mrr-diario');
    end if;
    -- 03:05 UTC = 00:05 em Brasília.
    perform cron.schedule(
      'snapshot-mrr-diario',
      '5 3 * * *',
      $cron$select public.capturar_snapshot_mrr();$cron$
    );
  end if;
end $$;

-- Primeiro ponto da série, para o gráfico não nascer vazio.
select public.capturar_snapshot_mrr();
