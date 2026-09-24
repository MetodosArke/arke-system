-- Vigia, Fase 3: executa (decisão do responsável, 24/09/2026).
--
-- Depois do simulado da Fase 2, o responsável decidiu:
--   1. as 6 regras de nível 1 agem sozinhas;
--   2. as 3 de nível 2 pedem aprovação de um clique na Visão Master — a de
--      aviso do Asaas agrupada por tipo de evento;
--   3. a análise por IA é conselheira: o diagnóstico fica visível e as ações
--      dela pedem aprovação, mesmo as que o catálogo classifica como
--      "sozinho", até acumular casos reais.
--
-- O que muda por baixo:
--
-- * **Quem executa é o banco, pela rotina agendada — não a função publicada.**
--   O cron `arke-vigia` passa a chamar public.vigia_varrer() direto: se a
--   edge function quebrar num deploy, as correções continuam; e a rotina do
--   cron não tem o limite de 8 s que o PostgREST impõe a cada chamada, o que
--   importa quando a correção é rodar de novo uma rotina do banco. A edge
--   function `vigia` fica com a análise por IA e os avisos por e-mail
--   (cron `arke-vigia-analise`).
--
-- * **Detectar deixa de depender da ordem pendente.** No modo sombra a regra
--   ignorava o Gateway que já tinha uma ordem na fila, para não contar em
--   dobro o que alguém já tinha pedido. Executando, a própria ordem do Vigia
--   fecharia a ocorrência na varredura seguinte — e ela reabriria como nova,
--   zerando tentativas e escalonamento. Agora a regra olha só o problema, e
--   quem espera a ordem pendente é o executor.
--
-- * **Remoção de digital reenviada fecha o ciclo.** A remoção só valia quando
--   todas as ordens do lote concluíam; a que expirou ficava para sempre
--   "expirada" e o consentimento nunca ganhava a data de exclusão. Agora vale
--   a ordem MAIS RECENTE de cada catraca do lote, e a tarefa manual aberta
--   pela falha é fechada, com desfecho, quando o reenvio conclui.
--
-- * **Rotina de banco que o Vigia rodou de novo conta.** O histórico do cron
--   só tem as execuções agendadas; sem isto, uma rotina consertada pelo
--   Vigia seguiria "falhou" até a próxima execução agendada, e ele tentaria
--   de novo e escalaria à toa.

-- ── Regras: modo e ferramenta ─────────────────────────────────────────────
alter table public.vigia_regras drop constraint if exists vigia_regras_modo_check;
alter table public.vigia_regras add constraint vigia_regras_modo_check
  check (modo in ('sombra', 'desligada', 'automatica', 'aprovacao'));
alter table public.vigia_regras drop constraint if exists vigia_regras_modo_nivel;
alter table public.vigia_regras add constraint vigia_regras_modo_nivel check (
  (nivel = 1 and modo in ('automatica', 'sombra', 'desligada'))
  or (nivel = 2 and modo in ('aprovacao', 'sombra', 'desligada')));
alter table public.vigia_regras add column if not exists ferramenta text;

update public.vigia_regras set ferramenta = case codigo
    when 'gateway_sincronizacao_atrasada' then 'sincronizar_gateway'
    when 'gateway_fila_parada' then 'reenviar_acessos_gateway'
    when 'gateway_contingencia_prolongada' then 'pedir_diagnostico_gateway'
    when 'remocao_biometrica_parada' then 'reenviar_remocao_digital'
    when 'rotina_repetivel_falhou' then 'reexecutar_rotina'
    when 'reconciliacao_com_erro' then 'reconferir_asaas'
    when 'rotina_sensivel_falhou' then 'reexecutar_rotina'
    when 'assinatura_orfa' then 'cancelar_assinatura_orfa'
    when 'webhook_nao_processado' then 'reprocessar_evento_asaas'
  end;
alter table public.vigia_regras alter column ferramenta set not null;

update public.vigia_regras set modo = 'automatica' where nivel = 1 and modo = 'sombra';
update public.vigia_regras set modo = 'aprovacao' where nivel = 2 and modo = 'sombra';

-- Aviso do Asaas agrupado por tipo de evento: uma queda do Asaas vira um
-- pedido de aprovação, não um por aviso. O freio deixa de fazer sentido.
update public.vigia_regras
   set titulo = 'Avisos de pagamento do Asaas não processados',
       acao = 'Processar de novo os avisos daquele tipo, com aprovação',
       freio_alvos = null
 where codigo = 'webhook_nao_processado';

-- ── Ocorrências: modo, decisão e aviso ─────────────────────────────────────
-- O modo da regra quando a ocorrência nasceu ou agiu: o que aconteceu no
-- modo sombra não se mistura com o que foi executado.
alter table public.vigia_ocorrencias add column if not exists modo text not null default 'sombra';
alter table public.vigia_ocorrencias drop constraint if exists vigia_ocorrencias_modo_check;
alter table public.vigia_ocorrencias add constraint vigia_ocorrencias_modo_check
  check (modo in ('sombra', 'automatica', 'aprovacao'));
alter table public.vigia_ocorrencias
  add column if not exists decisao text check (decisao in ('aprovada', 'dispensada')),
  add column if not exists decidida_por uuid,
  add column if not exists decidida_em timestamptz,
  add column if not exists decisao_motivo text,
  -- E-mail de "precisa de aprovação" ou "precisa de uma pessoa" já enviado.
  add column if not exists avisada_em timestamptz;

-- ── O que o Vigia fez ──────────────────────────────────────────────────────
-- Uma linha por ação executada — sozinha ou aprovada — e por ação dispensada.
-- Ordem ao Gateway é "ok" quando entra na fila; o desfecho dela está no
-- comando (comando_id), que o Gateway conclui depois.
create table if not exists public.vigia_acoes (
  id bigint generated always as identity primary key,
  criada_em timestamptz not null default now(),
  origem text not null check (origem in ('regra', 'analise')),
  ocorrencia_id bigint references public.vigia_ocorrencias(id) on delete set null,
  analise_id bigint references public.vigia_analises(id) on delete set null,
  indice integer,
  ferramenta text not null,
  alvo text,
  alvo_nome text,
  organization_id uuid references public.organizations(id) on delete cascade,
  forma text not null check (forma in ('automatica', 'aprovada', 'dispensada')),
  decidido_por uuid,
  resultado text not null check (resultado in ('executando', 'ok', 'erro', 'dispensada')),
  detalhe text,
  comando_id uuid references public.gateway_comandos(id) on delete set null
);
-- Uma decisão por ação da análise: dois cliques não executam duas vezes.
create unique index if not exists idx_vigia_acoes_decisao_analise
  on public.vigia_acoes (analise_id, indice) where origem = 'analise';
create index if not exists idx_vigia_acoes_criada on public.vigia_acoes (criada_em desc);
create index if not exists idx_vigia_acoes_rotina on public.vigia_acoes (ferramenta, alvo, criada_em desc);

alter table public.vigia_acoes enable row level security;
drop policy if exists "leitura" on public.vigia_acoes;
create policy "leitura" on public.vigia_acoes for select to authenticated using (
  public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
revoke all on public.vigia_acoes from anon, authenticated;
grant select on public.vigia_acoes to authenticated;
grant all on public.vigia_acoes to service_role;

-- ── Apoio ──────────────────────────────────────────────────────────────────

create or replace function public.vigia_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select valor from public.plataforma_config where chave = 'vigia_ativo'), 0) = 1;
$$;

-- A análise por IA roda numa rotina própria agora; rodá-la de novo só refaz a
-- análise e reenvia avisos ainda não marcados — repetível.
create or replace function public.vigia_rotina_repetivel(_nome text)
returns boolean
language sql
immutable
as $$
  select _nome = any (array[
    'arke-ativacao-pendente', 'arke-escalonamento-sla', 'arke-barreira-rotina', 'arke-acolhimento-elite',
    'arke-alerta-atestado', 'arke-inercia-mentor', 'arke-engajamento-baixo', 'arke-comandos-gateway',
    'arke-fechar-giros-pendentes', 'arke-situacao-mensalidade', 'arke-avanco-fases',
    'arke-lancamentos-atrasados', 'arke-lancamentos-recorrentes', 'arke-retencao-logs-catraca',
    'snapshot-mrr-diario', 'arke-alerta-rotinas', 'arke-alerta-catracas', 'arke-reconciliacao-asaas',
    'arke-vigia-analise'
  ]);
$$;

-- O que o Vigia sabe executar pelo banco. O resto — Asaas — é da edge
-- function vigia-aprovar; reiniciar o Gateway ainda não existe.
create or replace function public.vigia_ferramenta_executavel(_ferramenta text)
returns boolean
language sql
immutable
as $$
  select _ferramenta = any (array[
    'sincronizar_gateway', 'reenviar_acessos_gateway', 'pedir_diagnostico_gateway', 'vencer_ordens_paradas',
    'reenviar_remocao_digital', 'reexecutar_rotina', 'reconferir_asaas', 'reprocessar_evento_asaas',
    'cancelar_assinatura_orfa'
  ]);
$$;

-- ── Executor ───────────────────────────────────────────────────────────────

-- Ordem ao Gateway em nome do Vigia. Mesmas travas da tela: catraca ativa,
-- capacidade anunciada, Gateway no ar — e não empilha ordem igual.
create or replace function public.vigia_enviar_ordem(_catraca uuid, _tipo text, _parametros jsonb, _lote uuid, _motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat public.organizacao_catracas;
  v_tel public.gateway_telemetria;
  v_id uuid;
begin
  select * into v_cat from public.organizacao_catracas where id = _catraca;
  if v_cat.id is null or v_cat.status is distinct from 'ativo' then
    return jsonb_build_object('resultado', 'erro', 'detalhe', 'Catraca inexistente ou desativada.');
  end if;
  select * into v_tel from public.gateway_telemetria where catraca_id = _catraca;
  if v_tel.catraca_id is null or not (_tipo = any (v_tel.capacidades)) then
    return jsonb_build_object('resultado', 'erro', 'detalhe', 'O Gateway não aceita esta ordem.');
  end if;
  if v_tel.reportado_em < now() - interval '3 minutes' then
    return jsonb_build_object('resultado', 'erro', 'detalhe', 'O Gateway está sem sinal — a ordem não chegaria.');
  end if;
  if exists (select 1 from public.gateway_comandos c
              where c.catraca_id = _catraca and c.tipo = _tipo and c.status in ('pendente', 'entregue')
                and (_lote is null or c.lote = _lote)) then
    return jsonb_build_object('resultado', 'ignorada', 'detalhe', 'Já há uma ordem igual na fila do Gateway.');
  end if;
  insert into public.gateway_comandos (organization_id, catraca_id, tipo, parametros, lote, motivo, expira_em)
  values (v_cat.organization_id, _catraca, _tipo, coalesce(_parametros, '{}'::jsonb), _lote, left(_motivo, 300),
          now() + case when _tipo = 'apagar_usuario' then interval '24 hours' else interval '10 minutes' end)
  returning id into v_id;
  return jsonb_build_object('resultado', 'ok', 'detalhe', 'Ordem na fila do Gateway.', 'comando_id', v_id);
end;
$$;

-- Roda de novo uma rotina agendada, com o mesmo comando do cron. Rotina que
-- chama edge function só é disparada — a função registra o próprio desfecho.
create or replace function public.vigia_rodar_rotina(_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cmd text;
begin
  if _nome = 'arke-vigia' then
    return jsonb_build_object('resultado', 'erro', 'detalhe', 'O Vigia não roda a si mesmo.');
  end if;
  select command into v_cmd from cron.job where jobname = _nome;
  if v_cmd is null then
    return jsonb_build_object('resultado', 'erro', 'detalhe', 'Rotina não encontrada.');
  end if;
  begin
    execute v_cmd;
  exception when others then
    return jsonb_build_object('resultado', 'erro', 'detalhe', left(sqlerrm, 300));
  end;
  return jsonb_build_object('resultado', 'ok', 'detalhe',
    case when v_cmd like '%/functions/v1/%' then 'Rotina disparada; a função registra o próprio desfecho.'
         else 'A rotina rodou de novo sem erro.' end);
end;
$$;

-- Reenvia a remoção de digital parada numa catraca: a ordem mais recente de
-- cada lote, se expirou ou falhou e a tarefa manual segue aberta.
create or replace function public.vigia_reenviar_remocao(_catraca uuid, _lote uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x record;
  r jsonb;
  n_ok integer := 0;
  n_ign integer := 0;
  v_erro text;
  v_comando uuid;
begin
  for x in
    select u.lote, u.parametros->>'user_id' as user_id
      from (select distinct on (c.lote) c.*
              from public.gateway_comandos c
             where c.catraca_id = _catraca and c.tipo = 'apagar_usuario' and c.lote is not null
               and (_lote is null or c.lote = _lote)
             order by c.lote, c.solicitado_em desc) u
     where u.status in ('expirado', 'falhou')
       and exists (select 1 from public.tarefas t
                    where t.origem_evento = 'equipamento:' || u.lote::text and t.status not in ('concluida', 'cancelada'))
  loop
    r := public.vigia_enviar_ordem(_catraca, 'apagar_usuario', jsonb_build_object('user_id', x.user_id), x.lote,
                                   'Vigia: remoção da digital reenviada');
    if r->>'resultado' = 'ok' then
      n_ok := n_ok + 1;
      v_comando := (r->>'comando_id')::uuid;
    elsif r->>'resultado' = 'ignorada' then
      n_ign := n_ign + 1;
    else
      v_erro := r->>'detalhe';
    end if;
  end loop;
  if n_ok > 0 then
    return jsonb_build_object('resultado', 'ok', 'detalhe', n_ok || ' remoção(ões) reenviada(s) ao Gateway.', 'comando_id', v_comando);
  elsif v_erro is not null then
    return jsonb_build_object('resultado', 'erro', 'detalhe', v_erro);
  elsif n_ign > 0 then
    return jsonb_build_object('resultado', 'ignorada', 'detalhe', 'A remoção já está na fila do Gateway.');
  end if;
  return jsonb_build_object('resultado', 'ignorada', 'detalhe', 'Nenhuma remoção parada nesta catraca.');
end;
$$;

-- Executa uma ferramenta do catálogo pelo banco. O alvo aqui é o de verdade
-- (id da catraca, nome da rotina), nunca o pseudônimo da análise.
create or replace function public.vigia_executar(_ferramenta text, _alvo text, _contexto jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_catraca uuid;
  n integer;
begin
  if _ferramenta in ('sincronizar_gateway', 'reenviar_acessos_gateway', 'pedir_diagnostico_gateway',
                     'vencer_ordens_paradas', 'reenviar_remocao_digital') then
    begin
      v_catraca := _alvo::uuid;
    exception when others then
      return jsonb_build_object('resultado', 'erro', 'detalhe', 'Alvo não é uma catraca.');
    end;
  end if;

  case _ferramenta
    when 'sincronizar_gateway' then
      return public.vigia_enviar_ordem(v_catraca, 'sincronizar_completo', '{}'::jsonb, null, 'Vigia: lista de alunos atrasada');
    when 'reenviar_acessos_gateway' then
      return public.vigia_enviar_ordem(v_catraca, 'enviar_logs', '{}'::jsonb, null, 'Vigia: acessos guardados sem subir');
    when 'pedir_diagnostico_gateway' then
      return public.vigia_enviar_ordem(v_catraca, 'diagnostico', '{}'::jsonb, null, 'Vigia: diagnóstico do Gateway');
    when 'vencer_ordens_paradas' then
      n := public.expirar_comandos_gateway(v_catraca);
      return jsonb_build_object('resultado', 'ok', 'detalhe', n || ' ordem(ns) vencida(s).');
    when 'reenviar_remocao_digital' then
      return public.vigia_reenviar_remocao(v_catraca, nullif(_contexto->>'lote', '')::uuid);
    when 'reexecutar_rotina' then
      return public.vigia_rodar_rotina(_alvo);
    when 'reconferir_asaas' then
      return public.vigia_rodar_rotina('arke-reconciliacao-asaas');
    else
      return jsonb_build_object('resultado', 'erro', 'detalhe', 'Esta ação não é executada pelo banco.');
  end case;
end;
$$;

-- ── Remoção de digital: vale a ordem mais recente de cada catraca ──────────
create or replace function public.verificar_remocao_concluida(_lote uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aluno uuid;
begin
  if _lote is null then
    return;
  end if;
  -- Cada catraca do lote precisa ter a ordem MAIS RECENTE concluída: o Vigia
  -- pode ter reenviado uma que expirou, e a expirada não conta mais.
  if exists (select 1
               from (select distinct on (c.catraca_id) c.status
                       from public.gateway_comandos c
                      where c.lote = _lote
                      order by c.catraca_id, c.solicitado_em desc) u
              where u.status <> 'concluido') then
    return;
  end if;
  -- A tarefa aberta pela falha da ordem remota fica cumprida pelo reenvio.
  -- A manual (equipamento sem gestão remota) continua exigindo uma pessoa.
  update public.tarefas
     set status = 'concluida',
         desfecho_acao = 'Removido do equipamento por ordem remota reenviada pelo Vigia.'
   where origem_evento = 'equipamento:' || _lote::text and status not in ('concluida', 'cancelada')
     and exists (select 1 from public.gateway_comandos c where c.lote = _lote);
  if exists (
    select 1 from public.tarefas
     where origem_evento in ('equipamento:' || _lote::text, 'equipamento-manual:' || _lote::text)
       and status not in ('concluida', 'cancelada')
  ) then
    return;
  end if;
  select aluno_id into v_aluno from public.gateway_comandos where lote = _lote and aluno_id is not null limit 1;
  if v_aluno is null then
    select aluno_id into v_aluno from public.tarefas
     where origem_evento in ('equipamento:' || _lote::text, 'equipamento-manual:' || _lote::text)
       and aluno_id is not null limit 1;
  end if;
  if v_aluno is not null then
    update public.aluno_consentimento_biometrico
       set excluido_do_equipamento_em = now()
     where aluno_id = v_aluno and revogado_em is not null and excluido_do_equipamento_em is null;
  end if;
end;
$$;

-- ── Regras: o que cada uma vê ──────────────────────────────────────────────
create or replace function public.vigia_detectar()
returns table(regra text, alvo text, organization_id uuid, descricao text, contexto jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with gw as (
    select * from public.vigia_gateways() g
     where g.versao_1 and g.reportado_em > now() - interval '3 minutes'
  ),
  varredura as (
    select * from public.reconciliacoes_asaas where modo = 'varredura' order by executada_em desc limit 1
  )
  select 'gateway_sincronizacao_atrasada', 'catraca:' || g.catraca_id, g.organization_id,
         g.catraca || ' (' || g.academia || '): lista de alunos ' ||
           coalesce('sincronizada há ' || floor(extract(epoch from now() - g.ultima_sincronizacao) / 60)::int || ' min',
                    'nunca sincronizada'),
         jsonb_build_object('catraca_id', g.catraca_id, 'ultima_sincronizacao', g.ultima_sincronizacao)
    from gw g
   where 'sincronizar_completo' = any (g.capacidades)
     and (g.ultima_sincronizacao is null or g.ultima_sincronizacao < now() - interval '20 minutes')
  union all
  select 'gateway_fila_parada', 'catraca:' || g.catraca_id, g.organization_id,
         g.catraca || ' (' || g.academia || '): ' || g.fila || ' acesso(s) guardado(s) no Gateway sem subir, com a nuvem respondendo',
         jsonb_build_object('catraca_id', g.catraca_id, 'fila_offline', g.fila)
    from gw g
   where g.estado = 'online' and g.fila > 0 and 'enviar_logs' = any (g.capacidades)
  union all
  select 'gateway_contingencia_prolongada', 'catraca:' || g.catraca_id, g.organization_id,
         g.catraca || ' (' || g.academia || '): decidindo pelo cadastro local — a nuvem não responde a tempo',
         jsonb_build_object('catraca_id', g.catraca_id)
    from gw g
   where g.estado = 'contingencia' and 'diagnostico' = any (g.capacidades)
  union all
  -- Remoção parada: a ordem mais recente daquela catraca no lote não
  -- concluiu e a tarefa aberta pela falha segue de pé. Fica aberta enquanto
  -- o reenvio espera o Gateway — é o executor que não empilha ordem.
  select 'remocao_biometrica_parada', 'lote:' || u.lote || ':catraca:' || u.catraca_id, u.organization_id,
         'Remoção de digital parada em ' || g.catraca || ' (' || g.academia || '): '
           || case u.status when 'expirado' then 'a ordem expirou' when 'falhou' then 'a ordem falhou'
                            else 'ordem reenviada, aguardando o Gateway' end,
         jsonb_build_object('lote', u.lote, 'catraca_id', u.catraca_id, 'user_id', u.parametros->>'user_id', 'tarefa_id', tf.id)
    from (select distinct on (x.lote, x.catraca_id) x.*
            from public.gateway_comandos x
           where x.tipo = 'apagar_usuario' and x.lote is not null
           order by x.lote, x.catraca_id, x.solicitado_em desc) u
    join gw g on g.catraca_id = u.catraca_id
    join public.tarefas tf on tf.organization_id = u.organization_id
                          and tf.origem_evento = 'equipamento:' || u.lote::text
                          and tf.status not in ('concluida', 'cancelada')
   where u.status <> 'concluido' and 'apagar_usuario' = any (g.capacidades)
  union all
  -- Rotina de banco que o Vigia rodou de novo com sucesso, depois da falha,
  -- já está consertada: o histórico do cron só vai registrar isso na próxima
  -- execução agendada. Rotina de edge function registra o próprio desfecho.
  select case when public.vigia_rotina_repetivel(r.nome) then 'rotina_repetivel_falhou' else 'rotina_sensivel_falhou' end,
         'rotina:' || r.nome, null::uuid,
         'Rotina ' || r.nome || ' falhou' || coalesce(' (' || left(r.ultimo_erro, 160) || ')', ''),
         jsonb_build_object('rotina', r.nome, 'ultima_execucao', r.ultima_execucao, 'falhas_7d', r.falhas_7d)
    from public.avaliar_rotinas() r
    left join cron.job j on j.jobname = r.nome
   where r.situacao = 'falhou' and r.nome <> 'arke-vigia'
     and (coalesce(j.command, '') like '%/functions/v1/%'
          or not exists (select 1 from public.vigia_acoes a
                          where a.ferramenta = 'reexecutar_rotina' and a.alvo = r.nome and a.resultado = 'ok'
                            and a.criada_em > coalesce(r.ultima_execucao, '-infinity'::timestamptz)))
  union all
  select 'reconciliacao_com_erro', 'reconciliacao', null::uuid,
         'A conferência Asaas ↔ banco de ' || to_char(v.executada_em, 'DD/MM HH24:MI') || ' terminou com erro'
           || coalesce(': ' || left(v.erro, 160), ''),
         jsonb_build_object('reconciliacao_id', v.id)
    from varredura v
   where v.erro is not null
  union all
  select 'assinatura_orfa', 'assinatura:' || (e->>'id'), null::uuid,
         'Assinatura ativa no Asaas sem registro no banco (' || coalesce(nullif(e->>'referencia', ''), 'sem referência') || ')',
         jsonb_build_object('assinatura', e->>'id', 'referencia', e->>'referencia', 'reconciliacao_id', v.id)
    from varredura v,
         jsonb_array_elements(case when jsonb_typeof(v.detalhes->'orfas') = 'array' then v.detalhes->'orfas' else '[]'::jsonb end) e
   where coalesce(e->>'id', '') <> ''
  union all
  -- Agrupado por tipo: uma queda do Asaas é um pedido de aprovação só.
  select 'webhook_nao_processado', 'eventos:' || w.tipo_evento, null::uuid,
         count(*) || ' aviso(s) ' || w.tipo_evento || ' do Asaas sem processar, o mais antigo de '
           || to_char(min(w.created_at), 'DD/MM HH24:MI'),
         jsonb_build_object('tipo_evento', w.tipo_evento, 'quantidade', count(*))
    from public.asaas_webhook_events w
   where w.erro is not null and not w.processado
     and w.created_at > now() - interval '7 days' and w.created_at < now() - interval '15 minutes'
   group by w.tipo_evento;
$$;

-- ── A varredura: agora executa ─────────────────────────────────────────────
create or replace function public.vigia_varrer()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_det jsonb;
  v_freio text[];
  n_novas integer := 0;
  n_fechadas integer := 0;
  n_acoes integer := 0;
  n_tentativas integer := 0;
  n_exec integer := 0;
  n_escaladas integer := 0;
  pend record;
  v_res jsonb;
  v_alvo text;
  -- Teto por varredura: se algo sair do controle, o estrago é limitado e a
  -- sobra fica para a próxima.
  c_limite constant integer := 20;
begin
  if not public.vigia_ativo() then
    return jsonb_build_object('ativo', false);
  end if;

  insert into public.vigia_varreduras_dia (dia, varreduras) values (current_date, 1)
  on conflict (dia) do update set varreduras = public.vigia_varreduras_dia.varreduras + 1;

  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_det
    from (select distinct on (x.regra, x.alvo) x.*
            from public.vigia_detectar() x
            join public.vigia_regras r on r.codigo = x.regra and r.modo <> 'desligada'
           order by x.regra, x.alvo) d;

  select coalesce(array_agg(r.codigo), '{}') into v_freio
    from public.vigia_regras r
   where r.freio_alvos is not null
     and (select count(*) from jsonb_to_recordset(v_det) x(regra text) where x.regra = r.codigo) >= r.freio_alvos;

  update public.vigia_ocorrencias o set fechada_em = now()
   where o.fechada_em is null
     and not exists (select 1 from jsonb_to_recordset(v_det) x(regra text, alvo text)
                      where x.regra = o.regra and x.alvo = o.alvo);
  get diagnostics n_fechadas = row_count;

  update public.vigia_ocorrencias o
     set vista_em = now(), descricao = x.descricao, contexto = x.contexto
    from jsonb_to_recordset(v_det) x(regra text, alvo text, descricao text, contexto jsonb)
   where o.fechada_em is null and o.regra = x.regra and o.alvo = x.alvo;

  insert into public.vigia_ocorrencias (regra, alvo, organization_id, descricao, contexto, modo)
  select x.regra, x.alvo, x.organization_id, x.descricao, x.contexto, r.modo
    from jsonb_to_recordset(v_det) x(regra text, alvo text, organization_id uuid, descricao text, contexto jsonb)
    join public.vigia_regras r on r.codigo = x.regra
   where not exists (select 1 from public.vigia_ocorrencias o
                      where o.fechada_em is null and o.regra = x.regra and o.alvo = x.alvo);
  get diagnostics n_novas = row_count;

  update public.vigia_ocorrencias o set freio_em = coalesce(o.freio_em, now())
   where o.fechada_em is null and o.regra = any (v_freio);

  -- Hora de agir (passou a espera) ou de nova tentativa. Em modo automático
  -- executa; em aprovação abre o pedido; em sombra só registra.
  for pend in
    select oc.id, oc.contexto, oc.organization_id, oc.descricao, oc.acao_prevista_em,
           r.nivel, r.modo as rmodo, r.ferramenta
      from public.vigia_ocorrencias oc
      join public.vigia_regras r on r.codigo = oc.regra
     where oc.fechada_em is null and r.modo <> 'desligada' and not (oc.regra = any (v_freio))
       and ((oc.acao_prevista_em is null and oc.aberta_em <= now() - make_interval(mins => r.espera_minutos))
            or (r.nivel = 1 and r.retentativa_minutos is not null and oc.acao_prevista_em is not null
                and oc.escalaria_em is null and oc.tentativas_previstas < r.max_tentativas
                and oc.ultima_tentativa_em <= now() - make_interval(mins => r.retentativa_minutos)))
     order by oc.aberta_em
  loop
    if pend.rmodo = 'automatica' then
      if n_exec >= c_limite then
        continue;
      end if;
      v_alvo := case pend.ferramenta
                  when 'reexecutar_rotina' then pend.contexto->>'rotina'
                  when 'reconferir_asaas' then 'plataforma'
                  else pend.contexto->>'catraca_id' end;
      v_res := public.vigia_executar(pend.ferramenta, v_alvo, pend.contexto);
      -- Ordem igual já na fila: espera a próxima varredura, sem gastar tentativa.
      if v_res->>'resultado' = 'ignorada' then
        continue;
      end if;
      n_exec := n_exec + 1;
      insert into public.vigia_acoes (origem, ocorrencia_id, ferramenta, alvo, alvo_nome, organization_id,
                                      forma, resultado, detalhe, comando_id)
      values ('regra', pend.id, pend.ferramenta, v_alvo, pend.descricao, pend.organization_id,
              'automatica', v_res->>'resultado', v_res->>'detalhe', nullif(v_res->>'comando_id', '')::uuid);
    end if;
    if pend.acao_prevista_em is null then
      n_acoes := n_acoes + 1;
    else
      n_tentativas := n_tentativas + 1;
    end if;
    update public.vigia_ocorrencias
       set acao_prevista_em = coalesce(acao_prevista_em, now()),
           tentativas_previstas = case when pend.nivel = 1 then tentativas_previstas + 1 else 0 end,
           ultima_tentativa_em = case when pend.nivel = 1 then now() end,
           modo = pend.rmodo
     where id = pend.id;
  end loop;

  -- Esgotou as tentativas e segue de pé: vai para uma pessoa.
  update public.vigia_ocorrencias o set escalaria_em = now()
    from public.vigia_regras r
   where r.codigo = o.regra and r.nivel = 1
     and o.fechada_em is null and o.escalaria_em is null and o.acao_prevista_em is not null
     and o.tentativas_previstas >= r.max_tentativas
     and o.ultima_tentativa_em <= now() - make_interval(mins => coalesce(r.retentativa_minutos, 30));
  get diagnostics n_escaladas = row_count;

  delete from public.vigia_acoes where criada_em < now() - interval '180 days';
  delete from public.vigia_ocorrencias where fechada_em < now() - interval '180 days';
  delete from public.vigia_analises where criada_em < now() - interval '180 days';
  delete from public.vigia_varreduras_dia where dia < current_date - 400;

  return jsonb_build_object(
    'ativo', true, 'deteccoes', jsonb_array_length(v_det), 'novas', n_novas, 'fechadas', n_fechadas,
    'acoes', n_acoes, 'tentativas', n_tentativas, 'executadas', n_exec, 'escaladas', n_escaladas,
    'freio', to_jsonb(v_freio));
end;
$$;

-- ── Avisos por e-mail: aprovação pedida e escalonamento ────────────────────
create or replace function public.vigia_avisos_pendentes()
returns table(id bigint, tipo text, regra text, titulo text, acao text, descricao text, desde timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.id,
         case when o.escalaria_em is not null then 'escalada' else 'aprovacao' end,
         o.regra, r.titulo, r.acao, o.descricao, coalesce(o.escalaria_em, o.acao_prevista_em)
    from public.vigia_ocorrencias o
    join public.vigia_regras r on r.codigo = o.regra
   where o.fechada_em is null and o.avisada_em is null
     and ((o.modo = 'automatica' and o.escalaria_em is not null)
          or (o.modo = 'aprovacao' and o.acao_prevista_em is not null and o.decisao is null))
   order by 7;
$$;

create or replace function public.vigia_marcar_avisadas(_ids bigint[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.vigia_ocorrencias set avisada_em = now() where id = any (_ids) and avisada_em is null;
$$;

-- ── Aprovação e dispensa ───────────────────────────────────────────────────

-- Reserva a decisão antes de executar: dois cliques, ou duas abas, não
-- executam duas vezes. Quem chama é a edge function vigia-aprovar, com o id
-- do usuário que ela tirou do JWT.
create or replace function public.vigia_preparar_aprovacao(_uid uuid, _origem text, _id bigint, _indice integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.vigia_ocorrencias;
  r public.vigia_regras;
  a public.vigia_analises;
  ac jsonb;
  v_ferramenta text;
  v_alvo text;
  v_nome text;
  v_ctx jsonb := '{}'::jsonb;
  v_org uuid;
  v_acao bigint;
begin
  if not (public.has_role(_uid, 'superadmin') or public.has_role(_uid, 'admin_arke')) then
    raise exception 'Só a ArkeFit aprova ações do Vigia.' using errcode = '42501';
  end if;

  if _origem = 'regra' then
    select * into o from public.vigia_ocorrencias where id = _id for update;
    if o.id is null then
      raise exception 'Ocorrência não encontrada.';
    end if;
    select * into r from public.vigia_regras where codigo = o.regra;
    if o.fechada_em is not null then
      raise exception 'O problema já foi resolvido — não há o que aprovar.';
    end if;
    if o.decisao is not null then
      raise exception 'Esta ocorrência já foi decidida.';
    end if;
    if r.nivel <> 2 or o.acao_prevista_em is null then
      raise exception 'Esta ocorrência não está aguardando aprovação.';
    end if;
    v_ferramenta := r.ferramenta;
    v_alvo := case r.ferramenta
                when 'reexecutar_rotina' then o.contexto->>'rotina'
                when 'cancelar_assinatura_orfa' then o.contexto->>'assinatura'
                when 'reprocessar_evento_asaas' then o.contexto->>'tipo_evento' end;
    v_nome := o.descricao;
    v_ctx := o.contexto;
    v_org := o.organization_id;
    update public.vigia_ocorrencias set decisao = 'aprovada', decidida_por = _uid, decidida_em = now() where id = o.id;
    insert into public.vigia_acoes (origem, ocorrencia_id, ferramenta, alvo, alvo_nome, organization_id, forma, decidido_por, resultado)
    values ('regra', o.id, v_ferramenta, v_alvo, v_nome, v_org, 'aprovada', _uid, 'executando')
    returning id into v_acao;

  elsif _origem = 'analise' then
    select * into a from public.vigia_analises where id = _id;
    if a.id is null or a.status <> 'ok' then
      raise exception 'Análise não encontrada.';
    end if;
    if a.criada_em < now() - interval '12 hours' then
      raise exception 'Análise de mais de 12 horas — o quadro mudou desde então.';
    end if;
    ac := a.acoes -> _indice;
    if ac is null then
      raise exception 'Ação não encontrada.';
    end if;
    v_ferramenta := ac->>'ferramenta';
    if ac ? 'recusada' or not public.vigia_ferramenta_executavel(v_ferramenta)
       or v_ferramenta = 'cancelar_assinatura_orfa' then
      raise exception 'Esta ação não é executada pelo Vigia.';
    end if;
    -- O pseudônimo da análise vira o alvo de verdade pelo mapa, que nunca
    -- saiu do banco.
    v_alvo := coalesce(a.mapa -> (ac->>'alvo') ->> 'id', ac->>'alvo');
    v_nome := coalesce(a.mapa -> (ac->>'alvo') ->> 'nome', ac->>'alvo');
    if a.mapa -> (ac->>'alvo') ->> 'tipo' = 'catraca' then
      select organization_id into v_org from public.organizacao_catracas where id = v_alvo::uuid;
    elsif a.mapa -> (ac->>'alvo') ->> 'tipo' = 'organizacao' then
      v_org := v_alvo::uuid;
    end if;
    v_ctx := case when v_ferramenta = 'reprocessar_evento_asaas' then jsonb_build_object('tipo_evento', v_alvo) else '{}'::jsonb end;
    begin
      insert into public.vigia_acoes (origem, analise_id, indice, ferramenta, alvo, alvo_nome, organization_id, forma, decidido_por, resultado)
      values ('analise', a.id, _indice, v_ferramenta, v_alvo, v_nome, v_org, 'aprovada', _uid, 'executando')
      returning id into v_acao;
    exception when unique_violation then
      raise exception 'Esta ação já foi decidida.';
    end;
  else
    raise exception 'Origem inválida.';
  end if;

  return jsonb_build_object('acao_id', v_acao, 'ferramenta', v_ferramenta, 'alvo', v_alvo, 'alvo_nome', v_nome, 'contexto', v_ctx);
end;
$$;

create or replace function public.vigia_concluir_acao(_acao_id bigint, _resultado text, _detalhe text, _comando_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vigia_acoes;
begin
  update public.vigia_acoes
     set resultado = case when _resultado in ('ok', 'erro') then _resultado else 'erro' end,
         detalhe = left(_detalhe, 300), comando_id = _comando_id
   where id = _acao_id and resultado = 'executando'
  returning * into v;
  if v.id is null then
    return;
  end if;
  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, detalhes, organizacao_nome)
  select v.decidido_por, u.email, 'vigia.aprovar', 'vigia_acoes',
         jsonb_build_object('acao_id', v.id, 'origem', v.origem, 'ferramenta', v.ferramenta, 'alvo', v.alvo_nome,
                            'resultado', v.resultado, 'detalhe', v.detalhe),
         (select nome from public.organizations where id = v.organization_id)
    from (select 1) um
    left join auth.users u on u.id = v.decidido_por;
end;
$$;

-- Dispensar: pela tela, com o usuário da sessão.
create or replace function public.vigia_dispensar(_origem text, _id bigint, _indice integer default null, _motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  o public.vigia_ocorrencias;
  a public.vigia_analises;
  ac jsonb;
  v_ferramenta text;
  v_nome text;
begin
  if not (public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'Só a ArkeFit decide as ações do Vigia.' using errcode = '42501';
  end if;
  if _origem = 'regra' then
    update public.vigia_ocorrencias
       set decisao = 'dispensada', decidida_por = v_uid, decidida_em = now(), decisao_motivo = left(nullif(btrim(_motivo), ''), 300)
     where id = _id and decisao is null and fechada_em is null
    returning * into o;
    if o.id is null then
      raise exception 'Esta ocorrência já foi decidida ou já foi resolvida.';
    end if;
    select ferramenta into v_ferramenta from public.vigia_regras where codigo = o.regra;
    insert into public.vigia_acoes (origem, ocorrencia_id, ferramenta, alvo_nome, organization_id, forma, decidido_por, resultado, detalhe)
    values ('regra', o.id, v_ferramenta, o.descricao, o.organization_id, 'dispensada', v_uid, 'dispensada', left(_motivo, 300));
  elsif _origem = 'analise' then
    select * into a from public.vigia_analises where id = _id;
    ac := a.acoes -> _indice;
    if a.id is null or ac is null then
      raise exception 'Ação não encontrada.';
    end if;
    v_ferramenta := ac->>'ferramenta';
    v_nome := coalesce(a.mapa -> (ac->>'alvo') ->> 'nome', ac->>'alvo');
    begin
      insert into public.vigia_acoes (origem, analise_id, indice, ferramenta, alvo_nome, forma, decidido_por, resultado, detalhe)
      values ('analise', a.id, _indice, v_ferramenta, v_nome, 'dispensada', v_uid, 'dispensada', left(_motivo, 300));
    exception when unique_violation then
      raise exception 'Esta ação já foi decidida.';
    end;
  else
    raise exception 'Origem inválida.';
  end if;
end;
$$;

-- Modo de cada regra, pela tela. Nível 1 nunca pede aprovação e nível 2
-- nunca age sozinho sem uma mudança de código (a restrição da tabela).
create or replace function public.definir_modo_regra_vigia(_codigo text, _modo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_antes text;
begin
  if not (public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'Só a ArkeFit muda o modo das regras do Vigia.' using errcode = '42501';
  end if;
  select modo into v_antes from public.vigia_regras where codigo = _codigo;
  if v_antes is null then
    raise exception 'Regra não encontrada.';
  end if;
  update public.vigia_regras set modo = _modo where codigo = _codigo;
  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, detalhes)
  select v_uid, u.email, 'vigia.modo_regra', 'vigia_regras',
         jsonb_build_object('regra', _codigo, 'de', v_antes, 'para', _modo)
    from (select 1) um left join auth.users u on u.id = v_uid;
end;
$$;

-- ── Resumo, com o que foi executado e o que espera aprovação ───────────────
create or replace function public.vigia_resumo_interno(_horas integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with par as (
    select now() - make_interval(hours => greatest(1, least(coalesce(_horas, 24), 24 * 400))) as desde
  ),
  inicio as (select min(sombra_desde) as desde from public.vigia_regras),
  regras as (
    select r.codigo, r.nivel, r.titulo, r.acao, r.modo, r.ferramenta,
           count(o.id) filter (where o.aberta_em >= p.desde) as deteccoes,
           count(o.id) filter (where o.acao_prevista_em >= p.desde) as teria_agido,
           count(o.id) filter (where o.tentativas_previstas > 1 and o.ultima_tentativa_em >= p.desde) as com_retentativa,
           count(o.id) filter (where o.fechada_em >= p.desde and o.acao_prevista_em is null and o.freio_em is null) as sumiram_antes,
           round((percentile_cont(0.5) within group (order by extract(epoch from o.fechada_em - o.aberta_em) / 60)
             filter (where o.fechada_em >= p.desde and o.acao_prevista_em is null and o.freio_em is null))::numeric, 1)
             as mediana_min_sumiram,
           count(o.id) filter (where o.acao_prevista_em >= p.desde
                                 and (o.fechada_em is null or o.fechada_em > o.acao_prevista_em)) as persistiram,
           count(o.id) filter (where o.escalaria_em >= p.desde) as escalariam,
           count(o.id) filter (where o.freio_em >= p.desde) as freios,
           count(o.id) filter (where o.fechada_em is null) as abertas
      from public.vigia_regras r
      cross join par p
      left join public.vigia_ocorrencias o on o.regra = r.codigo
     group by r.codigo, r.nivel, r.titulo, r.acao, r.modo, r.ferramenta
  ),
  analises as (
    select a.* from public.vigia_analises a, par p where a.criada_em >= p.desde
  ),
  acoes as (
    select ac from analises a, jsonb_array_elements(a.acoes) ac where a.status = 'ok'
  ),
  feitas as (
    select v.* from public.vigia_acoes v, par p where v.criada_em >= p.desde
  ),
  pendentes as (
    select 'regra' as origem, o.id, null::integer as indice, o.acao_prevista_em as desde, r.ferramenta,
           o.descricao as alvo_nome, o.descricao, r.titulo
      from public.vigia_ocorrencias o join public.vigia_regras r on r.codigo = o.regra
     where o.fechada_em is null and o.modo = 'aprovacao' and o.acao_prevista_em is not null and o.decisao is null
    union all
    select 'analise', a.id, (t.i - 1)::int, a.criada_em, t.ac->>'ferramenta',
           coalesce(a.mapa -> (t.ac->>'alvo') ->> 'nome', t.ac->>'alvo'),
           public.vigia_resolver_nomes(t.ac->>'justificativa', a.mapa),
           'Análise por IA: ' || coalesce(a.causa_provavel, '')
      from public.vigia_analises a, jsonb_array_elements(a.acoes) with ordinality as t(ac, i)
     where a.status = 'ok' and a.criada_em > now() - interval '12 hours'
       and not (t.ac ? 'recusada')
       and public.vigia_ferramenta_executavel(t.ac->>'ferramenta')
       and t.ac->>'ferramenta' <> 'cancelar_assinatura_orfa'
       and not exists (select 1 from public.vigia_acoes v where v.analise_id = a.id and v.indice = t.i - 1)
  )
  select jsonb_build_object(
    'ativo', public.vigia_ativo(),
    'sombra_desde', (select desde from inicio),
    'dia', floor(extract(epoch from now() - (select desde from inicio)) / 86400)::int + 1,
    'dias_avaliacao', 14,
    'janela_horas', greatest(1, least(coalesce(_horas, 24), 24 * 400)),
    'varreduras', coalesce((select sum(varreduras) from public.vigia_varreduras_dia, par
                             where dia >= (par.desde)::date), 0),
    'regras', coalesce((select jsonb_agg(to_jsonb(r) order by r.nivel, r.codigo) from regras r), '[]'::jsonb),
    'ocorrencias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'regra', o.regra, 'nivel', r.nivel, 'titulo', r.titulo, 'descricao', o.descricao,
               'modo', o.modo, 'aberta_em', o.aberta_em, 'fechada_em', o.fechada_em,
               'acao_prevista_em', o.acao_prevista_em, 'tentativas_previstas', o.tentativas_previstas,
               'escalaria_em', o.escalaria_em, 'freio_em', o.freio_em, 'decisao', o.decisao)
             order by o.aberta_em desc)
        from (select * from public.vigia_ocorrencias o, par p
               where o.aberta_em >= p.desde or o.fechada_em is null
               order by o.aberta_em desc limit 30) o
        join public.vigia_regras r on r.codigo = o.regra), '[]'::jsonb),
    'pendentes', coalesce((select jsonb_agg(to_jsonb(x) order by x.desde) from pendentes x), '[]'::jsonb),
    'executadas', jsonb_build_object(
      'automaticas', (select count(*) from feitas where forma = 'automatica'),
      'aprovadas', (select count(*) from feitas where forma = 'aprovada'),
      'dispensadas', (select count(*) from feitas where forma = 'dispensada'),
      'erros', (select count(*) from feitas where resultado = 'erro'),
      'lista', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', v.id, 'criada_em', v.criada_em, 'origem', v.origem, 'ferramenta', v.ferramenta,
                 'alvo_nome', v.alvo_nome, 'forma', v.forma, 'resultado', v.resultado, 'detalhe', v.detalhe,
                 'decidido_por', u.email, 'comando_status', c.status, 'comando_erro', c.erro)
               order by v.criada_em desc)
          from (select * from feitas order by criada_em desc limit 30) v
          left join auth.users u on u.id = v.decidido_por
          left join public.gateway_comandos c on c.id = v.comando_id), '[]'::jsonb)),
    'analises', jsonb_build_object(
      'total', (select count(*) from analises),
      'ok', (select count(*) from analises where status = 'ok'),
      'indisponiveis', (select count(*) from analises where status = 'indisponivel'),
      'recusadas', (select count(*) from analises where status = 'recusada_validacao'),
      'invalidas', (select count(*) from analises where status = 'resposta_invalida'),
      'acoes_sozinho', (select count(*) from acoes where ac->>'classe' = 'sozinho'),
      'acoes_aprovacao', (select count(*) from acoes where ac->>'classe' = 'aprovacao'),
      'acoes_humano', (select count(*) from acoes where ac->>'classe' = 'humano'),
      'acoes_recusadas', (select count(*) from acoes where ac ? 'recusada'),
      'lista', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', a.id, 'criada_em', a.criada_em, 'status', a.status, 'modelo', a.modelo,
                 'diagnostico', public.vigia_resolver_nomes(a.diagnostico, a.mapa),
                 'causa_provavel', a.causa_provavel, 'gravidade', a.gravidade, 'confianca', a.confianca,
                 'anomalias', jsonb_array_length(coalesce(a.quadro->'anomalias', '[]'::jsonb)),
                 'latencia_ms', a.latencia_ms, 'motivo', a.motivo,
                 'acoes', coalesce((
                   select jsonb_agg(t.ac || jsonb_build_object(
                            'indice', t.i - 1,
                            'alvo_nome', coalesce(a.mapa -> (t.ac->>'alvo') ->> 'nome', t.ac->>'alvo'),
                            'justificativa', public.vigia_resolver_nomes(t.ac->>'justificativa', a.mapa),
                            'decisao', (select jsonb_build_object('forma', v.forma, 'resultado', v.resultado, 'detalhe', v.detalhe)
                                          from public.vigia_acoes v where v.analise_id = a.id and v.indice = t.i - 1))
                          order by t.i)
                     from jsonb_array_elements(a.acoes) with ordinality as t(ac, i)), '[]'::jsonb))
               order by a.criada_em desc)
          from (select * from analises order by criada_em desc limit 10) a), '[]'::jsonb)),
    'total', (
      select jsonb_build_object(
               'deteccoes', count(*),
               'teria_agido', count(*) filter (where acao_prevista_em is not null),
               'sumiram_antes', count(*) filter (where fechada_em is not null and acao_prevista_em is null and freio_em is null),
               'escalariam', count(*) filter (where escalaria_em is not null),
               'analises', (select count(*) from public.vigia_analises a, inicio i where a.criada_em >= i.desde),
               'executadas', (select count(*) from public.vigia_acoes v, inicio i
                               where v.criada_em >= i.desde and v.forma in ('automatica', 'aprovada')))
        from public.vigia_ocorrencias o, inicio i
       where o.aberta_em >= i.desde)
  );
$$;

-- ── Permissões ─────────────────────────────────────────────────────────────
revoke execute on function public.vigia_ativo() from public, anon, authenticated;
revoke execute on function public.vigia_rotina_repetivel(text) from public, anon, authenticated;
revoke execute on function public.vigia_ferramenta_executavel(text) from public, anon, authenticated;
revoke execute on function public.vigia_enviar_ordem(uuid, text, jsonb, uuid, text) from public, anon, authenticated;
revoke execute on function public.vigia_rodar_rotina(text) from public, anon, authenticated;
revoke execute on function public.vigia_reenviar_remocao(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.vigia_executar(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.verificar_remocao_concluida(uuid) from public, anon, authenticated;
revoke execute on function public.vigia_detectar() from public, anon, authenticated;
revoke execute on function public.vigia_varrer() from public, anon, authenticated;
revoke execute on function public.vigia_avisos_pendentes() from public, anon, authenticated;
revoke execute on function public.vigia_marcar_avisadas(bigint[]) from public, anon, authenticated;
revoke execute on function public.vigia_preparar_aprovacao(uuid, text, bigint, integer) from public, anon, authenticated;
revoke execute on function public.vigia_concluir_acao(bigint, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.vigia_resumo_interno(integer) from public, anon, authenticated;
revoke execute on function public.vigia_dispensar(text, bigint, integer, text) from public, anon;
revoke execute on function public.definir_modo_regra_vigia(text, text) from public, anon;
grant execute on function public.vigia_ativo() to service_role;
grant execute on function public.vigia_executar(text, text, jsonb) to service_role;
grant execute on function public.vigia_avisos_pendentes() to service_role;
grant execute on function public.vigia_marcar_avisadas(bigint[]) to service_role;
grant execute on function public.vigia_preparar_aprovacao(uuid, text, bigint, integer) to service_role;
grant execute on function public.vigia_concluir_acao(bigint, text, text, uuid) to service_role;
grant execute on function public.vigia_resumo_interno(integer) to service_role;
grant execute on function public.vigia_dispensar(text, bigint, integer, text) to authenticated;
grant execute on function public.definir_modo_regra_vigia(text, text) to authenticated;

-- ── Rotinas ────────────────────────────────────────────────────────────────
-- As correções rodam pelo banco, de 5 em 5 minutos; a análise por IA e os
-- avisos, pela edge function, na mesma cadência.
select cron.unschedule(jobid) from cron.job where jobname = 'arke-vigia';
select cron.schedule('arke-vigia', '*/5 * * * *', $cmd$select public.vigia_varrer()$cmd$);

select cron.unschedule(jobid) from cron.job where jobname = 'arke-vigia-analise';
select cron.schedule('arke-vigia-analise', '*/5 * * * *', $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/vigia',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cmd$);
