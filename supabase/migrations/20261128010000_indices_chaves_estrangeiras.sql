-- Índice em toda chave estrangeira que não tinha um.
--
-- O advisor de performance do Supabase apontou 23. As tabelas estão quase
-- vazias hoje, e é exatamente por isso que a hora é agora: criar índice em
-- tabela com milhões de linhas é migration lenta e com lock; aqui é
-- instantâneo.
--
-- Por que importam, além das consultas óbvias:
--
--   - **Cascade.** `on delete cascade` a partir de `organizations` (ou de
--     `alunos`, `auth.users`...) procura as linhas filhas pela coluna da FK.
--     Sem índice, excluir uma academia varre cada tabela filha inteira — com
--     muitas academias, a exclusão de um tenant pesa sobre todos.
--   - **RLS.** As policies filtram por `organization_id`; as quatro tabelas
--     que mais crescem por aluno por dia (`mensagens_treino`,
--     `mensagens_dieta`, `treino_calendario`, `desafio_progresso`) não tinham
--     índice por ele.
--
-- A lista foi gerada do catálogo (FK cujo primeiro conjunto de colunas não é
-- prefixo de nenhum índice), não escrita à mão, e bate uma a uma com o advisor.

create index if not exists idx_aluno_fase_historico_organization_id on public.aluno_fase_historico (organization_id);
create index if not exists idx_alunos_metodo_arke_ativado_por on public.alunos (metodo_arke_ativado_por);
create index if not exists idx_avaliacoes_fisicas_avaliado_por on public.avaliacoes_fisicas (avaliado_por);
create index if not exists idx_cobrancas_b2b_criado_por on public.cobrancas_b2b (criado_por);
create index if not exists idx_desafio_progresso_aluno_id on public.desafio_progresso (aluno_id);
create index if not exists idx_desafio_progresso_concluido_por on public.desafio_progresso (concluido_por);
create index if not exists idx_desafio_progresso_organization_id on public.desafio_progresso (organization_id);
create index if not exists idx_importacoes_alunos_linhas_organization_id on public.importacoes_alunos_linhas (organization_id);
create index if not exists idx_links_ativacao_user_id on public.links_ativacao (user_id);
create index if not exists idx_mensagens_dieta_aluno_id on public.mensagens_dieta (aluno_id);
create index if not exists idx_mensagens_dieta_organization_id on public.mensagens_dieta (organization_id);
create index if not exists idx_mensagens_dieta_remetente_id on public.mensagens_dieta (remetente_id);
create index if not exists idx_mensagens_treino_organization_id on public.mensagens_treino (organization_id);
create index if not exists idx_mensagens_treino_remetente_id on public.mensagens_treino (remetente_id);
create index if not exists idx_modelos_dieta_criado_por on public.modelos_dieta (criado_por);
create index if not exists idx_modelos_treino_criado_por on public.modelos_treino (criado_por);
create index if not exists idx_modelos_treino_organization_id on public.modelos_treino (organization_id);
create index if not exists idx_organization_planos_precificacao_nivel_atacado on public.organization_planos_precificacao (nivel_atacado);
create index if not exists idx_plano_contas_categoria_pai_id on public.plano_contas (categoria_pai_id);
create index if not exists idx_plataforma_config_updated_by on public.plataforma_config (updated_by);
create index if not exists idx_registro_treino_treino_id on public.registro_treino (treino_id);
create index if not exists idx_staff_folha_user_id on public.staff_folha (user_id);
create index if not exists idx_treino_calendario_organization_id on public.treino_calendario (organization_id);
