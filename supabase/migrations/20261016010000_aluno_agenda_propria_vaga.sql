-- Etapa 5 da frente de operação nativa da academia: lado do aluno em
-- Turmas. O admin já gerencia turma/agendamento desde a Etapa Studio
-- original; faltava o aluno poder reservar a própria vaga pelo app
-- dele — hoje só staff tinha policy de INSERT em agendamentos.
create policy "aluno agenda a própria vaga"
  on public.agendamentos for insert
  to authenticated
  with check (
    status in ('agendado', 'lista_espera')
    and exists (
      select 1 from public.alunos a
      where a.id = aluno_id
        and a.user_id = (select auth.uid())
        and a.organization_id = agendamentos.organization_id
    )
  );
