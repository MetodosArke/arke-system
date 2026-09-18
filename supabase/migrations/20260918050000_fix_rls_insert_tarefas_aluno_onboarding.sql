-- =====================================================================
-- CORREÇÃO: "new row violates row-level security policy for table
-- 'tarefas'" ao concluir a anamnese de acolhimento (M.A.P.A.®).
--
-- Causa: a única policy de `tarefas` ("staff da org gerencia tarefas")
-- cobre apenas staff (is_org_staff/admin_arke). O próprio aluno insere a
-- tarefa "Agendar consulta de Acolhimento" ao final do onboarding
-- (src/pages/app/Onboarding.tsx), e não havia nenhuma policy de INSERT
-- que permitisse isso — toda tentativa era barrada pela RLS.
--
-- `tarefas.aluno_id` referencia `alunos.id` (não `auth.uid()` direto), e
-- a tabela não tem coluna `criado_por`; o check precisa passar por
-- `alunos` para confirmar que o aluno logado é dono do `aluno_id` E da
-- mesma organização informada na tarefa.
-- =====================================================================

create policy "aluno cria a própria tarefa de onboarding"
  on public.tarefas for insert to authenticated
  with check (
    aluno_id is not null
    and exists (
      select 1 from public.alunos a
      where a.id = tarefas.aluno_id
        and a.user_id = auth.uid()
        and a.organization_id = tarefas.organization_id
    )
  );
