-- Falha de rotina também por e-mail (decisão da ArkeFit, 21/09/2026).
--
-- Até aqui o aviso era só a faixa vermelha no topo da Visão Master: bom para
-- quem abre a tela todo dia, cego no fim de semana. Agora a edge function
-- alertar-rotinas, chamada de hora em hora pelo pg_cron, manda e-mail aos Super
-- Admins — mas só quando algo muda, para o alerta não virar ruído que se
-- aprende a ignorar:
--
--   - novo:      a rotina entrou em problema (ou trocou de problema);
--   - lembrete:  continua em problema, e o último aviso tem mais de 24 h;
--   - recuperou: voltou ao normal depois de um aviso.
--
-- "Problema" é falhou ou atrasada. nunca_rodou fica de fora: é o estado de
-- toda rotina recém-criada até a primeira execução — inclusive a desta
-- migration —, e alertar ali ensinaria a ignorar o alerta. desativada também:
-- é decisão, não defeito.

-- 1) A classificação sai para uma função interna, sem checagem de papel, que
-- a Visão Master e o alerta compartilham. Mesma régua nos dois lugares.
create or replace function public.avaliar_rotinas()
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
language sql
stable
security definer
set search_path to 'public'
as $$
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
  ),
  avaliadas as (
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
  order by array_position(array['falhou', 'atrasada', 'nunca_rodou', 'ok', 'desativada'], a.situacao), a.nome;
$$;

revoke execute on function public.avaliar_rotinas() from public, anon, authenticated;
grant execute on function public.avaliar_rotinas() to service_role;

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

  return query select * from public.avaliar_rotinas();
end;
$$;

-- 2) O que já foi avisado, por rotina. Tabela da plataforma, não de tenant
-- (como reconciliacoes_asaas): não tem organization_id porque rotina não
-- pertence a academia nenhuma. RLS ligado e sem política — só a service_role
-- da edge function lê e grava.
create table if not exists public.alertas_rotinas (
  nome        text primary key,
  situacao    text not null,
  avisado_em  timestamptz not null default now()
);

alter table public.alertas_rotinas enable row level security;
revoke all on public.alertas_rotinas from anon, authenticated;
grant select, insert, update, delete on public.alertas_rotinas to service_role;

comment on table public.alertas_rotinas is
  'Último aviso por e-mail de cada rotina do pg_cron (alertar-rotinas). Linha presente = rotina em problema já avisada.';

-- 3) O que avisar agora. Não grava nada: o estado só muda depois que o e-mail
-- sai (registrar_alerta_rotinas), senão uma falha de envio apagaria o aviso.
create or replace function public.rotinas_para_alertar()
returns table (nome text, tipo text, situacao text, ultima_execucao timestamptz, ultimo_erro text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with atual as (
    select * from public.avaliar_rotinas()
  )
  -- Em problema: novo (sem aviso, ou problema diferente) ou lembrete (>24 h).
  select a.nome,
         case when al.nome is null or al.situacao <> a.situacao then 'novo' else 'lembrete' end,
         a.situacao, a.ultima_execucao, a.ultimo_erro
    from atual a
    left join public.alertas_rotinas al on al.nome = a.nome
   where a.situacao in ('falhou', 'atrasada')
     and (al.nome is null or al.situacao <> a.situacao or al.avisado_em < now() - interval '24 hours')
  union all
  -- Recuperou: tinha aviso e hoje não está mais em problema (inclui a rotina
  -- que foi desativada ou apagada — o problema deixou de existir).
  select al.nome, 'recuperou', coalesce(a.situacao, 'removida'), a.ultima_execucao, null
    from public.alertas_rotinas al
    left join atual a on a.nome = al.nome
   where a.nome is null or a.situacao not in ('falhou', 'atrasada');
$$;

revoke execute on function public.rotinas_para_alertar() from public, anon, authenticated;
grant execute on function public.rotinas_para_alertar() to service_role;

create or replace function public.registrar_alerta_rotinas(_itens jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
begin
  for v in select * from jsonb_array_elements(coalesce(_itens, '[]'::jsonb)) loop
    if v->>'tipo' = 'recuperou' then
      delete from public.alertas_rotinas where nome = v->>'nome';
    else
      insert into public.alertas_rotinas (nome, situacao, avisado_em)
      values (v->>'nome', v->>'situacao', now())
      on conflict (nome) do update set situacao = excluded.situacao, avisado_em = excluded.avisado_em;
    end if;
  end loop;
end;
$$;

revoke execute on function public.registrar_alerta_rotinas(jsonb) from public, anon, authenticated;
grant execute on function public.registrar_alerta_rotinas(jsonb) to service_role;

-- 4) E-mails dos Super Admins, para a edge function não precisar do Auth Admin
-- API só para isso.
create or replace function public.emails_superadmin()
returns table (email text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select distinct u.email::text
    from public.user_roles r
    join auth.users u on u.id = r.user_id
   where r.role = 'superadmin' and u.email is not null and u.deleted_at is null;
$$;

revoke execute on function public.emails_superadmin() from public, anon, authenticated;
grant execute on function public.emails_superadmin() to service_role;

-- 5) Token do cron, no Vault, como o da reconciliação.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'alerta_rotinas_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'alerta_rotinas_token',
      'Autentica o pg_cron na edge function alertar-rotinas.'
    );
  end if;
end $$;

create or replace function public.conferir_token_alerta_rotinas(_token text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'alerta_rotinas_token' and decrypted_secret = _token
  );
$$;

revoke execute on function public.conferir_token_alerta_rotinas(text) from public, anon, authenticated;
grant execute on function public.conferir_token_alerta_rotinas(text) to service_role;

-- 6) De hora em hora, aos 50 min: depois das rotinas que rodam na virada da
-- hora, para uma falha delas já aparecer na mesma hora.
select cron.unschedule(jobid) from cron.job where jobname = 'arke-alerta-rotinas';
select cron.schedule(
  'arke-alerta-rotinas',
  '50 * * * *',
  $cmd$
    select net.http_post(
      url := 'https://jbkrxrfdrmrkyldrrdpq.supabase.co/functions/v1/alertar-rotinas',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cmd$
);
