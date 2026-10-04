-- Autorizações do aluno pedem a sessão da própria pessoa (decisão do
-- responsável, 04/10/2026).
--
-- Simular o perfil é entrar na conta da pessoa: o banco vê o próprio aluno.
-- Sem esta trava, quem simula autorizaria a IA, a digital e o rosto, enviaria
-- a foto do rosto, aceitaria os documentos legais, daria o consentimento de
-- saúde e assinaria o contrato de matrícula em nome dele. A lei pede essas
-- autorizações do titular, e o banco já recusa quando a equipe tenta pela
-- conta dela; faltava recusar pela conta dele, numa sessão que não é dele.
--
-- Como o banco sabe que a sessão é simulada: `impersonar-perfil` abre a
-- sessão no servidor e grava o identificador dela aqui, antes de entregá-la.
-- É o único caminho que cria sessão simulada, então não depende de a tela
-- lembrar de avisar.

create table if not exists public.sessoes_simuladas (
  session_id uuid primary key,
  alvo_user_id uuid not null,
  ator_user_id uuid not null,
  criada_em timestamptz not null default now()
);

comment on table public.sessoes_simuladas is
  'Sessões abertas por impersonar-perfil. Só a service role lê e grava; sai na limpeza diária quando a sessão acaba.';

alter table public.sessoes_simuladas enable row level security;
revoke all on public.sessoes_simuladas from public, anon, authenticated;
grant select, insert, delete on public.sessoes_simuladas to service_role;

-- A sessão de quem chama é simulada? Responde só sobre quem chama.
create or replace function public.sessao_simulada()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.sessoes_simuladas s
     where s.session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
  );
$$;

revoke execute on function public.sessao_simulada() from public, anon;
grant execute on function public.sessao_simulada() to authenticated, service_role;

-- ── A trava, por gatilho: vale para a tela, a RPC e qualquer caminho novo ──
create or replace function public.recusar_autorizacao_em_sessao_simulada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.sessao_simulada() then
    raise exception 'Em perfil simulado, só a própria pessoa autoriza, retira a autorização, aceita ou assina. Peça a ela para fazer isso no app dela.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_autorizacao_da_propria_pessoa on public.aluno_consentimento_ia;
create trigger trg_autorizacao_da_propria_pessoa before insert or update on public.aluno_consentimento_ia
  for each row execute function public.recusar_autorizacao_em_sessao_simulada();
drop trigger if exists trg_autorizacao_da_propria_pessoa on public.aluno_consentimento_biometrico;
create trigger trg_autorizacao_da_propria_pessoa before insert or update on public.aluno_consentimento_biometrico
  for each row execute function public.recusar_autorizacao_em_sessao_simulada();
drop trigger if exists trg_autorizacao_da_propria_pessoa on public.aceites_documentos;
create trigger trg_autorizacao_da_propria_pessoa before insert or update on public.aceites_documentos
  for each row execute function public.recusar_autorizacao_em_sessao_simulada();
drop trigger if exists trg_autorizacao_da_propria_pessoa on public.aluno_assinaturas_contrato;
create trigger trg_autorizacao_da_propria_pessoa before insert or update on public.aluno_assinaturas_contrato
  for each row execute function public.recusar_autorizacao_em_sessao_simulada();
drop trigger if exists trg_autorizacao_da_propria_pessoa on public.fotos_rosto_pendentes;
create trigger trg_autorizacao_da_propria_pessoa before insert or update on public.fotos_rosto_pendentes
  for each row execute function public.recusar_autorizacao_em_sessao_simulada();

-- O consentimento de saúde mora na própria anamnese: a trava olha só as
-- colunas dele. Preencher a anamnese não é autorizar nada.
create or replace function public.recusar_consentimento_saude_em_sessao_simulada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' and new.consentimento_lgpd_aceito_em is not null)
     or (tg_op = 'UPDATE' and (new.consentimento_lgpd_aceito_em is distinct from old.consentimento_lgpd_aceito_em
                               or new.consentimento_lgpd_versao is distinct from old.consentimento_lgpd_versao)) then
    if public.sessao_simulada() then
      raise exception 'Em perfil simulado, só a própria pessoa autoriza, retira a autorização, aceita ou assina. Peça a ela para fazer isso no app dela.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_consentimento_saude_da_propria_pessoa on public.anamnese_acolhimento;
create trigger trg_consentimento_saude_da_propria_pessoa before insert or update on public.anamnese_acolhimento
  for each row execute function public.recusar_consentimento_saude_em_sessao_simulada();

revoke execute on function public.recusar_autorizacao_em_sessao_simulada() from public, anon, authenticated;
revoke execute on function public.recusar_consentimento_saude_em_sessao_simulada() from public, anon, authenticated;

-- ── Quem simula não é o aluno abrindo o app ──────────────────────────────
-- O primeiro acesso e o sinal de vida alimentam a ativação e a inércia do
-- Mentor: a visita de quem simula não pode contar como do aluno.
create or replace function public.registrar_primeiro_acesso_aluno()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.sessao_simulada() then
    return;
  end if;
  update public.alunos
     set primeiro_acesso_em = now()
   where user_id = auth.uid()
     and primeiro_acesso_em is null;
end;
$$;

create or replace function public.registrar_atividade_aluno()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.sessao_simulada() then
    return;
  end if;
  -- Freio de 15 minutos: o app chama isto a cada carga, e sem o freio seriam
  -- milhares de UPDATE por dia para responder a uma pergunta cuja unidade é o
  -- dia. A condição mora no WHERE para custar uma ida só ao banco.
  update public.alunos
     set ultima_atividade_em = now()
   where user_id = auth.uid()
     and (ultima_atividade_em is null or ultima_atividade_em < now() - interval '15 minutes');
end;
$$;

-- ── Limpeza: a marca sai quando a sessão acaba ───────────────────────────
create or replace function public.limpar_historicos_antigos()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _cron integer;
  _resumidos integer;
  _apagados integer;
  _freio integer;
  _simuladas integer;
begin
  delete from cron.job_run_details where end_time < now() - interval '30 days';
  get diagnostics _cron = row_count;

  update public.asaas_webhook_events
     set payload = jsonb_strip_nulls(jsonb_build_object(
           'event', payload->'event',
           'resumido_em', now(),
           'payment', jsonb_strip_nulls(jsonb_build_object(
             'id', payload->'payment'->'id',
             'status', payload->'payment'->'status',
             'value', payload->'payment'->'value',
             'netValue', payload->'payment'->'netValue',
             'dueDate', payload->'payment'->'dueDate',
             'externalReference', payload->'payment'->'externalReference',
             'subscription', payload->'payment'->'subscription'))))
   where processado
     and created_at < now() - interval '90 days'
     and not (payload ? 'resumido_em');
  get diagnostics _resumidos = row_count;

  delete from public.asaas_webhook_events where created_at < now() - interval '13 months';
  get diagnostics _apagados = row_count;

  delete from public.freio_chamadas where criado_em < now() - interval '2 days';
  get diagnostics _freio = row_count;

  delete from public.sessoes_simuladas s
   where s.criada_em < now() - interval '1 day'
     and not exists (select 1 from auth.sessions a where a.id = s.session_id);
  get diagnostics _simuladas = row_count;

  return jsonb_build_object('cron', _cron, 'avisos_resumidos', _resumidos, 'avisos_apagados', _apagados,
                            'freio', _freio, 'sessoes_simuladas', _simuladas);
end;
$function$;
revoke execute on function public.limpar_historicos_antigos() from public, anon, authenticated;
