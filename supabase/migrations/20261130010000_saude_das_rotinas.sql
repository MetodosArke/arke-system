-- Saúde das rotinas agendadas (pg_cron), para a Visão Master.
--
-- São 8 rotinas que movem o produto sozinhas: tarefa de ativação a cada hora,
-- escalonamento de SLA, barreira de rotina, acolhimento Elite, engajamento
-- baixo, lançamentos financeiros e o snapshot de MRR. Se uma quebra, nada
-- avisa: `cron.job_run_details` só é lido por quem for lá procurar, e a
-- consequência aparece dias depois como "a fila parou de receber tarefa".
--
-- Duas falhas diferentes, e a segunda é a traiçoeira:
--
--   - **falhou**: rodou e deu erro. Fica registrado, só ninguém lê.
--   - **atrasada**: parou de rodar. Não gera erro nenhum — o registro
--     simplesmente para de crescer. Por isso a função compara a última
--     execução com o intervalo que o agendamento promete, e acusa quando a
--     rotina está há mais que o dobro dele sem rodar.
--
-- O intervalo sai do próprio agendamento: "m * * * *" é de hora em hora,
-- "m h * * *" é diária, "m h * * d" é semanal. Agendamento fora desses três
-- formatos fica sem expectativa de intervalo — acusa falha, mas não atraso.

create or replace function public.get_superadmin_rotinas()
returns table (
  nome text,
  agendamento text,
  ativa boolean,
  situacao text,
  ultima_execucao timestamptz,
  ultimo_erro text,
  falhas_7d bigint,
  execucoes_7d bigint,
  intervalo_esperado interval
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- Mesma régua das demais get_superadmin_*: o papel é conferido aqui dentro.
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;

  return query
  with rotinas as (
    select j.jobid, j.jobname, j.schedule, j.active,
           case
             when j.schedule ~ '^\d+ \* \* \* \*$' then interval '1 hour'
             when j.schedule ~ '^\d+ \d+ \* \* \*$' then interval '1 day'
             when j.schedule ~ '^\d+ \d+ \* \* \d$' then interval '7 days'
           end as intervalo
    from cron.job j
  ),
  ultima as (
    select distinct on (d.jobid) d.jobid, d.status, d.start_time, d.return_message
    from cron.job_run_details d
    order by d.jobid, d.start_time desc
  ),
  semana as (
    select d.jobid,
           count(*) as execucoes,
           count(*) filter (where d.status <> 'succeeded') as falhas
    from cron.job_run_details d
    where d.start_time > now() - interval '7 days'
    group by d.jobid
  )
  , avaliadas as (
    select r.jobname::text as nome,
           r.schedule::text as agendamento,
           r.active as ativa,
           case
             when not r.active then 'desativada'
             when u.jobid is null then 'nunca_rodou'
             when u.status <> 'succeeded' then 'falhou'
             -- Folga de 15 min além do dobro do intervalo: a execução de
             -- hora em hora que atrasou uns minutos não é alarme.
             when r.intervalo is not null
                  and u.start_time < now() - (2 * r.intervalo) - interval '15 minutes' then 'atrasada'
             else 'ok'
           end as situacao,
           u.start_time as ultima_execucao,
           case when u.status <> 'succeeded' then left(u.return_message, 300) end as ultimo_erro,
           coalesce(s.falhas, 0) as falhas_7d,
           coalesce(s.execucoes, 0) as execucoes_7d,
           r.intervalo as intervalo_esperado
    from rotinas r
    left join ultima u on u.jobid = r.jobid
    left join semana s on s.jobid = r.jobid
  )
  select a.nome, a.agendamento, a.ativa, a.situacao, a.ultima_execucao, a.ultimo_erro,
         a.falhas_7d, a.execucoes_7d, a.intervalo_esperado
  from avaliadas a
  -- O que precisa de atenção primeiro.
  order by array_position(array['falhou', 'atrasada', 'nunca_rodou', 'ok', 'desativada'], a.situacao), a.nome;
end;
$$;

comment on function public.get_superadmin_rotinas() is
  'Saúde das rotinas do pg_cron para a Visão Master: ok, falhou, atrasada (parou de rodar), nunca_rodou ou desativada.';

revoke execute on function public.get_superadmin_rotinas() from public, anon;
grant execute on function public.get_superadmin_rotinas() to authenticated;
