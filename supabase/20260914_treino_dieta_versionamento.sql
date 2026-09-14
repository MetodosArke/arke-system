-- Fase 4 (Entrega profissional, CLAUDE.md §4 "Prescrição" e §9 item 4):
-- "Modelos, edição, revisão, publicação" / "Treino e plano alimentar
-- versionados". Design combinado com o cliente antes de codar (ver
-- discussão da sessão): estado de publicação e estado de uso são eixos
-- diferentes e não devem virar a mesma coluna (mesmo princípio do §6 —
-- "nunca juntar tudo numa nota só") — por isso `estado_publicacao` é nova,
-- separada do `status` (ativo/inativo/concluido) que já existe.
--
-- O aluno só enxerga a versão publicada (rascunho fica invisível até o
-- profissional publicar). Cada publicação grava um snapshot imutável em
-- treino_revisoes/dieta_revisoes — histórico completo de quem mudou o quê
-- e quando, sem reescrever o caminho de leitura atual (treinos/dietas
-- continuam sendo a mesma linha "corrente" que o aluno já lê hoje).
--
-- Escopo desta migration: só o schema/RLS. A lógica de publicar (montar o
-- snapshot, incrementar a versão) é responsabilidade da próxima etapa,
-- quando a tela de profissional for construída.

alter table public.treinos
  add column if not exists estado_publicacao text not null default 'rascunho'
    check (estado_publicacao in ('rascunho', 'publicado', 'arquivado')),
  add column if not exists versao int not null default 1,
  add column if not exists publicado_por uuid references auth.users(id) on delete set null,
  add column if not exists publicado_em timestamptz;

alter table public.dietas
  add column if not exists estado_publicacao text not null default 'rascunho'
    check (estado_publicacao in ('rascunho', 'publicado', 'arquivado')),
  add column if not exists versao int not null default 1,
  add column if not exists publicado_por uuid references auth.users(id) on delete set null,
  add column if not exists publicado_em timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create trigger update_dietas_updated_at
  before update on public.dietas
  for each row execute function public.update_updated_at_column();

create table public.treino_revisoes (
  id uuid primary key default gen_random_uuid(),
  treino_id uuid not null references public.treinos(id) on delete cascade,
  versao int not null,
  conteudo jsonb not null,
  autor_id uuid references auth.users(id) on delete set null,
  organization_id uuid references public.saas_organizations(id) on delete set null,
  publicado_em timestamptz not null default now(),
  unique (treino_id, versao)
);

create table public.dieta_revisoes (
  id uuid primary key default gen_random_uuid(),
  dieta_id uuid not null references public.dietas(id) on delete cascade,
  versao int not null,
  conteudo jsonb not null,
  autor_id uuid references auth.users(id) on delete set null,
  organization_id uuid references public.saas_organizations(id) on delete set null,
  publicado_em timestamptz not null default now(),
  unique (dieta_id, versao)
);

alter table public.treino_revisoes enable row level security;
alter table public.dieta_revisoes enable row level security;

create policy "Admin manages treino_revisoes"
  on public.treino_revisoes for all
  to authenticated
  using (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin'));

create policy "Staff reads treino_revisoes da própria organização"
  on public.treino_revisoes for select
  to authenticated
  using (organization_id is not null and public.saas_is_org_staff(organization_id));

create policy "Admin manages dieta_revisoes"
  on public.dieta_revisoes for all
  to authenticated
  using (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin'));

create policy "Staff reads dieta_revisoes da própria organização"
  on public.dieta_revisoes for select
  to authenticated
  using (organization_id is not null and public.saas_is_org_staff(organization_id));

-- Aluno só enxerga a versão publicada; rascunho/arquivado ficam
-- invisíveis para ele (admin/super_admin continuam vendo tudo).
drop policy if exists "Aluno reads own treinos" on public.treinos;
create policy "Aluno reads own treinos"
  on public.treinos for select
  to authenticated
  using (
    (aluno_id = auth.uid() and estado_publicacao = 'publicado')
    or private.has_role(auth.uid(), 'admin')
    or private.has_role(auth.uid(), 'super_admin')
  );

drop policy if exists "Aluno reads own dietas" on public.dietas;
create policy "Aluno reads own dietas"
  on public.dietas for select
  to authenticated
  using (
    (aluno_id = auth.uid() and estado_publicacao = 'publicado')
    or private.has_role(auth.uid(), 'admin')
    or private.has_role(auth.uid(), 'super_admin')
  );
