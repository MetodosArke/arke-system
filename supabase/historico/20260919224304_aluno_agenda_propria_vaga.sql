-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

create policy "aluno agenda a própria vaga"
  on public.agendamentos for insert
  to authenticated
  with check (
    status = 'agendado'
    and exists (
      select 1 from public.alunos a
      where a.id = aluno_id
        and a.user_id = (select auth.uid())
        and a.organization_id = agendamentos.organization_id
    )
  );
