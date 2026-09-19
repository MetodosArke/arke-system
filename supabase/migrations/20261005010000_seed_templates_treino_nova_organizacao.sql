-- A migration "selamento_templates_treino_padrao" já populou 5 fichas
-- modelo (Adaptação A/B, Hipertrofia A/B, Metabólico) em toda organização
-- que existia naquele momento — mas era um backfill único, sem trigger:
-- organização criada depois disso nasce sem nenhum modelo pronto, e o
-- gestor/professor precisa montar a ficha do zero antes de conseguir
-- publicar o primeiro treino. Este trigger fecha essa lacuna, seguindo o
-- mesmo padrão de `trg_organizations_seed_precificacao`.
--
-- Não seed para organização profissional_autonomo de nutricionista — quem
-- só prescreve dieta não usa a tela de Treinos.
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
  )
  insert into public.modelo_treino_exercicios (
    modelo_id, ordem, nome_exercicio, grupo_muscular, series, repeticoes, descanso_seg
  )
  select
    mi.id,
    v.ordem,
    v.nome_exercicio,
    array[v.grupo_muscular],
    coalesce(eb.series_padrao, 3),
    coalesce(eb.repeticoes_padrao, '12'),
    coalesce(eb.descanso_padrao_seg, 60)
  from exercicios_por_template v
  join modelos_inseridos mi on mi.titulo = v.titulo
  left join public.exercicios_biblioteca eb
    on eb.nome = v.nome_exercicio and eb.grupo_muscular = v.grupo_muscular;

  return new;
end;
$$;

create trigger trg_organizations_seed_templates_treino
  after insert on public.organizations
  for each row execute function public.seed_templates_treino_padrao();
