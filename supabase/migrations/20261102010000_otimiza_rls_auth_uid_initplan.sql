-- Reescreve toda policy de RLS em public que chama auth.uid()/auth.jwt()
-- "cru" (sem envolver em subselect), trocando para (SELECT auth.uid())/
-- (SELECT auth.jwt()). Isso não muda NENHUMA autorização: o Postgres
-- passa a avaliar a função uma única vez por statement (via InitPlan) em
-- vez de reavaliar para cada linha da tabela, que é o que os performance
-- advisors do Supabase reportam como "auth_rls_initplan" em ~90 policies
-- nas tabelas mais quentes (treinos, dietas, alunos, checkins, etc.).
do $$
declare
  pol record;
  new_qual text;
  new_check text;
  sql text;
begin
  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    new_qual := pol.qual;
    new_check := pol.with_check;

    if new_qual is not null then
      new_qual := replace(new_qual, '( SELECT auth.uid() AS uid)', '@@UID@@');
      new_qual := replace(new_qual, 'auth.uid()', '( SELECT auth.uid() AS uid)');
      new_qual := replace(new_qual, '@@UID@@', '( SELECT auth.uid() AS uid)');
      new_qual := replace(new_qual, '( SELECT auth.jwt() AS jwt)', '@@JWT@@');
      new_qual := replace(new_qual, 'auth.jwt()', '( SELECT auth.jwt() AS jwt)');
      new_qual := replace(new_qual, '@@JWT@@', '( SELECT auth.jwt() AS jwt)');
    end if;

    if new_check is not null then
      new_check := replace(new_check, '( SELECT auth.uid() AS uid)', '@@UID@@');
      new_check := replace(new_check, 'auth.uid()', '( SELECT auth.uid() AS uid)');
      new_check := replace(new_check, '@@UID@@', '( SELECT auth.uid() AS uid)');
      new_check := replace(new_check, '( SELECT auth.jwt() AS jwt)', '@@JWT@@');
      new_check := replace(new_check, 'auth.jwt()', '( SELECT auth.jwt() AS jwt)');
      new_check := replace(new_check, '@@JWT@@', '( SELECT auth.jwt() AS jwt)');
    end if;

    if new_qual is distinct from pol.qual or new_check is distinct from pol.with_check then
      sql := format('ALTER POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
      if new_qual is not null then
        sql := sql || format(' USING (%s)', new_qual);
      end if;
      if new_check is not null then
        sql := sql || format(' WITH CHECK (%s)', new_check);
      end if;
      execute sql;
    end if;
  end loop;
end $$;

-- Índices em FKs sem cobertura, flagrados pelos performance advisors nas
-- tabelas mais quentes do sistema (acessos_catraca_logs, dietas, treinos,
-- lancamentos_financeiros). Sem índice, qualquer join/delete/RLS check
-- que filtra por essas colunas faz sequential scan.
create index if not exists idx_acessos_catraca_logs_aluno_id
  on public.acessos_catraca_logs (aluno_id);

create index if not exists idx_acessos_catraca_logs_confirmado_por
  on public.acessos_catraca_logs (confirmado_por);

create index if not exists idx_dietas_publicado_por
  on public.dietas (publicado_por);

create index if not exists idx_lancamentos_financeiros_registrado_por
  on public.lancamentos_financeiros (registrado_por);

create index if not exists idx_treinos_publicado_por
  on public.treinos (publicado_por);
