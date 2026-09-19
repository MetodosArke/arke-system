-- =====================================================================
-- Operação nativa da academia (independente do Método ARKE): plano
-- próprio que a academia vende ao aluno (mensal/trimestral/semestral/
-- anual, valor livre), matrícula do aluno nesse plano com cobrança
-- recorrente automática via Asaas — mesmo mecanismo de assinatura já
-- usado pra adesão ao Método ARKE (asaas-create-subscription), mas
-- aqui o split manda 100% do valor pra wallet da academia (sem
-- repasse à ARKE, que só existe no produto do Método).
--
-- As duas coisas continuam independentes: um aluno pode estar com a
-- mensalidade da academia em dia e nunca ter aderido ao Método ARKE,
-- ou vice-versa.
-- =====================================================================

create type public.periodicidade_plano_academia as enum ('mensal', 'trimestral', 'semestral', 'anual');
create type public.status_matricula_academia as enum ('ativa', 'pausada', 'cancelada');
create type public.status_mensalidade as enum ('pendente', 'confirmado', 'atrasado', 'estornado', 'cancelado');
create type public.forma_pagamento_mensalidade as enum ('dinheiro', 'pix', 'cartao', 'boleto', 'transferencia', 'outro');

create table public.planos_academia (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome            text not null,
  periodicidade   public.periodicidade_plano_academia not null,
  valor           numeric(10,2) not null check (valor >= 0),
  descricao       text,
  ativo           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_planos_academia_organization_id on public.planos_academia(organization_id);

create table public.aluno_matriculas_academia (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  aluno_id              uuid not null references public.alunos(id) on delete cascade,
  plano_id              uuid not null references public.planos_academia(id) on delete restrict,
  valor_cobrado         numeric(10,2) not null check (valor_cobrado >= 0), -- snapshot no momento da matrícula (permite desconto pontual sem alterar o plano)
  data_inicio           date not null default current_date,
  dia_vencimento        integer not null check (dia_vencimento between 1 and 28), -- 28 evita cair fora do mês em fevereiro
  status                public.status_matricula_academia not null default 'ativa',
  asaas_customer_id     text,
  asaas_subscription_id text,
  registrado_por        uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_aluno_matriculas_academia_organization_id on public.aluno_matriculas_academia(organization_id);
create index idx_aluno_matriculas_academia_aluno_id on public.aluno_matriculas_academia(aluno_id);
create index idx_aluno_matriculas_academia_plano_id on public.aluno_matriculas_academia(plano_id);
create index idx_aluno_matriculas_academia_registrado_por on public.aluno_matriculas_academia(registrado_por);
create unique index idx_aluno_matriculas_academia_asaas_subscription on public.aluno_matriculas_academia(asaas_subscription_id) where asaas_subscription_id is not null;
-- só uma matrícula ativa por aluno ao mesmo tempo — pausar/cancelar a
-- anterior antes de criar outra.
create unique index uq_aluno_matricula_academia_ativa on public.aluno_matriculas_academia(aluno_id) where status = 'ativa';

create table public.mensalidades (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  matricula_id    uuid not null references public.aluno_matriculas_academia(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  competencia     date not null, -- sempre dia 1 do mês de referência (derivado do dueDate do Asaas)
  valor           numeric(10,2) not null check (valor >= 0),
  vencimento      date not null,
  status          public.status_mensalidade not null default 'pendente',
  forma_pagamento public.forma_pagamento_mensalidade,
  data_pagamento  date,
  asaas_payment_id text,
  invoice_url     text,
  observacao      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (matricula_id, competencia)
);

create unique index idx_mensalidades_asaas_payment_id on public.mensalidades(asaas_payment_id) where asaas_payment_id is not null;
create index idx_mensalidades_organization_id on public.mensalidades(organization_id);
create index idx_mensalidades_matricula_id on public.mensalidades(matricula_id);
create index idx_mensalidades_aluno_id on public.mensalidades(aluno_id);
create index idx_mensalidades_status_vencimento on public.mensalidades(organization_id, status, vencimento);

create trigger trg_planos_academia_updated_at
  before update on public.planos_academia
  for each row execute function public.set_updated_at();

create trigger trg_aluno_matriculas_academia_updated_at
  before update on public.aluno_matriculas_academia
  for each row execute function public.set_updated_at();

create trigger trg_mensalidades_updated_at
  before update on public.mensalidades
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------
alter table public.planos_academia enable row level security;
alter table public.aluno_matriculas_academia enable row level security;
alter table public.mensalidades enable row level security;

create policy "staff da org gerencia planos_academia"
  on public.planos_academia for all
  to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id))
  with check (public.is_org_staff((select auth.uid()), organization_id));

create policy "aluno vê os planos da própria organização"
  on public.planos_academia for select
  to authenticated
  using (public.is_org_member((select auth.uid()), organization_id));

create policy "staff da org gerencia matrículas"
  on public.aluno_matriculas_academia for all
  to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id))
  with check (public.is_org_staff((select auth.uid()), organization_id));

create policy "aluno vê a própria matrícula"
  on public.aluno_matriculas_academia for select
  to authenticated
  using (aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid())));

create policy "staff da org gerencia mensalidades"
  on public.mensalidades for all
  to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id))
  with check (public.is_org_staff((select auth.uid()), organization_id));

create policy "aluno vê as próprias mensalidades"
  on public.mensalidades for select
  to authenticated
  using (aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid())));

-- -----------------------------------------------------------------
-- Abre tarefa de cobrança pro staff quando uma mensalidade fica
-- atrasada — chamada pelo asaas-webhook (evento PAYMENT_OVERDUE),
-- não por polling. Idempotente via origem_evento (mesmo padrão do
-- motor de automações).
-- -----------------------------------------------------------------
create or replace function public.abrir_tarefa_mensalidade_atrasada(_mensalidade_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
  select
    men.organization_id,
    men.aluno_id,
    'Mensalidade da academia atrasada (venceu em ' || to_char(men.vencimento, 'DD/MM/YYYY') || ')',
    'alta',
    now() + interval '24 hours',
    'mensalidade_atrasada:' || men.id::text,
    'cobranca'
  from public.mensalidades men
  where men.id = _mensalidade_id
  on conflict (organization_id, origem_evento) do nothing;
end;
$$;

-- revoke de "public" (não só anon/authenticated): EXECUTE em função nova
-- é concedido a PUBLIC por padrão no Postgres, e PUBLIC inclui todo mundo
-- (inclusive anon/authenticated) — revogar só dos dois não bastava aqui.
revoke execute on function public.abrir_tarefa_mensalidade_atrasada(uuid) from public;
