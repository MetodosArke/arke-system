-- Cadastro direto de alunos + importação de dados na implantação de um
-- cliente novo (ver runbook de implantação e o desenho de importação
-- discutido com o cliente).
--
-- Correção de modelo pedida explicitamente pelo cliente: hoje um aluno só
-- "existe" (linha em profiles) depois de aceitar convite e criar conta —
-- não existe cadastro sem login (ver 20260915_jornada_inicial_convite_membro.sql
-- e o comentário em 20260915_crm_vendas_funil_leads.sql: "converter um lead
-- não cria um cadastro de aluno paralelo, gera o convite oficial já
-- existente"). O cliente quer o oposto: cadastro sempre existe na hora
-- (manual ou importado); convite para o app vira uma ação opcional e
-- separada, usada como estratégia comercial — não é mais o que dá
-- existência à pessoa no sistema.
--
-- `alunos` passa a ser a fonte de verdade do cadastro administrativo
-- (nome, CPF, telefone, unidade, plano, valor mensal), independente de
-- login. `member_invitations` (convite para o app) passa a apontar para
-- um `alunos` já existente em vez de carregar nome/e-mail direto — ver
-- ajuste em inviteMember/acceptMemberInvitation no server. Tudo que só
-- faz sentido com uso do app (check-in, frequência, atendimentos, reserva
-- de turma, perfil do Módulo Arke) continua preso a auth.users/profiles,
-- sem mudança — só passa a existir se/quando o aluno aceitar o convite.

create table public.org_membership_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  nome text not null,
  valor_mensal numeric not null check (valor_mensal >= 0),
  periodicidade text not null default 'mensal' check (periodicidade in ('mensal', 'trimestral', 'semestral', 'anual')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, nome)
);

create trigger update_org_membership_plans_updated_at
  before update on public.org_membership_plans
  for each row execute function public.update_updated_at_column();

alter table public.org_membership_plans enable row level security;

create policy "Staff manages org_membership_plans da própria organização"
  on public.org_membership_plans
  for all
  using (saas_is_org_staff(organization_id))
  with check (saas_is_org_staff(organization_id));

create table public.alunos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  unit_id uuid references public.saas_units(id) on delete set null,
  plano_id uuid references public.org_membership_plans(id) on delete set null,
  nome text not null,
  cpf text,
  email text,
  telefone text,
  data_nascimento date,
  responsavel_nome text,
  responsavel_cpf text,
  valor_mensal numeric,
  dia_vencimento integer check (dia_vencimento is null or (dia_vencimento >= 1 and dia_vencimento <= 31)),
  status text not null default 'ativo' check (status in ('ativo', 'inativo', 'trancado')),
  origem text not null default 'manual' check (origem in ('manual', 'importado')),
  auth_user_id uuid references auth.users(id) on delete set null,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index alunos_org_status_idx on public.alunos (organization_id, status);
create index alunos_org_created_idx on public.alunos (organization_id, created_at desc);
create unique index alunos_org_cpf_idx on public.alunos (organization_id, cpf) where cpf is not null;
create unique index alunos_org_email_idx on public.alunos (organization_id, email) where email is not null;

create trigger update_alunos_updated_at
  before update on public.alunos
  for each row execute function public.update_updated_at_column();

alter table public.alunos enable row level security;

create policy "Staff manages alunos da própria organização"
  on public.alunos
  for all
  using (saas_is_org_staff(organization_id))
  with check (saas_is_org_staff(organization_id));

-- O convite deixa de ser o que cria a pessoa: passa a apontar para um
-- cadastro já existente em `alunos`. Tabela nasceu vazia em produção
-- (rows: 0) — seguro tornar a coluna obrigatória na mesma migração.
alter table public.member_invitations add column aluno_id uuid references public.alunos(id) on delete cascade;
alter table public.member_invitations alter column aluno_id set not null;

-- Plano e financeiro pertencem ao cadastro administrativo, existam ou não
-- login — hoje aluno_id nessas tabelas não tinha FK declarada (tabelas
-- vazias em produção), então isso só adiciona a garantia que faltava.
alter table public.aluno_pagamento add constraint aluno_pagamento_aluno_id_fkey foreign key (aluno_id) references public.alunos(id) on delete cascade;
alter table public.pagamento_historico add constraint pagamento_historico_aluno_id_fkey foreign key (aluno_id) references public.alunos(id) on delete cascade;

-- Importação em lote (unidades, planos, alunos, profissionais, leads,
-- turmas) na implantação de um cliente novo. Guarda só contagens e um
-- resumo de erros por linha (campo + motivo) — nunca o conteúdo bruto da
-- linha, para não duplicar PII fora das tabelas de destino.
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  entity text not null check (entity in ('unidades', 'planos', 'alunos', 'profissionais', 'leads', 'turmas')),
  file_name text not null,
  status text not null default 'previewed' check (status in ('previewed', 'committed', 'failed')),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  error_rows integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  uploaded_by uuid not null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create index import_batches_org_created_idx on public.import_batches (organization_id, created_at desc);

alter table public.import_batches enable row level security;

create policy "Staff manages import_batches da própria organização"
  on public.import_batches
  for all
  using (saas_is_org_staff(organization_id))
  with check (saas_is_org_staff(organization_id));
