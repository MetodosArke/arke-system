-- Vigia das edge functions chamadas pelo cron (versão 1.0, 23/09/2026).
--
-- Três rotinas chamam edge function: o alerta de rotinas, o lembrete de
-- onboarding e o briefing semanal. O cron dispara por net.http_post, que é
-- assíncrono — o job termina "succeeded" no instante em que a requisição é
-- enfileirada, dê a função certo ou não. Então a saúde das rotinas via o cron
-- rodando e dizia "ok" com a função quebrada toda hora. O caso mais irônico
-- era o do próprio alerta: se alertar-rotinas quebrasse, nada avisava que
-- nada estava avisando.
--
-- Agora cada uma dessas funções registra o próprio desfecho aqui, e
-- avaliar_rotinas() cruza com o cron que a chama (pela URL no comando do job):
--   * o último desfecho foi erro → "falhou", com a mensagem da função;
--   * o cron roda, mas a função não conclui há mais de duas vezes o intervalo
--     → "atrasada".
-- A Visão Master mostra na faixa vermelha, e o e-mail sai pelo mesmo trilho —
-- menos quando quem quebrou foi o próprio alerta, e aí a faixa é o aviso.

create table if not exists public.execucoes_agendadas (
  nome text primary key,
  ultima_ok timestamptz,
  ultimo_erro text,
  ultimo_erro_em timestamptz
);
alter table public.execucoes_agendadas enable row level security;
-- Sem política: só as funções security definer abaixo leem e escrevem.

comment on table public.execucoes_agendadas is
  'Último desfecho de cada edge function chamada pelo cron. Lido por avaliar_rotinas(); gravado por registrar_execucao_agendada().';

-- Começa o relógio agora: função que nunca reportar vira "atrasada" depois
-- de dois intervalos, em vez de ficar invisível por não ter linha.
insert into public.execucoes_agendadas (nome, ultima_ok) values
  ('alertar-rotinas', now()),
  ('lembrete-onboarding', now()),
  ('briefing-semanal', now())
on conflict (nome) do nothing;

create or replace function public.registrar_execucao_agendada(_nome text, _ok boolean, _erro text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.execucoes_agendadas as e (nome, ultima_ok, ultimo_erro, ultimo_erro_em)
  values (_nome,
          case when _ok then now() end,
          case when _ok then null else left(coalesce(_erro, 'erro sem mensagem'), 300) end,
          case when _ok then null else now() end)
  on conflict (nome) do update
     set ultima_ok = case when _ok then now() else e.ultima_ok end,
         ultimo_erro = case when _ok then e.ultimo_erro else left(coalesce(_erro, 'erro sem mensagem'), 300) end,
         ultimo_erro_em = case when _ok then e.ultimo_erro_em else now() end;
$$;
revoke execute on function public.registrar_execucao_agendada(text, boolean, text) from public, anon, authenticated;
grant execute on function public.registrar_execucao_agendada(text, boolean, text) to service_role;

create or replace function public.avaliar_rotinas()
returns table(nome text, agendamento text, ativa boolean, situacao text, ultima_execucao timestamptz, ultimo_erro text,
              falhas_7d bigint, execucoes_7d bigint, intervalo_esperado interval)
language sql
stable
security definer
set search_path = public
as $$
  with rotinas as (
    select j.jobid, j.jobname, j.schedule, j.active,
           case
             when j.schedule ~ '^\d+ \* \* \* \*$' then interval '1 hour'
             when j.schedule ~ '^\d+ \d+ \* \* \*$' then interval '1 day'
             when j.schedule ~ '^\d+ \d+ \* \* \d$' then interval '7 days'
           end as intervalo,
           substring(j.command from '/functions/v1/([a-z0-9-]+)') as funcao
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
  ),
  avaliadas as (
    select r.jobname::text as nome,
           r.schedule::text as agendamento,
           r.active as ativa,
           case
             when not r.active then 'desativada'
             when u.jobid is null then 'nunca_rodou'
             when u.status <> 'succeeded' then 'falhou'
             when v.nome is not null and v.ultimo_erro_em is not null
                  and (v.ultima_ok is null or v.ultimo_erro_em > v.ultima_ok) then 'falhou'
             when r.intervalo is not null
                  and u.start_time < now() - (2 * r.intervalo) - interval '15 minutes' then 'atrasada'
             when v.nome is not null and r.intervalo is not null
                  and coalesce(v.ultima_ok, '-infinity'::timestamptz) < now() - (2 * r.intervalo) - interval '15 minutes' then 'atrasada'
             else 'ok'
           end as situacao,
           u.start_time as ultima_execucao,
           case
             when u.status <> 'succeeded' then left(u.return_message, 300)
             when v.nome is not null and v.ultimo_erro_em is not null
                  and (v.ultima_ok is null or v.ultimo_erro_em > v.ultima_ok)
               then 'A função ' || r.funcao || ' falhou: ' || left(v.ultimo_erro, 250)
             when v.nome is not null and r.intervalo is not null
                  and coalesce(v.ultima_ok, '-infinity'::timestamptz) < now() - (2 * r.intervalo) - interval '15 minutes'
               then 'O cron dispara, mas a função ' || r.funcao || ' não conclui desde '
                    || coalesce(to_char(v.ultima_ok, 'DD/MM HH24:MI'), 'sempre')
           end as ultimo_erro,
           coalesce(s.falhas, 0) as falhas_7d,
           coalesce(s.execucoes, 0) as execucoes_7d,
           r.intervalo as intervalo_esperado
    from rotinas r
    left join ultima u on u.jobid = r.jobid
    left join semana s on s.jobid = r.jobid
    left join public.execucoes_agendadas v on v.nome = r.funcao
  )
  select a.nome, a.agendamento, a.ativa, a.situacao, a.ultima_execucao, a.ultimo_erro,
         a.falhas_7d, a.execucoes_7d, a.intervalo_esperado
  from avaliadas a
  order by array_position(array['falhou', 'atrasada', 'nunca_rodou', 'ok', 'desativada'], a.situacao), a.nome;
$$;
