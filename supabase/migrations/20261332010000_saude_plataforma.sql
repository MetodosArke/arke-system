-- Saúde da plataforma para o monitor externo (Rodada B, 05/10/2026).
--
-- O alerta de rotinas e o Vigia rodam dentro do próprio Supabase: se o banco
-- ou o pg_cron param, quem avisaria também parou. O monitor de disponibilidade
-- do Sentry chama a edge function `saude`, que lê esta função, e acusa quando
-- ela não responde 200.
--
-- Só booleanos, nenhum nome nem dado: a função `saude` é pública.
--   rotinas: alguma rotina do pg_cron terminou bem nos últimos 15 minutos
--            (há rotinas de 2 em 2 e de 5 em 5 minutos);
--   alertas: o alerta de rotinas (de hora em hora, aos 50 minutos) rodou bem
--            nas últimas 2 h 15 min. É ele que avisa das outras rotinas.
set lock_timeout = '5s';

create or replace function public.saude_plataforma()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'rotinas', coalesce(
      (select max(d.end_time) from cron.job_run_details d where d.status = 'succeeded') > now() - interval '15 minutes',
      false),
    'alertas', coalesce(
      (select e.ultima_ok from public.execucoes_agendadas e where e.nome = 'alertar-rotinas') > now() - interval '135 minutes',
      false)
  );
$$;

comment on function public.saude_plataforma() is
  'Saúde para o monitor externo: rotinas do pg_cron e o alerta de rotinas em dia. Só a service role (edge function saude).';

revoke all on function public.saude_plataforma() from public, anon, authenticated;
grant execute on function public.saude_plataforma() to service_role;
