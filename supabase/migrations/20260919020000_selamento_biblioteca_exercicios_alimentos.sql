-- Selamento e Expansão Comercial — Biblioteca B.A.S.E.® (exercícios) e
-- Tabela Nutricional B.A.S.E.® (alimentos), no estilo TACO/IBGE.
--
-- São catálogos globais de referência da ARKE (não pertencem a nenhuma
-- organização específica) que o profissional usa como ponto de partida
-- ao montar exercícios/refeições em modelos_treino/modelos_dieta — por
-- isso não levam organization_id nem RLS por tenant: leitura liberada a
-- qualquer usuário autenticado, escrita restrita a admin_arke (quem
-- mantém o catálogo oficial da ARKE).
--
-- video_url é deixado em branco propositalmente: não inventamos links de
-- vídeo demonstrativo — cabe à equipe de conteúdo da ARKE/cada academia
-- preencher com material próprio ou licenciado depois.
create table public.exercicios_biblioteca (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  grupo_muscular    text not null check (grupo_muscular in (
    'Peito', 'Costas', 'Quadríceps', 'Isquiotibiais', 'Ombros', 'Braços', 'Core'
  )),
  series_padrao     integer not null default 3,
  repeticoes_padrao text not null default '12',
  descanso_padrao_seg integer not null default 60,
  video_url         text,
  observacoes       text,
  created_at        timestamptz not null default now(),
  unique (nome, grupo_muscular)
);

create index idx_exercicios_biblioteca_grupo on public.exercicios_biblioteca(grupo_muscular);

alter table public.exercicios_biblioteca enable row level security;

create policy "staff le a biblioteca de exercicios"
  on public.exercicios_biblioteca for select
  to authenticated
  using (true);

create policy "admin_arke gerencia a biblioteca de exercicios"
  on public.exercicios_biblioteca for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin_arke'))
  with check (public.has_role(auth.uid(), 'admin_arke'));

create table public.alimentos_biblioteca (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  categoria       text,
  porcao_g        numeric(6,1) not null default 100,
  calorias_kcal   numeric(7,1) not null,
  proteinas_g     numeric(6,2) not null default 0,
  carboidratos_g  numeric(6,2) not null default 0,
  gorduras_g      numeric(6,2) not null default 0,
  created_at      timestamptz not null default now(),
  unique (nome)
);

create index idx_alimentos_biblioteca_categoria on public.alimentos_biblioteca(categoria);

alter table public.alimentos_biblioteca enable row level security;

create policy "staff le a biblioteca de alimentos"
  on public.alimentos_biblioteca for select
  to authenticated
  using (true);

create policy "admin_arke gerencia a biblioteca de alimentos"
  on public.alimentos_biblioteca for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin_arke'))
  with check (public.has_role(auth.uid(), 'admin_arke'));

-- ---------------------------------------------------------------------
-- Exercícios (105 no total, 15 por grupo muscular)
-- ---------------------------------------------------------------------
insert into public.exercicios_biblioteca (nome, grupo_muscular, series_padrao, repeticoes_padrao, descanso_padrao_seg) values
  ('Supino reto com barra', 'Peito', 4, '8-10', 90),
  ('Supino reto com halteres', 'Peito', 4, '8-10', 90),
  ('Supino inclinado com barra', 'Peito', 4, '8-10', 90),
  ('Supino inclinado com halteres', 'Peito', 3, '10-12', 75),
  ('Supino declinado', 'Peito', 3, '10-12', 75),
  ('Crucifixo reto com halteres', 'Peito', 3, '12-15', 60),
  ('Crucifixo inclinado com halteres', 'Peito', 3, '12-15', 60),
  ('Crossover no cabo', 'Peito', 3, '12-15', 60),
  ('Peck deck (voador)', 'Peito', 3, '12-15', 60),
  ('Flexão de braço', 'Peito', 3, '15-20', 45),
  ('Flexão de braço com apoio elevado', 'Peito', 3, '12-15', 45),
  ('Pullover com halter', 'Peito', 3, '12-15', 60),
  ('Supino na máquina', 'Peito', 3, '10-12', 75),
  ('Crucifixo no banco declinado', 'Peito', 3, '12-15', 60),
  ('Flexão diamante', 'Peito', 3, '12-15', 45),

  ('Puxada frontal (pulley)', 'Costas', 4, '8-10', 90),
  ('Puxada por trás', 'Costas', 3, '10-12', 75),
  ('Remada curvada com barra', 'Costas', 4, '8-10', 90),
  ('Remada unilateral com halter (serrote)', 'Costas', 3, '10-12', 75),
  ('Remada cavalinho (T-bar)', 'Costas', 3, '10-12', 75),
  ('Remada baixa no cabo', 'Costas', 3, '10-12', 75),
  ('Levantamento terra', 'Costas', 4, '6-8', 120),
  ('Barra fixa pronada (pull-up)', 'Costas', 3, '8-10', 90),
  ('Barra fixa supinada (chin-up)', 'Costas', 3, '8-10', 90),
  ('Pulldown com corda', 'Costas', 3, '12-15', 60),
  ('Remada na máquina', 'Costas', 3, '10-12', 75),
  ('Hiperextensão lombar', 'Costas', 3, '15-20', 45),
  ('Encolhimento de ombros com barra', 'Costas', 3, '12-15', 60),
  ('Face pull', 'Costas', 3, '15-20', 45),
  ('Remada Pendlay', 'Costas', 3, '8-10', 90),

  ('Agachamento livre', 'Quadríceps', 4, '8-10', 120),
  ('Agachamento frontal', 'Quadríceps', 4, '8-10', 120),
  ('Leg press 45°', 'Quadríceps', 4, '10-12', 90),
  ('Cadeira extensora', 'Quadríceps', 3, '12-15', 60),
  ('Agachamento búlgaro', 'Quadríceps', 3, '10-12', 75),
  ('Afundo (avanço) com halteres', 'Quadríceps', 3, '10-12', 75),
  ('Agachamento sumô', 'Quadríceps', 3, '10-12', 90),
  ('Hack squat', 'Quadríceps', 4, '8-10', 90),
  ('Agachamento no smith', 'Quadríceps', 3, '10-12', 90),
  ('Passada com halteres', 'Quadríceps', 3, '12-15', 60),
  ('Agachamento com salto', 'Quadríceps', 3, '12-15', 60),
  ('Step up', 'Quadríceps', 3, '12-15', 60),
  ('Agachamento goblet com kettlebell', 'Quadríceps', 3, '12-15', 60),
  ('Leg press horizontal', 'Quadríceps', 3, '10-12', 90),
  ('Agachamento taça (goblet squat)', 'Quadríceps', 3, '12-15', 60),

  ('Mesa flexora', 'Isquiotibiais', 3, '12-15', 60),
  ('Cadeira flexora', 'Isquiotibiais', 3, '12-15', 60),
  ('Stiff com barra', 'Isquiotibiais', 4, '8-10', 90),
  ('Stiff com halteres', 'Isquiotibiais', 3, '10-12', 75),
  ('Levantamento terra romeno', 'Isquiotibiais', 4, '8-10', 90),
  ('Good morning', 'Isquiotibiais', 3, '10-12', 75),
  ('Elevação pélvica (hip thrust)', 'Isquiotibiais', 4, '10-12', 90),
  ('Ponte de glúteo', 'Isquiotibiais', 3, '15-20', 45),
  ('Cadeira flexora unilateral', 'Isquiotibiais', 3, '12-15', 60),
  ('Flexora em pé', 'Isquiotibiais', 3, '12-15', 60),
  ('Nordic curl', 'Isquiotibiais', 3, '8-10', 75),
  ('Glute ham raise', 'Isquiotibiais', 3, '8-10', 75),
  ('Passada reversa', 'Isquiotibiais', 3, '12-15', 60),
  ('Agachamento sumô com halter', 'Isquiotibiais', 3, '12-15', 60),
  ('Levantamento terra pernas rígidas', 'Isquiotibiais', 3, '8-10', 90),

  ('Desenvolvimento militar com barra', 'Ombros', 4, '8-10', 90),
  ('Desenvolvimento com halteres', 'Ombros', 4, '8-10', 90),
  ('Desenvolvimento Arnold', 'Ombros', 3, '10-12', 75),
  ('Elevação lateral com halteres', 'Ombros', 3, '12-15', 60),
  ('Elevação frontal com halteres', 'Ombros', 3, '12-15', 60),
  ('Elevação lateral no cabo', 'Ombros', 3, '12-15', 60),
  ('Remada alta', 'Ombros', 3, '10-12', 75),
  ('Crucifixo invertido (deltoide posterior)', 'Ombros', 3, '12-15', 60),
  ('Face pull para deltoide posterior', 'Ombros', 3, '15-20', 45),
  ('Desenvolvimento na máquina', 'Ombros', 3, '10-12', 75),
  ('Elevação lateral na máquina', 'Ombros', 3, '12-15', 60),
  ('Encolhimento com halteres', 'Ombros', 3, '12-15', 60),
  ('Push press', 'Ombros', 4, '6-8', 90),
  ('Desenvolvimento na barra guiada (smith)', 'Ombros', 3, '10-12', 75),
  ('Elevação em Y', 'Ombros', 3, '12-15', 45),

  ('Rosca direta com barra', 'Braços', 3, '10-12', 60),
  ('Rosca alternada com halteres', 'Braços', 3, '10-12', 60),
  ('Rosca martelo', 'Braços', 3, '10-12', 60),
  ('Rosca scott', 'Braços', 3, '10-12', 60),
  ('Rosca concentrada', 'Braços', 3, '12-15', 45),
  ('Rosca no cabo', 'Braços', 3, '12-15', 45),
  ('Tríceps testa (francesa) com barra', 'Braços', 3, '10-12', 60),
  ('Tríceps corda no pulley', 'Braços', 3, '12-15', 45),
  ('Tríceps coice (kickback)', 'Braços', 3, '12-15', 45),
  ('Mergulho no banco (bench dip)', 'Braços', 3, '12-15', 45),
  ('Tríceps francês com halter', 'Braços', 3, '10-12', 60),
  ('Rosca 21', 'Braços', 3, '21', 60),
  ('Extensão de tríceps unilateral no cabo', 'Braços', 3, '12-15', 45),
  ('Rosca inversa', 'Braços', 3, '12-15', 60),
  ('Paralelas (dips)', 'Braços', 3, '8-12', 75),

  ('Prancha abdominal', 'Core', 3, '30-45s', 45),
  ('Prancha lateral', 'Core', 3, '30-45s (cada lado)', 45),
  ('Abdominal supra', 'Core', 3, '15-20', 45),
  ('Abdominal infra (elevação de pernas)', 'Core', 3, '15-20', 45),
  ('Abdominal bicicleta', 'Core', 3, '20-30', 45),
  ('Abdominal na polia (cable crunch)', 'Core', 3, '12-15', 45),
  ('Prancha com elevação de perna', 'Core', 3, '10-12 (cada lado)', 45),
  ('Rotação de tronco com peso (russian twist)', 'Core', 3, '20-30', 45),
  ('Roda abdominal (ab wheel)', 'Core', 3, '8-12', 60),
  ('Elevação de pernas na barra fixa', 'Core', 3, '10-15', 60),
  ('Prancha dinâmica (mountain climber)', 'Core', 3, '20-30', 45),
  ('Abdominal canivete (V-up)', 'Core', 3, '12-15', 45),
  ('Dead bug', 'Core', 3, '10-12 (cada lado)', 45),
  ('Sit-up completo', 'Core', 3, '15-20', 45),
  ('Prancha com toque no ombro', 'Core', 3, '20-30', 45)
on conflict (nome, grupo_muscular) do nothing;

-- ---------------------------------------------------------------------
-- Alimentos (base inspirada na Tabela TACO/IBGE — valores aproximados
-- por 100g, para uso como ponto de partida na prescrição nutricional)
-- ---------------------------------------------------------------------
insert into public.alimentos_biblioteca (nome, categoria, porcao_g, calorias_kcal, proteinas_g, carboidratos_g, gorduras_g) values
  ('Arroz branco cozido', 'Cereais', 100, 128, 2.5, 28.1, 0.2),
  ('Arroz integral cozido', 'Cereais', 100, 124, 2.6, 25.8, 1.0),
  ('Feijão carioca cozido', 'Leguminosas', 100, 76, 4.8, 13.6, 0.5),
  ('Feijão preto cozido', 'Leguminosas', 100, 77, 4.5, 14.0, 0.5),
  ('Lentilha cozida', 'Leguminosas', 100, 93, 6.3, 16.3, 0.5),
  ('Grão-de-bico cozido', 'Leguminosas', 100, 121, 6.7, 20.4, 1.9),
  ('Aveia em flocos', 'Cereais', 100, 394, 13.9, 67.0, 8.5),
  ('Pão francês', 'Panificados', 50, 150, 4.0, 28.0, 1.5),
  ('Pão integral', 'Panificados', 50, 125, 4.5, 22.0, 1.7),
  ('Batata inglesa cozida', 'Tubérculos', 100, 52, 1.2, 11.9, 0.1),
  ('Batata-doce cozida', 'Tubérculos', 100, 77, 0.6, 18.4, 0.1),
  ('Mandioca cozida', 'Tubérculos', 100, 125, 0.6, 30.1, 0.3),
  ('Inhame cozido', 'Tubérculos', 100, 97, 1.5, 23.2, 0.1),
  ('Macarrão cozido', 'Cereais', 100, 111, 3.5, 22.2, 0.9),
  ('Quinoa cozida', 'Cereais', 100, 120, 4.4, 21.3, 1.9),
  ('Peito de frango grelhado', 'Carnes', 100, 159, 32.0, 0.0, 2.5),
  ('Coxa de frango assada', 'Carnes', 100, 209, 26.5, 0.0, 10.9),
  ('Carne bovina (patinho) grelhada', 'Carnes', 100, 219, 35.9, 0.0, 7.3),
  ('Carne bovina (acém) cozida', 'Carnes', 100, 212, 29.0, 0.0, 10.0),
  ('Carne moída (patinho) refogada', 'Carnes', 100, 194, 30.0, 0.0, 7.5),
  ('Filé de tilápia grelhado', 'Peixes', 100, 128, 26.2, 0.0, 2.7),
  ('Salmão grelhado', 'Peixes', 100, 208, 25.4, 0.0, 11.0),
  ('Atum em água (lata)', 'Peixes', 100, 116, 25.5, 0.0, 1.0),
  ('Sardinha grelhada', 'Peixes', 100, 172, 24.6, 0.0, 7.7),
  ('Camarão cozido', 'Peixes', 100, 90, 19.0, 0.0, 1.2),
  ('Ovo de galinha inteiro cozido', 'Ovos', 50, 78, 6.5, 0.6, 5.3),
  ('Clara de ovo cozida', 'Ovos', 33, 17, 3.6, 0.2, 0.1),
  ('Leite integral', 'Laticínios', 200, 122, 6.4, 9.4, 6.6),
  ('Leite desnatado', 'Laticínios', 200, 70, 6.8, 9.8, 0.4),
  ('Iogurte natural integral', 'Laticínios', 100, 51, 4.1, 1.9, 3.0),
  ('Iogurte natural desnatado', 'Laticínios', 100, 41, 4.0, 5.9, 0.2),
  ('Queijo minas frescal', 'Laticínios', 30, 71, 5.2, 1.0, 5.2),
  ('Queijo cottage', 'Laticínios', 100, 98, 12.0, 3.4, 4.0),
  ('Requeijão light', 'Laticínios', 30, 55, 3.0, 1.5, 4.0),
  ('Whey protein (concentrado, pó)', 'Suplementos', 30, 120, 24.0, 3.0, 1.5),
  ('Banana prata', 'Frutas', 100, 98, 1.3, 26.0, 0.1),
  ('Maçã com casca', 'Frutas', 100, 56, 0.3, 15.2, 0.1),
  ('Laranja pera', 'Frutas', 100, 37, 1.0, 8.9, 0.1),
  ('Mamão papaia', 'Frutas', 100, 40, 0.5, 10.4, 0.1),
  ('Abacate', 'Frutas', 100, 96, 1.2, 6.0, 8.4),
  ('Morango', 'Frutas', 100, 30, 0.9, 6.8, 0.3),
  ('Manga', 'Frutas', 100, 64, 0.4, 16.7, 0.2),
  ('Uva', 'Frutas', 100, 53, 0.6, 13.6, 0.2),
  ('Abacaxi', 'Frutas', 100, 48, 0.9, 12.3, 0.1),
  ('Melancia', 'Frutas', 100, 33, 0.9, 8.1, 0.0),
  ('Brócolis cozido', 'Vegetais', 100, 25, 2.1, 4.4, 0.3),
  ('Couve refogada', 'Vegetais', 100, 62, 2.0, 5.0, 4.3),
  ('Cenoura crua', 'Vegetais', 100, 34, 1.3, 7.7, 0.2),
  ('Tomate cru', 'Vegetais', 100, 15, 1.1, 3.1, 0.2),
  ('Alface', 'Vegetais', 100, 15, 1.3, 2.4, 0.2),
  ('Abobrinha cozida', 'Vegetais', 100, 19, 1.2, 4.3, 0.1),
  ('Espinafre cozido', 'Vegetais', 100, 20, 2.4, 3.3, 0.3),
  ('Pepino', 'Vegetais', 100, 10, 0.7, 2.0, 0.1),
  ('Beterraba cozida', 'Vegetais', 100, 32, 1.3, 7.3, 0.1),
  ('Azeite de oliva extra virgem', 'Óleos e gorduras', 10, 88, 0.0, 0.0, 10.0),
  ('Óleo de coco', 'Óleos e gorduras', 10, 87, 0.0, 0.0, 9.9),
  ('Castanha-do-pará', 'Oleaginosas', 20, 131, 2.9, 2.4, 13.3),
  ('Amêndoas', 'Oleaginosas', 20, 115, 4.2, 4.3, 9.9),
  ('Amendoim torrado', 'Oleaginosas', 20, 114, 5.2, 4.0, 9.6),
  ('Castanha de caju', 'Oleaginosas', 20, 114, 3.7, 6.0, 9.0),
  ('Pasta de amendoim integral', 'Oleaginosas', 20, 120, 5.0, 4.0, 10.0),
  ('Chia (semente)', 'Sementes', 15, 73, 2.5, 6.3, 4.6),
  ('Linhaça (semente)', 'Sementes', 15, 80, 2.7, 4.3, 6.3),
  ('Tapioca (goma hidratada)', 'Cereais', 60, 130, 0.1, 32.0, 0.0),
  ('Cuscuz de milho cozido', 'Cereais', 100, 112, 2.2, 25.0, 0.3),
  ('Milho verde cozido', 'Cereais', 100, 98, 3.3, 21.0, 1.5),
  ('Granola tradicional', 'Cereais', 40, 190, 4.4, 25.0, 8.0),
  ('Pão de forma integral', 'Panificados', 50, 128, 5.0, 21.5, 2.0),
  ('Torrada integral', 'Panificados', 20, 78, 2.6, 15.0, 0.8),
  ('Tofu firme', 'Proteína vegetal', 100, 76, 8.0, 1.9, 4.8),
  ('Proteína texturizada de soja (PTS) hidratada', 'Proteína vegetal', 100, 90, 15.0, 6.0, 0.5),
  ('Peito de peru defumado', 'Carnes', 30, 33, 6.0, 0.5, 0.6),
  ('Presunto sem capa de gordura', 'Carnes', 30, 40, 6.5, 0.5, 1.3),
  ('Carne suína (lombo) assada', 'Carnes', 100, 210, 28.0, 0.0, 10.0),
  ('Água de coco', 'Bebidas', 200, 38, 0.4, 9.0, 0.0),
  ('Suco de laranja natural', 'Bebidas', 200, 90, 1.4, 20.8, 0.4),
  ('Café sem açúcar', 'Bebidas', 100, 2, 0.1, 0.4, 0.0),
  ('Mel', 'Doces e açúcares', 20, 61, 0.1, 16.4, 0.0),
  ('Geleia de frutas (sem açúcar)', 'Doces e açúcares', 20, 30, 0.1, 7.5, 0.0),
  ('Chocolate amargo 70%', 'Doces e açúcares', 20, 110, 1.5, 9.0, 7.9),
  ('Batata-baroa (mandioquinha) cozida', 'Tubérculos', 100, 80, 1.5, 18.9, 0.3),
  ('Repolho cru', 'Vegetais', 100, 25, 1.3, 5.8, 0.1),
  ('Pepino em conserva', 'Vegetais', 100, 12, 0.7, 2.5, 0.2)
on conflict (nome) do nothing;
