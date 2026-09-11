-- Etapa 1 — Acervo Global Arke
-- Migração incremental para o projeto Supabase existente.
-- Não insere conteúdo de demonstração: banco vazio permanece em estado vazio.

ALTER TABLE public.exercicios
  ADD COLUMN IF NOT EXISTS instrucoes text;

CREATE TABLE IF NOT EXISTS public.acervo_planos_alimentares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  categoria text NOT NULL DEFAULT '',
  objetivo text,
  descricao text,
  instrucoes text,
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.acervo_rotinas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  categoria text NOT NULL DEFAULT '',
  descricao text,
  rotina text NOT NULL DEFAULT '',
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.acervo_acesso_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo text NOT NULL CHECK (modulo IN ('academia', 'studio', 'profissional', 'nutricionista')),
  plano text NOT NULL,
  habilitado boolean NOT NULL DEFAULT false,
  requer_consultoria boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (modulo, plano)
);

ALTER TABLE public.acervo_planos_alimentares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acervo_rotinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acervo_acesso_regras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage global nutrition library" ON public.acervo_planos_alimentares;
CREATE POLICY "Admins manage global nutrition library"
  ON public.acervo_planos_alimentares FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Admins manage global routines library" ON public.acervo_rotinas;
CREATE POLICY "Admins manage global routines library"
  ON public.acervo_rotinas FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Admins manage global access rules" ON public.acervo_acesso_regras;
CREATE POLICY "Admins manage global access rules"
  ON public.acervo_acesso_regras FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

DROP TRIGGER IF EXISTS update_acervo_planos_alimentares_updated_at ON public.acervo_planos_alimentares;
CREATE TRIGGER update_acervo_planos_alimentares_updated_at
  BEFORE UPDATE ON public.acervo_planos_alimentares FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_acervo_rotinas_updated_at ON public.acervo_rotinas;
CREATE TRIGGER update_acervo_rotinas_updated_at
  BEFORE UPDATE ON public.acervo_rotinas FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_acervo_acesso_regras_updated_at ON public.acervo_acesso_regras;
CREATE TRIGGER update_acervo_acesso_regras_updated_at
  BEFORE UPDATE ON public.acervo_acesso_regras FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS acervo_planos_alimentares_categoria_idx
  ON public.acervo_planos_alimentares (categoria);
CREATE INDEX IF NOT EXISTS acervo_rotinas_categoria_idx
  ON public.acervo_rotinas (categoria);
CREATE INDEX IF NOT EXISTS acervo_acesso_regras_modulo_plano_idx
  ON public.acervo_acesso_regras (modulo, plano);

-- Exercícios, grupos musculares e treino_templates já têm políticas administrativas
-- no instalador principal e são reutilizados como parte do Acervo Global.
-- Acesso de clientes deve ser liberado somente por regra habilitada e contratação válida.
