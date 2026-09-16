-- Fase 0 (Módulo Arke): isolamento multi-tenant nas tabelas herdadas do
-- arke-app. Confirmado antes desta migração: todas as tabelas abaixo têm
-- 0 linhas hoje, então organization_id entra direto como NOT NULL, sem
-- backfill. As policies antigas (has_role/qual=true) vêm do modelo
-- single-tenant do app original e permitem hoje leitura cross-tenant
-- (ex.: "Alunos can view desafios" com qual=true) — removidas aqui.
-- registro_treino/registro_serie já tinham sido corrigidas antes desta
-- sessão (join até treinos.organization_id) e não são tocadas, só
-- perdem a policy "Admin reads..." (resquício do modelo antigo).

-- ============ categoria: registro_treino/registro_serie (só limpeza) ============
drop policy if exists "Admin reads registros" on public.registro_treino;
drop policy if exists "Admin reads registro_serie" on public.registro_serie;

-- ============ categoria: pessoal, já seguro, sem organization_id (só limpeza) ============
drop policy if exists "Admin inserts notificacoes" on public.notificacoes;

-- ============ categoria 1: organization_id + staff, mantém policy de dono ============

alter table public.aluno_perfil add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_aluno_perfil_org on public.aluno_perfil(organization_id);
drop policy if exists "Aluno reads own perfil" on public.aluno_perfil;
drop policy if exists "Admin manages aluno_perfil" on public.aluno_perfil;
create policy "Aluno reads own perfil" on public.aluno_perfil for select using (user_id = auth.uid());
create policy "arke staff gerencia aluno_perfil da org" on public.aluno_perfil for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

alter table public.checkin_diario add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_checkin_diario_org on public.checkin_diario(organization_id);
drop policy if exists "Admin reads checkins" on public.checkin_diario;
create policy "arke staff le checkin_diario da org" on public.checkin_diario for select using (saas_is_org_staff(organization_id));

alter table public.avaliacao_semanal add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_avaliacao_semanal_org on public.avaliacao_semanal(organization_id);
drop policy if exists "Admin reads avaliacoes" on public.avaliacao_semanal;
create policy "arke staff le avaliacao_semanal da org" on public.avaliacao_semanal for select using (saas_is_org_staff(organization_id));

alter table public.rotina_semanal add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_rotina_semanal_org on public.rotina_semanal(organization_id);
create policy "arke staff le rotina_semanal da org" on public.rotina_semanal for select using (saas_is_org_staff(organization_id));

alter table public.plano_treino_semanal add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_plano_treino_semanal_org on public.plano_treino_semanal(organization_id);
create policy "arke staff le plano_treino_semanal da org" on public.plano_treino_semanal for select using (saas_is_org_staff(organization_id));

alter table public.compromisso_semanal add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_compromisso_semanal_org on public.compromisso_semanal(organization_id);
create policy "arke staff le compromisso_semanal da org" on public.compromisso_semanal for select using (saas_is_org_staff(organization_id));

alter table public.compromisso_metas add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_compromisso_metas_org on public.compromisso_metas(organization_id);
create policy "arke staff le compromisso_metas da org" on public.compromisso_metas for select using (saas_is_org_staff(organization_id));

alter table public.aluno_objetivos add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_aluno_objetivos_org on public.aluno_objetivos(organization_id);
create policy "arke staff le aluno_objetivos da org" on public.aluno_objetivos for select using (saas_is_org_staff(organization_id));

alter table public.aluno_valores add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_aluno_valores_org on public.aluno_valores(organization_id);
create policy "arke staff le aluno_valores da org" on public.aluno_valores for select using (saas_is_org_staff(organization_id));

alter table public.desafio_participantes add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_desafio_participantes_org on public.desafio_participantes(organization_id);
drop policy if exists "Admins can manage participants" on public.desafio_participantes;
create policy "arke staff gerencia desafio_participantes da org" on public.desafio_participantes for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

alter table public.desafio_progresso add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_desafio_progresso_org on public.desafio_progresso(organization_id);
drop policy if exists "Admins can manage progresso" on public.desafio_progresso;
create policy "arke staff gerencia desafio_progresso da org" on public.desafio_progresso for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

alter table public.competicao_participantes add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_competicao_participantes_org on public.competicao_participantes(organization_id);
drop policy if exists "Admins manage competicao_participantes" on public.competicao_participantes;
create policy "arke staff gerencia competicao_participantes da org" on public.competicao_participantes for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

alter table public.metricas_customizadas add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_metricas_customizadas_org on public.metricas_customizadas(organization_id);
drop policy if exists "Admin manages metricas" on public.metricas_customizadas;
create policy "arke staff gerencia metricas_customizadas da org" on public.metricas_customizadas for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

alter table public.metrica_valores add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_metrica_valores_org on public.metrica_valores(organization_id);
drop policy if exists "Admin manages metrica_valores" on public.metrica_valores;
create policy "arke staff gerencia metrica_valores da org" on public.metrica_valores for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

alter table public.progresso_semanal add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_progresso_semanal_org on public.progresso_semanal(organization_id);
drop policy if exists "Admin manages progresso" on public.progresso_semanal;
drop policy if exists "Admin reads progresso" on public.progresso_semanal;
create policy "arke staff gerencia progresso_semanal da org" on public.progresso_semanal for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

alter table public.mensagens_treino add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_mensagens_treino_org on public.mensagens_treino(organization_id);
drop policy if exists "Admin manages treino messages" on public.mensagens_treino;
create policy "arke staff gerencia mensagens_treino da org" on public.mensagens_treino for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

alter table public.mensagens_dieta add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_mensagens_dieta_org on public.mensagens_dieta(organization_id);
drop policy if exists "Admin manages diet messages" on public.mensagens_dieta;
create policy "arke staff gerencia mensagens_dieta da org" on public.mensagens_dieta for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

alter table public.treino_calendario add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_treino_calendario_org on public.treino_calendario(organization_id);
drop policy if exists "Admin reads calendario" on public.treino_calendario;
create policy "arke staff le treino_calendario da org" on public.treino_calendario for select using (saas_is_org_staff(organization_id));

alter table public.dieta_adesao add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_dieta_adesao_org on public.dieta_adesao(organization_id);
drop policy if exists "Admin reads adesao" on public.dieta_adesao;
create policy "arke staff le dieta_adesao da org" on public.dieta_adesao for select using (saas_is_org_staff(organization_id));

-- ============ categoria 2: conteúdo da organização (feed/desafios/competições/dicas) ============

alter table public.feed_posts add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_feed_posts_org on public.feed_posts(organization_id);
drop policy if exists "Authenticated can read feed posts" on public.feed_posts;
drop policy if exists "Admin deletes any post" on public.feed_posts;
create policy "arke membros leem feed_posts da org" on public.feed_posts for select using (saas_is_org_member(organization_id));
create policy "arke staff gerencia feed_posts da org" on public.feed_posts for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

alter table public.feed_likes add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_feed_likes_org on public.feed_likes(organization_id);
drop policy if exists "Authenticated can read likes" on public.feed_likes;
create policy "arke membros leem feed_likes da org" on public.feed_likes for select using (saas_is_org_member(organization_id));

alter table public.feed_comments add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_feed_comments_org on public.feed_comments(organization_id);
drop policy if exists "Authenticated can read comments" on public.feed_comments;
drop policy if exists "Admin deletes any comment" on public.feed_comments;
create policy "arke membros leem feed_comments da org" on public.feed_comments for select using (saas_is_org_member(organization_id));
create policy "arke staff apaga feed_comments da org" on public.feed_comments for delete using (saas_is_org_staff(organization_id));

alter table public.desafios add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_desafios_org on public.desafios(organization_id);
drop policy if exists "Alunos can view desafios" on public.desafios;
drop policy if exists "Admins can manage desafios" on public.desafios;
create policy "arke membros leem desafios da org" on public.desafios for select using (saas_is_org_member(organization_id));
create policy "arke staff gerencia desafios da org" on public.desafios for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

alter table public.competicoes add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_competicoes_org on public.competicoes(organization_id);
drop policy if exists "Alunos can view competicoes" on public.competicoes;
drop policy if exists "Admins manage competicoes" on public.competicoes;
create policy "arke membros leem competicoes da org" on public.competicoes for select using (saas_is_org_member(organization_id));
create policy "arke staff gerencia competicoes da org" on public.competicoes for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

alter table public.dicas_semanais add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_dicas_semanais_org on public.dicas_semanais(organization_id);
drop policy if exists "Authenticated reads active dicas" on public.dicas_semanais;
drop policy if exists "Admin manages dicas" on public.dicas_semanais;
create policy "arke membros leem dicas_semanais da org" on public.dicas_semanais for select using (ativa = true and saas_is_org_member(organization_id));
create policy "arke staff gerencia dicas_semanais da org" on public.dicas_semanais for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

-- ============ categoria 3: só staff, aluno nunca vê ============

alter table public.prontuario_observacoes add column organization_id uuid not null references public.saas_organizations(id) on delete cascade;
create index if not exists idx_prontuario_observacoes_org on public.prontuario_observacoes(organization_id);
drop policy if exists "Admins can manage prontuario_observacoes" on public.prontuario_observacoes;
create policy "arke staff gerencia prontuario_observacoes da org" on public.prontuario_observacoes for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));

-- ============ entitlement do módulo Arke ============

create table public.saas_arke_module (
  organization_id uuid primary key references public.saas_organizations(id) on delete cascade,
  enabled boolean not null default false,
  package_tier text check (package_tier in ('starter','growth','scale')),
  amount_cents integer,
  enabled_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.saas_arke_module enable row level security;
create policy "arke staff le modulo da propria org" on public.saas_arke_module for select using (saas_is_org_staff(organization_id));
create policy "arke admin gerencia modulo da propria org" on public.saas_arke_module for all using (saas_is_org_admin(organization_id)) with check (saas_is_org_admin(organization_id));

create table public.aluno_arke_licenca (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ativo boolean not null default false,
  ativado_em timestamptz,
  desativado_em timestamptz,
  ativado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index idx_aluno_arke_licenca_org on public.aluno_arke_licenca(organization_id);
alter table public.aluno_arke_licenca enable row level security;
create policy "arke aluno le propria licenca" on public.aluno_arke_licenca for select using (user_id = auth.uid());
create policy "arke staff gerencia licencas da org" on public.aluno_arke_licenca for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));
