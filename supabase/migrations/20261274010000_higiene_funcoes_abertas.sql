-- Rodada 360° de 24/09/2026: funções que respondiam sobre qualquer aluno,
-- search_path solto e a corrida no painel de rotinas.
--
-- (1) Funções SECURITY DEFINER sem checagem de quem chama, alcançáveis por
--     qualquer pessoa logada em /rest/v1/rpc. Cada uma responde sobre um
--     aluno ou uma academia pelo id — constância, dias sem aparecer, se está
--     inadimplente, se consentiu IA, o briefing inteiro da academia, o repasse
--     negociado com a ArkeFit. Um aluno de uma academia conseguia perguntar
--     sobre aluno de outra. Nenhuma é usada pelo app: quem chama são outras
--     funções SECURITY DEFINER (que rodam como dono e não precisam do
--     privilégio) e edge functions com a service role. Verificado antes:
--     nenhuma é chamada por função SECURITY INVOKER, gatilho, view ou regra
--     de RLS — e revogar EXECUTE não afeta o disparo de gatilhos.
--
--     Ficam abertas de propósito: has_role, has_org_role, is_org_member e
--     is_org_staff (as regras de RLS as chamam como o próprio usuário),
--     obter_organizacao_publica (a matrícula pública precisa, e devolve só o
--     que a página mostra) e as duas de taxa de processamento, que são
--     configuração da plataforma exibida na tela.

revoke execute on function public.aluno_ativo_em(uuid, date, integer) from public, anon, authenticated;
revoke execute on function public.aluno_ciclo_estourado(uuid, integer, numeric) from public, anon, authenticated;
revoke execute on function public.aluno_consentiu_ia(uuid, text) from public, anon, authenticated;
revoke execute on function public.aluno_dias_inativo(uuid) from public, anon, authenticated;
revoke execute on function public.aluno_fase_desde(uuid) from public, anon, authenticated;
revoke execute on function public.aluno_inadimplente_b2c(uuid) from public, anon, authenticated;
revoke execute on function public.aluno_mensalidade_vencida(uuid) from public, anon, authenticated;
revoke execute on function public.briefing_semanal_organizacao(uuid) from public, anon, authenticated;
revoke execute on function public.dono_da_tarefa(uuid, public.tarefa_tipo) from public, anon, authenticated;
revoke execute on function public.repasse_arke(uuid, numeric, text) from public, anon, authenticated;
revoke execute on function public.sentinela_taxa_de_aceite(integer) from public, anon, authenticated;
revoke execute on function public.organizacao_liberada(uuid) from public, anon, authenticated;
revoke execute on function public.documento_legal_vigente(public.tipo_documento_legal) from public, anon, authenticated;

grant execute on function public.aluno_ativo_em(uuid, date, integer) to service_role;
grant execute on function public.aluno_ciclo_estourado(uuid, integer, numeric) to service_role;
grant execute on function public.aluno_consentiu_ia(uuid, text) to service_role;
grant execute on function public.aluno_dias_inativo(uuid) to service_role;
grant execute on function public.aluno_fase_desde(uuid) to service_role;
grant execute on function public.aluno_inadimplente_b2c(uuid) to service_role;
grant execute on function public.aluno_mensalidade_vencida(uuid) to service_role;
grant execute on function public.briefing_semanal_organizacao(uuid) to service_role;
grant execute on function public.dono_da_tarefa(uuid, public.tarefa_tipo) to service_role;
grant execute on function public.repasse_arke(uuid, numeric, text) to service_role;
grant execute on function public.sentinela_taxa_de_aceite(integer) to service_role;
grant execute on function public.organizacao_liberada(uuid) to service_role;
grant execute on function public.documento_legal_vigente(public.tipo_documento_legal) to service_role;

-- (2) A ficha do aluno perguntava constância, fase elegível e motivo direto
--     às três funções — que respondiam a qualquer um. Uma porta só, com a
--     checagem: equipe da academia do aluno, a ArkeFit ou o próprio aluno.
--     As três deixam de estar abertas em 20261275010000, depois do deploy da
--     tela (antes disso a ficha publicada ainda chama as três).
create or replace function public.get_jornada_aluno(_aluno_id uuid)
returns table (motivo text, elegivel public.fase_jornada, constancia numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_user uuid;
begin
  select a.organization_id, a.user_id into v_org, v_user from public.alunos a where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;
  if not (public.is_org_staff(auth.uid(), v_org)
          or public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')
          or v_user = auth.uid()) then
    raise exception 'Acesso restrito à equipe da academia.' using errcode = '42501';
  end if;

  return query select public.motivo_nao_avanca(_aluno_id),
                      public.fase_elegivel(_aluno_id),
                      public.aluno_constancia(_aluno_id, 4);
end;
$$;

revoke execute on function public.get_jornada_aluno(uuid) from public, anon;
grant execute on function public.get_jornada_aluno(uuid) to authenticated, service_role;

-- (3) Valor da mensalidade B2B: a tela da Visão Master e a edge function que
--     cria a assinatura usam. Sem checagem, qualquer pessoa logada lia o valor
--     negociado com qualquer academia. Agora: a ArkeFit, o gestor daquela
--     academia, ou contexto sem usuário (a edge function, com service role).
create or replace function public.valor_mensal_b2b(_organization_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not (public.has_role(auth.uid(), 'superadmin')
              or public.has_role(auth.uid(), 'admin_arke')
              or public.has_org_role(auth.uid(), _organization_id, 'gestor')) then
    raise exception 'Acesso restrito.' using errcode = '42501';
  end if;
  return (select coalesce(o.valor_mensal_b2b, p.valor_mensal)
            from public.organizations o
            left join public.planos_b2b_precos p on p.plano = o.plano_b2b
           where o.id = _organization_id);
end;
$$;

revoke execute on function public.valor_mensal_b2b(uuid) from public, anon;
grant execute on function public.valor_mensal_b2b(uuid) to authenticated, service_role;

-- (4) search_path fixo nas funções que nasceram sem ele. Nenhuma é SECURITY
--     DEFINER, então não havia escalada; é a mesma higiene das outras 130.
alter function public.aluno_elegivel_catraca(text, text, timestamptz) set search_path = public;
alter function public.situacao_permite_app_em(public.situacao_aluno_academia, timestamptz, timestamptz) set search_path = public;
alter function public.situacao_permite_app(public.situacao_aluno_academia, timestamptz) set search_path = public;
alter function public.sla_mentor_horas(public.tarefa_prioridade) set search_path = public;
alter function public.versao_consentimento_biometrico() set search_path = public;
alter function public.versao_consentimento_ia() set search_path = public;
alter function public.versao_consentimento_saude() set search_path = public;
alter function public.vigia_classificar_erro(text) set search_path = public;
alter function public.vigia_ferramenta_executavel(text) set search_path = public;
alter function public.vigia_resolver_nomes(text, jsonb) set search_path = public;
alter function public.vigia_rotina_repetivel(text) set search_path = public;

-- (5) Rotina ainda rodando contava como rotina que falhou.
--
--     O pg_cron grava a execução como 'starting'/'running' e só depois como
--     'succeeded'. Várias rotinas disparam no mesmo segundo (a varredura do
--     Vigia, a análise dele e o alerta de catracas coincidem a cada 10
--     minutos), e quem avaliava a saúde naquele instante via a vizinha em
--     andamento — situação "falhou". O Vigia abriu ocorrência três vezes em
--     24/09/2026 por isso e mandou reexecutar a própria análise duas; o
--     alerta de rotinas, que roda aos :50 junto com as de 5 em 5 minutos,
--     estava sujeito ao mesmo aviso falso.
--
--     Agora vale só a última execução terminada, e falha é só 'failed'.
create or replace function public.avaliar_rotinas()
 returns table(nome text, agendamento text, ativa boolean, situacao text, ultima_execucao timestamp with time zone, ultimo_erro text, falhas_7d bigint, execucoes_7d bigint, intervalo_esperado interval)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
    where d.status in ('succeeded', 'failed')
    order by d.jobid, d.start_time desc
  ),
  semana as (
    select d.jobid,
           count(*) filter (where d.status in ('succeeded', 'failed')) as execucoes,
           count(*) filter (where d.status = 'failed') as falhas
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
$function$;
