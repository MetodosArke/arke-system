-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- O `with check` das tarefas nunca teve `superadmin` (23/09/2026).
--
-- Achado ao exercitar o console do Mentor: o Super Admin passava no USING e
-- era recusado no WITH CHECK, entao a ArkeFit nunca conseguiu **alterar** uma
-- tarefa — so ler. Nao doia porque nao havia console; com a fila do Mentor,
-- encerrar um chamado e a acao principal da tela.
--
-- A armadilha e que `alter policy ... using (...)` muda SO o using. Quem
-- corrige uma regra de UPDATE precisa lembrar das duas metades, e o sintoma
-- de esquecer e uma atualizacao que responde sucesso com zero linhas.
alter policy "alteração" on public.tarefas
  with check (
    is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

alter policy "inclusão" on public.tarefas
  with check (
    (
      aluno_id is not null
      and exists (
        select 1 from public.alunos a
         where a.id = tarefas.aluno_id
           and a.user_id = (select auth.uid())
           and a.organization_id = tarefas.organization_id
      )
    )
    or is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );
