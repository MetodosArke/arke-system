-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.assinatura);
  end loop;
end $$;

revoke execute on function public.valor_mensal_b2b(uuid) from public, anon;
grant execute on function public.valor_mensal_b2b(uuid) to authenticated, service_role;

revoke execute on function public.get_bloqueio_organizacao() from public, anon;
grant execute on function public.get_bloqueio_organizacao() to authenticated, service_role;

alter function public.plano_do_aluno(public.metodo_arke_status, public.nivel_atacado)
  set search_path to 'public';
alter function public.situacao_permite_app(public.situacao_aluno_academia, timestamptz)
  set search_path to 'public';
