-- Painel de negócio ArkeFit (Sessão C, terceira fatia) — agenda interna
-- da própria equipe Arke para acompanhar implantações/onboarding de
-- clientes e atividades de gestão do negócio. `organization_id` é
-- opcional (nem todo compromisso é sobre um cliente específico).
--
-- Nunca lida por nenhuma organização cliente: só o backend (service_role,
-- atrás de adminProcedure) acessa esta tabela. RLS habilitada sem
-- política nenhuma — mesmo padrão de defesa em profundidade já usado por
-- outras tabelas internas do projeto (app_invitations, asaas_webhook_events).
create table public.arke_internal_appointments (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.saas_organizations(id) on delete set null,
  tipo text not null default 'outro' check (tipo in ('onboarding', 'implantacao', 'acompanhamento', 'outro')),
  titulo text not null,
  descricao text,
  scheduled_at timestamptz not null,
  duracao_minutos integer not null default 30,
  status text not null default 'agendado' check (status in ('agendado', 'concluido', 'cancelado')),
  criado_por uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index arke_internal_appointments_scheduled_idx on public.arke_internal_appointments (scheduled_at);
create index arke_internal_appointments_org_idx on public.arke_internal_appointments (organization_id);

create trigger update_arke_internal_appointments_updated_at
  before update on public.arke_internal_appointments
  for each row execute function public.update_updated_at_column();

alter table public.arke_internal_appointments enable row level security;
