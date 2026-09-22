-- Rodada 2 dos ajustes do sócio: acervo de exercícios e prescrição, trazendo a
-- estrutura do app original (C:\Users\andre\arke-original, fora do repo) para o
-- esquema multitenant atual.

-- 1) Listas de apoio, como no original: grupos musculares e equipamentos.
-- Globais (valem para todas as academias) e mantidas pela ArkeFit. A lista de
-- grupos junta a atual (7, usada pelos 105 exercícios) com a do original,
-- sem os genéricos que ela já cobre ("Pernas", "Abdômen"). A escolha final é
-- decisão de conteúdo (D7) — por isso tabela, e não CHECK.
create table if not exists public.grupos_musculares (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  ordem      integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.equipamentos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  ordem      integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.grupos_musculares (nome, ordem) values
  ('Peito', 1), ('Costas', 2), ('Ombros', 3), ('Braços', 4), ('Bíceps', 5), ('Tríceps', 6),
  ('Antebraços', 7), ('Core', 8), ('Quadríceps', 9), ('Isquiotibiais', 10), ('Glúteos', 11),
  ('Panturrilha', 12), ('Cardio', 13)
on conflict (nome) do nothing;

insert into public.equipamentos (nome, ordem) values
  ('Barra', 1), ('Halteres', 2), ('Máquina', 3), ('Peso Corporal', 4), ('Elástico', 5),
  ('Cabo', 6), ('Kettlebell', 7), ('TRX', 8), ('Bola', 9), ('Step', 10)
on conflict (nome) do nothing;

alter table public.grupos_musculares enable row level security;
alter table public.equipamentos enable row level security;

create policy leitura on public.grupos_musculares for select to authenticated using (true);
create policy "inclusão" on public.grupos_musculares for insert to authenticated
  with check (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
create policy "alteração" on public.grupos_musculares for update to authenticated
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
create policy "exclusão" on public.grupos_musculares for delete to authenticated
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));

create policy leitura on public.equipamentos for select to authenticated using (true);
create policy "inclusão" on public.equipamentos for insert to authenticated
  with check (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
create policy "alteração" on public.equipamentos for update to authenticated
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
create policy "exclusão" on public.equipamentos for delete to authenticated
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));

comment on table public.grupos_musculares is 'Lista global de grupos musculares do acervo (mantida pela ArkeFit). Tabela de plataforma, sem organization_id.';
comment on table public.equipamentos is 'Lista global de equipamentos do acervo (mantida pela ArkeFit). Tabela de plataforma, sem organization_id.';

-- 2) Exercício com vários grupos musculares e equipamento, como no original.
-- `grupo_muscular` continua existindo como o grupo principal (= o primeiro da
-- lista), porque as fichas já publicadas e o De-Para leem ele.
alter table public.exercicios_biblioteca
  add column if not exists grupos_musculares text[] not null default '{}',
  add column if not exists equipamento text references public.equipamentos(nome) on update cascade on delete set null;

update public.exercicios_biblioteca
   set grupos_musculares = array[grupo_muscular]
 where grupo_muscular is not null and cardinality(grupos_musculares) = 0;

alter table public.exercicios_biblioteca drop constraint if exists exercicios_biblioteca_grupo_muscular_check;

create index if not exists idx_exercicios_biblioteca_equipamento on public.exercicios_biblioteca (equipamento);

create or replace function public.normalizar_grupos_exercicio()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_invalido text;
begin
  if cardinality(new.grupos_musculares) = 0 and new.grupo_muscular is not null then
    new.grupos_musculares := array[new.grupo_muscular];
  end if;
  if cardinality(new.grupos_musculares) = 0 then
    raise exception 'Informe pelo menos um grupo muscular.';
  end if;
  select g into v_invalido from unnest(new.grupos_musculares) g
   where not exists (select 1 from public.grupos_musculares gm where gm.nome = g) limit 1;
  if v_invalido is not null then
    raise exception 'Grupo muscular desconhecido: %', v_invalido;
  end if;
  new.grupo_muscular := new.grupos_musculares[1];
  return new;
end;
$$;

revoke execute on function public.normalizar_grupos_exercicio() from public, anon, authenticated;

drop trigger if exists trg_normalizar_grupos_exercicio on public.exercicios_biblioteca;
create trigger trg_normalizar_grupos_exercicio
  before insert or update of grupo_muscular, grupos_musculares on public.exercicios_biblioteca
  for each row execute function public.normalizar_grupos_exercicio();

-- 3) Prescrição: divisões (A, B, C...) e séries individuais.
--   series_detalhe: [{"reps": "12", "descanso_seg": 60, "tecnica": null|"drop"|...}]
-- Quando existe, é a verdade de cada série; `series`, `repeticoes` e
-- `descanso_seg` seguem preenchidos como resumo, para as fichas antigas e para
-- quem ainda lê só eles.
alter table public.modelo_treino_exercicios
  add column if not exists divisao text not null default 'A',
  add column if not exists series_detalhe jsonb,
  add column if not exists equipamento text,
  add column if not exists exercicio_id uuid references public.exercicios_biblioteca(id) on delete set null;

alter table public.modelo_treino_exercicios
  drop constraint if exists modelo_treino_exercicios_divisao_check,
  add constraint modelo_treino_exercicios_divisao_check check (divisao ~ '^[A-J]$'),
  drop constraint if exists modelo_treino_exercicios_series_detalhe_check,
  add constraint modelo_treino_exercicios_series_detalhe_check check (series_detalhe is null or jsonb_typeof(series_detalhe) = 'array');

create index if not exists idx_modelo_treino_exercicios_exercicio on public.modelo_treino_exercicios (exercicio_id);

-- Qual divisão o aluno fez no dia (o calendário mostra "Treino A").
alter table public.registro_treino add column if not exists divisao text;

-- 4) Publicar congela também divisão, séries individuais e equipamento.
create or replace function public.publicar_treino(_aluno_id uuid, _modelo_id uuid, _titulo text, _validade_inicio date default current_date, _validade_fim date default null::date)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
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
        'divisao', divisao,
        'nome_exercicio', nome_exercicio,
        'grupo_muscular', grupo_muscular,
        'equipamento', equipamento,
        'exercicio_id', exercicio_id,
        'series', series,
        'repeticoes', repeticoes,
        'descanso_seg', descanso_seg,
        'series_detalhe', series_detalhe,
        'observacoes', observacoes,
        'video_url', video_url,
        'descricao_execucao', descricao_execucao,
        'gif_url', gif_url
      ) order by divisao, ordem
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
$function$;

-- 5) Upload de vídeo e imagem. Os espaços existiam, mas só com regra de
-- leitura: ninguém conseguia enviar arquivo. O caminho começa pela pasta de
-- quem é dono: o id da organização (gestor ou professor dela) ou "global"
-- (acervo global, da ArkeFit). Leitura continua pública — o app do aluno toca
-- o vídeo direto, sem abrir o navegador.
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
 where id = 'exercicio-imagens';

create or replace function public.pode_gravar_midia_exercicio(_pasta text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when _pasta = 'global' then
      public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')
    when _pasta ~ '^[0-9a-f-]{36}$' then
      public.has_org_role(auth.uid(), _pasta::uuid, 'gestor')
      or public.has_org_role(auth.uid(), _pasta::uuid, 'professor')
      or public.has_role(auth.uid(), 'admin_arke')
    else false
  end;
$$;

revoke execute on function public.pode_gravar_midia_exercicio(text) from public, anon;
grant execute on function public.pode_gravar_midia_exercicio(text) to authenticated;

drop policy if exists "midia de exercicio: envio" on storage.objects;
create policy "midia de exercicio: envio" on storage.objects for insert to authenticated
  with check (
    bucket_id in ('exercicio-videos', 'exercicio-imagens')
    and public.pode_gravar_midia_exercicio((storage.foldername(name))[1])
  );

drop policy if exists "midia de exercicio: troca" on storage.objects;
create policy "midia de exercicio: troca" on storage.objects for update to authenticated
  using (
    bucket_id in ('exercicio-videos', 'exercicio-imagens')
    and public.pode_gravar_midia_exercicio((storage.foldername(name))[1])
  )
  with check (
    bucket_id in ('exercicio-videos', 'exercicio-imagens')
    and public.pode_gravar_midia_exercicio((storage.foldername(name))[1])
  );

drop policy if exists "midia de exercicio: exclusão" on storage.objects;
create policy "midia de exercicio: exclusão" on storage.objects for delete to authenticated
  using (
    bucket_id in ('exercicio-videos', 'exercicio-imagens')
    and public.pode_gravar_midia_exercicio((storage.foldername(name))[1])
  );
