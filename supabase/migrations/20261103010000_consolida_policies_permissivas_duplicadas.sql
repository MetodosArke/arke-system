-- Consolida os 13 pares de policies PERMISSIVE que colidem no mesmo
-- comando (mesmo cmd), reportados pelos performance advisors como
-- "multiple_permissive_policies". Postgres já fazia OR entre elas
-- implicitamente (esse é o comportamento de policies PERMISSIVE) —
-- então juntar em uma única policy com OR explícito é comportamento
-- IDÊNTICO, só evita avaliar duas expressões separadas por linha.
-- Os demais achados dessa categoria (ALL vs. cmd específico, ex.:
-- "staff gerencia tudo" + "aluno vê o próprio") ficam de fora: são
-- policies com formas diferentes (ALL x SELECT) e consolidá-las exigiria
-- quebrar a policy ALL em 4 policies por comando, risco/ganho pior.

-- 1) acessos_catraca_logs (SELECT)
drop policy "admin_arke ve todos os logs de acesso" on public.acessos_catraca_logs;
drop policy "staff ve logs de acesso da propria org" on public.acessos_catraca_logs;
create policy "staff/admin_arke vê logs de acesso"
  on public.acessos_catraca_logs for select
  using (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or is_org_staff((select auth.uid()), organization_id)
  );

-- 2) aluno_rotina_semanal (ALL)
drop policy "aluno gerencia a própria rotina semanal" on public.aluno_rotina_semanal;
drop policy "staff da org vê/gerencia rotina semanal dos alunos" on public.aluno_rotina_semanal;
create policy "aluno/staff gerencia rotina semanal"
  on public.aluno_rotina_semanal for all
  using (
    (exists (select 1 from alunos a where a.id = aluno_rotina_semanal.aluno_id and a.user_id = (select auth.uid())))
    or is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
  )
  with check (
    (exists (select 1 from alunos a where a.id = aluno_rotina_semanal.aluno_id and a.user_id = (select auth.uid())))
    or is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
  );

-- 3) anamnese_acolhimento (ALL)
drop policy "aluno gerencia a própria anamnese" on public.anamnese_acolhimento;
drop policy "staff da org vê/gerencia anamnese dos seus alunos" on public.anamnese_acolhimento;
create policy "aluno/staff gerencia anamnese"
  on public.anamnese_acolhimento for all
  using (
    (exists (select 1 from alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid())))
    or is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
  )
  with check (
    (exists (select 1 from alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid())))
    or is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
  );

-- 4) exercicios_biblioteca (ALL)
drop policy "admin_arke gerencia biblioteca global" on public.exercicios_biblioteca;
drop policy "gestor/professor gerencia a biblioteca da própria organizaçã" on public.exercicios_biblioteca;
create policy "admin_arke/gestor/professor gerencia biblioteca de exercícios"
  on public.exercicios_biblioteca for all
  using (
    (organization_id is null and has_role((select auth.uid()), 'admin_arke'::app_role))
    or (organization_id is not null and (
      has_org_role((select auth.uid()), organization_id, 'gestor'::app_role)
      or has_org_role((select auth.uid()), organization_id, 'professor'::app_role)
      or has_role((select auth.uid()), 'admin_arke'::app_role)
    ))
  )
  with check (
    (organization_id is null and has_role((select auth.uid()), 'admin_arke'::app_role))
    or (organization_id is not null and (
      has_org_role((select auth.uid()), organization_id, 'gestor'::app_role)
      or has_org_role((select auth.uid()), organization_id, 'professor'::app_role)
      or has_role((select auth.uid()), 'admin_arke'::app_role)
    ))
  );

-- 5) feed_comments (DELETE)
drop policy "autor apaga o próprio comentário" on public.feed_comments;
drop policy "staff da org apaga qualquer comentário" on public.feed_comments;
create policy "autor/staff apaga comentário"
  on public.feed_comments for delete
  using (
    user_id = (select auth.uid())
    or is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
  );

-- 6) feed_posts (DELETE)
drop policy "autor apaga o próprio post" on public.feed_posts;
drop policy "staff da org apaga qualquer post" on public.feed_posts;
create policy "autor/staff apaga post"
  on public.feed_posts for delete
  using (
    user_id = (select auth.uid())
    or is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
  );

-- 7) mensagens_dieta (ALL)
drop policy "aluno usa o próprio chat de nutrição" on public.mensagens_dieta;
drop policy "staff da org usa o chat de nutrição dos alunos" on public.mensagens_dieta;
create policy "aluno/staff usa chat de nutrição"
  on public.mensagens_dieta for all
  using (
    (exists (select 1 from alunos a where a.id = mensagens_dieta.aluno_id and a.user_id = (select auth.uid())))
    or is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
  )
  with check (
    (
      (exists (select 1 from alunos a where a.id = mensagens_dieta.aluno_id and a.user_id = (select auth.uid())))
      and remetente_id = (select auth.uid())
      and remetente_tipo = 'aluno'::remetente_tipo_dieta
    )
    or (
      (is_org_staff((select auth.uid()), organization_id) or has_role((select auth.uid()), 'admin_arke'::app_role))
      and remetente_id = (select auth.uid())
      and remetente_tipo = 'nutricionista'::remetente_tipo_dieta
    )
  );

-- 8) mensagens_treino (ALL)
drop policy "aluno usa o próprio chat de treino" on public.mensagens_treino;
drop policy "staff da org usa o chat de treino dos alunos" on public.mensagens_treino;
create policy "aluno/staff usa chat de treino"
  on public.mensagens_treino for all
  using (
    (exists (select 1 from alunos a where a.id = mensagens_treino.aluno_id and a.user_id = (select auth.uid())))
    or is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
  )
  with check (
    (
      (exists (select 1 from alunos a where a.id = mensagens_treino.aluno_id and a.user_id = (select auth.uid())))
      and remetente_id = (select auth.uid())
      and remetente_tipo = 'aluno'::remetente_tipo_treino
    )
    or (
      (is_org_staff((select auth.uid()), organization_id) or has_role((select auth.uid()), 'admin_arke'::app_role))
      and remetente_id = (select auth.uid())
      and remetente_tipo = 'treinador'::remetente_tipo_treino
    )
  );

-- 9) organizacao_catracas (ALL)
drop policy "admin_arke gerencia todas as catracas" on public.organizacao_catracas;
drop policy "staff gerencia catracas da propria org" on public.organizacao_catracas;
create policy "staff/admin_arke gerencia catracas"
  on public.organizacao_catracas for all
  using (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or is_org_staff((select auth.uid()), organization_id)
  )
  with check (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or is_org_staff((select auth.uid()), organization_id)
  );

-- 10) organizacao_credenciais_parceiro (ALL)
drop policy "admin_arke gerencia todas as credenciais de parceiro" on public.organizacao_credenciais_parceiro;
drop policy "gestor gerencia credenciais de parceiro da propria org" on public.organizacao_credenciais_parceiro;
create policy "gestor/admin_arke gerencia credenciais de parceiro"
  on public.organizacao_credenciais_parceiro for all
  using (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_org_role((select auth.uid()), organization_id, 'gestor'::app_role)
  )
  with check (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_org_role((select auth.uid()), organization_id, 'gestor'::app_role)
  );

-- 11) organizations (SELECT)
drop policy "admin_arke vê todas as organizações" on public.organizations;
drop policy "membros veem a própria organização" on public.organizations;
create policy "membros/admin_arke vê organização"
  on public.organizations for select
  using (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or is_org_member((select auth.uid()), id)
  );

-- 12) organizations (UPDATE)
drop policy "superadmin gerencia organizations" on public.organizations;
drop policy "gestor atualiza a própria organização" on public.organizations;
create policy "gestor/superadmin atualiza organização"
  on public.organizations for update
  using (
    has_role((select auth.uid()), 'superadmin'::app_role)
    or has_org_role((select auth.uid()), id, 'gestor'::app_role)
  )
  with check (
    has_role((select auth.uid()), 'superadmin'::app_role)
    or has_org_role((select auth.uid()), id, 'gestor'::app_role)
  );

-- 13) profiles (SELECT)
drop policy "admin_arke vê todos os perfis" on public.profiles;
drop policy "staff da organização vê perfis de membros da própria organi" on public.profiles;
create policy "staff/admin_arke vê perfis de membros"
  on public.profiles for select
  using (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or exists (
      select 1 from organization_members them
      where them.user_id = profiles.user_id
        and them.status = 'active'
        and (is_org_staff((select auth.uid()), them.organization_id) or has_role((select auth.uid()), 'admin_arke'::app_role))
    )
  );
