set lock_timeout = '5s';

-- Os modelos de treino que toda academia nova recebe (Adaptação A/B,
-- Hipertrofia A/B, Metabólico) nasciam sem `exercicio_id`: a função juntava o
-- acervo pelo nome e pelo grupo só para copiar séries, repetições e descanso,
-- e não gravava o vínculo. O treino publicado leva o `exercicio_id` do item
-- para o snapshot (`publicar_treino`), e o app lê os GIFs por modelo do acervo
-- por esse id; sem ele, o aluno via o exercício sem GIF (09/10/2026: 93 dos
-- 102 itens de modelo, 31 em cada academia).
--
-- A junção também tinha dois defeitos que escondiam o vínculo:
--   * comparava o grupo antigo do roteiro ('Core', 'Braços', 'Quadríceps',
--     'Isquiotibiais') com o do acervo, que desde a rodada 3 (20261209010000)
--     é 'Abdômen', 'Bíceps', 'Tríceps', 'Pernas', 'Glúteos': 19 dos 31 itens
--     não achavam o exercício nem para copiar as séries;
--   * não se limitava ao acervo global: um exercício próprio de outra
--     academia com o mesmo nome e grupo entraria no modelo (e duplicaria o
--     item, se houvesse dois).
--
-- Agora o exercício do modelo é o global de mesmo nome, e só quando o nome é
-- único entre os globais. Com o vínculo, o item copia do acervo o que o
-- prescritor copiaria ao escolher o exercício na tela (grupos, equipamento,
-- vídeo, descrição e GIF), como `aplicarExercicioBiblioteca` em
-- `PrescricaoTreino`. O snapshot dos treinos já publicados não muda (é
-- imutável): para eles, o app casa pelo nome na leitura (`useGifsDoAcervo`).

-- 1) A função dos modelos da academia nova grava o vínculo.
create or replace function public.seed_templates_treino_padrao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tipo = 'profissional_autonomo' and new.especialidade_profissional = 'nutricionista' then
    return new;
  end if;

  with novos_modelos (titulo) as (
    values ('Adaptação A'), ('Adaptação B'), ('Hipertrofia A'), ('Hipertrofia B'), ('Metabólico (Emagrecimento)')
  ),
  modelos_inseridos as (
    insert into public.modelos_treino (organization_id, titulo)
    select new.id, titulo from novos_modelos
    returning id, titulo
  ),
  exercicios_por_template (titulo, ordem, nome_exercicio, grupo_muscular) as (
    values
      ('Adaptação A', 1, 'Supino na máquina', 'Peito'),
      ('Adaptação A', 2, 'Puxada frontal (pulley)', 'Costas'),
      ('Adaptação A', 3, 'Leg press 45°', 'Quadríceps'),
      ('Adaptação A', 4, 'Mesa flexora', 'Isquiotibiais'),
      ('Adaptação A', 5, 'Desenvolvimento na máquina', 'Ombros'),
      ('Adaptação A', 6, 'Prancha abdominal', 'Core'),

      ('Adaptação B', 1, 'Peck deck (voador)', 'Peito'),
      ('Adaptação B', 2, 'Remada na máquina', 'Costas'),
      ('Adaptação B', 3, 'Cadeira extensora', 'Quadríceps'),
      ('Adaptação B', 4, 'Stiff com halteres', 'Isquiotibiais'),
      ('Adaptação B', 5, 'Rosca direta com barra', 'Braços'),
      ('Adaptação B', 6, 'Tríceps corda no pulley', 'Braços'),
      ('Adaptação B', 7, 'Abdominal supra', 'Core'),

      ('Hipertrofia A', 1, 'Supino reto com barra', 'Peito'),
      ('Hipertrofia A', 2, 'Puxada frontal (pulley)', 'Costas'),
      ('Hipertrofia A', 3, 'Desenvolvimento com halteres', 'Ombros'),
      ('Hipertrofia A', 4, 'Remada curvada com barra', 'Costas'),
      ('Hipertrofia A', 5, 'Rosca alternada com halteres', 'Braços'),
      ('Hipertrofia A', 6, 'Tríceps testa (francesa) com barra', 'Braços'),

      ('Hipertrofia B', 1, 'Agachamento livre', 'Quadríceps'),
      ('Hipertrofia B', 2, 'Leg press 45°', 'Quadríceps'),
      ('Hipertrofia B', 3, 'Stiff com barra', 'Isquiotibiais'),
      ('Hipertrofia B', 4, 'Mesa flexora', 'Isquiotibiais'),
      ('Hipertrofia B', 5, 'Elevação pélvica (hip thrust)', 'Isquiotibiais'),
      ('Hipertrofia B', 6, 'Prancha abdominal', 'Core'),

      ('Metabólico (Emagrecimento)', 1, 'Agachamento com salto', 'Quadríceps'),
      ('Metabólico (Emagrecimento)', 2, 'Flexão de braço', 'Peito'),
      ('Metabólico (Emagrecimento)', 3, 'Remada baixa no cabo', 'Costas'),
      ('Metabólico (Emagrecimento)', 4, 'Elevação lateral com halteres', 'Ombros'),
      ('Metabólico (Emagrecimento)', 5, 'Abdominal bicicleta', 'Core'),
      ('Metabólico (Emagrecimento)', 6, 'Prancha dinâmica (mountain climber)', 'Core')
  ),
  -- O exercício global de cada nome, só quando o nome é único entre os globais.
  acervo_global as (
    select e.nome, min(e.id::text)::uuid as id
      from public.exercicios_biblioteca e
     where e.organization_id is null
       and e.nome in (select nome_exercicio from exercicios_por_template)
     group by e.nome
    having count(*) = 1
  )
  insert into public.modelo_treino_exercicios (
    modelo_id, ordem, nome_exercicio, grupo_muscular, series, repeticoes, descanso_seg,
    exercicio_id, equipamento, video_url, descricao_execucao, gif_url
  )
  select
    mi.id,
    v.ordem,
    v.nome_exercicio,
    coalesce(nullif(eb.grupos_musculares, '{}'::text[]), array[v.grupo_muscular]),
    coalesce(eb.series_padrao, 3),
    coalesce(eb.repeticoes_padrao, '12'),
    coalesce(eb.descanso_padrao_seg, 60),
    eb.id,
    eb.equipamento,
    eb.video_url,
    eb.descricao_execucao,
    eb.gif_url
  from exercicios_por_template v
  join modelos_inseridos mi on mi.titulo = v.titulo
  left join acervo_global ag on ag.nome = v.nome_exercicio
  left join public.exercicios_biblioteca eb on eb.id = ag.id;

  return new;
end;
$$;

-- Função de gatilho: ninguém a chama pela API.
revoke all on function public.seed_templates_treino_padrao() from public, anon, authenticated;

-- 2) Os itens de modelo que já existem sem vínculo ganham o exercício global
-- de mesmo nome; se o nome se repetir entre os globais, o único de mesmo
-- grupo. Sem exatamente um candidato, o item fica como está. Junto com o
-- vínculo, os grupos passam a ser os do exercício (a regra da rodada 3:
-- "acompanham o exercício quando há vínculo"), e a mídia, o equipamento e a
-- descrição vazios vêm do acervo; o que a academia preencheu não muda.
with candidatos as (
  select
    m.id as item_id,
    e.id as exercicio_id,
    (e.grupos_musculares && m.grupo_muscular or e.grupo_muscular = any (m.grupo_muscular)) as mesmo_grupo,
    count(*) over (partition by m.id) as por_nome,
    count(*) filter (where e.grupos_musculares && m.grupo_muscular or e.grupo_muscular = any (m.grupo_muscular))
      over (partition by m.id) as por_nome_e_grupo
  from public.modelo_treino_exercicios m
  join public.exercicios_biblioteca e
    on e.organization_id is null
   and e.nome = m.nome_exercicio
  where m.exercicio_id is null
),
vinculo as (
  select item_id, exercicio_id
    from candidatos
   where por_nome = 1
      or (mesmo_grupo and por_nome_e_grupo = 1)
)
update public.modelo_treino_exercicios m
   set exercicio_id = e.id,
       grupo_muscular = coalesce(nullif(e.grupos_musculares, '{}'::text[]), m.grupo_muscular),
       equipamento = coalesce(nullif(m.equipamento, ''), e.equipamento),
       video_url = coalesce(nullif(m.video_url, ''), e.video_url),
       descricao_execucao = coalesce(nullif(m.descricao_execucao, ''), e.descricao_execucao),
       gif_url = coalesce(nullif(m.gif_url, ''), e.gif_url)
  from vinculo v
  join public.exercicios_biblioteca e on e.id = v.exercicio_id
 where m.id = v.item_id
   and m.exercicio_id is null;
