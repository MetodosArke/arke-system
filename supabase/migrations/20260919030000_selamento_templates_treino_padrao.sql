-- Selamento e Expansão Comercial — 5 fichas/templates modelo prontas
-- para clonagem, aplicadas a toda organização já existente (e cada nova
-- organização criada depois pode copiá-las manualmente a partir da tela
-- de Treinos, já que modelos_treino é escopado por tenant).
--
-- modelos_treino/modelo_treino_exercicios não têm unique constraint
-- própria (ver migrations anteriores), então a idempotência aqui é feita
-- via `where not exists`, no mesmo espírito do `on conflict do nothing`
-- usado no restante do projeto.

-- 1) Cria os 5 modelos (um por organização) se ainda não existirem.
insert into public.modelos_treino (organization_id, titulo)
select o.id, t.titulo
from public.organizations o
cross join (values
  ('Adaptação A'),
  ('Adaptação B'),
  ('Hipertrofia A'),
  ('Hipertrofia B'),
  ('Metabólico (Emagrecimento)')
) as t(titulo)
where not exists (
  select 1 from public.modelos_treino mt
  where mt.organization_id = o.id and mt.titulo = t.titulo
);

-- 2) Popula os exercícios de cada modelo recém-criado, puxando os
--    valores padrão (séries/repetições/descanso) da biblioteca ARKE.
with exercicios_por_template (titulo, ordem, nome_exercicio, grupo_muscular) as (
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
)
insert into public.modelo_treino_exercicios (
  modelo_id, ordem, nome_exercicio, grupo_muscular, series, repeticoes, descanso_seg
)
select
  mt.id,
  v.ordem,
  v.nome_exercicio,
  array[v.grupo_muscular],
  coalesce(eb.series_padrao, 3),
  coalesce(eb.repeticoes_padrao, '12'),
  coalesce(eb.descanso_padrao_seg, 60)
from exercicios_por_template v
join public.modelos_treino mt
  on mt.titulo = v.titulo
left join public.exercicios_biblioteca eb
  on eb.nome = v.nome_exercicio and eb.grupo_muscular = v.grupo_muscular
where not exists (
  select 1 from public.modelo_treino_exercicios existing
  where existing.modelo_id = mt.id and existing.ordem = v.ordem
);
