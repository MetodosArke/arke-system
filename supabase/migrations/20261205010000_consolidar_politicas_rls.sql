-- Consolidação das regras de acesso (RLS) duplicadas — 38 tabelas, 79 → 152.
--
-- O padrão era uma regra "equipe gerencia" (FOR ALL) somada a uma regra "aluno
-- vê o próprio" (FOR SELECT): na leitura, o Postgres avaliava as duas em toda
-- consulta. O advisor do Supabase acusa isso como "multiple permissive
-- policies" — custo de desempenho, não falha de segurança.
--
-- A consolidação é exata por construção: para cada tabela e operação, uma
-- regra só, cuja condição é o OU das condições que já valiam para aquela
-- operação — que é justamente como o Postgres combina regras permissivas. Na
-- inclusão e na alteração, a checagem do dado gravado também é o OU, com a
-- condição de acesso fazendo as vezes de checagem quando a regra original não
-- tinha uma (de novo, o comportamento do próprio Postgres). Cada regra nova
-- leva em comentário os nomes das originais que consolida.
--
-- Única mudança de papel: exercicios_biblioteca tinha duas regras TO public;
-- viraram TO authenticated. As duas exigem papel de usuário logado (has_role /
-- has_org_role com auth.uid()), então o visitante anônimo nunca passou por
-- elas — confirmado no teste abaixo.
--
-- Este arquivo foi GERADO a partir de pg_policies (o gerador está no histórico
-- da sessão de 21/09/2026) e aplicado pelo mesmo gerador dentro do banco; o
-- registro em supabase_migrations.schema_migrations ('consolidar_politicas_rls')
-- guarda também o SQL de volta, na coluna rollback.
--
-- Verificação em produção, 21/09/2026: 12 identidades (anônimo, 2 Super Admins,
-- gestor, professor, nutricionista, 5 alunos, conta E2E) × 38 tabelas, contando
-- as linhas visíveis antes e depois — 456 medições, 0 divergências. Escritas
-- testadas em transação revertida: aluno não cria treino nem se dá papel nem
-- grava na biblioteca; gestor cria treino e exercício da própria academia, não
-- global; Super Admin grava global, não de academia; anônimo não grava nada.

-- agendamentos
drop policy "aluno agenda a própria vaga" on public.agendamentos;
drop policy "aluno cancela o próprio agendamento" on public.agendamentos;
drop policy "aluno vê os próprios agendamentos" on public.agendamentos;
drop policy "staff da org gerencia agendamentos" on public.agendamentos;
create policy leitura on public.agendamentos for select to authenticated
  using (
    ((aluno_id IN ( SELECT a.id
   FROM alunos a
  WHERE (a.user_id = ( SELECT auth.uid() AS uid)))))
    OR (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy leitura on public.agendamentos is 'Consolida: aluno vê os próprios agendamentos; staff da org gerencia agendamentos';
create policy "inclusão" on public.agendamentos for insert to authenticated
  with check (
    (((status = ANY (ARRAY['agendado'::agendamento_status, 'lista_espera'::agendamento_status])) AND (EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = agendamentos.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid)) AND (a.organization_id = agendamentos.organization_id))))))
    OR (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "inclusão" on public.agendamentos is 'Consolida: aluno agenda a própria vaga; staff da org gerencia agendamentos';
create policy "alteração" on public.agendamentos for update to authenticated
  using (
    ((aluno_id IN ( SELECT a.id
   FROM alunos a
  WHERE (a.user_id = ( SELECT auth.uid() AS uid)))))
    OR (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  )
  with check (
    ((status = 'cancelado'::agendamento_status))
    OR (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "alteração" on public.agendamentos is 'Consolida: aluno cancela o próprio agendamento; staff da org gerencia agendamentos';
create policy "exclusão" on public.agendamentos for delete to authenticated
  using (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "exclusão" on public.agendamentos is 'Consolida: staff da org gerencia agendamentos';

-- alimentos_biblioteca
drop policy "admin_arke gerencia a biblioteca de alimentos" on public.alimentos_biblioteca;
drop policy "staff le a biblioteca de alimentos" on public.alimentos_biblioteca;
create policy leitura on public.alimentos_biblioteca for select to authenticated
  using (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
    OR (true)
  );
comment on policy leitura on public.alimentos_biblioteca is 'Consolida: admin_arke gerencia a biblioteca de alimentos; staff le a biblioteca de alimentos';
create policy "inclusão" on public.alimentos_biblioteca for insert to authenticated
  with check (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  );
comment on policy "inclusão" on public.alimentos_biblioteca is 'Consolida: admin_arke gerencia a biblioteca de alimentos';
create policy "alteração" on public.alimentos_biblioteca for update to authenticated
  using (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  )
  with check (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  );
comment on policy "alteração" on public.alimentos_biblioteca is 'Consolida: admin_arke gerencia a biblioteca de alimentos';
create policy "exclusão" on public.alimentos_biblioteca for delete to authenticated
  using (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  );
comment on policy "exclusão" on public.alimentos_biblioteca is 'Consolida: admin_arke gerencia a biblioteca de alimentos';

-- aluno_assinaturas
drop policy "aluno vê a própria assinatura" on public.aluno_assinaturas;
drop policy "staff da org vê/gerencia assinaturas dos seus alunos" on public.aluno_assinaturas;
create policy leitura on public.aluno_assinaturas for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = aluno_assinaturas.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.aluno_assinaturas is 'Consolida: aluno vê a própria assinatura; staff da org vê/gerencia assinaturas dos seus alunos';
create policy "inclusão" on public.aluno_assinaturas for insert to authenticated
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.aluno_assinaturas is 'Consolida: staff da org vê/gerencia assinaturas dos seus alunos';
create policy "alteração" on public.aluno_assinaturas for update to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.aluno_assinaturas is 'Consolida: staff da org vê/gerencia assinaturas dos seus alunos';
create policy "exclusão" on public.aluno_assinaturas for delete to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.aluno_assinaturas is 'Consolida: staff da org vê/gerencia assinaturas dos seus alunos';

-- aluno_consentimento_biometrico
drop policy "aluno vê o próprio consentimento biométrico" on public.aluno_consentimento_biometrico;
drop policy "staff da org gerencia consentimento biométrico dos seus alunos" on public.aluno_consentimento_biometrico;
create policy leitura on public.aluno_consentimento_biometrico for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = aluno_consentimento_biometrico.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'superadmin'::app_role)))
  );
comment on policy leitura on public.aluno_consentimento_biometrico is 'Consolida: aluno vê o próprio consentimento biométrico; staff da org gerencia consentimento biométrico dos seus alunos';
create policy "inclusão" on public.aluno_consentimento_biometrico for insert to authenticated
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'superadmin'::app_role)))
  );
comment on policy "inclusão" on public.aluno_consentimento_biometrico is 'Consolida: staff da org gerencia consentimento biométrico dos seus alunos';
create policy "alteração" on public.aluno_consentimento_biometrico for update to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'superadmin'::app_role)))
  )
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'superadmin'::app_role)))
  );
comment on policy "alteração" on public.aluno_consentimento_biometrico is 'Consolida: staff da org gerencia consentimento biométrico dos seus alunos';
create policy "exclusão" on public.aluno_consentimento_biometrico for delete to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'superadmin'::app_role)))
  );
comment on policy "exclusão" on public.aluno_consentimento_biometrico is 'Consolida: staff da org gerencia consentimento biométrico dos seus alunos';

-- aluno_matriculas_academia
drop policy "aluno vê a própria matrícula" on public.aluno_matriculas_academia;
drop policy "staff da org gerencia matrículas" on public.aluno_matriculas_academia;
create policy leitura on public.aluno_matriculas_academia for select to authenticated
  using (
    ((aluno_id IN ( SELECT a.id
   FROM alunos a
  WHERE (a.user_id = ( SELECT auth.uid() AS uid)))))
    OR (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy leitura on public.aluno_matriculas_academia is 'Consolida: aluno vê a própria matrícula; staff da org gerencia matrículas';
create policy "inclusão" on public.aluno_matriculas_academia for insert to authenticated
  with check (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "inclusão" on public.aluno_matriculas_academia is 'Consolida: staff da org gerencia matrículas';
create policy "alteração" on public.aluno_matriculas_academia for update to authenticated
  using (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  )
  with check (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "alteração" on public.aluno_matriculas_academia is 'Consolida: staff da org gerencia matrículas';
create policy "exclusão" on public.aluno_matriculas_academia for delete to authenticated
  using (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "exclusão" on public.aluno_matriculas_academia is 'Consolida: staff da org gerencia matrículas';

-- aluno_objetivos
drop policy "aluno gerencia os próprios objetivos" on public.aluno_objetivos;
drop policy "staff da org vê os objetivos dos alunos" on public.aluno_objetivos;
create policy leitura on public.aluno_objetivos for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = aluno_objetivos.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.aluno_objetivos is 'Consolida: aluno gerencia os próprios objetivos; staff da org vê os objetivos dos alunos';
create policy "inclusão" on public.aluno_objetivos for insert to authenticated
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = aluno_objetivos.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "inclusão" on public.aluno_objetivos is 'Consolida: aluno gerencia os próprios objetivos';
create policy "alteração" on public.aluno_objetivos for update to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = aluno_objetivos.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  )
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = aluno_objetivos.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "alteração" on public.aluno_objetivos is 'Consolida: aluno gerencia os próprios objetivos';
create policy "exclusão" on public.aluno_objetivos for delete to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = aluno_objetivos.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "exclusão" on public.aluno_objetivos is 'Consolida: aluno gerencia os próprios objetivos';

-- aluno_valores
drop policy "aluno gerencia os próprios valores-guia" on public.aluno_valores;
drop policy "staff da org vê os valores-guia dos alunos" on public.aluno_valores;
create policy leitura on public.aluno_valores for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = aluno_valores.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.aluno_valores is 'Consolida: aluno gerencia os próprios valores-guia; staff da org vê os valores-guia dos alunos';
create policy "inclusão" on public.aluno_valores for insert to authenticated
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = aluno_valores.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "inclusão" on public.aluno_valores is 'Consolida: aluno gerencia os próprios valores-guia';
create policy "alteração" on public.aluno_valores for update to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = aluno_valores.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  )
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = aluno_valores.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "alteração" on public.aluno_valores is 'Consolida: aluno gerencia os próprios valores-guia';
create policy "exclusão" on public.aluno_valores for delete to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = aluno_valores.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "exclusão" on public.aluno_valores is 'Consolida: aluno gerencia os próprios valores-guia';

-- alunos
drop policy "aluno vê o próprio cadastro" on public.alunos;
drop policy "staff da org vê/gerencia alunos" on public.alunos;
create policy leitura on public.alunos for select to authenticated
  using (
    ((user_id = ( SELECT auth.uid() AS uid)))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.alunos is 'Consolida: aluno vê o próprio cadastro; staff da org vê/gerencia alunos';
create policy "inclusão" on public.alunos for insert to authenticated
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.alunos is 'Consolida: staff da org vê/gerencia alunos';
create policy "alteração" on public.alunos for update to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.alunos is 'Consolida: staff da org vê/gerencia alunos';
create policy "exclusão" on public.alunos for delete to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.alunos is 'Consolida: staff da org vê/gerencia alunos';

-- avaliacoes_fisicas
drop policy "aluno vê as próprias avaliações físicas" on public.avaliacoes_fisicas;
drop policy "staff da org gerencia avaliações físicas dos seus alunos" on public.avaliacoes_fisicas;
create policy leitura on public.avaliacoes_fisicas for select to authenticated
  using (
    ((aluno_id IN ( SELECT a.id
   FROM alunos a
  WHERE (a.user_id = ( SELECT auth.uid() AS uid)))))
    OR (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy leitura on public.avaliacoes_fisicas is 'Consolida: aluno vê as próprias avaliações físicas; staff da org gerencia avaliações físicas dos seus alunos';
create policy "inclusão" on public.avaliacoes_fisicas for insert to authenticated
  with check (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "inclusão" on public.avaliacoes_fisicas is 'Consolida: staff da org gerencia avaliações físicas dos seus alunos';
create policy "alteração" on public.avaliacoes_fisicas for update to authenticated
  using (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  )
  with check (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "alteração" on public.avaliacoes_fisicas is 'Consolida: staff da org gerencia avaliações físicas dos seus alunos';
create policy "exclusão" on public.avaliacoes_fisicas for delete to authenticated
  using (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "exclusão" on public.avaliacoes_fisicas is 'Consolida: staff da org gerencia avaliações físicas dos seus alunos';

-- checkins
drop policy "aluno registra e vê os próprios checkins" on public.checkins;
drop policy "staff da org vê checkins dos seus alunos" on public.checkins;
create policy leitura on public.checkins for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = checkins.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.checkins is 'Consolida: aluno registra e vê os próprios checkins; staff da org vê checkins dos seus alunos';
create policy "inclusão" on public.checkins for insert to authenticated
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = checkins.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "inclusão" on public.checkins is 'Consolida: aluno registra e vê os próprios checkins';
create policy "alteração" on public.checkins for update to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = checkins.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  )
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = checkins.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "alteração" on public.checkins is 'Consolida: aluno registra e vê os próprios checkins';
create policy "exclusão" on public.checkins for delete to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = checkins.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "exclusão" on public.checkins is 'Consolida: aluno registra e vê os próprios checkins';

-- competicao_participantes
drop policy "aluno vê a própria participação em competições" on public.competicao_participantes;
drop policy "staff da org gerencia participantes de competições" on public.competicao_participantes;
create policy leitura on public.competicao_participantes for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = competicao_participantes.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.competicao_participantes is 'Consolida: aluno vê a própria participação em competições; staff da org gerencia participantes de competições';
create policy "inclusão" on public.competicao_participantes for insert to authenticated
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.competicao_participantes is 'Consolida: staff da org gerencia participantes de competições';
create policy "alteração" on public.competicao_participantes for update to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.competicao_participantes is 'Consolida: staff da org gerencia participantes de competições';
create policy "exclusão" on public.competicao_participantes for delete to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.competicao_participantes is 'Consolida: staff da org gerencia participantes de competições';

-- competicoes
drop policy "aluno vê competições para todos ou em que foi cadastrado" on public.competicoes;
drop policy "staff da org gerencia competições" on public.competicoes;
create policy leitura on public.competicoes for select to authenticated
  using (
    ((para_todos OR (EXISTS ( SELECT 1
   FROM (competicao_participantes cp
     JOIN alunos a ON ((a.id = cp.aluno_id)))
  WHERE ((cp.competicao_id = competicoes.id) AND (a.user_id = ( SELECT auth.uid() AS uid)))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.competicoes is 'Consolida: aluno vê competições para todos ou em que foi cadastrado; staff da org gerencia competições';
create policy "inclusão" on public.competicoes for insert to authenticated
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.competicoes is 'Consolida: staff da org gerencia competições';
create policy "alteração" on public.competicoes for update to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.competicoes is 'Consolida: staff da org gerencia competições';
create policy "exclusão" on public.competicoes for delete to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.competicoes is 'Consolida: staff da org gerencia competições';

-- compromisso_metas
drop policy "aluno gerencia as próprias metas do compromisso" on public.compromisso_metas;
drop policy "staff da org vê as metas do compromisso dos alunos" on public.compromisso_metas;
create policy leitura on public.compromisso_metas for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM (compromisso_semanal cs
     JOIN alunos a ON ((a.id = cs.aluno_id)))
  WHERE ((cs.id = compromisso_metas.compromisso_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.compromisso_metas is 'Consolida: aluno gerencia as próprias metas do compromisso; staff da org vê as metas do compromisso dos alunos';
create policy "inclusão" on public.compromisso_metas for insert to authenticated
  with check (
    ((EXISTS ( SELECT 1
   FROM (compromisso_semanal cs
     JOIN alunos a ON ((a.id = cs.aluno_id)))
  WHERE ((cs.id = compromisso_metas.compromisso_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "inclusão" on public.compromisso_metas is 'Consolida: aluno gerencia as próprias metas do compromisso';
create policy "alteração" on public.compromisso_metas for update to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM (compromisso_semanal cs
     JOIN alunos a ON ((a.id = cs.aluno_id)))
  WHERE ((cs.id = compromisso_metas.compromisso_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  )
  with check (
    ((EXISTS ( SELECT 1
   FROM (compromisso_semanal cs
     JOIN alunos a ON ((a.id = cs.aluno_id)))
  WHERE ((cs.id = compromisso_metas.compromisso_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "alteração" on public.compromisso_metas is 'Consolida: aluno gerencia as próprias metas do compromisso';
create policy "exclusão" on public.compromisso_metas for delete to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM (compromisso_semanal cs
     JOIN alunos a ON ((a.id = cs.aluno_id)))
  WHERE ((cs.id = compromisso_metas.compromisso_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "exclusão" on public.compromisso_metas is 'Consolida: aluno gerencia as próprias metas do compromisso';

-- compromisso_semanal
drop policy "aluno gerencia o próprio compromisso semanal" on public.compromisso_semanal;
drop policy "staff da org vê o compromisso semanal dos alunos" on public.compromisso_semanal;
create policy leitura on public.compromisso_semanal for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = compromisso_semanal.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.compromisso_semanal is 'Consolida: aluno gerencia o próprio compromisso semanal; staff da org vê o compromisso semanal dos alunos';
create policy "inclusão" on public.compromisso_semanal for insert to authenticated
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = compromisso_semanal.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "inclusão" on public.compromisso_semanal is 'Consolida: aluno gerencia o próprio compromisso semanal';
create policy "alteração" on public.compromisso_semanal for update to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = compromisso_semanal.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  )
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = compromisso_semanal.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "alteração" on public.compromisso_semanal is 'Consolida: aluno gerencia o próprio compromisso semanal';
create policy "exclusão" on public.compromisso_semanal for delete to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = compromisso_semanal.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "exclusão" on public.compromisso_semanal is 'Consolida: aluno gerencia o próprio compromisso semanal';

-- desafio_participantes
drop policy "aluno vê a própria participação em desafios" on public.desafio_participantes;
drop policy "staff da org gerencia participantes de desafios" on public.desafio_participantes;
create policy leitura on public.desafio_participantes for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = desafio_participantes.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.desafio_participantes is 'Consolida: aluno vê a própria participação em desafios; staff da org gerencia participantes de desafios';
create policy "inclusão" on public.desafio_participantes for insert to authenticated
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.desafio_participantes is 'Consolida: staff da org gerencia participantes de desafios';
create policy "alteração" on public.desafio_participantes for update to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.desafio_participantes is 'Consolida: staff da org gerencia participantes de desafios';
create policy "exclusão" on public.desafio_participantes for delete to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.desafio_participantes is 'Consolida: staff da org gerencia participantes de desafios';

-- desafio_progresso
drop policy "aluno vê o próprio progresso em desafios" on public.desafio_progresso;
drop policy "staff da org gerencia progresso de desafios" on public.desafio_progresso;
create policy leitura on public.desafio_progresso for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = desafio_progresso.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.desafio_progresso is 'Consolida: aluno vê o próprio progresso em desafios; staff da org gerencia progresso de desafios';
create policy "inclusão" on public.desafio_progresso for insert to authenticated
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.desafio_progresso is 'Consolida: staff da org gerencia progresso de desafios';
create policy "alteração" on public.desafio_progresso for update to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.desafio_progresso is 'Consolida: staff da org gerencia progresso de desafios';
create policy "exclusão" on public.desafio_progresso for delete to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.desafio_progresso is 'Consolida: staff da org gerencia progresso de desafios';

-- desafios
drop policy "aluno vê desafios para todos ou em que foi cadastrado" on public.desafios;
drop policy "staff da org gerencia desafios" on public.desafios;
create policy leitura on public.desafios for select to authenticated
  using (
    ((para_todos OR (EXISTS ( SELECT 1
   FROM (desafio_participantes dp
     JOIN alunos a ON ((a.id = dp.aluno_id)))
  WHERE ((dp.desafio_id = desafios.id) AND (a.user_id = ( SELECT auth.uid() AS uid)))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.desafios is 'Consolida: aluno vê desafios para todos ou em que foi cadastrado; staff da org gerencia desafios';
create policy "inclusão" on public.desafios for insert to authenticated
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.desafios is 'Consolida: staff da org gerencia desafios';
create policy "alteração" on public.desafios for update to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.desafios is 'Consolida: staff da org gerencia desafios';
create policy "exclusão" on public.desafios for delete to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.desafios is 'Consolida: staff da org gerencia desafios';

-- dieta_adesao
drop policy "aluno gerencia a própria adesão à dieta" on public.dieta_adesao;
drop policy "staff da org vê a adesão à dieta dos alunos" on public.dieta_adesao;
create policy leitura on public.dieta_adesao for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = dieta_adesao.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.dieta_adesao is 'Consolida: aluno gerencia a própria adesão à dieta; staff da org vê a adesão à dieta dos alunos';
create policy "inclusão" on public.dieta_adesao for insert to authenticated
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = dieta_adesao.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "inclusão" on public.dieta_adesao is 'Consolida: aluno gerencia a própria adesão à dieta';
create policy "alteração" on public.dieta_adesao for update to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = dieta_adesao.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  )
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = dieta_adesao.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "alteração" on public.dieta_adesao is 'Consolida: aluno gerencia a própria adesão à dieta';
create policy "exclusão" on public.dieta_adesao for delete to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = dieta_adesao.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "exclusão" on public.dieta_adesao is 'Consolida: aluno gerencia a própria adesão à dieta';

-- dietas
drop policy "aluno vê as próprias dietas" on public.dietas;
drop policy "staff da org gerencia dietas" on public.dietas;
create policy leitura on public.dietas for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = dietas.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.dietas is 'Consolida: aluno vê as próprias dietas; staff da org gerencia dietas';
create policy "inclusão" on public.dietas for insert to authenticated
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.dietas is 'Consolida: staff da org gerencia dietas';
create policy "alteração" on public.dietas for update to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.dietas is 'Consolida: staff da org gerencia dietas';
create policy "exclusão" on public.dietas for delete to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.dietas is 'Consolida: staff da org gerencia dietas';

-- exercicios_biblioteca
drop policy "gestor/professor gerencia biblioteca da própria organização" on public.exercicios_biblioteca;
drop policy "staff lê exercícios globais e da própria organização" on public.exercicios_biblioteca;
drop policy "superadmin gerencia biblioteca global" on public.exercicios_biblioteca;
create policy leitura on public.exercicios_biblioteca for select to authenticated
  using (
    (((organization_id IS NOT NULL) AND (has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_org_role(( SELECT auth.uid() AS uid), organization_id, 'professor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))))
    OR (((organization_id IS NULL) OR is_org_member(( SELECT auth.uid() AS uid), organization_id)))
    OR (((organization_id IS NULL) AND has_role(( SELECT auth.uid() AS uid), 'superadmin'::app_role)))
  );
comment on policy leitura on public.exercicios_biblioteca is 'Consolida: gestor/professor gerencia biblioteca da própria organização; staff lê exercícios globais e da própria organização; superadmin gerencia biblioteca global';
create policy "inclusão" on public.exercicios_biblioteca for insert to authenticated
  with check (
    (((organization_id IS NOT NULL) AND (has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_org_role(( SELECT auth.uid() AS uid), organization_id, 'professor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))))
    OR (((organization_id IS NULL) AND has_role(( SELECT auth.uid() AS uid), 'superadmin'::app_role)))
  );
comment on policy "inclusão" on public.exercicios_biblioteca is 'Consolida: gestor/professor gerencia biblioteca da própria organização; superadmin gerencia biblioteca global';
create policy "alteração" on public.exercicios_biblioteca for update to authenticated
  using (
    (((organization_id IS NOT NULL) AND (has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_org_role(( SELECT auth.uid() AS uid), organization_id, 'professor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))))
    OR (((organization_id IS NULL) AND has_role(( SELECT auth.uid() AS uid), 'superadmin'::app_role)))
  )
  with check (
    (((organization_id IS NOT NULL) AND (has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_org_role(( SELECT auth.uid() AS uid), organization_id, 'professor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))))
    OR (((organization_id IS NULL) AND has_role(( SELECT auth.uid() AS uid), 'superadmin'::app_role)))
  );
comment on policy "alteração" on public.exercicios_biblioteca is 'Consolida: gestor/professor gerencia biblioteca da própria organização; superadmin gerencia biblioteca global';
create policy "exclusão" on public.exercicios_biblioteca for delete to authenticated
  using (
    (((organization_id IS NOT NULL) AND (has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_org_role(( SELECT auth.uid() AS uid), organization_id, 'professor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))))
    OR (((organization_id IS NULL) AND has_role(( SELECT auth.uid() AS uid), 'superadmin'::app_role)))
  );
comment on policy "exclusão" on public.exercicios_biblioteca is 'Consolida: gestor/professor gerencia biblioteca da própria organização; superadmin gerencia biblioteca global';

-- feed_likes
drop policy "membro da org gerencia as próprias curtidas" on public.feed_likes;
drop policy "membro da org vê as curtidas do feed" on public.feed_likes;
create policy leitura on public.feed_likes for select to authenticated
  using (
    ((user_id = ( SELECT auth.uid() AS uid)))
    OR (is_org_member(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy leitura on public.feed_likes is 'Consolida: membro da org gerencia as próprias curtidas; membro da org vê as curtidas do feed';
create policy "inclusão" on public.feed_likes for insert to authenticated
  with check (
    (((user_id = ( SELECT auth.uid() AS uid)) AND is_org_member(( SELECT auth.uid() AS uid), organization_id)))
  );
comment on policy "inclusão" on public.feed_likes is 'Consolida: membro da org gerencia as próprias curtidas';
create policy "alteração" on public.feed_likes for update to authenticated
  using (
    ((user_id = ( SELECT auth.uid() AS uid)))
  )
  with check (
    (((user_id = ( SELECT auth.uid() AS uid)) AND is_org_member(( SELECT auth.uid() AS uid), organization_id)))
  );
comment on policy "alteração" on public.feed_likes is 'Consolida: membro da org gerencia as próprias curtidas';
create policy "exclusão" on public.feed_likes for delete to authenticated
  using (
    ((user_id = ( SELECT auth.uid() AS uid)))
  );
comment on policy "exclusão" on public.feed_likes is 'Consolida: membro da org gerencia as próprias curtidas';

-- mensalidades
drop policy "aluno vê as próprias mensalidades" on public.mensalidades;
drop policy "staff da org gerencia mensalidades" on public.mensalidades;
create policy leitura on public.mensalidades for select to authenticated
  using (
    ((aluno_id IN ( SELECT a.id
   FROM alunos a
  WHERE (a.user_id = ( SELECT auth.uid() AS uid)))))
    OR (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy leitura on public.mensalidades is 'Consolida: aluno vê as próprias mensalidades; staff da org gerencia mensalidades';
create policy "inclusão" on public.mensalidades for insert to authenticated
  with check (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "inclusão" on public.mensalidades is 'Consolida: staff da org gerencia mensalidades';
create policy "alteração" on public.mensalidades for update to authenticated
  using (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  )
  with check (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "alteração" on public.mensalidades is 'Consolida: staff da org gerencia mensalidades';
create policy "exclusão" on public.mensalidades for delete to authenticated
  using (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "exclusão" on public.mensalidades is 'Consolida: staff da org gerencia mensalidades';

-- metrica_valores
drop policy "aluno vê os próprios valores de métricas customizadas" on public.metrica_valores;
drop policy "staff da org gerencia valores de métricas customizadas" on public.metrica_valores;
create policy leitura on public.metrica_valores for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM (avaliacoes_fisicas af
     JOIN alunos a ON ((a.id = af.aluno_id)))
  WHERE ((af.id = metrica_valores.avaliacao_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.metrica_valores is 'Consolida: aluno vê os próprios valores de métricas customizadas; staff da org gerencia valores de métricas customizadas';
create policy "inclusão" on public.metrica_valores for insert to authenticated
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.metrica_valores is 'Consolida: staff da org gerencia valores de métricas customizadas';
create policy "alteração" on public.metrica_valores for update to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.metrica_valores is 'Consolida: staff da org gerencia valores de métricas customizadas';
create policy "exclusão" on public.metrica_valores for delete to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.metrica_valores is 'Consolida: staff da org gerencia valores de métricas customizadas';

-- metricas_customizadas
drop policy "aluno vê as próprias métricas customizadas" on public.metricas_customizadas;
drop policy "staff da org gerencia métricas customizadas" on public.metricas_customizadas;
create policy leitura on public.metricas_customizadas for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = metricas_customizadas.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.metricas_customizadas is 'Consolida: aluno vê as próprias métricas customizadas; staff da org gerencia métricas customizadas';
create policy "inclusão" on public.metricas_customizadas for insert to authenticated
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.metricas_customizadas is 'Consolida: staff da org gerencia métricas customizadas';
create policy "alteração" on public.metricas_customizadas for update to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.metricas_customizadas is 'Consolida: staff da org gerencia métricas customizadas';
create policy "exclusão" on public.metricas_customizadas for delete to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.metricas_customizadas is 'Consolida: staff da org gerencia métricas customizadas';

-- organization_members
drop policy "gestor gerencia membros da própria organização" on public.organization_members;
drop policy "membros veem membros da própria organização" on public.organization_members;
create policy leitura on public.organization_members for select to authenticated
  using (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
    OR ((is_org_member(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.organization_members is 'Consolida: gestor gerencia membros da própria organização; membros veem membros da própria organização';
create policy "inclusão" on public.organization_members for insert to authenticated
  with check (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.organization_members is 'Consolida: gestor gerencia membros da própria organização';
create policy "alteração" on public.organization_members for update to authenticated
  using (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.organization_members is 'Consolida: gestor gerencia membros da própria organização';
create policy "exclusão" on public.organization_members for delete to authenticated
  using (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.organization_members is 'Consolida: gestor gerencia membros da própria organização';

-- organization_planos_precificacao
drop policy "gestor define a própria precificação (markup)" on public.organization_planos_precificacao;
drop policy "org vê a própria precificação" on public.organization_planos_precificacao;
create policy leitura on public.organization_planos_precificacao for select to authenticated
  using (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
    OR ((is_org_member(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.organization_planos_precificacao is 'Consolida: gestor define a própria precificação (markup); org vê a própria precificação';
create policy "inclusão" on public.organization_planos_precificacao for insert to authenticated
  with check (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.organization_planos_precificacao is 'Consolida: gestor define a própria precificação (markup)';
create policy "alteração" on public.organization_planos_precificacao for update to authenticated
  using (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.organization_planos_precificacao is 'Consolida: gestor define a própria precificação (markup)';
create policy "exclusão" on public.organization_planos_precificacao for delete to authenticated
  using (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.organization_planos_precificacao is 'Consolida: gestor define a própria precificação (markup)';

-- planos_academia
drop policy "aluno vê os planos da própria organização" on public.planos_academia;
drop policy "staff da org gerencia planos_academia" on public.planos_academia;
create policy leitura on public.planos_academia for select to authenticated
  using (
    (is_org_member(( SELECT auth.uid() AS uid), organization_id))
    OR (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy leitura on public.planos_academia is 'Consolida: aluno vê os planos da própria organização; staff da org gerencia planos_academia';
create policy "inclusão" on public.planos_academia for insert to authenticated
  with check (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "inclusão" on public.planos_academia is 'Consolida: staff da org gerencia planos_academia';
create policy "alteração" on public.planos_academia for update to authenticated
  using (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  )
  with check (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "alteração" on public.planos_academia is 'Consolida: staff da org gerencia planos_academia';
create policy "exclusão" on public.planos_academia for delete to authenticated
  using (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "exclusão" on public.planos_academia is 'Consolida: staff da org gerencia planos_academia';

-- planos_atacado
drop policy "admin_arke gerencia catálogo de atacado" on public.planos_atacado;
drop policy "leitura pública autenticada do catálogo de atacado" on public.planos_atacado;
create policy leitura on public.planos_atacado for select to authenticated
  using (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
    OR (true)
  );
comment on policy leitura on public.planos_atacado is 'Consolida: admin_arke gerencia catálogo de atacado; leitura pública autenticada do catálogo de atacado';
create policy "inclusão" on public.planos_atacado for insert to authenticated
  with check (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  );
comment on policy "inclusão" on public.planos_atacado is 'Consolida: admin_arke gerencia catálogo de atacado';
create policy "alteração" on public.planos_atacado for update to authenticated
  using (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  )
  with check (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  );
comment on policy "alteração" on public.planos_atacado is 'Consolida: admin_arke gerencia catálogo de atacado';
create policy "exclusão" on public.planos_atacado for delete to authenticated
  using (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  );
comment on policy "exclusão" on public.planos_atacado is 'Consolida: admin_arke gerencia catálogo de atacado';

-- registro_habito
drop policy "aluno gerencia o próprio diário de hábitos" on public.registro_habito;
drop policy "staff da org vê diário de hábitos dos seus alunos" on public.registro_habito;
create policy leitura on public.registro_habito for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = registro_habito.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.registro_habito is 'Consolida: aluno gerencia o próprio diário de hábitos; staff da org vê diário de hábitos dos seus alunos';
create policy "inclusão" on public.registro_habito for insert to authenticated
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = registro_habito.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "inclusão" on public.registro_habito is 'Consolida: aluno gerencia o próprio diário de hábitos';
create policy "alteração" on public.registro_habito for update to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = registro_habito.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  )
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = registro_habito.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "alteração" on public.registro_habito is 'Consolida: aluno gerencia o próprio diário de hábitos';
create policy "exclusão" on public.registro_habito for delete to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = registro_habito.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "exclusão" on public.registro_habito is 'Consolida: aluno gerencia o próprio diário de hábitos';

-- registro_treino
drop policy "aluno registra e vê os próprios treinos executados" on public.registro_treino;
drop policy "staff da org vê registros de treino dos seus alunos" on public.registro_treino;
create policy leitura on public.registro_treino for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = registro_treino.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.registro_treino is 'Consolida: aluno registra e vê os próprios treinos executados; staff da org vê registros de treino dos seus alunos';
create policy "inclusão" on public.registro_treino for insert to authenticated
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = registro_treino.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "inclusão" on public.registro_treino is 'Consolida: aluno registra e vê os próprios treinos executados';
create policy "alteração" on public.registro_treino for update to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = registro_treino.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  )
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = registro_treino.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "alteração" on public.registro_treino is 'Consolida: aluno registra e vê os próprios treinos executados';
create policy "exclusão" on public.registro_treino for delete to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = registro_treino.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "exclusão" on public.registro_treino is 'Consolida: aluno registra e vê os próprios treinos executados';

-- sla_config
drop policy "admin_arke gerencia a configuracao de sla" on public.sla_config;
drop policy "staff le a configuracao de sla" on public.sla_config;
create policy leitura on public.sla_config for select to authenticated
  using (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
    OR (true)
  );
comment on policy leitura on public.sla_config is 'Consolida: admin_arke gerencia a configuracao de sla; staff le a configuracao de sla';
create policy "inclusão" on public.sla_config for insert to authenticated
  with check (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  );
comment on policy "inclusão" on public.sla_config is 'Consolida: admin_arke gerencia a configuracao de sla';
create policy "alteração" on public.sla_config for update to authenticated
  using (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  )
  with check (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  );
comment on policy "alteração" on public.sla_config is 'Consolida: admin_arke gerencia a configuracao de sla';
create policy "exclusão" on public.sla_config for delete to authenticated
  using (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  );
comment on policy "exclusão" on public.sla_config is 'Consolida: admin_arke gerencia a configuracao de sla';

-- staff_comissoes_lancamentos
drop policy "gestor gerencia lançamentos de comissão" on public.staff_comissoes_lancamentos;
drop policy "profissional vê as próprias comissões" on public.staff_comissoes_lancamentos;
create policy leitura on public.staff_comissoes_lancamentos for select to authenticated
  using (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
    OR ((user_id = ( SELECT auth.uid() AS uid)))
  );
comment on policy leitura on public.staff_comissoes_lancamentos is 'Consolida: gestor gerencia lançamentos de comissão; profissional vê as próprias comissões';
create policy "inclusão" on public.staff_comissoes_lancamentos for insert to authenticated
  with check (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.staff_comissoes_lancamentos is 'Consolida: gestor gerencia lançamentos de comissão';
create policy "alteração" on public.staff_comissoes_lancamentos for update to authenticated
  using (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.staff_comissoes_lancamentos is 'Consolida: gestor gerencia lançamentos de comissão';
create policy "exclusão" on public.staff_comissoes_lancamentos for delete to authenticated
  using (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.staff_comissoes_lancamentos is 'Consolida: gestor gerencia lançamentos de comissão';

-- staff_horarios
drop policy "gestor gerencia horários da equipe" on public.staff_horarios;
drop policy "profissional vê o próprio horário" on public.staff_horarios;
create policy leitura on public.staff_horarios for select to authenticated
  using (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
    OR ((user_id = ( SELECT auth.uid() AS uid)))
  );
comment on policy leitura on public.staff_horarios is 'Consolida: gestor gerencia horários da equipe; profissional vê o próprio horário';
create policy "inclusão" on public.staff_horarios for insert to authenticated
  with check (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.staff_horarios is 'Consolida: gestor gerencia horários da equipe';
create policy "alteração" on public.staff_horarios for update to authenticated
  using (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.staff_horarios is 'Consolida: gestor gerencia horários da equipe';
create policy "exclusão" on public.staff_horarios for delete to authenticated
  using (
    ((has_org_role(( SELECT auth.uid() AS uid), organization_id, 'gestor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.staff_horarios is 'Consolida: gestor gerencia horários da equipe';

-- tarefas
drop policy "aluno cria a própria tarefa de onboarding" on public.tarefas;
drop policy "staff da org gerencia tarefas" on public.tarefas;
create policy leitura on public.tarefas for select to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.tarefas is 'Consolida: staff da org gerencia tarefas';
create policy "inclusão" on public.tarefas for insert to authenticated
  with check (
    (((aluno_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = tarefas.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid)) AND (a.organization_id = tarefas.organization_id))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.tarefas is 'Consolida: aluno cria a própria tarefa de onboarding; staff da org gerencia tarefas';
create policy "alteração" on public.tarefas for update to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.tarefas is 'Consolida: staff da org gerencia tarefas';
create policy "exclusão" on public.tarefas for delete to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.tarefas is 'Consolida: staff da org gerencia tarefas';

-- treino_calendario
drop policy "aluno gerencia o próprio calendário de treino" on public.treino_calendario;
drop policy "staff da org vê o calendário dos alunos" on public.treino_calendario;
create policy leitura on public.treino_calendario for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = treino_calendario.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.treino_calendario is 'Consolida: aluno gerencia o próprio calendário de treino; staff da org vê o calendário dos alunos';
create policy "inclusão" on public.treino_calendario for insert to authenticated
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = treino_calendario.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "inclusão" on public.treino_calendario is 'Consolida: aluno gerencia o próprio calendário de treino';
create policy "alteração" on public.treino_calendario for update to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = treino_calendario.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  )
  with check (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = treino_calendario.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "alteração" on public.treino_calendario is 'Consolida: aluno gerencia o próprio calendário de treino';
create policy "exclusão" on public.treino_calendario for delete to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = treino_calendario.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
  );
comment on policy "exclusão" on public.treino_calendario is 'Consolida: aluno gerencia o próprio calendário de treino';

-- treinos
drop policy "aluno vê os próprios treinos" on public.treinos;
drop policy "staff da org gerencia treinos" on public.treinos;
create policy leitura on public.treinos for select to authenticated
  using (
    ((EXISTS ( SELECT 1
   FROM alunos a
  WHERE ((a.id = treinos.aluno_id) AND (a.user_id = ( SELECT auth.uid() AS uid))))))
    OR ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy leitura on public.treinos is 'Consolida: aluno vê os próprios treinos; staff da org gerencia treinos';
create policy "inclusão" on public.treinos for insert to authenticated
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "inclusão" on public.treinos is 'Consolida: staff da org gerencia treinos';
create policy "alteração" on public.treinos for update to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  )
  with check (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "alteração" on public.treinos is 'Consolida: staff da org gerencia treinos';
create policy "exclusão" on public.treinos for delete to authenticated
  using (
    ((is_org_staff(( SELECT auth.uid() AS uid), organization_id) OR has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role)))
  );
comment on policy "exclusão" on public.treinos is 'Consolida: staff da org gerencia treinos';

-- turmas
drop policy "aluno vê as turmas da própria organização" on public.turmas;
drop policy "staff da org gerencia turmas" on public.turmas;
create policy leitura on public.turmas for select to authenticated
  using (
    (is_org_member(( SELECT auth.uid() AS uid), organization_id))
    OR (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy leitura on public.turmas is 'Consolida: aluno vê as turmas da própria organização; staff da org gerencia turmas';
create policy "inclusão" on public.turmas for insert to authenticated
  with check (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "inclusão" on public.turmas is 'Consolida: staff da org gerencia turmas';
create policy "alteração" on public.turmas for update to authenticated
  using (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  )
  with check (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "alteração" on public.turmas is 'Consolida: staff da org gerencia turmas';
create policy "exclusão" on public.turmas for delete to authenticated
  using (
    (is_org_staff(( SELECT auth.uid() AS uid), organization_id))
  );
comment on policy "exclusão" on public.turmas is 'Consolida: staff da org gerencia turmas';

-- user_roles
drop policy "admin_arke gerencia user_roles" on public.user_roles;
drop policy "usuário vê os próprios papéis globais" on public.user_roles;
create policy leitura on public.user_roles for select to authenticated
  using (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
    OR ((user_id = ( SELECT auth.uid() AS uid)))
  );
comment on policy leitura on public.user_roles is 'Consolida: admin_arke gerencia user_roles; usuário vê os próprios papéis globais';
create policy "inclusão" on public.user_roles for insert to authenticated
  with check (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  );
comment on policy "inclusão" on public.user_roles is 'Consolida: admin_arke gerencia user_roles';
create policy "alteração" on public.user_roles for update to authenticated
  using (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  )
  with check (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  );
comment on policy "alteração" on public.user_roles is 'Consolida: admin_arke gerencia user_roles';
create policy "exclusão" on public.user_roles for delete to authenticated
  using (
    (has_role(( SELECT auth.uid() AS uid), 'admin_arke'::app_role))
  );
comment on policy "exclusão" on public.user_roles is 'Consolida: admin_arke gerencia user_roles';
