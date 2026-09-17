-- =====================================================================
-- ARKE — FASE 3: B.A.S.E.® — Prescrição & Versionamento Imutável
-- =====================================================================

-- -----------------------------------------------------------------
-- 1. Biblioteca relacional de TREINO (editável; não afeta publicados)
-- -----------------------------------------------------------------

create table public.modelo_treino_exercicios (
  id              uuid primary key default gen_random_uuid(),
  modelo_id       uuid not null references public.modelos_treino(id) on delete cascade,
  ordem           int not null default 0,
  nome_exercicio  text not null,
  grupo_muscular  text[] not null default '{}',
  series          int not null default 3,
  repeticoes      text not null default '12',
  descanso_seg    int not null default 60,
  observacoes     text,
  created_at      timestamptz not null default now()
);

create index idx_modelo_treino_exercicios_modelo on public.modelo_treino_exercicios(modelo_id, ordem);

alter table public.modelo_treino_exercicios enable row level security;

create policy "staff da org gerencia exercícios de modelos de treino"
  on public.modelo_treino_exercicios for all to authenticated
  using (
    exists (
      select 1 from public.modelos_treino m
      where m.id = modelo_id
        and (public.is_org_staff(auth.uid(), m.organization_id) or public.has_role(auth.uid(), 'admin_arke'))
    )
  )
  with check (
    exists (
      select 1 from public.modelos_treino m
      where m.id = modelo_id
        and (public.is_org_staff(auth.uid(), m.organization_id) or public.has_role(auth.uid(), 'admin_arke'))
    )
  );

-- modelos_treino.conteudo (jsonb livre da Fase 1) é substituído pela tabela relacional acima
alter table public.modelos_treino drop column if exists conteudo;

-- -----------------------------------------------------------------
-- 2. Biblioteca relacional de DIETA (editável; não afeta publicados)
-- -----------------------------------------------------------------

create table public.modelos_dieta (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  titulo          text not null,
  tipo            text,
  criado_por      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_modelos_dieta_org on public.modelos_dieta(organization_id);

create trigger trg_modelos_dieta_updated_at
  before update on public.modelos_dieta
  for each row execute function public.set_updated_at();

alter table public.modelos_dieta enable row level security;

create policy "staff da org gerencia modelos de dieta"
  on public.modelos_dieta for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create table public.modelo_dieta_refeicoes (
  id                uuid primary key default gen_random_uuid(),
  modelo_id         uuid not null references public.modelos_dieta(id) on delete cascade,
  ordem             int not null default 0,
  nome_refeicao     text not null,
  horario_sugerido  time,
  itens             text,
  created_at        timestamptz not null default now()
);

create index idx_modelo_dieta_refeicoes_modelo on public.modelo_dieta_refeicoes(modelo_id, ordem);

alter table public.modelo_dieta_refeicoes enable row level security;

create policy "staff da org gerencia refeições de modelos de dieta"
  on public.modelo_dieta_refeicoes for all to authenticated
  using (
    exists (
      select 1 from public.modelos_dieta m
      where m.id = modelo_id
        and (public.is_org_staff(auth.uid(), m.organization_id) or public.has_role(auth.uid(), 'admin_arke'))
    )
  )
  with check (
    exists (
      select 1 from public.modelos_dieta m
      where m.id = modelo_id
        and (public.is_org_staff(auth.uid(), m.organization_id) or public.has_role(auth.uid(), 'admin_arke'))
    )
  );

-- -----------------------------------------------------------------
-- 3. Snapshot imutável: renomeia `conteudo` para `snapshot_conteudo`
--    (deixa explícito que é uma cópia congelada, não editável)
-- -----------------------------------------------------------------

alter table public.treinos rename column conteudo to snapshot_conteudo;
alter table public.dietas rename column conteudo to snapshot_conteudo;

-- refaz a trigger de imutabilidade apontando para o novo nome de coluna
create or replace function public.bloquear_edicao_conteudo_publicado()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.snapshot_conteudo is distinct from new.snapshot_conteudo or old.versao_id is distinct from new.versao_id then
    raise exception 'Prescrição publicada é imutável: crie uma nova versão em vez de editar o conteúdo existente.';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------
-- 4. Gate de plano contratado: Essencial não inclui nutrição
-- -----------------------------------------------------------------

create or replace function public.exigir_nivel_para_dieta()
returns trigger language plpgsql set search_path = public as $$
declare
  _nivel public.nivel_atacado;
begin
  select nivel_atacado into _nivel from public.alunos where id = new.aluno_id;
  if _nivel = 'essencial' then
    raise exception 'Plano Essencial não inclui nutrição. Atualize o nível do aluno para Integrado ou Integral antes de publicar uma dieta.';
  end if;
  return new;
end;
$$;

create trigger trg_dietas_exigir_nivel
  before insert on public.dietas
  for each row execute function public.exigir_nivel_para_dieta();

-- -----------------------------------------------------------------
-- 5. Avanço automático de fase da jornada: M.A.P.A.® → B.A.S.E.®
--    ao publicar a primeira prescrição (treino ou dieta) do aluno
-- -----------------------------------------------------------------

create or replace function public.avancar_fase_apos_publicacao()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.alunos set fase_jornada = 'base' where id = new.aluno_id and fase_jornada = 'mapa';
  return new;
end;
$$;

create trigger trg_treinos_avancar_fase
  after insert on public.treinos
  for each row execute function public.avancar_fase_apos_publicacao();

create trigger trg_dietas_avancar_fase
  after insert on public.dietas
  for each row execute function public.avancar_fase_apos_publicacao();

-- -----------------------------------------------------------------
-- 6. Funções de publicação (rodam como invoker: exigem que o
--    chamador já tenha permissão de INSERT em treinos/dietas via RLS)
-- -----------------------------------------------------------------

create or replace function public.publicar_treino(
  _aluno_id uuid,
  _modelo_id uuid,
  _titulo text,
  _validade_inicio date default current_date,
  _validade_fim date default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  _organization_id uuid;
  _snapshot jsonb;
  _treino_id uuid;
begin
  select organization_id into _organization_id from public.alunos where id = _aluno_id;
  if _organization_id is null then
    raise exception 'Aluno não encontrado';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ordem', ordem,
        'nome_exercicio', nome_exercicio,
        'grupo_muscular', grupo_muscular,
        'series', series,
        'repeticoes', repeticoes,
        'descanso_seg', descanso_seg,
        'observacoes', observacoes
      ) order by ordem
    ),
    '[]'::jsonb
  )
  into _snapshot
  from public.modelo_treino_exercicios
  where modelo_id = _modelo_id;

  insert into public.treinos (
    organization_id, aluno_id, modelo_id, titulo, snapshot_conteudo,
    publicado_por, validade_inicio, validade_fim
  )
  values (
    _organization_id, _aluno_id, _modelo_id, _titulo, _snapshot,
    auth.uid(), _validade_inicio, _validade_fim
  )
  returning id into _treino_id;

  return _treino_id;
end;
$$;

create or replace function public.publicar_dieta(
  _aluno_id uuid,
  _modelo_id uuid,
  _titulo text
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  _organization_id uuid;
  _snapshot jsonb;
  _dieta_id uuid;
begin
  select organization_id into _organization_id from public.alunos where id = _aluno_id;
  if _organization_id is null then
    raise exception 'Aluno não encontrado';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ordem', ordem,
        'nome_refeicao', nome_refeicao,
        'horario_sugerido', horario_sugerido,
        'itens', itens
      ) order by ordem
    ),
    '[]'::jsonb
  )
  into _snapshot
  from public.modelo_dieta_refeicoes
  where modelo_id = _modelo_id;

  insert into public.dietas (
    organization_id, aluno_id, titulo, snapshot_conteudo, publicado_por
  )
  values (
    _organization_id, _aluno_id, _titulo, _snapshot, auth.uid()
  )
  returning id into _dieta_id;

  return _dieta_id;
end;
$$;
