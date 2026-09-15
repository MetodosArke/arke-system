-- Curadoria em lote do acervo global via IA (scripts/seed-acervo.ts).
--
-- Três mudanças de schema, nenhuma com dado real em risco (as três
-- tabelas abaixo estão vazias em produção até esta migração):
--
-- 1. Bug real encontrado ao preparar esta fase: public.exercicios.
--    grupo_muscular ficou como text[] desde a configuração original do
--    piloto arke-app (Arke-Supabase-Setup.sql, bloco "Convert
--    grupo_muscular from text to text[]"), mas todo o código atual
--    (server/routers.ts, server/supabaseAdmin.ts, acervoAi.ts,
--    GlobalLibraryAdmin.tsx) sempre tratou o campo como texto único.
--    Como a tabela nunca teve uma linha criada com sucesso, o
--    desalinhamento nunca foi notado — mas bloquearia toda tentativa de
--    cadastrar exercício, manual ou via IA. Corrigido para text.
--
-- 2. Segundo bug real, mesma causa raiz: a coluna public.exercicios.
--    instrucoes deveria já existir desde a Fase 2 (Acervo Global —
--    20260911_global_library.sql, "ALTER TABLE exercicios ADD COLUMN
--    instrucoes"), mas nunca chegou a ser aplicada neste projeto —
--    server/acervoAi.ts e o formulário de exercício sempre leram/
--    escreveram esse campo assumindo que ele existia. Adicionada aqui.
--
-- 3. estado_publicacao (rascunho/publicado/arquivado) em exercicios,
--    treino_templates e acervo_planos_alimentares — mesmo padrão já
--    usado em treinos/dietas individuais (20260914_treino_dieta_
--    versionamento.sql). Default 'publicado' preserva qualquer linha já
--    cadastrada manualmente; só conteúdo gerado explicitamente como
--    rascunho (o script de seed) nasce oculto do uso real (ex.:
--    listExercisesCatalog, usado na prescrição de treino de verdade)
--    até o Admin Arke revisar e aprovar em lote.

alter table public.exercicios
  alter column grupo_muscular type text using coalesce(grupo_muscular[1], ''),
  alter column grupo_muscular set default null,
  alter column grupo_muscular drop default;

alter table public.exercicios add column if not exists instrucoes text;

alter table public.exercicios
  add column if not exists estado_publicacao text not null default 'publicado',
  add column if not exists publicado_por uuid references auth.users(id) on delete set null,
  add column if not exists publicado_em timestamptz;

do $$ begin
  alter table public.exercicios
    add constraint exercicios_estado_publicacao_check
    check (estado_publicacao in ('rascunho', 'publicado', 'arquivado'));
exception when duplicate_object then null; end $$;

alter table public.treino_templates
  add column if not exists estado_publicacao text not null default 'publicado',
  add column if not exists publicado_por uuid references auth.users(id) on delete set null,
  add column if not exists publicado_em timestamptz;

do $$ begin
  alter table public.treino_templates
    add constraint treino_templates_estado_publicacao_check
    check (estado_publicacao in ('rascunho', 'publicado', 'arquivado'));
exception when duplicate_object then null; end $$;

alter table public.acervo_planos_alimentares
  add column if not exists estado_publicacao text not null default 'publicado',
  add column if not exists publicado_por uuid references auth.users(id) on delete set null,
  add column if not exists publicado_em timestamptz;

do $$ begin
  alter table public.acervo_planos_alimentares
    add constraint acervo_planos_alimentares_estado_publicacao_check
    check (estado_publicacao in ('rascunho', 'publicado', 'arquivado'));
exception when duplicate_object then null; end $$;

create index if not exists exercicios_estado_publicacao_idx on public.exercicios (estado_publicacao);
create index if not exists treino_templates_estado_publicacao_idx on public.treino_templates (estado_publicacao);
create index if not exists acervo_planos_alimentares_estado_publicacao_idx on public.acervo_planos_alimentares (estado_publicacao);
