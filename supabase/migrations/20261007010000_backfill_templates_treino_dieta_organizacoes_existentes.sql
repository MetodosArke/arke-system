-- Backfill idempotente para organizações que já existiam antes dos
-- triggers seed_templates_treino_padrao / seed_templates_dieta_padrao
-- entrarem em vigor: garante que toda organização hoje tenha os mesmos 5
-- templates de treino e os 5 templates de dieta que organizações novas já
-- recebem automaticamente. Segue o mesmo critério de exclusão dos
-- triggers (nutricionista autônomo fica sem treino; personal autônomo
-- fica sem dieta) e é seguro rodar mais de uma vez (`where not exists`).

-- ---------------------------------------------------------------------
-- Treino
-- ---------------------------------------------------------------------
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
where not (o.tipo = 'profissional_autonomo' and o.especialidade_profissional = 'nutricionista')
  and not exists (
    select 1 from public.modelos_treino mt
    where mt.organization_id = o.id and mt.titulo = t.titulo
  );

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
join public.organizations o on o.id = mt.organization_id
left join public.exercicios_biblioteca eb
  on eb.nome = v.nome_exercicio and eb.grupo_muscular = v.grupo_muscular
where not (o.tipo = 'profissional_autonomo' and o.especialidade_profissional = 'nutricionista')
  and not exists (
    select 1 from public.modelo_treino_exercicios existing
    where existing.modelo_id = mt.id and existing.ordem = v.ordem
  );

-- ---------------------------------------------------------------------
-- Dieta
-- ---------------------------------------------------------------------
insert into public.modelos_dieta (organization_id, titulo)
select o.id, t.titulo
from public.organizations o
cross join (values
  ('Emagrecimento A'),
  ('Emagrecimento B'),
  ('Hipertrofia A'),
  ('Hipertrofia B'),
  ('Manutenção')
) as t(titulo)
where not (o.tipo = 'profissional_autonomo' and o.especialidade_profissional = 'professor')
  and not exists (
    select 1 from public.modelos_dieta md
    where md.organization_id = o.id and md.titulo = t.titulo
  );

with refeicoes_por_template (
  titulo, ordem, nome_refeicao, horario_sugerido, itens, calorias_kcal, proteinas_g, carboidratos_g, gorduras_g
) as (
  values
    ('Emagrecimento A', 1, 'Café da manhã', '07:00', '2 ovos cozidos, 1 fatia de pão integral, café sem açúcar', 220, 20, 22, 8),
    ('Emagrecimento A', 2, 'Almoço', '12:00', '120g peito de frango grelhado, 4 colheres de arroz integral, salada verde à vontade', 380, 38, 35, 8),
    ('Emagrecimento A', 3, 'Lanche da tarde', '16:00', '1 iogurte natural desnatado, 1 maçã', 120, 5, 22, 1),
    ('Emagrecimento A', 4, 'Jantar', '19:30', '150g filé de tilápia grelhado, batata-doce cozida (100g), legumes no vapor', 350, 30, 25, 8),

    ('Emagrecimento B', 1, 'Café da manhã', '07:00', 'Omelete de 3 claras + 1 ovo, banana prata', 230, 22, 20, 7),
    ('Emagrecimento B', 2, 'Almoço', '12:00', '120g carne moída (patinho) refogada, quinoa cozida (100g), salada', 400, 35, 30, 12),
    ('Emagrecimento B', 3, 'Lanche da tarde', '16:00', 'Whey protein (30g) com água, 1 maçã', 200, 25, 18, 2),
    ('Emagrecimento B', 4, 'Jantar', '19:30', 'Peito de frango grelhado (120g), legumes refogados, batata inglesa cozida (100g)', 320, 35, 15, 6),

    ('Hipertrofia A', 1, 'Café da manhã', '07:00', 'Aveia em flocos (60g) com leite integral, banana, 2 ovos cozidos', 560, 28, 70, 18),
    ('Hipertrofia A', 2, 'Almoço', '12:00', '200g carne bovina (patinho) grelhada, arroz branco (150g), feijão carioca (100g)', 700, 55, 60, 18),
    ('Hipertrofia A', 3, 'Lanche da tarde', '16:00', 'Whey protein (30g), pão integral com queijo minas, banana', 450, 35, 45, 10),
    ('Hipertrofia A', 4, 'Jantar', '19:30', '200g filé de tilápia grelhado, batata-doce (200g), legumes', 500, 42, 50, 8),

    ('Hipertrofia B', 1, 'Café da manhã', '07:00', '3 ovos mexidos, pão francês (2 unid), queijo minas', 500, 30, 40, 22),
    ('Hipertrofia B', 2, 'Almoço', '12:00', 'Salmão grelhado (150g), quinoa cozida (150g), salada com azeite', 650, 42, 55, 22),
    ('Hipertrofia B', 3, 'Lanche da tarde', '16:00', 'Iogurte natural integral, aveia em flocos (40g), mel', 350, 15, 50, 10),
    ('Hipertrofia B', 4, 'Jantar', '19:30', 'Carne bovina (acém) cozida (180g), mandioca cozida (150g), legumes', 600, 45, 55, 18),

    ('Manutenção', 1, 'Café da manhã', '07:00', 'Pão integral, ovo cozido, iogurte natural', 350, 20, 35, 12),
    ('Manutenção', 2, 'Almoço', '12:00', 'Peito de frango grelhado (150g), arroz integral (120g), feijão carioca (100g), salada', 550, 42, 55, 10),
    ('Manutenção', 3, 'Lanche da tarde', '16:00', '1 fruta, iogurte natural', 150, 6, 25, 2),
    ('Manutenção', 4, 'Jantar', '19:30', 'Peixe grelhado (150g), legumes, batata-doce cozida (100g)', 400, 35, 30, 10)
)
insert into public.modelo_dieta_refeicoes (
  modelo_id, ordem, nome_refeicao, horario_sugerido, itens, calorias_kcal, proteinas_g, carboidratos_g, gorduras_g
)
select mi.id, v.ordem, v.nome_refeicao, v.horario_sugerido::time, v.itens, v.calorias_kcal, v.proteinas_g, v.carboidratos_g, v.gorduras_g
from refeicoes_por_template v
join public.modelos_dieta mi on mi.titulo = v.titulo
join public.organizations o on o.id = mi.organization_id
where not (o.tipo = 'profissional_autonomo' and o.especialidade_profissional = 'professor')
  and not exists (
    select 1 from public.modelo_dieta_refeicoes existing
    where existing.modelo_id = mi.id and existing.ordem = v.ordem
  );
