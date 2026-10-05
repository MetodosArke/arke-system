-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- O `case ... end` devolve texto e a coluna e enum. So quebra em execucao:
-- o plpgsql nao valida o tipo do CASE contra a coluna na criacao da funcao.
create or replace function public.gerar_tarefas_inercia()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _a record;
  _n integer := 0;
begin
  for _a in
    select al.id, al.organization_id, public.aluno_dias_inativo(al.id) as dias
      from public.alunos al
      join public.organizations o on o.id = al.organization_id
     where al.metodo_arke_status = 'ativo'
       and al.situacao_academia = 'em_dia'
       and (o.onboarding_completed or o.status = 'trial')
       and public.aluno_dias_inativo(al.id) is not null
       and public.aluno_dias_inativo(al.id) >= 5
  loop
    insert into public.tarefas
      (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
    values
      (_a.organization_id, _a.id,
       'Risco de evasão — sem sinal de vida há ' || _a.dias || ' dias',
       (case when _a.dias >= 10 then 'critica' else 'alta' end)::public.tarefa_prioridade,
       now() + interval '24 hours',
       'inercia:' || _a.id::text || ':' || ((_a.dias / 5) * 5)::text,
       'inercia')
    on conflict (organization_id, origem_evento) do nothing;
    if found then
      _n := _n + 1;
    end if;
  end loop;
  return _n;
end;
$$;

revoke execute on function public.gerar_tarefas_inercia() from public;
grant execute on function public.gerar_tarefas_inercia() to service_role;
