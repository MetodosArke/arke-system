-- Fases 14 e 15 do roadmap (CLAUDE.md §9, itens 14 e 15) —
-- Benefícios (Wellhub/TotalPass) e integração de catracas.
--
-- Decisão de arquitetura (mudança em relação ao CLAUDE.md §8.3/§8.4
-- original): a Arke não precisa ser parceira oficial da Wellhub/TotalPass
-- nem de nenhum fabricante de catraca. O parceiro real é a academia/studio
-- — cada organização já tem (ou terá) sua própria conta/contrato com essas
-- plataformas e seu próprio equipamento de catraca já instalado. O papel
-- do Arke é apenas guardar as credenciais/identificadores que a própria
-- organização informa no onboarding e usar isso para fazer o vínculo
-- (chamar a API certa em nome daquela organização, ou acionar o adaptador
-- certo para aquela catraca) — nunca uma credencial única e global da
-- Arke compartilhada entre clientes.
--
-- Benefícios são por ORGANIZAÇÃO (convênio comercial da empresa como um
-- todo). Catraca é por UNIDADE, como o CLAUDE.md §4 já previa ("o cadastro
-- da unidade precisa registrar qual marca/modelo já está instalado").
--
-- Nenhuma das duas tabelas abaixo é lida diretamente pelo cliente depois
-- de salva: o backend (service_role) nunca devolve o jsonb de
-- credenciais/config em claro — só indica se está configurado e mostra os
-- campos não sensíveis (ver server/integrations.ts). RLS aqui é defesa em
-- profundidade, restrita a admin/owner da organização (dado tratar de
-- segredos), não a todo o staff.

create table public.saas_benefit_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  provider text not null check (provider in ('wellhub', 'totalpass')),
  enabled boolean not null default true,
  credentials jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create trigger update_saas_benefit_integrations_updated_at
  before update on public.saas_benefit_integrations
  for each row execute function public.update_updated_at_column();

alter table public.saas_benefit_integrations enable row level security;

create policy "Admin da organização gerencia integrações de benefícios"
  on public.saas_benefit_integrations
  for all
  using (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id))
  with check (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

create table public.saas_turnstile_integrations (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.saas_units(id) on delete cascade unique,
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  brand text not null check (brand in ('control_id', 'topdata', 'henry', 'dimep', 'outra')),
  model text,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index saas_turnstile_integrations_org_idx on public.saas_turnstile_integrations (organization_id);

create trigger update_saas_turnstile_integrations_updated_at
  before update on public.saas_turnstile_integrations
  for each row execute function public.update_updated_at_column();

alter table public.saas_turnstile_integrations enable row level security;

create policy "Admin da organização gerencia integração de catraca"
  on public.saas_turnstile_integrations
  for all
  using (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id))
  with check (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));
