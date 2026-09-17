-- =====================================================================
-- ARKE — FASE 5: A.P.E.X.®/L.E.G.A.D.O.® — Gestão Comercial,
-- Markup & Split de Pagamento (Asaas)
-- =====================================================================

create type public.assinatura_status as enum ('ativa', 'atrasada', 'cancelada');
create type public.pagamento_status as enum ('pendente', 'confirmado', 'atrasado', 'estornado');

-- -----------------------------------------------------------------
-- 1. Assinaturas do aluno (vínculo com a cobrança recorrente no Asaas)
-- -----------------------------------------------------------------

create table public.aluno_assinaturas (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  aluno_id              uuid not null references public.alunos(id) on delete cascade,
  nivel_atacado         public.nivel_atacado not null,
  valor_cobrado         numeric(10,2) not null,
  status                public.assinatura_status not null default 'ativa',
  asaas_subscription_id text unique,
  proxima_cobranca      date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (aluno_id)
);

create index idx_aluno_assinaturas_org on public.aluno_assinaturas(organization_id);

create trigger trg_aluno_assinaturas_updated_at
  before update on public.aluno_assinaturas
  for each row execute function public.set_updated_at();

alter table public.aluno_assinaturas enable row level security;

create policy "staff da org vê/gerencia assinaturas dos seus alunos"
  on public.aluno_assinaturas for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

-- -----------------------------------------------------------------
-- 2. Pagamentos (com split: repasse ARKE vs. líquido da academia)
-- -----------------------------------------------------------------

create table public.pagamentos (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  aluno_assinatura_id    uuid not null references public.aluno_assinaturas(id) on delete cascade,
  valor                  numeric(10,2) not null,
  valor_repasse_arke     numeric(10,2) not null default 0,
  valor_liquido_academia numeric(10,2) not null default 0,
  status                 public.pagamento_status not null default 'pendente',
  asaas_payment_id       text unique,
  data_pagamento         date,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index idx_pagamentos_org on public.pagamentos(organization_id);
create index idx_pagamentos_assinatura on public.pagamentos(aluno_assinatura_id);

create trigger trg_pagamentos_updated_at
  before update on public.pagamentos
  for each row execute function public.set_updated_at();

alter table public.pagamentos enable row level security;

create policy "staff da org vê/gerencia pagamentos da própria organização"
  on public.pagamentos for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

-- -----------------------------------------------------------------
-- 3. Log/auditoria de webhooks do Asaas (idempotência)
--    Sem policies: só a service_role (usada pela Edge Function) acessa.
--    RLS habilitado nega por padrão para anon/authenticated.
-- -----------------------------------------------------------------

create table public.asaas_webhook_events (
  id               uuid primary key default gen_random_uuid(),
  asaas_event_id   text unique,
  asaas_payment_id text,
  tipo_evento      text,
  payload          jsonb not null,
  processado       boolean not null default false,
  erro             text,
  created_at       timestamptz not null default now(),
  processed_at     timestamptz
);

create index idx_asaas_webhook_events_payment on public.asaas_webhook_events(asaas_payment_id);

alter table public.asaas_webhook_events enable row level security;

-- -----------------------------------------------------------------
-- 4. View de métricas de retenção/churn por organização
--    security_invoker: respeita o RLS das tabelas de origem para quem consulta
-- -----------------------------------------------------------------

create view public.org_churn_metrics
with (security_invoker = true)
as
select
  o.id as organization_id,
  o.nome as organization_nome,
  (select count(*) from public.alunos a where a.organization_id = o.id) as alunos_total,
  (select count(*) from public.alunos a where a.organization_id = o.id and a.fase_jornada = 'mapa') as alunos_fase_mapa,
  (select count(*) from public.alunos a where a.organization_id = o.id and a.fase_jornada = 'base') as alunos_fase_base,
  (select count(*) from public.alunos a where a.organization_id = o.id and a.fase_jornada = 'rota') as alunos_fase_rota,
  (select count(*) from public.alunos a where a.organization_id = o.id and a.fase_jornada = 'apex') as alunos_fase_apex,
  (select count(*) from public.alunos a where a.organization_id = o.id and a.fase_jornada = 'legado') as alunos_fase_legado,
  (select count(*) from public.aluno_assinaturas s where s.organization_id = o.id and s.status = 'ativa') as assinaturas_ativas,
  (select count(*) from public.aluno_assinaturas s where s.organization_id = o.id and s.status = 'cancelada' and s.updated_at >= date_trunc('month', now())) as cancelamentos_mes_atual,
  (
    select coalesce(round(
      count(distinct rt.aluno_id)::numeric / nullif(count(distinct t.aluno_id), 0) * 100, 1
    ), 0)
    from public.treinos t
    left join public.registro_treino rt
      on rt.aluno_id = t.aluno_id and rt.data >= current_date - 7
    where t.status = 'ativo' and t.organization_id = o.id
  ) as constancia_pct_7d
from public.organizations o;
