-- =====================================================================
-- SISTEMA ARKE - CONFIGURACAO COMPLETA DO SUPABASE
-- =====================================================================
-- Uso: execute este arquivo UMA UNICA VEZ no SQL Editor de um projeto
-- Supabase novo e vazio.
--
-- O arquivo cria tipos, tabelas, indices, funcoes, triggers, RLS,
-- permissoes, buckets de Storage e dados auxiliares do Sistema Arke.
--
-- Por seguranca, este pacote NAO contem chaves, URLs privadas, pg_cron
-- nem chamadas de Edge Functions. Tarefas agendadas devem ser configuradas
-- separadamente depois que as funcoes forem publicadas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- bloco: 20260221031103
-- ---------------------------------------------------------------------
-- 1. Enum para roles
create type public.app_role as enum ('aluno', 'admin', 'super_admin');

-- 2. Tabela de roles (separada, conforme boas práticas)
create table public.user_roles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade not null,
    role app_role not null default 'aluno',
    created_at timestamptz not null default now(),
    unique (user_id, role)
);
alter table public.user_roles enable row level security;

-- 3. Função has_role (security definer para evitar recursão)
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = _user_id
      and role = _role
  )
$$;

-- 4. Perfis de usuário
create table public.profiles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade not null unique,
    full_name text not null default '',
    avatar_url text,
    phone text,
    status text not null default 'pending' check (status in ('active', 'pending', 'inactive')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- 5. Perfil do aluno (dados extras)
create table public.aluno_perfil (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade not null unique,
    objetivo text,
    observacoes text,
    data_inicio date default current_date,
    data_nascimento date,
    altura_cm numeric,
    peso_kg numeric,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table public.aluno_perfil enable row level security;

-- 6. Catálogo de exercícios
create table public.exercicios (
    id uuid primary key default gen_random_uuid(),
    nome text not null,
    grupo_muscular text not null,
    descricao text,
    video_url text,
    imagem_url text,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);
alter table public.exercicios enable row level security;

-- 7. Treinos (rotinas)
create table public.treinos (
    id uuid primary key default gen_random_uuid(),
    aluno_id uuid references auth.users(id) on delete cascade not null,
    titulo text not null,
    descricao text,
    tipo text not null default 'A',
    status text not null default 'ativo' check (status in ('ativo', 'inativo', 'concluido')),
    criado_por uuid references auth.users(id) on delete set null,
    validade_inicio date default current_date,
    validade_fim date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table public.treinos enable row level security;

-- 8. Exercícios do treino (relação N:N com detalhes)
create table public.treino_exercicios (
    id uuid primary key default gen_random_uuid(),
    treino_id uuid references public.treinos(id) on delete cascade not null,
    exercicio_id uuid references public.exercicios(id) on delete cascade not null,
    ordem int not null default 0,
    series int not null default 3,
    repeticoes text not null default '12',
    descanso_seg int not null default 60,
    observacoes text,
    created_at timestamptz not null default now()
);
alter table public.treino_exercicios enable row level security;

-- 9. Registro de treino concluído
create table public.registro_treino (
    id uuid primary key default gen_random_uuid(),
    treino_id uuid references public.treinos(id) on delete cascade not null,
    aluno_id uuid references auth.users(id) on delete cascade not null,
    data date not null default current_date,
    feedback text,
    nota int check (nota >= 1 and nota <= 5),
    duracao_min int,
    created_at timestamptz not null default now()
);
alter table public.registro_treino enable row level security;

-- 10. Progresso semanal
create table public.progresso_semanal (
    id uuid primary key default gen_random_uuid(),
    aluno_id uuid references auth.users(id) on delete cascade not null,
    data date not null default current_date,
    peso_kg numeric,
    cintura_cm numeric,
    quadril_cm numeric,
    braco_cm numeric,
    perna_cm numeric,
    bem_estar int check (bem_estar >= 1 and bem_estar <= 5),
    observacoes text,
    created_at timestamptz not null default now()
);
alter table public.progresso_semanal enable row level security;

-- 11. Dietas
create table public.dietas (
    id uuid primary key default gen_random_uuid(),
    aluno_id uuid references auth.users(id) on delete cascade not null,
    titulo text not null,
    arquivo_url text,
    criado_por uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);
alter table public.dietas enable row level security;

-- 12. Notificações
create table public.notificacoes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade not null,
    titulo text not null,
    mensagem text,
    tipo text not null default 'info',
    lida boolean not null default false,
    created_at timestamptz not null default now()
);
alter table public.notificacoes enable row level security;

-- === RLS POLICIES ===

-- user_roles: users can read their own roles, admins can manage
create policy "Users can read own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "Admins can manage roles" on public.user_roles for all to authenticated using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

-- profiles: users can read/update own, admins can read all
create policy "Users can read own profile" on public.profiles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));
create policy "Users can update own profile" on public.profiles for update to authenticated using (user_id = auth.uid());
create policy "Users can insert own profile" on public.profiles for insert to authenticated with check (user_id = auth.uid());

-- aluno_perfil: aluno reads own, admin reads all
create policy "Aluno reads own perfil" on public.aluno_perfil for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));
create policy "Aluno updates own perfil" on public.aluno_perfil for update to authenticated using (user_id = auth.uid());
create policy "Aluno inserts own perfil" on public.aluno_perfil for insert to authenticated with check (user_id = auth.uid());
create policy "Admin manages aluno_perfil" on public.aluno_perfil for all to authenticated using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

-- exercicios: all authenticated can read, admins can manage
create policy "Authenticated can read exercicios" on public.exercicios for select to authenticated using (true);
create policy "Admins manage exercicios" on public.exercicios for all to authenticated using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

-- treinos: aluno reads own, admin manages all
create policy "Aluno reads own treinos" on public.treinos for select to authenticated using (aluno_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));
create policy "Admin manages treinos" on public.treinos for all to authenticated using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

-- treino_exercicios: follows treino access
create policy "Read treino_exercicios" on public.treino_exercicios for select to authenticated using (
  exists (select 1 from public.treinos t where t.id = treino_id and (t.aluno_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')))
);
create policy "Admin manages treino_exercicios" on public.treino_exercicios for all to authenticated using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

-- registro_treino: aluno manages own, admin reads all
create policy "Aluno manages own registro" on public.registro_treino for all to authenticated using (aluno_id = auth.uid());
create policy "Admin reads registros" on public.registro_treino for select to authenticated using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

-- progresso_semanal: aluno manages own, admin reads all
create policy "Aluno manages own progresso" on public.progresso_semanal for all to authenticated using (aluno_id = auth.uid());
create policy "Admin reads progresso" on public.progresso_semanal for select to authenticated using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

-- dietas: aluno reads own, admin manages all
create policy "Aluno reads own dietas" on public.dietas for select to authenticated using (aluno_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));
create policy "Admin manages dietas" on public.dietas for all to authenticated using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

-- notificacoes: user reads/updates own, admin can insert for anyone
create policy "User reads own notificacoes" on public.notificacoes for select to authenticated using (user_id = auth.uid());
create policy "User updates own notificacoes" on public.notificacoes for update to authenticated using (user_id = auth.uid());
create policy "Admin inserts notificacoes" on public.notificacoes for insert to authenticated with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

-- === TRIGGERS ===

-- Auto-update updated_at
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger update_profiles_updated_at before update on public.profiles for each row execute function public.update_updated_at_column();
create trigger update_aluno_perfil_updated_at before update on public.aluno_perfil for each row execute function public.update_updated_at_column();
create trigger update_treinos_updated_at before update on public.treinos for each row execute function public.update_updated_at_column();

-- Auto-create profile + role on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  
  insert into public.user_roles (user_id, role)
  values (new.id, 'aluno');
  
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- bloco: 20260306230123
-- ---------------------------------------------------------------------
-- Add equipamento column to exercicios
ALTER TABLE public.exercicios ADD COLUMN IF NOT EXISTS equipamento text;

-- Create storage bucket for exercise images
INSERT INTO storage.buckets (id, name, public) VALUES ('exercicio-imagens', 'exercicio-imagens', true) ON CONFLICT (id) DO NOTHING;

-- Create storage bucket for exercise videos
INSERT INTO storage.buckets (id, name, public) VALUES ('exercicio-videos', 'exercicio-videos', true) ON CONFLICT (id) DO NOTHING;

-- RLS policies for exercicio-imagens bucket
CREATE POLICY "Admin uploads exercise images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'exercicio-imagens' AND (SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')));

CREATE POLICY "Anyone can read exercise images" ON storage.objects FOR SELECT USING (bucket_id = 'exercicio-imagens');

CREATE POLICY "Admin deletes exercise images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'exercicio-imagens' AND (SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')));

-- RLS policies for exercicio-videos bucket
CREATE POLICY "Admin uploads exercise videos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'exercicio-videos' AND (SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')));

CREATE POLICY "Anyone can read exercise videos" ON storage.objects FOR SELECT USING (bucket_id = 'exercicio-videos');

CREATE POLICY "Admin deletes exercise videos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'exercicio-videos' AND (SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')));

-- ---------------------------------------------------------------------
-- bloco: 20260307010007
-- ---------------------------------------------------------------------
-- Tabela de grupos musculares
CREATE TABLE public.grupos_musculares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.grupos_musculares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read grupos_musculares" ON public.grupos_musculares
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage grupos_musculares" ON public.grupos_musculares
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

-- Tabela de equipamentos
CREATE TABLE public.equipamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.equipamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read equipamentos" ON public.equipamentos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage equipamentos" ON public.equipamentos
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

-- Seed grupos musculares
INSERT INTO public.grupos_musculares (nome, ordem) VALUES
  ('Peito', 1),
  ('Costas', 2),
  ('Ombros', 3),
  ('Bíceps', 4),
  ('Tríceps', 5),
  ('Pernas', 6),
  ('Glúteos', 7),
  ('Abdômen', 8),
  ('Antebraços', 9),
  ('Panturrilha', 10),
  ('Cardio', 11);

-- Seed equipamentos
INSERT INTO public.equipamentos (nome, ordem) VALUES
  ('Barra', 1),
  ('Halteres', 2),
  ('Máquina', 3),
  ('Peso Corporal', 4),
  ('Elástico', 5),
  ('Cabo', 6),
  ('Kettlebell', 7),
  ('TRX', 8),
  ('Bola', 9),
  ('Step', 10);

-- ---------------------------------------------------------------------
-- bloco: 20260307034616
-- ---------------------------------------------------------------------
ALTER TABLE treinos ADD COLUMN IF NOT EXISTS grupo_id uuid;
ALTER TABLE treino_exercicios ADD COLUMN IF NOT EXISTS descanso_por_serie text;

-- ---------------------------------------------------------------------
-- bloco: 20260320023018
-- ---------------------------------------------------------------------
ALTER TABLE public.treinos
  ADD COLUMN IF NOT EXISTS duracao_esperada_min integer,
  ADD COLUMN IF NOT EXISTS distancia_esperada_km numeric;

-- ---------------------------------------------------------------------
-- bloco: 20260320023926
-- ---------------------------------------------------------------------
CREATE TABLE public.registro_serie (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  registro_treino_id uuid NOT NULL,
  exercicio_id uuid NOT NULL,
  serie_numero integer NOT NULL,
  repeticoes integer NOT NULL DEFAULT 0,
  carga_kg numeric DEFAULT 0,
  concluida boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT registro_serie_registro_fkey FOREIGN KEY (registro_treino_id) REFERENCES public.registro_treino(id) ON DELETE CASCADE,
  CONSTRAINT registro_serie_exercicio_fkey FOREIGN KEY (exercicio_id) REFERENCES public.exercicios(id) ON DELETE CASCADE
);

ALTER TABLE public.registro_serie ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Aluno manages own registro_serie"
ON public.registro_serie
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.registro_treino rt
    WHERE rt.id = registro_serie.registro_treino_id
    AND rt.aluno_id = auth.uid()
  )
);

CREATE POLICY "Admin reads registro_serie"
ON public.registro_serie
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Add desconforto fields to registro_treino
ALTER TABLE public.registro_treino
  ADD COLUMN IF NOT EXISTS desconforto boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS desconforto_descricao text;

-- ---------------------------------------------------------------------
-- bloco: 20260323163845
-- ---------------------------------------------------------------------
-- Create storage bucket for diet files
INSERT INTO storage.buckets (id, name, public) VALUES ('dietas', 'dietas', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for dietas bucket
CREATE POLICY "Admin uploads dietas" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'dietas' AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin')));

CREATE POLICY "Admin deletes dietas" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'dietas' AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin')));

CREATE POLICY "Authenticated reads dietas" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'dietas');

CREATE POLICY "Admin updates dietas" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'dietas' AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin')));

-- ---------------------------------------------------------------------
-- bloco: 20260323164438
-- ---------------------------------------------------------------------
-- Add descricao column to dietas table
ALTER TABLE public.dietas ADD COLUMN IF NOT EXISTS descricao text;

-- Create dieta_adesao table for daily diet adherence tracking
CREATE TABLE public.dieta_adesao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id uuid NOT NULL,
  dieta_id uuid REFERENCES public.dietas(id) ON DELETE CASCADE NOT NULL,
  data date NOT NULL DEFAULT CURRENT_DATE,
  adesao_percentual integer NOT NULL DEFAULT 0,
  consumiu_doce boolean NOT NULL DEFAULT false,
  consumiu_alcool boolean NOT NULL DEFAULT false,
  agua_ml integer DEFAULT 0,
  nivel_saciedade text,
  fome_manha boolean NOT NULL DEFAULT false,
  fome_tarde boolean NOT NULL DEFAULT false,
  fome_noite boolean NOT NULL DEFAULT false,
  observacoes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(aluno_id, data)
);

-- Enable RLS
ALTER TABLE public.dieta_adesao ENABLE ROW LEVEL SECURITY;

-- Aluno manages own adesao
CREATE POLICY "Aluno manages own adesao" ON public.dieta_adesao
  FOR ALL TO authenticated
  USING (aluno_id = auth.uid());

-- Admin reads all adesao
CREATE POLICY "Admin reads adesao" ON public.dieta_adesao
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------------------
-- bloco: 20260323165133
-- ---------------------------------------------------------------------
-- Create mensagens_dieta table for student-nutritionist messaging
CREATE TABLE public.mensagens_dieta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dieta_id uuid REFERENCES public.dietas(id) ON DELETE CASCADE NOT NULL,
  aluno_id uuid NOT NULL,
  remetente_id uuid NOT NULL,
  mensagem text NOT NULL,
  lida boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.mensagens_dieta ENABLE ROW LEVEL SECURITY;

-- Aluno can manage messages related to their diets
CREATE POLICY "Aluno manages own diet messages" ON public.mensagens_dieta
  FOR ALL TO authenticated
  USING (aluno_id = auth.uid());

-- Admin can read/insert all diet messages
CREATE POLICY "Admin manages diet messages" ON public.mensagens_dieta
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------------------
-- bloco: 20260323194317
-- ---------------------------------------------------------------------
ALTER TABLE public.mensagens_dieta
ADD COLUMN remetente_tipo text;

UPDATE public.mensagens_dieta
SET remetente_tipo = CASE
  WHEN public.has_role(remetente_id, 'admin'::public.app_role) OR public.has_role(remetente_id, 'super_admin'::public.app_role) THEN 'nutricionista'
  ELSE 'aluno'
END
WHERE remetente_tipo IS NULL;

ALTER TABLE public.mensagens_dieta
ALTER COLUMN remetente_tipo SET NOT NULL;

ALTER TABLE public.mensagens_dieta
ALTER COLUMN remetente_tipo SET DEFAULT 'aluno';

ALTER TABLE public.mensagens_dieta
ADD CONSTRAINT mensagens_dieta_remetente_tipo_check
CHECK (remetente_tipo IN ('aluno', 'nutricionista'));

-- ---------------------------------------------------------------------
-- bloco: 20260325013455
-- ---------------------------------------------------------------------
-- Table for manual calendar workout entries
CREATE TABLE public.treino_calendario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id uuid NOT NULL,
  data date NOT NULL,
  tipos text[] NOT NULL DEFAULT '{}',
  duracao_min integer,
  distancia_km numeric,
  intensidade text DEFAULT 'moderada',
  detalhes text,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.treino_calendario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Aluno manages own calendario" ON public.treino_calendario
  FOR ALL TO authenticated
  USING (aluno_id = auth.uid());

CREATE POLICY "Admin reads calendario" ON public.treino_calendario
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- Add weekly goal column to aluno_perfil
ALTER TABLE public.aluno_perfil ADD COLUMN IF NOT EXISTS meta_semanal_dias integer DEFAULT 3;

-- ---------------------------------------------------------------------
-- bloco: 20260325015237
-- ---------------------------------------------------------------------
CREATE TABLE public.mensagens_treino (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id uuid NOT NULL,
  remetente_id uuid NOT NULL,
  remetente_tipo text NOT NULL DEFAULT 'aluno',
  mensagem text NOT NULL,
  lida boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mensagens_treino ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages treino messages" ON public.mensagens_treino
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Aluno manages own treino messages" ON public.mensagens_treino
  FOR ALL TO authenticated
  USING (aluno_id = auth.uid());

-- ---------------------------------------------------------------------
-- bloco: 20260326041251
-- ---------------------------------------------------------------------
-- Add video_url column to mensagens_treino
ALTER TABLE public.mensagens_treino ADD COLUMN video_url text;

-- Create storage bucket for chat videos
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-videos', 'chat-videos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for the bucket
CREATE POLICY "Authenticated users can upload chat videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-videos');

CREATE POLICY "Anyone can view chat videos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'chat-videos');

CREATE POLICY "Users can delete own chat videos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'chat-videos' AND (auth.uid()::text = (storage.foldername(name))[1]));

-- ---------------------------------------------------------------------
-- bloco: 20260326044139
-- ---------------------------------------------------------------------
-- Template table for reusable workout templates
CREATE TABLE public.treino_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  categoria text NOT NULL DEFAULT '',
  descricao text,
  divisoes text[] NOT NULL DEFAULT '{A}',
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.treino_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages templates"
  ON public.treino_templates FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

-- Template exercises
CREATE TABLE public.treino_template_exercicios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.treino_templates(id) ON DELETE CASCADE,
  divisao text NOT NULL DEFAULT 'A',
  exercicio_id uuid NOT NULL REFERENCES public.exercicios(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 0,
  series integer NOT NULL DEFAULT 3,
  repeticoes text NOT NULL DEFAULT '12',
  descanso_seg integer NOT NULL DEFAULT 60,
  descanso_por_serie text,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.treino_template_exercicios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages template exercicios"
  ON public.treino_template_exercicios FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------------------
-- bloco: 20260326045301
-- ---------------------------------------------------------------------
-- Feed posts table
CREATE TABLE public.feed_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  content text NOT NULL DEFAULT '',
  image_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.feed_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read feed posts" ON public.feed_posts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "User creates own posts" ON public.feed_posts
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "User deletes own posts" ON public.feed_posts
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Admin deletes any post" ON public.feed_posts
  FOR DELETE TO authenticated USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)
  );

-- Feed likes table
CREATE TABLE public.feed_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.feed_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

ALTER TABLE public.feed_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read likes" ON public.feed_likes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "User manages own likes" ON public.feed_likes
  FOR ALL TO authenticated USING (user_id = auth.uid());

-- Feed comments table
CREATE TABLE public.feed_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.feed_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.feed_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read comments" ON public.feed_comments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "User creates own comments" ON public.feed_comments
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "User deletes own comments" ON public.feed_comments
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Admin deletes any comment" ON public.feed_comments
  FOR DELETE TO authenticated USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)
  );

-- Storage bucket for feed images
INSERT INTO storage.buckets (id, name, public) VALUES ('feed-images', 'feed-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated upload feed images" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'feed-images');

CREATE POLICY "Public read feed images" ON storage.objects
  FOR SELECT USING (bucket_id = 'feed-images');

CREATE POLICY "User deletes own feed images" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'feed-images' AND (auth.uid()::text = (storage.foldername(name))[1]));

-- ---------------------------------------------------------------------
-- bloco: 20260326050515
-- ---------------------------------------------------------------------
-- Public view for feed profiles (only name and avatar, no sensitive data)
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT user_id, full_name, avatar_url
FROM public.profiles;

-- Grant access to authenticated users
GRANT SELECT ON public.public_profiles TO authenticated;

-- Security definer function to get public profile data bypassing RLS
CREATE OR REPLACE FUNCTION public.get_public_profiles()
RETURNS TABLE (user_id uuid, full_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.full_name, p.avatar_url
  FROM public.profiles p;
$$;

-- ---------------------------------------------------------------------
-- bloco: 20260326050553
-- ---------------------------------------------------------------------
-- Fix the view to use security_invoker instead of security_definer
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles
WITH (security_invoker=on) AS
SELECT user_id, full_name, avatar_url
FROM public.profiles;

-- ---------------------------------------------------------------------
-- bloco: 20260328212609
-- ---------------------------------------------------------------------
-- Add new columns to progresso_semanal
ALTER TABLE public.progresso_semanal
  ADD COLUMN IF NOT EXISTS gordura_percentual numeric,
  ADD COLUMN IF NOT EXISTS musculo_percentual numeric,
  ADD COLUMN IF NOT EXISTS meta text,
  ADD COLUMN IF NOT EXISTS data_proxima_avaliacao date;

-- Create custom metrics definitions table
CREATE TABLE public.metricas_customizadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  criado_por uuid REFERENCES auth.users(id),
  aluno_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.metricas_customizadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages metricas" ON public.metricas_customizadas
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Aluno reads own metricas" ON public.metricas_customizadas
  FOR SELECT TO authenticated
  USING (aluno_id = auth.uid());

-- Create custom metric values table
CREATE TABLE public.metrica_valores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metrica_id uuid NOT NULL REFERENCES public.metricas_customizadas(id) ON DELETE CASCADE,
  progresso_id uuid NOT NULL REFERENCES public.progresso_semanal(id) ON DELETE CASCADE,
  valor numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.metrica_valores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages metrica_valores" ON public.metrica_valores
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Aluno reads own metrica_valores" ON public.metrica_valores
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.progresso_semanal ps
    WHERE ps.id = metrica_valores.progresso_id AND ps.aluno_id = auth.uid()
  ));

-- ---------------------------------------------------------------------
-- bloco: 20260328213442
-- ---------------------------------------------------------------------
ALTER TABLE public.progresso_semanal ADD COLUMN IF NOT EXISTS meta_peso_kg numeric;

-- ---------------------------------------------------------------------
-- bloco: 20260328214626
-- ---------------------------------------------------------------------
ALTER TABLE public.progresso_semanal
  ADD COLUMN IF NOT EXISTS meta_gordura text,
  ADD COLUMN IF NOT EXISTS meta_gordura_valor numeric,
  ADD COLUMN IF NOT EXISTS meta_musculo text,
  ADD COLUMN IF NOT EXISTS meta_musculo_valor numeric,
  ADD COLUMN IF NOT EXISTS braco_direito_cm numeric,
  ADD COLUMN IF NOT EXISTS braco_esquerdo_cm numeric,
  ADD COLUMN IF NOT EXISTS coxa_direita_cm numeric,
  ADD COLUMN IF NOT EXISTS coxa_esquerda_cm numeric,
  ADD COLUMN IF NOT EXISTS panturrilha_direita_cm numeric,
  ADD COLUMN IF NOT EXISTS panturrilha_esquerda_cm numeric,
  ADD COLUMN IF NOT EXISTS abdomen_cm numeric,
  ADD COLUMN IF NOT EXISTS peito_cm numeric,
  ADD COLUMN IF NOT EXISTS gluteos_cm numeric,
  ADD COLUMN IF NOT EXISTS pontos integer DEFAULT 0;

-- ---------------------------------------------------------------------
-- bloco: 20260328221418
-- ---------------------------------------------------------------------
CREATE POLICY "Admin manages progresso"
ON public.progresso_semanal
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ---------------------------------------------------------------------
-- bloco: 20260329193600
-- ---------------------------------------------------------------------
-- Table for daily check-in (dedicação do dia)
CREATE TABLE public.checkin_diario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  data date NOT NULL DEFAULT CURRENT_DATE,
  dedicacao text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, data)
);

ALTER TABLE public.checkin_diario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User manages own checkin"
ON public.checkin_diario FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admin reads checkins"
ON public.checkin_diario FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- Table for weekly assessment (progresso semanal autoavaliação)
CREATE TABLE public.avaliacao_semanal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  semana text NOT NULL,
  sono integer NOT NULL DEFAULT 5,
  produtividade integer NOT NULL DEFAULT 5,
  humor integer NOT NULL DEFAULT 5,
  conquista text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, semana)
);

ALTER TABLE public.avaliacao_semanal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User manages own avaliacao"
ON public.avaliacao_semanal FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admin reads avaliacoes"
ON public.avaliacao_semanal FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ---------------------------------------------------------------------
-- bloco: 20260330191107
-- ---------------------------------------------------------------------
ALTER TABLE public.registro_treino DROP CONSTRAINT registro_treino_nota_check;

-- ---------------------------------------------------------------------
-- bloco: 20260330195054
-- ---------------------------------------------------------------------
-- Tabela de objetivos do aluno
CREATE TABLE public.aluno_objetivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  objetivos text[] DEFAULT '{}',
  conquistas text,
  dificuldades text,
  visao_3_meses text,
  visao_3_anos text,
  proxima_revisao date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.aluno_objetivos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own objetivos" ON public.aluno_objetivos
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Tabela de valores-guia do aluno
CREATE TABLE public.aluno_valores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  valores text[] DEFAULT '{}',
  validade date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.aluno_valores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own valores" ON public.aluno_valores
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Tabela de compromisso semanal
CREATE TABLE public.compromisso_semanal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  semana text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, semana)
);

ALTER TABLE public.compromisso_semanal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own compromisso" ON public.compromisso_semanal
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Tabela de metas do compromisso
CREATE TABLE public.compromisso_metas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compromisso_id uuid REFERENCES public.compromisso_semanal(id) ON DELETE CASCADE NOT NULL,
  texto text NOT NULL,
  objetivo_vinculado text,
  valor_vinculado text,
  concluida boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.compromisso_metas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own metas" ON public.compromisso_metas
  FOR ALL TO authenticated
  USING (compromisso_id IN (SELECT id FROM public.compromisso_semanal WHERE user_id = auth.uid()))
  WITH CHECK (compromisso_id IN (SELECT id FROM public.compromisso_semanal WHERE user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- bloco: 20260331183233
-- ---------------------------------------------------------------------
UPDATE auth.users SET email_confirmed_at = now() WHERE email = 'aluno2@teste.com';

-- ---------------------------------------------------------------------
-- bloco: 20260401001451
-- ---------------------------------------------------------------------
CREATE TABLE public.dicas_semanais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  conteudo text NOT NULL,
  ativa boolean NOT NULL DEFAULT true,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dicas_semanais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manages dicas" ON public.dicas_semanais
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Authenticated reads active dicas" ON public.dicas_semanais
  FOR SELECT TO authenticated
  USING (ativa = true);

CREATE TRIGGER update_dicas_semanais_updated_at
  BEFORE UPDATE ON public.dicas_semanais
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------
-- bloco: 20260401003632
-- ---------------------------------------------------------------------
-- Tabela para atividades da rotina por dia da semana
create table public.rotina_semanal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  dia_semana integer not null,
  atividade text not null default '',
  hora_inicio text,
  hora_fim text,
  created_at timestamptz default now(),
  unique(user_id, dia_semana)
);

alter table public.rotina_semanal enable row level security;

create policy "User manages own rotina"
  on public.rotina_semanal for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Tabela para plano de treino semanal (dias, horário, local)
create table public.plano_treino_semanal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  dias_treino text[] default '{}',
  horario_preferido text,
  local_treino text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.plano_treino_semanal enable row level security;

create policy "User manages own plano treino"
  on public.plano_treino_semanal for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- bloco: 20260402013306
-- ---------------------------------------------------------------------
-- Challenge types enum
CREATE TYPE public.desafio_tipo AS ENUM ('sem_doce', 'sem_alcool', 'consumo_agua', 'numero_treinos', 'quilometros', 'modalidades', 'desempenho_dieta', 'livre');

-- Main challenges table
CREATE TABLE public.desafios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo TEXT NOT NULL,
  descricao TEXT,
  tipo public.desafio_tipo NOT NULL DEFAULT 'livre',
  meta_valor NUMERIC,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  pontos INTEGER NOT NULL DEFAULT 10,
  criado_por UUID REFERENCES auth.users(id),
  para_todos BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Challenge participants (used when para_todos = false)
CREATE TABLE public.desafio_participantes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  desafio_id UUID NOT NULL REFERENCES public.desafios(id) ON DELETE CASCADE,
  aluno_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(desafio_id, aluno_id)
);

-- Challenge progress/completion tracking
CREATE TABLE public.desafio_progresso (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  desafio_id UUID NOT NULL REFERENCES public.desafios(id) ON DELETE CASCADE,
  aluno_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  concluido BOOLEAN NOT NULL DEFAULT false,
  valor_atual NUMERIC DEFAULT 0,
  concluido_por UUID REFERENCES auth.users(id),
  concluido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(desafio_id, aluno_id)
);

-- Enable RLS
ALTER TABLE public.desafios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desafio_participantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desafio_progresso ENABLE ROW LEVEL SECURITY;

-- Policies for desafios
CREATE POLICY "Admins can manage desafios" ON public.desafios
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Alunos can view desafios" ON public.desafios
  FOR SELECT TO authenticated
  USING (true);

-- Policies for desafio_participantes
CREATE POLICY "Admins can manage participants" ON public.desafio_participantes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Alunos can view their participation" ON public.desafio_participantes
  FOR SELECT TO authenticated
  USING (aluno_id = auth.uid());

-- Policies for desafio_progresso
CREATE POLICY "Admins can manage progresso" ON public.desafio_progresso
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Alunos can view their progresso" ON public.desafio_progresso
  FOR SELECT TO authenticated
  USING (aluno_id = auth.uid());

-- ---------------------------------------------------------------------
-- bloco: 20260402201408
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Anyone can view avatars"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- ---------------------------------------------------------------------
-- bloco: 20260403192049
-- ---------------------------------------------------------------------
CREATE TABLE public.prontuario_observacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id uuid NOT NULL,
  mes integer NOT NULL,
  ano integer NOT NULL,
  observacao text NOT NULL DEFAULT '',
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(aluno_id, mes, ano)
);

ALTER TABLE public.prontuario_observacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage prontuario_observacoes"
ON public.prontuario_observacoes
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ---------------------------------------------------------------------
-- bloco: 20260407013905
-- ---------------------------------------------------------------------
CREATE TABLE public.competicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descricao text,
  data_inicio date NOT NULL,
  data_fim date NOT NULL,
  metrica text NOT NULL DEFAULT 'pontuacao_geral',
  status text NOT NULL DEFAULT 'ativa',
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.competicoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage competicoes"
ON public.competicoes FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'))
WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Alunos can view competicoes"
ON public.competicoes FOR SELECT
TO authenticated
USING (true);

-- ---------------------------------------------------------------------
-- bloco: 20260407021430
-- ---------------------------------------------------------------------
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'professor';

-- ---------------------------------------------------------------------
-- bloco: 20260407021521
-- ---------------------------------------------------------------------
-- Professor can read all treinos
CREATE POLICY "Professor reads treinos"
ON public.treinos FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'professor'::app_role));

-- Professor can read treino_exercicios
CREATE POLICY "Professor reads treino_exercicios"
ON public.treino_exercicios FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'professor'::app_role));

-- Professor can read profiles (to select students)
CREATE POLICY "Professor reads profiles"
ON public.profiles FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'professor'::app_role));

-- Professor can manage registro_treino (start/complete workouts for students)
CREATE POLICY "Professor manages registro_treino"
ON public.registro_treino FOR ALL TO authenticated
USING (has_role(auth.uid(), 'professor'::app_role))
WITH CHECK (has_role(auth.uid(), 'professor'::app_role));

-- Professor can manage registro_serie (fill in loads/reps for students)
CREATE POLICY "Professor manages registro_serie"
ON public.registro_serie FOR ALL TO authenticated
USING (has_role(auth.uid(), 'professor'::app_role))
WITH CHECK (has_role(auth.uid(), 'professor'::app_role));

-- ---------------------------------------------------------------------
-- bloco: 20260407021946
-- ---------------------------------------------------------------------
UPDATE auth.users 
SET email_confirmed_at = now()
WHERE email = 'prof@teste.com' AND email_confirmed_at IS NULL;

UPDATE public.user_roles 
SET role = 'professor' 
WHERE user_id = '9639a244-dd9b-4e43-bb23-ad8ec888a6d5';

UPDATE public.profiles 
SET status = 'active' 
WHERE user_id = '9639a244-dd9b-4e43-bb23-ad8ec888a6d5';

-- ---------------------------------------------------------------------
-- bloco: 20260408010534
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-assets', 'email-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Email assets are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'email-assets');

CREATE POLICY "Admins can upload email assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'email-assets'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admins can update email assets"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'email-assets'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admins can delete email assets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'email-assets'
  AND public.has_role(auth.uid(), 'admin')
);

-- ---------------------------------------------------------------------
-- bloco: 20260408012112
-- ---------------------------------------------------------------------
CREATE POLICY "Admins can delete profiles"
ON public.profiles
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ---------------------------------------------------------------------
-- bloco: 20260409135610
-- ---------------------------------------------------------------------
-- Add para_todos column to competicoes
ALTER TABLE public.competicoes ADD COLUMN IF NOT EXISTS para_todos boolean NOT NULL DEFAULT true;

-- Create competicao_participantes table
CREATE TABLE public.competicao_participantes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  competicao_id UUID NOT NULL REFERENCES public.competicoes(id) ON DELETE CASCADE,
  aluno_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(competicao_id, aluno_id)
);

-- Enable RLS
ALTER TABLE public.competicao_participantes ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins manage competicao_participantes"
ON public.competicao_participantes
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- Alunos can view their own participation
CREATE POLICY "Alunos can view own competicao participation"
ON public.competicao_participantes
FOR SELECT
TO authenticated
USING (aluno_id = auth.uid());

-- ---------------------------------------------------------------------
-- bloco: 20260409141144
-- ---------------------------------------------------------------------
ALTER TABLE public.rotina_semanal DROP CONSTRAINT IF EXISTS rotina_semanal_user_id_dia_semana_key;

-- ---------------------------------------------------------------------
-- bloco: 20260409170025
-- ---------------------------------------------------------------------
-- Push subscriptions table
CREATE TABLE public.push_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User manages own push subscriptions"
  ON public.push_subscriptions
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Notification preferences table
CREATE TABLE public.notificacao_preferencias (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  lembrete_agua boolean NOT NULL DEFAULT true,
  progresso_semanal boolean NOT NULL DEFAULT true,
  meta_treinos_semana boolean NOT NULL DEFAULT true,
  compromisso_semanal boolean NOT NULL DEFAULT true,
  constancia_treino boolean NOT NULL DEFAULT true,
  revisao_rotina boolean NOT NULL DEFAULT true,
  desempenho_dieta boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.notificacao_preferencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User manages own notification preferences"
  ON public.notificacao_preferencias
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Cron e chamadas externas omitidos nesta etapa.
-- ---------------------------------------------------------------------
-- bloco: 20260411030903
-- ---------------------------------------------------------------------
-- Table to cache monthly scores per user
CREATE TABLE public.pontuacao_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ano integer NOT NULL,
  mes integer NOT NULL,
  engajamento integer NOT NULL DEFAULT 0,
  performance integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, ano, mes)
);

ALTER TABLE public.pontuacao_cache ENABLE ROW LEVEL SECURITY;

-- Users can upsert their own score
CREATE POLICY "User manages own pontuacao_cache"
  ON public.pontuacao_cache
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Security definer function to get class averages (accessible by any authenticated user)
CREATE OR REPLACE FUNCTION public.get_pontuacao_turma(p_ano integer, p_mes integer)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'media_engajamento', COALESCE(ROUND(AVG(engajamento)::numeric, 1), 0),
    'media_performance', COALESCE(ROUND(AVG(performance)::numeric, 1), 0),
    'media_total', COALESCE(ROUND(AVG(total)::numeric, 1), 0),
    'total_alunos', COUNT(*)
  )
  FROM public.pontuacao_cache
  WHERE ano = p_ano AND mes = p_mes;
$$;

-- ---------------------------------------------------------------------
-- bloco: 20260411123113
-- ---------------------------------------------------------------------
CREATE TABLE public.reuniao_acolhimento (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  aluno_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rotina_diaria TEXT,
  experiencias_exercicio TEXT,
  experiencias_gostou TEXT,
  experiencias_nao_gostou TEXT,
  dores_lesoes TEXT,
  medicamentos TEXT,
  tempo_disponivel TEXT,
  estilo_treino TEXT,
  exercicios_nao_gosta TEXT,
  alimentos_gosta TEXT,
  alimentos_nao_gosta TEXT,
  alimentacao_rotina TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  criado_por UUID REFERENCES auth.users(id),
  UNIQUE(aluno_id)
);

ALTER TABLE public.reuniao_acolhimento ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins full access on reuniao_acolhimento"
ON public.reuniao_acolhimento
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Professors can read
CREATE POLICY "Professors can read reuniao_acolhimento"
ON public.reuniao_acolhimento
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'professor'));

-- Alunos can read own
CREATE POLICY "Alunos can read own reuniao_acolhimento"
ON public.reuniao_acolhimento
FOR SELECT
TO authenticated
USING (auth.uid() = aluno_id);

-- Trigger for updated_at
CREATE TRIGGER update_reuniao_acolhimento_updated_at
BEFORE UPDATE ON public.reuniao_acolhimento
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- bloco: 20260415025145
-- ---------------------------------------------------------------------
-- Convert grupo_muscular from text to text[]
ALTER TABLE public.exercicios 
  ALTER COLUMN grupo_muscular TYPE text[] 
  USING ARRAY[grupo_muscular];

-- Set a default for new rows
ALTER TABLE public.exercicios 
  ALTER COLUMN grupo_muscular SET DEFAULT '{}'::text[];

-- ---------------------------------------------------------------------
-- bloco: 20260418230302
-- ---------------------------------------------------------------------
-- Tabela principal de controle de pagamento por aluno
CREATE TABLE public.aluno_pagamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id uuid NOT NULL UNIQUE,
  meio_pagamento text NOT NULL DEFAULT 'pix',
  dia_vencimento integer NOT NULL DEFAULT 10 CHECK (dia_vencimento BETWEEN 1 AND 31),
  valor_mensal numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ativo',
  proxima_data_vencimento date NOT NULL,
  ultima_data_pagamento date,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  criado_por uuid
);

ALTER TABLE public.aluno_pagamento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage aluno_pagamento"
ON public.aluno_pagamento FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER update_aluno_pagamento_updated_at
BEFORE UPDATE ON public.aluno_pagamento
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Histórico de pagamentos
CREATE TABLE public.pagamento_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aluno_id uuid NOT NULL,
  data_pagamento date NOT NULL DEFAULT CURRENT_DATE,
  valor_pago numeric(10,2) NOT NULL DEFAULT 0,
  meio_pagamento text NOT NULL DEFAULT 'pix',
  observacoes text,
  registrado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pagamento_historico_aluno ON public.pagamento_historico(aluno_id, data_pagamento DESC);

ALTER TABLE public.pagamento_historico ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage pagamento_historico"
ON public.pagamento_historico FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ---------------------------------------------------------------------
-- bloco: 20260502002213
-- ---------------------------------------------------------------------
ALTER TABLE public.progresso_semanal REPLICA IDENTITY FULL;
ALTER TABLE public.metricas_customizadas REPLICA IDENTITY FULL;
ALTER TABLE public.metrica_valores REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.progresso_semanal;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.metricas_customizadas;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.metrica_valores;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ---------------------------------------------------------------------
-- bloco: 20260512000055
-- ---------------------------------------------------------------------
-- Create academias table
CREATE TABLE IF NOT EXISTS public.academias (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  criado_por uuid
);

ALTER TABLE public.academias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage academias"
  ON public.academias FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Authenticated reads academias"
  ON public.academias FOR SELECT TO authenticated
  USING (true);

-- Add academia_id to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS academia_id uuid REFERENCES public.academias(id) ON DELETE SET NULL;

-- Add academia_id to treinos
ALTER TABLE public.treinos
  ADD COLUMN IF NOT EXISTS academia_id uuid REFERENCES public.academias(id) ON DELETE SET NULL;

-- Allow admins to update profiles (needed to set academia_id from admin UI)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Admins update profiles'
  ) THEN
    CREATE POLICY "Admins update profiles"
      ON public.profiles FOR UPDATE TO authenticated
      USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
      WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));
  END IF;
END $$;
