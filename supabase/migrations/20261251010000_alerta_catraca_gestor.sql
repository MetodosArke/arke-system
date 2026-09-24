-- Aviso de catraca fora do ar também para o gestor, aos 10 minutos
-- (decisão do responsável, 23/09/2026).
--
-- A versão anterior (20261246010000) avisava só a ArkeFit, aos 15 minutos,
-- pelo trilho do alerta de rotinas — que roda de hora em hora. Com o gestor
-- na conta, os 10 minutos pedidos virariam até 70: o aviso sairia na
-- próxima passada das :50. Por isso a catraca ganha trilho próprio, uma
-- rotina de 2 em 2 minutos (`arke-alerta-catracas` → edge function
-- `alertar-catracas`), e sai do alerta de rotinas.
--
-- O gestor recebe só as catracas da academia dele, com o que conferir na
-- recepção; a ArkeFit recebe todas. Mesma janela de horário (6h–23h) e o
-- mesmo "já avisei": lembrete a cada 24 h enquanto continuar fora, e "voltou"
-- quando voltar.

update public.plataforma_config set valor = 10 where chave = 'alerta_catraca_minutos';
update public.plataforma_config
   set descricao = 'Minutos sem sinal do Gateway Local até avisar por e-mail a ArkeFit e o gestor da academia que a catraca saiu do ar.'
 where chave = 'alerta_catraca_minutos';

-- "Já avisei" próprio. Dividir a tabela das rotinas faria o alerta de
-- rotinas enxergar as linhas da catraca como rotinas que sumiram e mandar
-- "voltou ao normal" por elas.
create table if not exists public.alertas_catracas (
  catraca_id uuid primary key references public.organizacao_catracas(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  situacao text not null,
  avisado_em timestamptz not null default now()
);
alter table public.alertas_catracas enable row level security;
-- Sem política: só as funções abaixo leem e escrevem.

create or replace function public.catracas_para_alertar()
returns table(catraca_id uuid, organization_id uuid, academia text, catraca text, tipo text, situacao text,
              sem_sinal_desde timestamptz, detalhe text)
language sql
stable
security definer
set search_path = public
as $$
  with atual as (
    select k.catraca_id, k.organization_id, k.situacao, k.sem_sinal_desde, k.detalhe
      from public.avaliar_catracas() k
  )
  select a.catraca_id, a.organization_id, o.nome, c.nome,
         case when al.catraca_id is null or al.situacao <> a.situacao then 'novo' else 'lembrete' end,
         a.situacao, a.sem_sinal_desde, a.detalhe
    from atual a
    join public.organizacao_catracas c on c.id = a.catraca_id
    join public.organizations o on o.id = a.organization_id
    left join public.alertas_catracas al on al.catraca_id = a.catraca_id
   where a.situacao = 'catraca_offline'
     and (al.catraca_id is null or al.situacao <> a.situacao or al.avisado_em < now() - interval '24 hours')
  union all
  -- Voltou: só quando está de fato no ar. Fora do horário não é volta — é a
  -- janela de silêncio —, e catraca desativada no meio do caminho encerra o
  -- aviso como "desativada".
  select al.catraca_id, al.organization_id, o.nome, c.nome, 'recuperou',
         case when a.catraca_id is null then 'desativada' else a.situacao end,
         null::timestamptz, coalesce(a.detalhe, o.nome || ' · ' || c.nome)
    from public.alertas_catracas al
    join public.organizacao_catracas c on c.id = al.catraca_id
    join public.organizations o on o.id = al.organization_id
    left join atual a on a.catraca_id = al.catraca_id
   where a.catraca_id is null or a.situacao = 'ok';
$$;
revoke execute on function public.catracas_para_alertar() from public, anon, authenticated;
grant execute on function public.catracas_para_alertar() to service_role;

create or replace function public.registrar_alerta_catracas(_itens jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  for v in select * from jsonb_array_elements(coalesce(_itens, '[]'::jsonb)) loop
    if v->>'tipo' = 'recuperou' then
      delete from public.alertas_catracas where catraca_id = (v->>'catraca_id')::uuid;
    else
      insert into public.alertas_catracas (catraca_id, organization_id, situacao, avisado_em)
      values ((v->>'catraca_id')::uuid, (v->>'organization_id')::uuid, v->>'situacao', now())
      on conflict (catraca_id) do update set situacao = excluded.situacao, avisado_em = excluded.avisado_em;
    end if;
  end loop;
end;
$$;
revoke execute on function public.registrar_alerta_catracas(jsonb) from public, anon, authenticated;
grant execute on function public.registrar_alerta_catracas(jsonb) to service_role;

-- Gestores ativos da academia, para o aviso da catraca dela.
create or replace function public.emails_gestores_organizacao(_organization_id uuid)
returns table(email text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct u.email::text
    from public.organization_members m
    join auth.users u on u.id = m.user_id
   where m.organization_id = _organization_id
     and m.role = 'gestor' and m.status = 'active'
     and u.email is not null and u.deleted_at is null;
$$;
revoke execute on function public.emails_gestores_organizacao(uuid) from public, anon, authenticated;
grant execute on function public.emails_gestores_organizacao(uuid) to service_role;

-- A catraca sai do alerta de rotinas (volta à definição de 20261242010000).
create or replace function public.rotinas_para_alertar()
returns table(nome text, tipo text, situacao text, ultima_execucao timestamptz, ultimo_erro text)
language sql
stable
security definer
set search_path = public
as $$
  with atual as (
    select r.nome, r.situacao, r.ultima_execucao, r.ultimo_erro from public.avaliar_rotinas() r
    union all
    select c.nome, c.situacao, null::timestamptz, c.detalhe from public.avaliar_capacidade() c
  ),
  problema as (
    select * from atual where situacao in ('falhou', 'atrasada', 'banco_70', 'banco_85')
  )
  select a.nome,
         case when al.nome is null or al.situacao <> a.situacao then 'novo' else 'lembrete' end,
         a.situacao, a.ultima_execucao, a.ultimo_erro
    from problema a
    left join public.alertas_rotinas al on al.nome = a.nome
   where al.nome is null
      or al.situacao <> a.situacao
      or al.avisado_em < now() - case when a.situacao = 'banco_70' then interval '7 days' else interval '24 hours' end
  union all
  select al.nome, 'recuperou', coalesce(a.situacao, 'removida'), a.ultima_execucao,
         case when al.nome like 'capacidade:%' then a.ultimo_erro end
    from public.alertas_rotinas al
    left join atual a on a.nome = al.nome
   where a.nome is null or a.situacao not in ('falhou', 'atrasada', 'banco_70', 'banco_85');
$$;

-- avaliar_rotinas() passa a reconhecer agendamento de N em N minutos
-- ("*/2 * * * *"), para a rotina nova ter a mesma vigilância das outras:
-- parou de rodar ou a função não conclui → faixa vermelha.
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
             when j.schedule ~ '^\*/\d+ \* \* \* \*$' then make_interval(mins => substring(j.schedule from '^\*/(\d+)')::int)
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

insert into public.execucoes_agendadas (nome, ultima_ok) values ('alertar-catracas', now())
on conflict (nome) do nothing;

-- A rotina. Mesmo token do alerta de rotinas: mesma confiança, e um segredo
-- a menos para configurar. Criada por último, depois de a edge function
-- estar publicada — ver o checklist da versão 1.0.
select cron.unschedule(jobid) from cron.job where jobname = 'arke-alerta-catracas';
select cron.schedule('arke-alerta-catracas', '*/2 * * * *', $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/alertar-catracas',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cmd$);
