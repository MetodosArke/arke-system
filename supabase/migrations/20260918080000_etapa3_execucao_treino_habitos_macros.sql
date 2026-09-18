-- =====================================================================
-- ARKE — ETAPA 3: App do Aluno & Jornada M.A.P.A.®
--
-- 1. Vídeo de execução por exercício (biblioteca + snapshot publicado).
-- 2. Execução granular do treino do dia: checklist por exercício com
--    série concluída + carga utilizada (registro_treino.detalhes_execucao).
-- 3. Diário de hábitos: água ingerida e refeições marcadas no dia.
-- 4. Macronutrientes por refeição (biblioteca + snapshot publicado), para
--    o aluno ver a contagem do dia.
-- =====================================================================

alter table public.modelo_treino_exercicios
  add column video_url text;

alter table public.modelo_dieta_refeicoes
  add column calorias_kcal numeric,
  add column proteinas_g numeric,
  add column carboidratos_g numeric,
  add column gorduras_g numeric;

alter table public.registro_treino
  add column detalhes_execucao jsonb not null default '[]'::jsonb;

-- -----------------------------------------------------------------
-- Diário de hábitos (água + refeições marcadas no dia)
-- -----------------------------------------------------------------

create table public.registro_habito (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  data            date not null default current_date,
  agua_ml         int not null default 0,
  refeicoes_concluidas int[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (aluno_id, data)
);

create index idx_registro_habito_org on public.registro_habito(organization_id);

alter table public.registro_habito enable row level security;

create policy "aluno gerencia o próprio diário de hábitos"
  on public.registro_habito for all to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

create policy "staff da org vê diário de hábitos dos seus alunos"
  on public.registro_habito for select to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create trigger trg_registro_habito_updated_at
  before update on public.registro_habito
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------
-- Snapshot de publicação: inclui video_url (treino) e macros (dieta)
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
        'observacoes', observacoes,
        'video_url', video_url
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
        'itens', itens,
        'calorias_kcal', calorias_kcal,
        'proteinas_g', proteinas_g,
        'carboidratos_g', carboidratos_g,
        'gorduras_g', gorduras_g
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
