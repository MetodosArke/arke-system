-- Sessão B (plano vigente): evolui a integração de catraca de "1 tabela +
-- texto livre" para um fluxo plug-and-play (catálogo marca/modelo +
-- dispositivo com modo de comunicação, status e heartbeat). Esta é a
-- fatia B1 — só modelo de dado; sinalização via Supabase Realtime
-- (testConnection/heartbeat, B2) e a tela plug-and-play (B3) vêm depois.
--
-- Catálogo global (mesmo padrão de public.acervo_* — gerido por
-- admin/super_admin, lido por qualquer usuário autenticado, já que toda
-- organização precisa dele para configurar sua própria unidade).
-- Só semeia "Modelo padrão" por marca: o Arke ainda não tem lista real de
-- modelos por fabricante (CLAUDE.md — nunca fingir um dado que não existe),
-- e o modo de comunicação de cada marca replica exatamente a nota já
-- documentada em server/access.ts (Control iD é a única com nota oficial
-- de notificação em nuvem; as demais são hardware de rede local até
-- confirmação em campo — CLAUDE.md §8.4).

create table public.turnstile_brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.turnstile_models (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.turnstile_brands(id) on delete cascade,
  name text not null,
  communication_modes text[] not null default '{}',
  default_port integer,
  protocol_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, name)
);

alter table public.turnstile_brands enable row level security;
alter table public.turnstile_models enable row level security;

create policy "Qualquer usuário autenticado lê o catálogo de catracas"
  on public.turnstile_brands for select to authenticated using (true);
create policy "Admins gerenciam o catálogo de marcas de catraca"
  on public.turnstile_brands for all
  using (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin'))
  with check (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin'));

create policy "Qualquer usuário autenticado lê o catálogo de modelos de catraca"
  on public.turnstile_models for select to authenticated using (true);
create policy "Admins gerenciam o catálogo de modelos de catraca"
  on public.turnstile_models for all
  using (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin'))
  with check (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin'));

create trigger update_turnstile_brands_updated_at
  before update on public.turnstile_brands for each row execute function public.update_updated_at_column();
create trigger update_turnstile_models_updated_at
  before update on public.turnstile_models for each row execute function public.update_updated_at_column();

insert into public.turnstile_brands (slug, name) values
  ('control_id', 'Control iD'), ('topdata', 'Topdata'), ('henry', 'Henry'), ('dimep', 'Dimep'),
  ('intelbras', 'Intelbras'), ('zkteco', 'ZKTeco'), ('nitgen', 'Nitgen'), ('hikvision', 'Hikvision'),
  ('madis', 'Madis'), ('primme', 'Primme'), ('nedap', 'Nedap'), ('suprema', 'Suprema'), ('outra', 'Outra');

insert into public.turnstile_models (brand_id, name, communication_modes)
select id, 'Modelo padrão', case when slug = 'control_id' then array['cloud_webhook', 'local_agent'] else array['local_agent'] end
from public.turnstile_brands;

-- ============ Evolução de saas_turnstile_integrations → turnstile_devices ============
-- Renomeia (preserva dados, índice, trigger e policy existentes) e adiciona
-- as colunas que o fluxo plug-and-play precisa. `brand`/`model` (texto
-- livre) continuam existindo — model_id é o novo vínculo com o catálogo,
-- mas nenhum dispositivo já cadastrado tem correspondência confiável com
-- um model_id ainda (nenhum modelo real foi confirmado em campo), então
-- fica nullable e a UI passa a preencher os dois a partir daqui.

alter table public.saas_turnstile_integrations rename to turnstile_devices;

alter table public.turnstile_devices
  add column model_id uuid references public.turnstile_models(id) on delete set null,
  add column communication_mode text check (communication_mode in ('cloud_webhook', 'local_agent')),
  add column port integer,
  add column serial_or_key text,
  add column status text not null default 'unknown' check (status in ('online', 'offline', 'unknown')),
  add column last_ping_at timestamptz;
