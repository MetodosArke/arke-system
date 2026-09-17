-- =====================================================================
-- ARKE — SCRIPT SQL UNIFICADO DE FUNDAÇÃO (Fase 1)
-- Multitenant estrito + Auth/RLS por Tenant + Motor de Automações
--   + Versionamento Imutável + Tabela de Atacado/Markup
-- =====================================================================
-- PRÉ-REQUISITO: rodar em um schema public vazio
--   DROP SCHEMA public CASCADE;
--   CREATE SCHEMA public;
--   GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
-- 1. ENUMS
-- =====================================================================

create type public.app_role as enum (
  'admin_arke',      -- staff da plataforma ARKE (multi-tenant, cross-org)
  'gestor',          -- gestor da unidade/academia
  'professor',
  'nutricionista',
  'aluno'
);

create type public.org_status as enum ('trial', 'ativo', 'inadimplente', 'suspenso', 'cancelado');

create type public.plano_b2b as enum ('starter', 'growth', 'enterprise', 'custom');

create type public.nivel_atacado as enum ('essencial', 'integrado', 'integral');

create type public.tarefa_status as enum ('aberta', 'em_andamento', 'aguardando', 'concluida', 'cancelada');

create type public.tarefa_prioridade as enum ('baixa', 'media', 'alta', 'critica');

create type public.checkin_status as enum ('funcionando_bem', 'preciso_ajuste', 'com_dificuldade', 'quero_falar_com_alguem');

-- =====================================================================
-- 2. NÚCLEO MULTITENANT: organizations, organization_members, profiles, user_roles
-- =====================================================================

create table public.organizations (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  slug             text not null unique,
  plano_b2b        public.plano_b2b not null default 'starter',
  status           public.org_status not null default 'trial',
  limite_alunos    integer not null default 150,
  markup_padrao_pct numeric(6,2) not null default 0, -- markup padrão aplicado sobre custo de atacado
  asaas_wallet_id  text, -- referência para split automático de pagamento
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- perfil global do usuário (1:1 com auth.users, independente de organização)
create table public.profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  full_name    text not null default '',
  avatar_url   text,
  phone        text,
  status       text not null default 'active' check (status in ('active', 'pending', 'inactive')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- papéis GLOBAIS de plataforma (ex.: admin_arke). Papéis por tenant vivem em organization_members.
create table public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

-- vínculo do usuário com uma organização + papel dentro dela
create table public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            public.app_role not null default 'aluno',
  status          text not null default 'active' check (status in ('active', 'pending', 'inactive')),
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index idx_org_members_org on public.organization_members(organization_id);
create index idx_org_members_user on public.organization_members(user_id);

-- =====================================================================
-- 3. FUNÇÕES DE APOIO (security definer, evitam recursão em RLS)
-- =====================================================================

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

create or replace function public.is_org_member(_user_id uuid, _organization_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where user_id = _user_id
      and organization_id = _organization_id
      and status = 'active'
  )
$$;

create or replace function public.has_org_role(_user_id uuid, _organization_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where user_id = _user_id
      and organization_id = _organization_id
      and role = _role
      and status = 'active'
  )
$$;

create or replace function public.is_org_staff(_user_id uuid, _organization_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where user_id = _user_id
      and organization_id = _organization_id
      and role in ('gestor', 'professor', 'nutricionista')
      and status = 'active'
  )
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- 4. TABELA DE ATACADO ARKE (catálogo global) + MARKUP POR ORGANIZAÇÃO
-- =====================================================================

create table public.planos_atacado (
  id             public.nivel_atacado primary key,
  nome           text not null,
  custo_mensal   numeric(10,2) not null,
  descricao      text
);

insert into public.planos_atacado (id, nome, custo_mensal, descricao) values
  ('essencial', 'Essencial (Treino ARKE)', 15.00, 'Onboarding M.A.P.A., treino individualizado, registro de dificuldades e evolução'),
  ('integrado', 'Integrado (Treino + Nutrição)', 45.00, 'Essencial + plano alimentar individualizado, acompanhamento nutricional e revisão integrada'),
  ('integral',  'Integral (Acompanhamento 360°)', 85.00, 'Integrado + acolhimento expandido, jornada de hábitos, encontros periódicos e acompanhamento humano proativo');

-- markup/preço de varejo definido pela academia, por nível de atacado
create table public.organization_planos_precificacao (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nivel_atacado   public.nivel_atacado not null references public.planos_atacado(id),
  markup_pct      numeric(6,2) not null default 0,
  valor_varejo    numeric(10,2) not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, nivel_atacado)
);

-- =====================================================================
-- 5. ALUNOS (por tenant)
-- =====================================================================

create table public.alunos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  nivel_atacado   public.nivel_atacado not null default 'essencial',
  objetivo        text,
  observacoes     text,
  data_inicio     date default current_date,
  data_nascimento date,
  altura_cm       numeric,
  peso_kg         numeric,
  meta_semanal_dias integer not null default 3,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index idx_alunos_org on public.alunos(organization_id);

-- =====================================================================
-- 6. PRESCRIÇÕES COM VERSIONAMENTO IMUTÁVEL (treinos e dietas)
-- =====================================================================

-- biblioteca global de modelos (editável; alterar aqui NÃO afeta planos já publicados)
create table public.modelos_treino (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  titulo          text not null,
  conteudo        jsonb not null default '{}'::jsonb,
  criado_por      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- prescrição publicada para um aluno: snapshot imutável (versao_id trava o conteúdo)
create table public.treinos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  modelo_id       uuid references public.modelos_treino(id) on delete set null,
  versao_id       uuid not null default gen_random_uuid(), -- snapshot imutável desta publicação
  titulo          text not null,
  conteudo        jsonb not null default '{}'::jsonb, -- cópia congelada no momento da publicação
  status          text not null default 'ativo' check (status in ('ativo', 'inativo', 'concluido')),
  publicado_por   uuid references auth.users(id) on delete set null,
  validade_inicio date default current_date,
  validade_fim    date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_treinos_org on public.treinos(organization_id);
create index idx_treinos_aluno on public.treinos(aluno_id);

create table public.dietas (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  versao_id       uuid not null default gen_random_uuid(),
  titulo          text not null,
  conteudo        jsonb not null default '{}'::jsonb,
  arquivo_url     text,
  status          text not null default 'ativo' check (status in ('ativo', 'inativo', 'concluido')),
  publicado_por   uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_dietas_org on public.dietas(organization_id);
create index idx_dietas_aluno on public.dietas(aluno_id);

-- trigger: bloqueia UPDATE de conteúdo/versao_id em prescrições já publicadas (imutabilidade)
create or replace function public.bloquear_edicao_conteudo_publicado()
returns trigger language plpgsql as $$
begin
  if old.conteudo is distinct from new.conteudo or old.versao_id is distinct from new.versao_id then
    raise exception 'Prescrição publicada é imutável: crie uma nova versão em vez de editar o conteúdo existente.';
  end if;
  return new;
end;
$$;

create trigger trg_treinos_imutavel
  before update on public.treinos
  for each row execute function public.bloquear_edicao_conteudo_publicado();

create trigger trg_dietas_imutavel
  before update on public.dietas
  for each row execute function public.bloquear_edicao_conteudo_publicado();

-- =====================================================================
-- 7. CHECK-INS (R.O.T.A.®) — perguntas construtivas, sem penalização
-- =====================================================================

create table public.checkins (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  status          public.checkin_status not null,
  comentario      text,
  created_at      timestamptz not null default now()
);

create index idx_checkins_org on public.checkins(organization_id);
create index idx_checkins_aluno on public.checkins(aluno_id);

-- =====================================================================
-- 8. MOTOR DE AUTOMAÇÕES — tarefas com SLA, prioridade e desfecho obrigatório
-- =====================================================================

create table public.tarefas (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  aluno_id          uuid references public.alunos(id) on delete cascade,
  responsavel_id    uuid references auth.users(id) on delete set null,
  motivo            text not null,               -- Motivo
  prioridade        public.tarefa_prioridade not null default 'media',
  status             public.tarefa_status not null default 'aberta',
  sla_prazo         timestamptz not null,          -- Prazo
  acao              text,                          -- Ação tomada
  desfecho_acao     text,                          -- Desfecho (obrigatório para encerrar)
  proxima_checagem  timestamptz,                   -- Próxima Checagem
  origem_evento     text not null,                 -- chave de idempotência (ex.: 'primeiro_acesso_48h:<aluno_id>')
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, origem_evento)           -- anti-duplicação/idempotência
);

create index idx_tarefas_org on public.tarefas(organization_id);
create index idx_tarefas_status on public.tarefas(organization_id, status);
create index idx_tarefas_responsavel on public.tarefas(responsavel_id);

-- encerramento só é permitido com desfecho_acao preenchido (Ciclo Completo de Atendimento)
create or replace function public.exigir_desfecho_ao_concluir()
returns trigger language plpgsql as $$
begin
  if new.status in ('concluida', 'cancelada')
     and old.status not in ('concluida', 'cancelada')
     and (new.desfecho_acao is null or btrim(new.desfecho_acao) = '') then
    raise exception 'Não é possível encerrar uma tarefa sem registrar o desfecho_acao.';
  end if;
  return new;
end;
$$;

create trigger trg_tarefas_desfecho
  before update on public.tarefas
  for each row execute function public.exigir_desfecho_ao_concluir();

create trigger trg_tarefas_updated_at
  before update on public.tarefas
  for each row execute function public.set_updated_at();

create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_alunos_updated_at
  before update on public.alunos
  for each row execute function public.set_updated_at();

-- =====================================================================
-- 9. ROW LEVEL SECURITY
-- =====================================================================

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.organization_members enable row level security;
alter table public.planos_atacado enable row level security;
alter table public.organization_planos_precificacao enable row level security;
alter table public.alunos enable row level security;
alter table public.modelos_treino enable row level security;
alter table public.treinos enable row level security;
alter table public.dietas enable row level security;
alter table public.checkins enable row level security;
alter table public.tarefas enable row level security;

-- organizations: admin_arke vê tudo; membros veem a própria organização
create policy "admin_arke vê todas as organizações"
  on public.organizations for select to authenticated
  using (public.has_role(auth.uid(), 'admin_arke'));

create policy "membros veem a própria organização"
  on public.organizations for select to authenticated
  using (public.is_org_member(auth.uid(), id));

create policy "admin_arke gerencia organizações"
  on public.organizations for all to authenticated
  using (public.has_role(auth.uid(), 'admin_arke'))
  with check (public.has_role(auth.uid(), 'admin_arke'));

create policy "gestor atualiza a própria organização"
  on public.organizations for update to authenticated
  using (public.has_org_role(auth.uid(), id, 'gestor'))
  with check (public.has_org_role(auth.uid(), id, 'gestor'));

-- profiles: cada usuário vê/edita o próprio perfil
create policy "usuário gerencia o próprio perfil"
  on public.profiles for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "admin_arke vê todos os perfis"
  on public.profiles for select to authenticated
  using (public.has_role(auth.uid(), 'admin_arke'));

-- user_roles: somente admin_arke gerencia papéis globais
create policy "admin_arke gerencia user_roles"
  on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(), 'admin_arke'))
  with check (public.has_role(auth.uid(), 'admin_arke'));

create policy "usuário vê os próprios papéis globais"
  on public.user_roles for select to authenticated
  using (user_id = auth.uid());

-- organization_members: membros veem colegas da própria org; gestor gerencia
create policy "membros veem membros da própria organização"
  on public.organization_members for select to authenticated
  using (public.is_org_member(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create policy "gestor gerencia membros da própria organização"
  on public.organization_members for all to authenticated
  using (public.has_org_role(auth.uid(), organization_id, 'gestor') or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.has_org_role(auth.uid(), organization_id, 'gestor') or public.has_role(auth.uid(), 'admin_arke'));

-- planos_atacado: catálogo global, leitura para autenticados, escrita só admin_arke
create policy "leitura pública autenticada do catálogo de atacado"
  on public.planos_atacado for select to authenticated
  using (true);

create policy "admin_arke gerencia catálogo de atacado"
  on public.planos_atacado for all to authenticated
  using (public.has_role(auth.uid(), 'admin_arke'))
  with check (public.has_role(auth.uid(), 'admin_arke'));

-- organization_planos_precificacao: por tenant
create policy "org vê a própria precificação"
  on public.organization_planos_precificacao for select to authenticated
  using (public.is_org_member(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create policy "gestor define a própria precificação (markup)"
  on public.organization_planos_precificacao for all to authenticated
  using (public.has_org_role(auth.uid(), organization_id, 'gestor') or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.has_org_role(auth.uid(), organization_id, 'gestor') or public.has_role(auth.uid(), 'admin_arke'));

-- template genérico de policies por tenant para tabelas de negócio ------
-- alunos
create policy "staff da org vê/gerencia alunos"
  on public.alunos for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create policy "aluno vê o próprio cadastro"
  on public.alunos for select to authenticated
  using (user_id = auth.uid());

-- modelos_treino (biblioteca global editável por org)
create policy "staff da org gerencia modelos de treino"
  on public.modelos_treino for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

-- treinos (prescrição publicada)
create policy "staff da org gerencia treinos"
  on public.treinos for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create policy "aluno vê os próprios treinos"
  on public.treinos for select to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

-- dietas
create policy "staff da org gerencia dietas"
  on public.dietas for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create policy "aluno vê as próprias dietas"
  on public.dietas for select to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

-- checkins
create policy "aluno registra e vê os próprios checkins"
  on public.checkins for all to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

create policy "staff da org vê checkins dos seus alunos"
  on public.checkins for select to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

-- tarefas (fila de atendimento)
create policy "staff da org gerencia tarefas"
  on public.tarefas for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

-- =====================================================================
-- FIM DO SCRIPT DE FUNDAÇÃO
-- =====================================================================
