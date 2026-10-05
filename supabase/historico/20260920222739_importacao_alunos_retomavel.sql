-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

create table if not exists public.importacoes_alunos (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  criado_por       uuid,
  arquivo_nome     text,
  total_linhas     integer not null,
  status           text not null default 'em_andamento'
                   check (status in ('em_andamento', 'concluida', 'cancelada')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_importacoes_alunos_org
  on public.importacoes_alunos (organization_id, created_at desc);

create table if not exists public.importacoes_alunos_linhas (
  id               uuid primary key default gen_random_uuid(),
  importacao_id    uuid not null references public.importacoes_alunos(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  numero           integer not null,
  dados            jsonb not null,
  status           text not null default 'pendente'
                   check (status in ('pendente', 'sucesso', 'erro')),
  mensagem         text,
  user_id_criado   uuid,
  processado_em    timestamptz
);

create unique index if not exists idx_importacoes_linhas_unica
  on public.importacoes_alunos_linhas (importacao_id, numero);

create index if not exists idx_importacoes_linhas_pendentes
  on public.importacoes_alunos_linhas (importacao_id, status)
  where status = 'pendente';

alter table public.importacoes_alunos enable row level security;
alter table public.importacoes_alunos_linhas enable row level security;

drop policy if exists "staff da org gerencia as próprias importações" on public.importacoes_alunos;
create policy "staff da org gerencia as próprias importações"
  on public.importacoes_alunos for all to authenticated
  using (
    public.is_org_staff(( select auth.uid() ), organization_id)
    or public.has_role(( select auth.uid() ), 'admin_arke')
    or public.has_role(( select auth.uid() ), 'superadmin')
  )
  with check (
    public.is_org_staff(( select auth.uid() ), organization_id)
    or public.has_role(( select auth.uid() ), 'admin_arke')
    or public.has_role(( select auth.uid() ), 'superadmin')
  );

drop policy if exists "staff da org gerencia as linhas das próprias importações" on public.importacoes_alunos_linhas;
create policy "staff da org gerencia as linhas das próprias importações"
  on public.importacoes_alunos_linhas for all to authenticated
  using (
    public.is_org_staff(( select auth.uid() ), organization_id)
    or public.has_role(( select auth.uid() ), 'admin_arke')
    or public.has_role(( select auth.uid() ), 'superadmin')
  )
  with check (
    public.is_org_staff(( select auth.uid() ), organization_id)
    or public.has_role(( select auth.uid() ), 'admin_arke')
    or public.has_role(( select auth.uid() ), 'superadmin')
  );

drop trigger if exists trg_importacoes_alunos_updated_at on public.importacoes_alunos;
create trigger trg_importacoes_alunos_updated_at
  before update on public.importacoes_alunos
  for each row execute function public.set_updated_at();
