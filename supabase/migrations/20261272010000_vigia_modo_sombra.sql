-- Vigia: o agente de saúde técnica, em modo sombra (decisão do responsável,
-- 24/09/2026).
--
-- O ARKE passa a ter dois agentes. O Sentinela, que já existia, é a IA do
-- Mentor: resume a anamnese e sugere resposta no chat, com o consentimento do
-- aluno e processando em São Paulo. O Vigia é o novo: cuida da saúde técnica
-- da plataforma — Gateways de catraca, rotinas agendadas, conferência com o
-- Asaas, avisos de pagamento, capacidade do banco — e não lê dado de aluno.
--
-- Um agente só, em duas camadas que se completam:
--   * **regras** (vigia_detectar) reconhecem o que já se sabe tratar, com uma
--     ação prevista para cada caso, espera, novas tentativas e escalonamento;
--   * **análise por IA** (edge function `vigia`) olha o quadro inteiro de uma
--     vez, explica a causa provável — é o que percebe que duas catracas da
--     mesma academia caíram juntas porque a internet de lá caiu — e escolhe
--     ferramentas de um catálogo fechado (_shared/vigiaAnalise.ts).
--
-- **Modo sombra por 2 semanas: nada é executado.** O Vigia registra o que
-- faria — nível 1, sozinho; nível 2, pedindo aprovação — e manda um resumo
-- diário. Depois da avaliação, o responsável decide o que passa a rodar. É o
-- jeito de ter evidência antes de dar autonomia: quantas vezes a regra
-- dispararia, quantas vezes o problema sumiria sozinho antes da hora de agir,
-- quantas escalariam para uma pessoa, e se a análise por IA acerta.
--
-- Freios que já valem no modo sombra, para a avaliação medir o que de fato
-- rodaria: espera antes de agir (o que some antes não teria recebido ação),
-- limite de tentativas, e freio de falha geral — a mesma regra disparando em
-- muitos alvos de uma vez indica causa comum (nuvem, fornecedor), e agir em
-- cada alvo seria tratar sintoma.

-- ── Interruptor ────────────────────────────────────────────────────────────
insert into public.plataforma_config (chave, valor, descricao)
values ('vigia_ativo', 1, 'Vigia ligado (1) ou desligado (0). Em modo sombra ele só registra o que faria; desligado, nem isso.')
on conflict (chave) do nothing;

-- ── Regras ─────────────────────────────────────────────────────────────────
create table if not exists public.vigia_regras (
  codigo text primary key,
  nivel smallint not null check (nivel in (1, 2)),
  titulo text not null,
  acao text not null,
  modo text not null default 'sombra' check (modo in ('sombra', 'desligada')),
  espera_minutos integer not null check (espera_minutos >= 0),
  retentativa_minutos integer check (retentativa_minutos > 0),
  max_tentativas integer not null default 1 check (max_tentativas between 1 and 10),
  freio_alvos integer check (freio_alvos >= 2),
  sombra_desde timestamptz not null default now()
);
comment on table public.vigia_regras is
  'Regras do Vigia. Nível 1 faria sozinho, nível 2 pediria aprovação. No modo sombra nenhuma executa: só registram o que fariam.';

insert into public.vigia_regras (codigo, nivel, titulo, acao, espera_minutos, retentativa_minutos, max_tentativas, freio_alvos) values
  ('gateway_sincronizacao_atrasada', 1, 'Gateway com a lista de alunos atrasada',
   'Pedir ao Gateway a sincronização completa', 5, 30, 3, 3),
  ('gateway_fila_parada', 1, 'Acessos guardados no Gateway sem subir',
   'Pedir ao Gateway que envie os acessos guardados', 15, 30, 3, 3),
  ('gateway_contingencia_prolongada', 1, 'Gateway decidindo pelo cadastro local há muito tempo',
   'Pedir diagnóstico ao Gateway', 10, 60, 2, 3),
  ('remocao_biometrica_parada', 1, 'Remoção de digital parada com o Gateway de volta',
   'Reenviar ao Gateway a ordem de apagar a digital', 5, 60, 3, null),
  ('rotina_repetivel_falhou', 1, 'Rotina agendada repetível falhou',
   'Rodar a rotina de novo', 10, 30, 3, 3),
  ('reconciliacao_com_erro', 1, 'Conferência Asaas ↔ banco terminou com erro',
   'Rodar a conferência de novo', 15, 60, 3, null),
  ('rotina_sensivel_falhou', 2, 'Rotina que fala com academias falhou',
   'Rodar a rotina de novo, com aprovação', 10, null, 1, 3),
  ('assinatura_orfa', 2, 'Assinatura cobrando no Asaas sem registro no banco',
   'Cancelar a assinatura no Asaas, com aprovação', 0, null, 1, null),
  ('webhook_nao_processado', 2, 'Aviso de pagamento do Asaas não processado',
   'Processar o aviso de novo, com aprovação', 15, null, 1, 5)
on conflict (codigo) do nothing;

-- ── Ocorrências (camada de regras) ─────────────────────────────────────────
-- Uma linha por problema, do momento em que a regra o vê até ele sumir. É
-- tabela da plataforma: organization_id existe para filtrar, e fica nulo no
-- que não é de academia nenhuma (rotinas, Asaas).
create table if not exists public.vigia_ocorrencias (
  id bigint generated always as identity primary key,
  regra text not null references public.vigia_regras(codigo) on delete cascade,
  alvo text not null,
  organization_id uuid references public.organizations(id) on delete cascade,
  descricao text not null,
  contexto jsonb not null default '{}'::jsonb,
  aberta_em timestamptz not null default now(),
  vista_em timestamptz not null default now(),
  fechada_em timestamptz,
  -- Quando o Vigia teria agido (nível 1) ou pedido aprovação (nível 2).
  acao_prevista_em timestamptz,
  tentativas_previstas integer not null default 0,
  ultima_tentativa_em timestamptz,
  -- Nível 1 que esgotou as tentativas e continuaria de pé: iria para uma pessoa.
  escalaria_em timestamptz,
  -- O freio de falha geral segurou a ação.
  freio_em timestamptz
);
create unique index if not exists idx_vigia_ocorrencias_aberta on public.vigia_ocorrencias (regra, alvo) where fechada_em is null;
create index if not exists idx_vigia_ocorrencias_aberta_em on public.vigia_ocorrencias (aberta_em desc);
create index if not exists idx_vigia_ocorrencias_org on public.vigia_ocorrencias (organization_id) where organization_id is not null;

-- ── Análises (camada de IA) ────────────────────────────────────────────────
-- `quadro` é exatamente o que foi enviado ao modelo — sem dado pessoal, e por
-- isso pode ser guardado e mostrado. `mapa` liga os pseudônimos (A1, G1) às
-- academias e catracas de verdade; ele nunca sai daqui.
create table if not exists public.vigia_analises (
  id bigint generated always as identity primary key,
  criada_em timestamptz not null default now(),
  assinatura text not null,
  quadro jsonb not null,
  mapa jsonb not null default '{}'::jsonb,
  modelo text,
  status text not null check (status in ('ok', 'indisponivel', 'recusada_validacao', 'resposta_invalida')),
  diagnostico text,
  causa_provavel text,
  gravidade text,
  -- Declarada pelo modelo. Guardada para a avaliação medir se ela acompanha
  -- o acerto; não decide nada.
  confianca integer check (confianca between 0 and 100),
  anomalias_relacionadas jsonb not null default '[]'::jsonb,
  acoes jsonb not null default '[]'::jsonb,
  latencia_ms integer,
  tokens_entrada integer,
  tokens_saida integer,
  motivo text
);
create index if not exists idx_vigia_analises_criada on public.vigia_analises (criada_em desc);

create table if not exists public.vigia_varreduras_dia (
  dia date primary key,
  varreduras integer not null default 0
);

alter table public.vigia_regras enable row level security;
alter table public.vigia_ocorrencias enable row level security;
alter table public.vigia_analises enable row level security;
alter table public.vigia_varreduras_dia enable row level security;

-- Só a ArkeFit lê; ninguém escreve direto — só as funções abaixo.
drop policy if exists "leitura" on public.vigia_regras;
create policy "leitura" on public.vigia_regras for select to authenticated using (
  public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
drop policy if exists "leitura" on public.vigia_ocorrencias;
create policy "leitura" on public.vigia_ocorrencias for select to authenticated using (
  public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
drop policy if exists "leitura" on public.vigia_analises;
create policy "leitura" on public.vigia_analises for select to authenticated using (
  public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));

revoke all on public.vigia_regras, public.vigia_ocorrencias, public.vigia_analises, public.vigia_varreduras_dia from anon, authenticated;
grant select on public.vigia_regras, public.vigia_ocorrencias, public.vigia_analises to authenticated;
grant all on public.vigia_regras, public.vigia_ocorrencias, public.vigia_analises, public.vigia_varreduras_dia to service_role;

-- ── Apoio ──────────────────────────────────────────────────────────────────

-- Rotinas que podem rodar de novo sem efeito duplicado: todas criam tarefa
-- com `on conflict … do nothing`, atualizam por condição ou só leem. Uma lista
-- só, para as duas camadas — a análise por IA recebe `repetivel` no quadro em
-- vez de ter a própria lista. Rotina nova fica fora até alguém conferir:
-- quem manda e-mail para academia (briefing, lembrete) não entra.
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
    'snapshot-mrr-diario', 'arke-alerta-rotinas', 'arke-alerta-catracas', 'arke-reconciliacao-asaas'
  ]);
$$;

-- A mensagem de erro não vai para o modelo — pode carregar valor de coluna.
-- Vai só a classe.
create or replace function public.vigia_classificar_erro(_msg text)
returns text
language sql
immutable
as $$
  select case
    when _msg is null or btrim(_msg) = '' then null
    when _msg ~* 'timeout|timed out|canceling statement|TimeoutError' then 'tempo_esgotado'
    when _msg ~* 'permission denied|not authorized|unauthorized|forbidden|HTTP 40[13]' then 'permissao'
    when _msg ~* 'does not exist|undefined (function|column|table)|42883|42703|42P01' then 'objeto_inexistente'
    when _msg ~* 'duplicate key|unique constraint|23505' then 'duplicidade'
    when _msg ~* 'violates|constraint|23502|23503|23514' then 'restricao'
    when _msg ~* 'connection|could not connect|network|fetch failed|ECONN|dns|TypeError' then 'conexao'
    when _msg ~* 'resend|e-?mail' then 'envio_email'
    when _msg ~* 'HTTP 5\d\d|bad gateway|service unavailable|asaas' then 'servico_externo'
    else 'outro'
  end;
$$;

-- Gateways ativos com a situação na mesma régua do resto do sistema.
create or replace function public.vigia_gateways()
returns table(catraca_id uuid, organization_id uuid, catraca text, academia text, estado text, fila integer,
              ultima_sincronizacao timestamptz, reportado_em timestamptz, capacidades text[], situacao text,
              min_sem_sinal integer, versao_1 boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.organization_id, c.nome, o.nome, t.estado, coalesce(t.fila_offline, 0), t.ultima_sincronizacao,
         t.reportado_em, coalesce(t.capacidades, '{}'),
         public.situacao_gateway(c.ultimo_heartbeat_em, t.reportado_em, t.estado),
         floor(extract(epoch from now() - coalesce(t.reportado_em, c.ultimo_heartbeat_em)) / 60)::int,
         t.catraca_id is not null
    from public.organizacao_catracas c
    join public.organizations o on o.id = c.organization_id
    left join public.gateway_telemetria t on t.catraca_id = c.id
   where c.status = 'ativo';
$$;

-- ── Camada de regras ───────────────────────────────────────────────────────
-- O que cada regra vê agora. A descrição usa nomes de verdade: fica no banco
-- e só a ArkeFit lê. Nada disto vai para o modelo.
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
     and not exists (select 1 from public.gateway_comandos x
                      where x.catraca_id = g.catraca_id and x.tipo = 'sincronizar_completo'
                        and x.status in ('pendente', 'entregue'))
  union all
  select 'gateway_fila_parada', 'catraca:' || g.catraca_id, g.organization_id,
         g.catraca || ' (' || g.academia || '): ' || g.fila || ' acesso(s) guardado(s) no Gateway sem subir, com a nuvem respondendo',
         jsonb_build_object('catraca_id', g.catraca_id, 'fila_offline', g.fila)
    from gw g
   where g.estado = 'online' and g.fila > 0 and 'enviar_logs' = any (g.capacidades)
     and not exists (select 1 from public.gateway_comandos x
                      where x.catraca_id = g.catraca_id and x.tipo = 'enviar_logs' and x.status in ('pendente', 'entregue'))
  union all
  select 'gateway_contingencia_prolongada', 'catraca:' || g.catraca_id, g.organization_id,
         g.catraca || ' (' || g.academia || '): decidindo pelo cadastro local — a nuvem não responde a tempo',
         jsonb_build_object('catraca_id', g.catraca_id)
    from gw g
   where g.estado = 'contingencia' and 'diagnostico' = any (g.capacidades)
     and not exists (select 1 from public.gateway_comandos x
                      where x.catraca_id = g.catraca_id and x.tipo = 'diagnostico' and x.status in ('pendente', 'entregue'))
  union all
  select * from (
    select distinct on (x.lote, x.catraca_id)
           'remocao_biometrica_parada'::text, 'lote:' || x.lote || ':catraca:' || x.catraca_id, x.organization_id,
           'Remoção de digital parada em ' || g.catraca || ' (' || g.academia || '): a ordem '
             || case x.status when 'expirado' then 'expirou' else 'falhou' end
             || ', virou tarefa manual, e o Gateway voltou a receber ordens',
           jsonb_build_object('lote', x.lote, 'catraca_id', x.catraca_id, 'comando_id', x.id, 'tarefa_id', tf.id)
      from public.gateway_comandos x
      join gw g on g.catraca_id = x.catraca_id
      join public.tarefas tf on tf.organization_id = x.organization_id
                            and tf.origem_evento = 'equipamento:' || x.lote::text
                            and tf.status not in ('concluida', 'cancelada')
     where x.tipo = 'apagar_usuario' and x.status in ('expirado', 'falhou') and x.lote is not null
       and 'apagar_usuario' = any (g.capacidades)
       and not exists (select 1 from public.gateway_comandos n
                        where n.lote = x.lote and n.catraca_id = x.catraca_id
                          and n.status in ('pendente', 'entregue', 'concluido'))
     order by x.lote, x.catraca_id, x.solicitado_em desc
  ) remocoes
  union all
  -- O próprio Vigia fica de fora: se a rotina dele falha, ele não está
  -- rodando para se consertar — quem avisa é o alerta de rotinas.
  select case when public.vigia_rotina_repetivel(r.nome) then 'rotina_repetivel_falhou' else 'rotina_sensivel_falhou' end,
         'rotina:' || r.nome, null::uuid,
         'Rotina ' || r.nome || ' falhou' || coalesce(' (' || left(r.ultimo_erro, 160) || ')', ''),
         jsonb_build_object('rotina', r.nome, 'ultima_execucao', r.ultima_execucao, 'falhas_7d', r.falhas_7d)
    from public.avaliar_rotinas() r
   where r.situacao = 'falhou' and r.nome <> 'arke-vigia'
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
  select 'webhook_nao_processado', 'evento:' || w.id, null::uuid,
         'Aviso ' || w.tipo_evento || ' do Asaas recebido em ' || to_char(w.created_at, 'DD/MM HH24:MI')
           || ' não foi processado' || coalesce(': ' || left(w.erro, 160), ''),
         jsonb_build_object('evento_id', w.id, 'tipo_evento', w.tipo_evento)
    from public.asaas_webhook_events w
   where w.erro is not null and not w.processado
     and w.created_at > now() - interval '7 days' and w.created_at < now() - interval '15 minutes';
$$;

-- A varredura das regras. Chamada de 5 em 5 minutos pela edge function
-- `vigia`. No modo sombra ela só registra: abre a ocorrência quando a regra
-- vê o problema, marca quando teria agido (depois da espera), conta as novas
-- tentativas que faria, marca quando escalaria para uma pessoa e fecha
-- quando o problema some — com ou sem ação.
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
  n_escaladas integer := 0;
begin
  if coalesce((select valor from public.plataforma_config where chave = 'vigia_ativo'), 0) <> 1 then
    return jsonb_build_object('ativo', false);
  end if;

  insert into public.vigia_varreduras_dia (dia, varreduras) values (current_date, 1)
  on conflict (dia) do update set varreduras = public.vigia_varreduras_dia.varreduras + 1;

  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_det
    from (select distinct on (x.regra, x.alvo) x.*
            from public.vigia_detectar() x
            join public.vigia_regras r on r.codigo = x.regra and r.modo = 'sombra'
           order by x.regra, x.alvo) d;

  -- Freio de falha geral: a mesma regra em muitos alvos ao mesmo tempo.
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

  insert into public.vigia_ocorrencias (regra, alvo, organization_id, descricao, contexto)
  select x.regra, x.alvo, x.organization_id, x.descricao, x.contexto
    from jsonb_to_recordset(v_det) x(regra text, alvo text, organization_id uuid, descricao text, contexto jsonb)
   where not exists (select 1 from public.vigia_ocorrencias o
                      where o.fechada_em is null and o.regra = x.regra and o.alvo = x.alvo);
  get diagnostics n_novas = row_count;

  update public.vigia_ocorrencias o set freio_em = coalesce(o.freio_em, now())
   where o.fechada_em is null and o.regra = any (v_freio);

  -- Hora de agir: passou a espera e o freio não está segurando.
  update public.vigia_ocorrencias o
     set acao_prevista_em = now(),
         tentativas_previstas = case when r.nivel = 1 then 1 else 0 end,
         ultima_tentativa_em = case when r.nivel = 1 then now() end
    from public.vigia_regras r
   where r.codigo = o.regra and o.fechada_em is null and o.acao_prevista_em is null
     and o.aberta_em <= now() - make_interval(mins => r.espera_minutos)
     and not (o.regra = any (v_freio));
  get diagnostics n_acoes = row_count;

  -- Nível 1 que continua de pé: nova tentativa, até o limite.
  update public.vigia_ocorrencias o
     set tentativas_previstas = o.tentativas_previstas + 1, ultima_tentativa_em = now()
    from public.vigia_regras r
   where r.codigo = o.regra and r.nivel = 1 and r.retentativa_minutos is not null
     and o.fechada_em is null and o.acao_prevista_em is not null and o.escalaria_em is null
     and o.tentativas_previstas < r.max_tentativas
     and o.ultima_tentativa_em <= now() - make_interval(mins => r.retentativa_minutos)
     and not (o.regra = any (v_freio));
  get diagnostics n_tentativas = row_count;

  -- Esgotou as tentativas e segue de pé: iria para uma pessoa.
  update public.vigia_ocorrencias o set escalaria_em = now()
    from public.vigia_regras r
   where r.codigo = o.regra and r.nivel = 1
     and o.fechada_em is null and o.escalaria_em is null and o.acao_prevista_em is not null
     and o.tentativas_previstas >= r.max_tentativas
     and o.ultima_tentativa_em <= now() - make_interval(mins => coalesce(r.retentativa_minutos, 30));
  get diagnostics n_escaladas = row_count;

  delete from public.vigia_ocorrencias where fechada_em < now() - interval '180 days';
  delete from public.vigia_analises where criada_em < now() - interval '180 days';
  delete from public.vigia_varreduras_dia where dia < current_date - 400;

  return jsonb_build_object(
    'ativo', true, 'deteccoes', jsonb_array_length(v_det), 'novas', n_novas, 'fechadas', n_fechadas,
    'acoes_previstas', n_acoes, 'retentativas_previstas', n_tentativas, 'escaladas', n_escaladas,
    'freio', to_jsonb(v_freio));
end;
$$;

-- ── Camada de análise: o quadro ────────────────────────────────────────────
-- Tudo o que o modelo vê, montado aqui, com lista do que é permitido — e
-- conferido de novo por validarQuadro() antes de sair. Pseudônimos valem só
-- dentro de uma análise; `mapa` volta para o banco, nunca para o modelo.
create or replace function public.vigia_quadro()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hora integer := extract(hour from now())::int;
  v_ini numeric := coalesce((select valor from public.plataforma_config where chave = 'alerta_catraca_hora_inicio'), 6);
  v_fim numeric := coalesce((select valor from public.plataforma_config where chave = 'alerta_catraca_hora_fim'), 23);
  v_dentro boolean;
  v_bruto jsonb;
  v_orgs jsonb;
  v_cats jsonb;
  v_anom jsonb;
  v_acad jsonb;
  v_plat jsonb;
  v_vig jsonb;
  v_mapa jsonb;
  v_ass text;
  v_ult public.vigia_analises;
  v_analisar boolean;
begin
  v_dentro := v_hora >= v_ini and v_hora < v_fim;

  with gw as (select * from public.vigia_gateways()),
  varredura as (
    select * from public.reconciliacoes_asaas where modo = 'varredura' order by executada_em desc limit 1
  ),
  bruto as (
    select 'gateway_sem_sinal' as tipo, g.organization_id as org_id, g.catraca_id, null::text as rotina,
           null::text as evento, null::text as classe_erro, null::boolean as repetivel, v_dentro as dentro,
           g.min_sem_sinal as minutos, null::int as quantidade, null::numeric as percentual,
           null::int as falhas_7d, null::int as execucoes_7d, nullif(g.fila, 0) as fila_offline
      from gw g
     where g.situacao = 'offline' and g.min_sem_sinal >= 10
    union all
    select 'gateway_contingencia', g.organization_id, g.catraca_id, null, null, null, null, v_dentro,
           e.minutos, null, null, null, null, nullif(g.fila, 0)
      from gw g
      cross join lateral (
        select floor(extract(epoch from now() - max(ev.ocorrido_em)) / 60)::int as minutos
          from public.gateway_eventos ev where ev.catraca_id = g.catraca_id and ev.tipo = 'contingencia'
      ) e
     where g.situacao = 'contingencia' and coalesce(e.minutos, 0) >= 10
    union all
    select 'gateway_sincronizacao_atrasada', g.organization_id, g.catraca_id, null, null, null, null, null,
           floor(extract(epoch from now() - g.ultima_sincronizacao) / 60)::int, null, null, null, null, null
      from gw g
     where g.versao_1 and g.situacao in ('online', 'contingencia')
       and (g.ultima_sincronizacao is null or g.ultima_sincronizacao < now() - interval '20 minutes')
    union all
    -- Fila parada: a persistência vem da camada de regras, que já mede há
    -- quanto tempo ela está de pé — fila que esvazia em segundos não é quadro.
    select 'gateway_fila_parada', g.organization_id, g.catraca_id, null, null, null, null, null,
           null, null, null, null, null, g.fila
      from gw g
     where g.fila > 0
       and exists (select 1 from public.vigia_ocorrencias o
                    where o.fechada_em is null and o.regra = 'gateway_fila_parada'
                      and o.alvo = 'catraca:' || g.catraca_id and o.aberta_em <= now() - interval '10 minutes')
    union all
    select 'gateway_erro_recente', g.organization_id, g.catraca_id, null, null,
           public.vigia_classificar_erro(e.ultimo), null, null, null, e.quantidade, null, null, null, null
      from gw g
      cross join lateral (
        select count(*)::int as quantidade,
               (array_agg(ev.detalhe order by ev.ocorrido_em desc))[1] as ultimo
          from public.gateway_eventos ev
         where ev.catraca_id = g.catraca_id and ev.tipo = 'erro' and ev.ocorrido_em > now() - interval '1 hour'
      ) e
     where e.quantidade >= 1
    union all
    select 'gateway_ordens_com_falha', g.organization_id, g.catraca_id, null, null,
           public.vigia_classificar_erro(c.ultimo), null, null, null, c.quantidade, null, null, null, null
      from gw g
      cross join lateral (
        select count(*)::int as quantidade,
               (array_agg(x.erro order by x.concluido_em desc))[1] as ultimo
          from public.gateway_comandos x
         where x.catraca_id = g.catraca_id and x.status in ('falhou', 'expirado')
           and x.concluido_em > now() - interval '1 hour'
      ) c
     where c.quantidade >= 2
    union all
    select case when r.situacao = 'falhou' then 'rotina_falhou' else 'rotina_atrasada' end, null, null,
           case when r.nome ~ '^[a-z0-9-]{1,63}$' then r.nome else 'rotina-sem-nome' end, null,
           public.vigia_classificar_erro(r.ultimo_erro), public.vigia_rotina_repetivel(r.nome), null,
           floor(extract(epoch from now() - r.ultima_execucao) / 60)::int, null, null,
           r.falhas_7d::int, r.execucoes_7d::int, null
      from public.avaliar_rotinas() r
     where r.situacao in ('falhou', 'atrasada') and r.nome <> 'arke-vigia'
    union all
    select 'reconciliacao_com_erro', null, null, null, null, public.vigia_classificar_erro(v.erro), null, null,
           floor(extract(epoch from now() - v.executada_em) / 60)::int, null, null, null, null, null
      from varredura v where v.erro is not null
    union all
    select 'reconciliacao_atrasada', null, null, null, null, null, null, null,
           floor(extract(epoch from now() - v.executada_em) / 60)::int, null, null, null, null, null
      from varredura v where v.executada_em < now() - interval '26 hours'
    union all
    select 'assinaturas_orfas', null, null, null, null, null, null, null,
           null, v.assinaturas_orfas, null, null, null, null
      from varredura v where v.assinaturas_orfas > 0
    union all
    select 'divergencias_nao_corrigidas', null, null, null, null, null, null, null,
           null, v.divergencias - v.corrigidas, null, null, null, null
      from varredura v where v.divergencias > v.corrigidas
    union all
    select 'webhook_nao_processado', null, null, null,
           case when w.tipo_evento ~ '^[A-Z_]{1,40}$' then w.tipo_evento else 'OUTRO' end,
           null, null, null, null, count(*)::int, null, null, null, null
      from public.asaas_webhook_events w
     where w.erro is not null and not w.processado
       and w.created_at > now() - interval '24 hours' and w.created_at < now() - interval '15 minutes'
     group by 5
    union all
    select 'banco_capacidade', null, null, null, null, null, null, null,
           null, null, c.percentual, null, null, null
      from public.avaliar_capacidade() c where c.percentual >= 70
    union all
    select 'remocao_biometrica_parada', b.organization_id, null, null, null, null, null, null,
           null, count(*)::int, null, null, null, null
      from public.aluno_consentimento_biometrico b
     where b.revogado_em < now() - interval '24 hours' and b.excluido_do_equipamento_em is null
       and not exists (select 1 from public.aluno_consentimento_biometrico n
                        where n.aluno_id = b.aluno_id and n.revogado_em is null)
     group by b.organization_id
  )
  select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) into v_bruto
    from (select * from bruto order by tipo, org_id, catraca_id, rotina, evento limit 60) b;

  -- Pseudônimos: A1, A2… para academias; G1, G2… para Gateways.
  select coalesce(jsonb_object_agg(id, 'A' || n), '{}'::jsonb) into v_orgs
    from (select id, row_number() over (order by id) as n
            from (select distinct x->>'org_id' as id from jsonb_array_elements(v_bruto) x
                   where x->>'org_id' is not null
                  union
                  select distinct c.organization_id::text from jsonb_array_elements(v_bruto) x
                    join public.organizacao_catracas c on c.id = (x->>'catraca_id')::uuid) ids) numerados;
  select coalesce(jsonb_object_agg(id, 'G' || n), '{}'::jsonb) into v_cats
    from (select id, row_number() over (order by id) as n
            from (select distinct x->>'catraca_id' as id from jsonb_array_elements(v_bruto) x
                   where x->>'catraca_id' is not null) ids) numerados;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', ord,
           'tipo', x->>'tipo',
           'academia', coalesce(v_orgs->>(x->>'org_id'),
                                v_orgs->>(select c.organization_id::text from public.organizacao_catracas c
                                           where c.id = (x->>'catraca_id')::uuid)),
           'gateway', v_cats->>(x->>'catraca_id'),
           'rotina', x->'rotina',
           'evento', x->'evento',
           'classe_erro', x->'classe_erro',
           'repetivel', x->'repetivel',
           'dentro_do_horario', x->'dentro',
           'minutos', x->'minutos',
           'quantidade', x->'quantidade',
           'percentual', x->'percentual',
           'falhas_7d', x->'falhas_7d',
           'execucoes_7d', x->'execucoes_7d',
           'fila_offline', x->'fila_offline'
         )) order by ord), '[]'::jsonb) into v_anom
    from jsonb_array_elements(v_bruto) with ordinality as t(x, ord);

  select coalesce(jsonb_agg(jsonb_build_object('academia', v_orgs->>g.organization_id::text,
                                               'gateways', g.total, 'gateways_no_ar', g.no_ar)
                            order by v_orgs->>g.organization_id::text), '[]'::jsonb) into v_acad
    from (select organization_id, count(*)::int as total,
                 count(*) filter (where situacao in ('online', 'contingencia'))::int as no_ar
            from public.vigia_gateways()
           where organization_id::text in (select jsonb_object_keys(v_orgs))
           group by organization_id) g;

  select jsonb_build_object(
           'gateways', count(*) filter (where situacao <> 'nunca_conectou')::int,
           'gateways_no_ar', count(*) filter (where situacao in ('online', 'contingencia'))::int,
           'academias_com_gateway', count(distinct organization_id) filter (where situacao <> 'nunca_conectou')::int)
    into v_plat
    from public.vigia_gateways();

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'regra', o.regra,
           'gateway', v_cats->>substring(o.alvo from 'catraca:([0-9a-f-]{36})'),
           'rotina', case when o.alvo ~ '^rotina:[a-z0-9-]{1,63}$' then substring(o.alvo from 8) end
         ))), '[]'::jsonb) into v_vig
    from (select * from public.vigia_ocorrencias where fechada_em is null order by aberta_em limit 60) o;

  select coalesce(jsonb_object_agg(v_orgs->>o.id::text,
                                   jsonb_build_object('tipo', 'organizacao', 'id', o.id, 'nome', o.nome)), '{}'::jsonb)
         || coalesce((select jsonb_object_agg(v_cats->>c.id::text,
                                              jsonb_build_object('tipo', 'catraca', 'id', c.id,
                                                                 'nome', c.nome || ' (' || og.nome || ')'))
                        from public.organizacao_catracas c
                        join public.organizations og on og.id = c.organization_id
                       where c.id::text in (select jsonb_object_keys(v_cats))), '{}'::jsonb)
    into v_mapa
    from public.organizations o
   where o.id::text in (select jsonb_object_keys(v_orgs));

  -- Assinatura do quadro: o conjunto de problemas, sem os números que mudam
  -- a cada minuto. Mesmo problema persistindo não gera análise nova a cada
  -- varredura; problema novo, ou um que some, gera.
  select md5(coalesce(string_agg(k, '|' order by k), '')) into v_ass
    from (select (x->>'tipo') || ':' || coalesce(x->>'catraca_id', x->>'org_id', x->>'rotina', x->>'evento', '') as k
            from jsonb_array_elements(v_bruto) x) chaves;

  select * into v_ult from public.vigia_analises order by criada_em desc limit 1;
  v_analisar := jsonb_array_length(v_anom) > 0
    and (select count(*) from public.vigia_analises where criada_em > now() - interval '1 hour') < 4
    and (v_ult.id is null
         or v_ult.assinatura <> v_ass
         or v_ult.criada_em < now() - interval '6 hours'
         or (v_ult.status <> 'ok' and v_ult.criada_em < now() - interval '30 minutes'));

  return jsonb_build_object(
    'assinatura', v_ass,
    'analisar', v_analisar,
    'enviar', jsonb_build_object(
      'hora_local', v_hora,
      'dia_semana', extract(dow from now())::int,
      'plataforma', v_plat,
      'academias', v_acad,
      'anomalias', v_anom,
      'vigia', v_vig),
    'mapa', v_mapa);
end;
$$;

create or replace function public.vigia_registrar_analise(
  _assinatura text, _quadro jsonb, _mapa jsonb, _modelo text, _status text, _analise jsonb,
  _latencia_ms integer, _tokens_entrada integer, _tokens_saida integer, _motivo text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into public.vigia_analises (
    assinatura, quadro, mapa, modelo, status, diagnostico, causa_provavel, gravidade, confianca,
    anomalias_relacionadas, acoes, latencia_ms, tokens_entrada, tokens_saida, motivo)
  values (
    _assinatura, coalesce(_quadro, '{}'::jsonb), coalesce(_mapa, '{}'::jsonb), left(_modelo, 120), _status,
    left(_analise->>'diagnostico', 800), left(_analise->>'causa_provavel', 40), left(_analise->>'gravidade', 20),
    case when _analise->>'confianca' ~ '^\d{1,3}$' and (_analise->>'confianca')::int <= 100
         then (_analise->>'confianca')::int end,
    case when jsonb_typeof(_analise->'anomalias_relacionadas') = 'array' then _analise->'anomalias_relacionadas' else '[]'::jsonb end,
    case when jsonb_typeof(_analise->'acoes') = 'array' then _analise->'acoes' else '[]'::jsonb end,
    _latencia_ms, _tokens_entrada, _tokens_saida, left(_motivo, 300))
  returning id into v_id;
  return v_id;
end;
$$;

-- ── Leitura: resumo, painel e interruptor ──────────────────────────────────

-- Troca A1/G1 pelos nomes, para a ArkeFit ler. Só aqui dentro: o texto
-- guardado continua como o modelo escreveu.
create or replace function public.vigia_resolver_nomes(_texto text, _mapa jsonb)
returns text
language plpgsql
immutable
as $$
declare
  k text;
  r text := _texto;
begin
  if r is null or _mapa is null or jsonb_typeof(_mapa) <> 'object' then
    return r;
  end if;
  for k in select chave from jsonb_object_keys(_mapa) as chave order by length(chave) desc, chave desc loop
    r := regexp_replace(r, '\m' || k || '\M', replace(coalesce(_mapa->k->>'nome', k), '\', '\\'), 'g');
  end loop;
  return r;
end;
$$;

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
    select r.codigo, r.nivel, r.titulo, r.acao, r.modo,
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
     group by r.codigo, r.nivel, r.titulo, r.acao, r.modo
  ),
  analises as (
    select a.* from public.vigia_analises a, par p where a.criada_em >= p.desde
  ),
  acoes as (
    select ac from analises a, jsonb_array_elements(a.acoes) ac where a.status = 'ok'
  )
  select jsonb_build_object(
    'ativo', coalesce((select valor from public.plataforma_config where chave = 'vigia_ativo'), 0) = 1,
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
               'aberta_em', o.aberta_em, 'fechada_em', o.fechada_em, 'acao_prevista_em', o.acao_prevista_em,
               'tentativas_previstas', o.tentativas_previstas, 'escalaria_em', o.escalaria_em, 'freio_em', o.freio_em)
             order by o.aberta_em desc)
        from (select * from public.vigia_ocorrencias o, par p
               where o.aberta_em >= p.desde or o.fechada_em is null
               order by o.aberta_em desc limit 30) o
        join public.vigia_regras r on r.codigo = o.regra), '[]'::jsonb),
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
                   select jsonb_agg(ac || jsonb_build_object(
                            'alvo_nome', coalesce(a.mapa->(ac->>'alvo')->>'nome', ac->>'alvo'),
                            'justificativa', public.vigia_resolver_nomes(ac->>'justificativa', a.mapa)))
                     from jsonb_array_elements(a.acoes) ac), '[]'::jsonb))
               order by a.criada_em desc)
          from (select * from analises order by criada_em desc limit 10) a), '[]'::jsonb)),
    'total', (
      select jsonb_build_object(
               'deteccoes', count(*),
               'teria_agido', count(*) filter (where acao_prevista_em is not null),
               'sumiram_antes', count(*) filter (where fechada_em is not null and acao_prevista_em is null and freio_em is null),
               'escalariam', count(*) filter (where escalaria_em is not null),
               'analises', (select count(*) from public.vigia_analises a, inicio i where a.criada_em >= i.desde))
        from public.vigia_ocorrencias o, inicio i
       where o.aberta_em >= i.desde)
  );
$$;

create or replace function public.get_superadmin_vigia(_horas integer default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return public.vigia_resumo_interno(_horas);
end;
$$;

create or replace function public.definir_vigia_ativo(_ativo boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if not (public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'Só a ArkeFit liga ou desliga o Vigia.' using errcode = '42501';
  end if;
  update public.plataforma_config
     set valor = case when _ativo then 1 else 0 end, updated_by = v_uid, updated_at = now()
   where chave = 'vigia_ativo'
  returning id into v_id;
  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, detalhes)
  select v_uid, u.email, case when _ativo then 'vigia.ligar' else 'vigia.desligar' end, 'plataforma_config', v_id,
         jsonb_build_object('ativo', _ativo)
    from (select 1) um
    left join auth.users u on u.id = v_uid;
end;
$$;

-- ── Permissões ─────────────────────────────────────────────────────────────
revoke execute on function public.vigia_rotina_repetivel(text) from public, anon, authenticated;
revoke execute on function public.vigia_classificar_erro(text) from public, anon, authenticated;
revoke execute on function public.vigia_gateways() from public, anon, authenticated;
revoke execute on function public.vigia_detectar() from public, anon, authenticated;
revoke execute on function public.vigia_varrer() from public, anon, authenticated;
revoke execute on function public.vigia_quadro() from public, anon, authenticated;
revoke execute on function public.vigia_registrar_analise(text, jsonb, jsonb, text, text, jsonb, integer, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.vigia_resolver_nomes(text, jsonb) from public, anon, authenticated;
revoke execute on function public.vigia_resumo_interno(integer) from public, anon, authenticated;
revoke execute on function public.get_superadmin_vigia(integer) from public, anon;
revoke execute on function public.definir_vigia_ativo(boolean) from public, anon;
grant execute on function public.vigia_varrer() to service_role;
grant execute on function public.vigia_quadro() to service_role;
grant execute on function public.vigia_registrar_analise(text, jsonb, jsonb, text, text, jsonb, integer, integer, integer, text) to service_role;
grant execute on function public.vigia_resumo_interno(integer) to service_role;
grant execute on function public.get_superadmin_vigia(integer) to authenticated;
grant execute on function public.definir_vigia_ativo(boolean) to authenticated;

-- ── Rotinas ────────────────────────────────────────────────────────────────
-- As duas funções registram o próprio desfecho (execucoes_agendadas): se o
-- cron dispara mas a função quebra, o alerta de rotinas acusa.
insert into public.execucoes_agendadas (nome, ultima_ok) values ('vigia', now()), ('vigia-resumo', now())
on conflict (nome) do nothing;

-- Mesmo token do alerta de rotinas: mesma confiança, um segredo a menos.
-- Criadas por último, depois das edge functions publicadas.
select cron.unschedule(jobid) from cron.job where jobname = 'arke-vigia';
select cron.schedule('arke-vigia', '*/5 * * * *', $cmd$
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

-- Resumo diário às 8h de Brasília (11:00 UTC; o pg_cron agenda em GMT).
select cron.unschedule(jobid) from cron.job where jobname = 'arke-vigia-resumo';
select cron.schedule('arke-vigia-resumo', '0 11 * * *', $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/vigia-resumo',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cmd$);
