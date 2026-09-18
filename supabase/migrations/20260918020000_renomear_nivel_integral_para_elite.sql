-- =====================================================================
-- Renomeia o nível de atacado "Integral" para "Elite" (topo de linha).
-- Custo de atacado (R$ 85) e sugestão de varejo (R$ 199) permanecem
-- inalterados — é apenas um rename de rótulo.
--
-- `ALTER TYPE ... RENAME VALUE` preserva todas as linhas que já usam o
-- valor do enum (planos_atacado.id, organization_planos_precificacao.
-- nivel_atacado, alunos.nivel_atacado, aluno_assinaturas.nivel_atacado):
-- nenhuma migração de dados é necessária.
-- =====================================================================

alter type public.nivel_atacado rename value 'integral' to 'elite';

update public.planos_atacado
  set nome = 'Elite (Acompanhamento 360°)'
  where id = 'elite';
