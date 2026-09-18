-- Etapa 6, Stage 4: Arquitetura do ARKE® Gateway Local (Catracas e Hardware)
--
-- Cadastro de dispositivos (catracas) por organização e log de acessos
-- validados pela Edge Function catraca-validar-acesso. Segue o padrão
-- multitenant estrito do projeto (organization_id em toda tabela + RLS).

create table public.organizacao_catracas (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome            text not null,
  localizacao     text,
  device_token    uuid not null default gen_random_uuid(),
  status          text not null default 'ativo' check (status in ('ativo', 'inativo')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (device_token)
);

create index idx_organizacao_catracas_org on public.organizacao_catracas(organization_id);

create table public.acessos_catraca_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  catraca_id      uuid not null references public.organizacao_catracas(id) on delete cascade,
  aluno_id        uuid references public.alunos(id) on delete set null,
  cpf_consultado  text,
  resultado       text not null check (resultado in (
    'liberado', 'negado_inadimplente', 'negado_nao_encontrado', 'negado_catraca_inativa'
  )),
  created_at      timestamptz not null default now()
);

create index idx_acessos_catraca_logs_org on public.acessos_catraca_logs(organization_id);
create index idx_acessos_catraca_logs_catraca on public.acessos_catraca_logs(catraca_id);
create index idx_acessos_catraca_logs_created on public.acessos_catraca_logs(created_at desc);

alter table public.organizacao_catracas enable row level security;
alter table public.acessos_catraca_logs enable row level security;

-- Equipe da própria organização (gestor/professor/nutricionista) gerencia
-- os dispositivos da sua academia; admin_arke gerencia todas.
create policy "staff gerencia catracas da propria org"
  on public.organizacao_catracas for all
  to authenticated
  using (public.is_org_staff(auth.uid(), organization_id))
  with check (public.is_org_staff(auth.uid(), organization_id));

create policy "admin_arke gerencia todas as catracas"
  on public.organizacao_catracas for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin_arke'))
  with check (public.has_role(auth.uid(), 'admin_arke'));

-- Log de acessos: leitura pela equipe da própria org; a gravação é feita
-- exclusivamente pela Edge Function catraca-validar-acesso via service_role
-- (que ignora RLS), então não há policy de INSERT para authenticated/anon.
create policy "staff ve logs de acesso da propria org"
  on public.acessos_catraca_logs for select
  to authenticated
  using (public.is_org_staff(auth.uid(), organization_id));

create policy "admin_arke ve todos os logs de acesso"
  on public.acessos_catraca_logs for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin_arke'));
