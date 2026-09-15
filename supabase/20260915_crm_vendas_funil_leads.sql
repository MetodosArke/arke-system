-- Fase 12 (CRM de vendas): funil de leads, follow-up automatizado e
-- fechamento (conversão de lead em membro ativo).
-- CLAUDE.md seção 4: módulo "CRM de vendas (diferencial)" — funil de
-- leads, follow-up e fechamento de novos membros; conversão de lead em
-- membro ativo.
-- CLAUDE.md seção 6: prioridade/estágio sem falsa precisão — categorias
-- explicáveis de estágio do funil, sem nota numérica de propensão à
-- compra; nunca duplicar tarefa aberta.
--
-- Fechamento reaproveita member_invitations (Fase 3): converter um lead
-- não cria um cadastro de aluno paralelo, gera o convite oficial já
-- existente. Follow-up automatizado reaproveita o motor de automação
-- (cron diário) da Fase 7, no mesmo padrão de "sem_checkin".

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  nome text not null,
  telefone text,
  email text,
  origem text,
  estagio text not null default 'novo' check (estagio in ('novo', 'contato_feito', 'visita_agendada', 'matriculado', 'perdido')),
  responsavel_id uuid references auth.users(id) on delete set null,
  notas text,
  motivo_perda text,
  member_invitation_id uuid references public.member_invitations(id) on delete set null,
  convertido_em timestamptz,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_org_estagio_idx on public.leads (organization_id, estagio);
create index leads_org_created_idx on public.leads (organization_id, created_at desc);

create trigger update_leads_updated_at
  before update on public.leads
  for each row execute function public.update_updated_at_column();

alter table public.leads enable row level security;

create policy "Staff manages leads da própria organização"
  on public.leads
  for all
  using (saas_is_org_staff(organization_id))
  with check (saas_is_org_staff(organization_id));

-- lead_atividades: histórico de contato (nota manual) e tarefa de
-- follow-up automático quando o lead fica tempo demais sem contato no
-- mesmo estágio. tipo='nota' já nasce concluída (é um registro do
-- contato que já foi feito); tipo='follow_up_automatico' nasce aberta
-- até alguém agir.
create table public.lead_atividades (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  tipo text not null check (tipo in ('nota', 'follow_up_automatico')),
  descricao text,
  status text not null default 'concluida' check (status in ('aberta', 'concluida')),
  responsavel_id uuid references auth.users(id) on delete set null,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index lead_atividades_lead_idx on public.lead_atividades (lead_id, created_at desc);
create index lead_atividades_org_idx on public.lead_atividades (organization_id, created_at desc);

-- "Nunca duplicar tarefa aberta" (CLAUDE.md §6): no máximo um follow-up
-- automático aberto por lead ao mesmo tempo.
create unique index lead_atividades_follow_up_aberto_idx on public.lead_atividades (lead_id) where tipo = 'follow_up_automatico' and status = 'aberta';

alter table public.lead_atividades enable row level security;

create policy "Staff manages lead_atividades da própria organização"
  on public.lead_atividades
  for all
  using (saas_is_org_staff(organization_id))
  with check (saas_is_org_staff(organization_id));
