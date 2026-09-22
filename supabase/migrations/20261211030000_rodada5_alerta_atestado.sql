-- Alerta de atestado: PAR-Q com algum "sim" e sem atestado, ou atestado que
-- vence em até 15 dias (ou já venceu), vira tarefa na fila da academia.
-- Idempotente pela origem do evento: uma tarefa por aluno e por validade.
create or replace function public.gerar_tarefas_atestado()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
  select
    p.organization_id,
    p.aluno_id,
    case
      when p.atestado_validade is null then 'PAR-Q com resposta "sim" e sem atestado médico — pedir o atestado antes de liberar o treino'
      when p.atestado_validade < current_date then 'Atestado médico vencido em ' || to_char(p.atestado_validade, 'DD/MM/YYYY')
      else 'Atestado médico vence em ' || to_char(p.atestado_validade, 'DD/MM/YYYY')
    end,
    case when p.atestado_validade is null or p.atestado_validade < current_date then 'alta'::public.tarefa_prioridade else 'media'::public.tarefa_prioridade end,
    now() + interval '72 hours',
    'atestado:' || p.aluno_id::text || ':' || coalesce(p.atestado_validade::text, 'sem'),
    'atestado'
  from public.aluno_parq p
  join public.alunos a on a.id = p.aluno_id
  where p.algum_sim
    and a.anonimizado_em is null
    and a.situacao_academia = 'em_dia'
    and (p.atestado_validade is null or p.atestado_validade < current_date + 15)
  on conflict (organization_id, origem_evento) do nothing;
end;
$$;

revoke execute on function public.gerar_tarefas_atestado() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'arke-alerta-atestado';
select cron.schedule('arke-alerta-atestado', '15 7 * * *', 'select public.gerar_tarefas_atestado();');
