-- Índices pras FKs sem cobertura apontadas pelo advisor de performance,
-- nas tabelas de Jornada/Evolução, Desafios/Competições, Feed Social,
-- Controle de Dieta e Métricas Customizadas. Toda consulta multitenant
-- filtra por organization_id (RLS inclusive), então essas colunas são
-- as que mais importam ter índice.

create index if not exists idx_aluno_objetivos_organization_id on public.aluno_objetivos (organization_id);
create index if not exists idx_aluno_valores_organization_id on public.aluno_valores (organization_id);

create index if not exists idx_competicao_participantes_aluno_id on public.competicao_participantes (aluno_id);
create index if not exists idx_competicao_participantes_organization_id on public.competicao_participantes (organization_id);

create index if not exists idx_competicoes_criado_por on public.competicoes (criado_por);
create index if not exists idx_competicoes_organization_id on public.competicoes (organization_id);

create index if not exists idx_compromisso_metas_compromisso_id on public.compromisso_metas (compromisso_id);
create index if not exists idx_compromisso_metas_organization_id on public.compromisso_metas (organization_id);

create index if not exists idx_compromisso_semanal_organization_id on public.compromisso_semanal (organization_id);

create index if not exists idx_desafio_participantes_aluno_id on public.desafio_participantes (aluno_id);
create index if not exists idx_desafio_participantes_organization_id on public.desafio_participantes (organization_id);

create index if not exists idx_desafios_criado_por on public.desafios (criado_por);
create index if not exists idx_desafios_organization_id on public.desafios (organization_id);

create index if not exists idx_dieta_adesao_dieta_id on public.dieta_adesao (dieta_id);
create index if not exists idx_dieta_adesao_organization_id on public.dieta_adesao (organization_id);

create index if not exists idx_feed_comments_organization_id on public.feed_comments (organization_id);
create index if not exists idx_feed_comments_user_id on public.feed_comments (user_id);

create index if not exists idx_feed_likes_organization_id on public.feed_likes (organization_id);
create index if not exists idx_feed_likes_user_id on public.feed_likes (user_id);

create index if not exists idx_feed_posts_user_id on public.feed_posts (user_id);

create index if not exists idx_metrica_valores_avaliacao_id on public.metrica_valores (avaliacao_id);
create index if not exists idx_metrica_valores_metrica_id on public.metrica_valores (metrica_id);
create index if not exists idx_metrica_valores_organization_id on public.metrica_valores (organization_id);

create index if not exists idx_metricas_customizadas_aluno_id on public.metricas_customizadas (aluno_id);
create index if not exists idx_metricas_customizadas_criado_por on public.metricas_customizadas (criado_por);
create index if not exists idx_metricas_customizadas_organization_id on public.metricas_customizadas (organization_id);
