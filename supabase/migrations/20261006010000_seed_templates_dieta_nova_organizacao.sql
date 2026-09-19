-- Mesmo tratamento que `seed_templates_treino_padrao` (migration anterior),
-- agora para Dietas: toda organização nova já nasce com 5 planos alimentares
-- modelo prontos para clonar/publicar, em vez de o nutricionista/gestor ter
-- que montar a ficha do zero na primeira prescrição.
--
-- Não seed para organização profissional_autonomo de personal trainer
-- (especialidade 'professor') — quem só prescreve treino não usa a tela
-- de Dietas.
create or replace function public.seed_templates_dieta_padrao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tipo = 'profissional_autonomo' and new.especialidade_profissional = 'professor' then
    return new;
  end if;

  with novos_modelos (titulo) as (
    values ('Emagrecimento A'), ('Emagrecimento B'), ('Hipertrofia A'), ('Hipertrofia B'), ('Manutenção')
  ),
  modelos_inseridos as (
    insert into public.modelos_dieta (organization_id, titulo)
    select new.id, titulo from novos_modelos
    returning id, titulo
  ),
  refeicoes_por_template (
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
  join modelos_inseridos mi on mi.titulo = v.titulo;

  return new;
end;
$$;

create trigger trg_organizations_seed_templates_dieta
  after insert on public.organizations
  for each row execute function public.seed_templates_dieta_padrao();
