-- Telemetria e canal de comandos do Gateway Local (versão 1.0, 23/09/2026).
--
-- A auditoria 360° mostrou que a nuvem enxergava de cada catraca só um
-- carimbo de "último sinal", gravado junto com a sincronização de alunos a
-- cada 5 minutos. Não sabia se o Gateway estava decidindo pelo cache
-- (contingência), quantos acessos esperavam para subir, que versão rodava,
-- se a ponte Topdata tinha caído nem qual foi o último erro. E não havia
-- caminho de volta: nenhuma ordem saía da nuvem para o Gateway — nem
-- "sincronize agora", nem "apague este aluno do equipamento", que a LGPD
-- exige depois da revogação biométrica.
--
-- O desenho:
--   * gateway_telemetria — o último estado que cada Gateway reportou. Tabela
--     própria, e não colunas em organizacao_catracas, porque a equipe da
--     academia pode alterar organizacao_catracas (ativar/desativar) e não
--     pode poder forjar a saúde do próprio equipamento. Só a service_role
--     escreve aqui.
--   * gateway_eventos — o histórico: conectou, voltou depois de N minutos
--     sem sinal, entrou/saiu da contingência, erro novo.
--   * gateway_comandos — a fila de ordens. O Gateway busca (escuta longa na
--     edge function catraca-comandos), executa e devolve o resultado na
--     chamada seguinte. Nenhuma porta nova precisa ser aberta na rede da
--     academia: quem inicia a conexão continua sendo o Gateway.

-- ── Tabelas ────────────────────────────────────────────────────────────────

create table if not exists public.gateway_telemetria (
  catraca_id uuid primary key references public.organizacao_catracas(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  versao text,
  modelo text,
  estado text check (estado is null or estado in ('online', 'contingencia', 'offline')),
  fila_offline integer not null default 0,
  cache_alunos integer not null default 0,
  ultima_sincronizacao timestamptz,
  ultimo_erro text,
  ultimo_erro_em timestamptz,
  equipamentos jsonb not null default '[]'::jsonb,
  ponte jsonb,
  capacidades text[] not null default '{}',
  reportado_em timestamptz not null default now()
);
create index if not exists idx_gateway_telemetria_org on public.gateway_telemetria (organization_id);

comment on table public.gateway_telemetria is
  'Último estado reportado por cada Gateway Local (versão, contingência, fila offline, equipamentos, ponte Topdata, capacidades). Só a service_role escreve.';

create table if not exists public.gateway_eventos (
  id bigserial primary key,
  catraca_id uuid not null references public.organizacao_catracas(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tipo text not null check (tipo in ('conectou', 'voltou', 'contingencia', 'normalizou', 'erro')),
  detalhe text,
  ocorrido_em timestamptz not null default now()
);
create index if not exists idx_gateway_eventos_catraca on public.gateway_eventos (catraca_id, ocorrido_em desc);
create index if not exists idx_gateway_eventos_org on public.gateway_eventos (organization_id, ocorrido_em desc);

create table if not exists public.gateway_comandos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  catraca_id uuid not null references public.organizacao_catracas(id) on delete cascade,
  tipo text not null check (tipo in (
    'sincronizar_completo', 'enviar_logs', 'diagnostico', 'liberar_catraca',
    'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao', 'apagar_usuario'
  )),
  parametros jsonb not null default '{}'::jsonb,
  aluno_id uuid references public.alunos(id) on delete set null,
  -- Comandos que só valem juntos (apagar o mesmo aluno em todos os Gateways
  -- da academia) compartilham o lote.
  lote uuid,
  motivo text,
  status text not null default 'pendente'
    check (status in ('pendente', 'entregue', 'concluido', 'falhou', 'expirado')),
  solicitado_por uuid,
  solicitado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  entregue_em timestamptz,
  concluido_em timestamptz,
  resultado jsonb,
  erro text
);
create index if not exists idx_gateway_comandos_fila on public.gateway_comandos (catraca_id, status, solicitado_em);
create index if not exists idx_gateway_comandos_org on public.gateway_comandos (organization_id, solicitado_em desc);
create index if not exists idx_gateway_comandos_lote on public.gateway_comandos (lote) where lote is not null;
create index if not exists idx_gateway_comandos_aluno on public.gateway_comandos (aluno_id) where aluno_id is not null;

-- ── Acesso: a equipe da academia e a ArkeFit leem; ninguém escreve direto ──
-- Uma regra por operação, como o resto do schema. Escrita só pela
-- service_role (edge functions) e pelas funções abaixo, que conferem o
-- papel de quem pede.

alter table public.gateway_telemetria enable row level security;
alter table public.gateway_eventos enable row level security;
alter table public.gateway_comandos enable row level security;

drop policy if exists "leitura" on public.gateway_telemetria;
create policy "leitura" on public.gateway_telemetria for select to authenticated using (
  public.is_org_staff((select auth.uid()), organization_id)
  or public.has_role((select auth.uid()), 'admin_arke')
  or public.has_role((select auth.uid()), 'superadmin')
);
drop policy if exists "leitura" on public.gateway_eventos;
create policy "leitura" on public.gateway_eventos for select to authenticated using (
  public.is_org_staff((select auth.uid()), organization_id)
  or public.has_role((select auth.uid()), 'admin_arke')
  or public.has_role((select auth.uid()), 'superadmin')
);
drop policy if exists "leitura" on public.gateway_comandos;
create policy "leitura" on public.gateway_comandos for select to authenticated using (
  public.is_org_staff((select auth.uid()), organization_id)
  or public.has_role((select auth.uid()), 'admin_arke')
  or public.has_role((select auth.uid()), 'superadmin')
);

revoke all on public.gateway_telemetria, public.gateway_eventos, public.gateway_comandos from anon, authenticated;
grant select on public.gateway_telemetria, public.gateway_eventos, public.gateway_comandos to authenticated;
grant all on public.gateway_telemetria, public.gateway_eventos, public.gateway_comandos to service_role;
-- bigserial: os privilégios padrão cobrem tabela, não sequência (armadilha já
-- vista na reconciliação do Asaas).
grant usage, select on sequence public.gateway_eventos_id_seq to service_role;

-- O registro de acesso ganha a liberação remota. Não vira presença: o
-- gatilho de presença só olha 'liberado'.
alter table public.acessos_catraca_logs drop constraint if exists acessos_catraca_logs_resultado_check;
alter table public.acessos_catraca_logs add constraint acessos_catraca_logs_resultado_check
  check (resultado = any (array[
    'liberado', 'negado_inadimplente', 'negado_pausado', 'negado_nao_encontrado',
    'negado_catraca_inativa', 'negado_sem_agendamento', 'negado_falha_verificacao_agendamento',
    'liberado_parceiro_externo', 'liberado_remoto'
  ]));

-- ── Situação de um Gateway, num lugar só ──────────────────────────────────
-- Gateway 1.0 fala com a nuvem a cada ~20 s (escuta longa de comandos),
-- então 3 minutos em silêncio já é queda. Gateway antigo só aparece na
-- sincronização de 5 min, e aí a régua de 15 min continua valendo.
create or replace function public.situacao_gateway(_heartbeat timestamptz, _reportado timestamptz, _estado text)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when _reportado is not null then
      case
        when _reportado < now() - interval '3 minutes' then 'offline'
        when _estado = 'contingencia' then 'contingencia'
        else 'online'
      end
    when _heartbeat is null then 'nunca_conectou'
    when _heartbeat < now() - interval '15 minutes' then 'offline'
    else 'online'
  end;
$$;

-- ── Telemetria ─────────────────────────────────────────────────────────────

create or replace function public.registrar_telemetria_gateway(_catraca_id uuid, _tel jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_ant public.gateway_telemetria;
  v_estado text := nullif(_tel->>'estado', '');
  v_erro_em timestamptz;
  v_sync timestamptz;
  v_gap interval;
  v_min numeric;
  v_caps text[];
  v_conhecidas text[] := array[
    'sincronizar_completo', 'enviar_logs', 'diagnostico', 'liberar_catraca',
    'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao', 'apagar_usuario'
  ];
begin
  select organization_id into v_org from public.organizacao_catracas where id = _catraca_id;
  if v_org is null or _tel is null or jsonb_typeof(_tel) <> 'object' then
    return;
  end if;
  if v_estado is not null and v_estado not in ('online', 'contingencia', 'offline') then
    v_estado := null;
  end if;
  -- Datas vindas de fora: valor torto vira nulo, nunca derruba o registro.
  begin v_erro_em := nullif(_tel->>'ultimo_erro_em', '')::timestamptz; exception when others then v_erro_em := null; end;
  begin v_sync := nullif(_tel->>'ultima_sincronizacao', '')::timestamptz; exception when others then v_sync := null; end;

  select coalesce(array_agg(x), '{}') into v_caps
    from jsonb_array_elements_text(
      case when jsonb_typeof(_tel->'capacidades') = 'array' then _tel->'capacidades' else '[]'::jsonb end
    ) x
   where x = any (v_conhecidas);

  select * into v_ant from public.gateway_telemetria where catraca_id = _catraca_id;

  if v_ant.catraca_id is null then
    insert into public.gateway_eventos (catraca_id, organization_id, tipo, detalhe)
    values (_catraca_id, v_org, 'conectou',
            'Gateway ' || coalesce(nullif(_tel->>'versao', ''), '(versão não informada)') || ' passou a reportar à nuvem.');
  else
    v_gap := now() - v_ant.reportado_em;
    if v_gap > interval '3 minutes' then
      v_min := round(extract(epoch from v_gap) / 60);
      insert into public.gateway_eventos (catraca_id, organization_id, tipo, detalhe)
      values (_catraca_id, v_org, 'voltou',
              'Voltou depois de ' ||
              case when v_min >= 120 then round(v_min / 60, 1)::text || ' h' else v_min::text || ' min' end ||
              ' sem sinal.');
    end if;
    if v_estado is not null and v_estado is distinct from v_ant.estado then
      if v_estado = 'contingencia' then
        insert into public.gateway_eventos (catraca_id, organization_id, tipo, detalhe)
        values (_catraca_id, v_org, 'contingencia', 'Decidindo pelo cache local — a nuvem não respondeu a tempo.');
      elsif v_estado = 'online' and v_ant.estado in ('contingencia', 'offline') then
        insert into public.gateway_eventos (catraca_id, organization_id, tipo, detalhe)
        values (_catraca_id, v_org, 'normalizou', 'Voltou a validar na nuvem.');
      end if;
    end if;
  end if;

  if v_erro_em is not null and (v_ant.ultimo_erro_em is null or v_erro_em > v_ant.ultimo_erro_em) then
    insert into public.gateway_eventos (catraca_id, organization_id, tipo, detalhe, ocorrido_em)
    values (_catraca_id, v_org, 'erro', left(coalesce(_tel->>'ultimo_erro', ''), 300), least(v_erro_em, now()));
  end if;

  insert into public.gateway_telemetria as t (
    catraca_id, organization_id, versao, modelo, estado, fila_offline, cache_alunos,
    ultima_sincronizacao, ultimo_erro, ultimo_erro_em, equipamentos, ponte, capacidades, reportado_em
  ) values (
    _catraca_id, v_org,
    left(nullif(_tel->>'versao', ''), 40),
    left(nullif(_tel->>'modelo', ''), 40),
    v_estado,
    case when _tel->>'fila_offline' ~ '^\d{1,9}$' then (_tel->>'fila_offline')::int else 0 end,
    case when _tel->>'cache_alunos' ~ '^\d{1,9}$' then (_tel->>'cache_alunos')::int else 0 end,
    v_sync,
    left(nullif(_tel->>'ultimo_erro', ''), 500),
    v_erro_em,
    case when jsonb_typeof(_tel->'equipamentos') = 'array' then _tel->'equipamentos' else '[]'::jsonb end,
    case when jsonb_typeof(_tel->'ponte') = 'object' then _tel->'ponte' else null end,
    v_caps,
    now()
  )
  on conflict (catraca_id) do update set
    versao = excluded.versao,
    modelo = excluded.modelo,
    estado = excluded.estado,
    fila_offline = excluded.fila_offline,
    cache_alunos = excluded.cache_alunos,
    ultima_sincronizacao = coalesce(excluded.ultima_sincronizacao, t.ultima_sincronizacao),
    ultimo_erro = coalesce(excluded.ultimo_erro, t.ultimo_erro),
    ultimo_erro_em = coalesce(excluded.ultimo_erro_em, t.ultimo_erro_em),
    equipamentos = excluded.equipamentos,
    ponte = excluded.ponte,
    capacidades = excluded.capacidades,
    reportado_em = now();

  -- O carimbo antigo continua valendo para quem só lê organizacao_catracas;
  -- a escrita é freada porque a escuta longa chama isto a cada ~20 s.
  update public.organizacao_catracas
     set ultimo_heartbeat_em = now()
   where id = _catraca_id
     and (ultimo_heartbeat_em is null or ultimo_heartbeat_em < now() - interval '30 seconds');
end;
$$;

-- ── Tarefa de remoção manual ───────────────────────────────────────────────
-- Quando o Gateway não tem como apagar sozinho (equipamento sem gestão
-- remota, comando que falhou ou expirou), a obrigação vira tarefa da
-- academia, com desfecho obrigatório como qualquer outra.
create or replace function public.abrir_tarefa_remocao_equipamento(
  _org uuid, _aluno_id uuid, _identificador text, _origem text, _motivo text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if _identificador is null or btrim(_identificador) = '' then
    return;
  end if;
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo, dono, acao)
  values (
    _org,
    -- A tarefa some junto com o aluno excluído (cascade); por isso aluno
    -- excluído não é referenciado — o número do equipamento basta.
    case when exists (select 1 from public.alunos where id = _aluno_id) then _aluno_id end,
    'Apagar do equipamento da catraca o usuário ' || _identificador
      || coalesce(' — ' || nullif(_motivo, ''), ''),
    'alta',
    now() + interval '3 days',
    _origem,
    'equipamento',
    'academia',
    'No leitor da catraca, excluir o usuário ' || _identificador
      || ' com as digitais e os cartões dele. A LGPD exige apagar o dado biométrico depois da revogação ou da saída do aluno.'
  )
  on conflict (organization_id, origem_evento) do nothing;
end;
$$;

-- Remoção concluída de ponta a ponta: todo comando do lote concluído e
-- nenhuma tarefa manual aberta. Só então o consentimento revogado ganha a
-- data de exclusão do equipamento — a prova de que a obrigação foi cumprida.
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
  if exists (select 1 from public.gateway_comandos where lote = _lote and status <> 'concluido') then
    return;
  end if;
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

-- ── Fila de comandos ───────────────────────────────────────────────────────

-- Vence o que passou do prazo. Remoção que não aconteceu vira tarefa manual:
-- a obrigação não some porque o Gateway ficou desligado.
create or replace function public.expirar_comandos_gateway(_catraca_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.gateway_comandos;
  n integer := 0;
begin
  for r in
    update public.gateway_comandos c
       set status = 'expirado', concluido_em = now(),
           erro = coalesce(c.erro, 'Não chegou ao Gateway dentro do prazo — ele estava sem sinal.')
     where c.status = 'pendente' and c.expira_em < now()
       and (_catraca_id is null or c.catraca_id = _catraca_id)
    returning c.*
  loop
    n := n + 1;
    if r.tipo = 'apagar_usuario' then
      perform public.abrir_tarefa_remocao_equipamento(
        r.organization_id, r.aluno_id, r.parametros->>'user_id', 'equipamento:' || coalesce(r.lote, r.id)::text, r.motivo);
    end if;
  end loop;

  for r in
    update public.gateway_comandos c
       set status = 'falhou', concluido_em = now(),
           erro = 'O Gateway recebeu a ordem e não devolveu resultado.'
     where c.status = 'entregue' and c.entregue_em < now() - interval '10 minutes'
       and (_catraca_id is null or c.catraca_id = _catraca_id)
    returning c.*
  loop
    n := n + 1;
    if r.tipo = 'apagar_usuario' then
      perform public.abrir_tarefa_remocao_equipamento(
        r.organization_id, r.aluno_id, r.parametros->>'user_id', 'equipamento:' || coalesce(r.lote, r.id)::text, r.motivo);
    end if;
  end loop;
  return n;
end;
$$;

-- Entrega ao Gateway o que está pendente para ele, marcando como entregue na
-- mesma instrução — duas escutas simultâneas do mesmo Gateway não recebem a
-- mesma ordem duas vezes.
create or replace function public.entregar_comandos_gateway(_catraca_id uuid)
returns setof public.gateway_comandos
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.expirar_comandos_gateway(_catraca_id);
  return query
    update public.gateway_comandos c
       set status = 'entregue', entregue_em = now()
     where c.id in (
       select id from public.gateway_comandos
        where catraca_id = _catraca_id and status = 'pendente' and expira_em >= now()
        order by solicitado_em
        limit 10
        for update skip locked
     )
    returning c.*;
end;
$$;

-- Resultado devolvido pelo Gateway, com os efeitos no resto do sistema.
create or replace function public.concluir_comando_gateway(
  _catraca_id uuid, _comando_id uuid, _sucesso boolean, _resultado jsonb, _erro text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.gateway_comandos;
begin
  update public.gateway_comandos
     set status = case when _sucesso then 'concluido' else 'falhou' end,
         concluido_em = now(),
         resultado = _resultado,
         erro = case when _sucesso then null else left(coalesce(nullif(_erro, ''), 'Falhou sem detalhe.'), 500) end
   where id = _comando_id and catraca_id = _catraca_id and status = 'entregue'
  returning * into c;
  if c.id is null then
    -- Resultado de comando que não é deste Gateway, ou que já foi fechado
    -- (expirado, ou resultado repetido): ignorado em silêncio de propósito.
    return;
  end if;

  if c.tipo = 'cadastrar_usuario' and _sucesso and c.aluno_id is not null then
    begin
      update public.alunos
         set identificador_catraca = c.parametros->>'user_id'
       where id = c.aluno_id and organization_id = c.organization_id;
    exception when unique_violation then
      update public.gateway_comandos
         set status = 'falhou',
             erro = 'O número ' || (c.parametros->>'user_id') || ' já pertence a outro aluno desta academia.'
       where id = c.id;
    end;
  elsif c.tipo = 'liberar_catraca' and _sucesso then
    insert into public.acessos_catraca_logs (organization_id, catraca_id, aluno_id, cpf_consultado, resultado, confirmado_por)
    values (c.organization_id, c.catraca_id, null, 'remoto', 'liberado_remoto', c.solicitado_por);
  elsif c.tipo = 'apagar_usuario' then
    if _sucesso then
      perform public.verificar_remocao_concluida(c.lote);
    else
      perform public.abrir_tarefa_remocao_equipamento(
        c.organization_id, c.aluno_id, c.parametros->>'user_id', 'equipamento:' || coalesce(c.lote, c.id)::text, c.motivo);
    end if;
  end if;
end;
$$;

-- A tarefa manual de remoção concluída também fecha o ciclo.
create or replace function public.tarefa_equipamento_concluida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote uuid;
begin
  if new.tipo = 'equipamento' and new.status = 'concluida' and old.status is distinct from 'concluida' then
    begin
      v_lote := substring(new.origem_evento from '^equipamento(?:-manual)?:([0-9a-f-]{36})$')::uuid;
    exception when others then
      v_lote := null;
    end;
    if v_lote is not null then
      perform public.verificar_remocao_concluida(v_lote);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tarefa_equipamento_concluida on public.tarefas;
create trigger trg_tarefa_equipamento_concluida
  after update of status on public.tarefas
  for each row execute function public.tarefa_equipamento_concluida();

-- ── Pedido de comando, pela tela ───────────────────────────────────────────
-- A única porta de entrada para ordens vindas de gente. Confere o papel, a
-- capacidade que o próprio Gateway declarou e, para o que precisa de
-- alguém na frente da catraca, se o Gateway está com sinal agora.
create or replace function public.solicitar_comando_gateway(
  _catraca_id uuid,
  _tipo text,
  _parametros jsonb default '{}'::jsonb,
  _aluno_id uuid default null,
  _motivo text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cat public.organizacao_catracas;
  v_tel public.gateway_telemetria;
  v_aluno public.alunos;
  v_nome text;
  v_params jsonb := '{}'::jsonb;
  v_user_id text;
  v_expira interval;
  v_id uuid;
  v_arkefit boolean;
begin
  select * into v_cat from public.organizacao_catracas where id = _catraca_id;
  if v_cat.id is null then
    raise exception 'Catraca não encontrada.';
  end if;

  v_arkefit := public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke');
  if not (v_arkefit
          or public.has_org_role(v_uid, v_cat.organization_id, 'gestor')
          or public.has_org_role(v_uid, v_cat.organization_id, 'recepcao')) then
    raise exception 'Só a gestão ou a recepção da academia (ou a ArkeFit) enviam ordens ao Gateway.' using errcode = '42501';
  end if;

  if _tipo not in ('sincronizar_completo', 'enviar_logs', 'diagnostico', 'liberar_catraca',
                   'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao') then
    -- apagar_usuario só nasce da revogação, da exclusão ou da anonimização,
    -- que conferem o motivo; não é botão.
    raise exception 'Ordem desconhecida: %', _tipo;
  end if;

  if v_cat.status is distinct from 'ativo' then
    raise exception 'Esta catraca está desativada no ARKE.';
  end if;

  select * into v_tel from public.gateway_telemetria where catraca_id = _catraca_id;
  if v_tel.catraca_id is null or not (_tipo = any (v_tel.capacidades)) then
    raise exception '%', case
      when v_tel.catraca_id is null then
        'Este Gateway ainda não reportou à nuvem. Atualize o Gateway Local para a versão 1.0.'
      when _tipo in ('liberar_catraca', 'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao') then
        'Este Gateway não tem a gestão remota do equipamento configurada (disponível para Control iD).'
      else 'Este Gateway não aceita esta ordem.'
    end;
  end if;

  if _tipo in ('liberar_catraca', 'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao')
     and v_tel.reportado_em < now() - interval '3 minutes' then
    raise exception 'O Gateway está sem sinal agora. Esta ordem precisa de resposta na hora — confira o computador da catraca.';
  end if;

  if _tipo in ('cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao') then
    select * into v_aluno from public.alunos where id = _aluno_id;
    if v_aluno.id is null or v_aluno.organization_id <> v_cat.organization_id then
      raise exception 'Aluno não encontrado nesta academia.';
    end if;
    if v_aluno.anonimizado_em is not null then
      raise exception 'Aluno anonimizado não é cadastrado no equipamento.';
    end if;
  end if;

  case _tipo
    when 'liberar_catraca' then
      if length(btrim(coalesce(_motivo, ''))) < 3 then
        raise exception 'Informe o motivo da liberação — fica registrado.';
      end if;
      v_params := jsonb_build_object(
        'sentido', case when _parametros->>'sentido' in ('entrada', 'saida', 'ambos') then _parametros->>'sentido' else 'entrada' end,
        'equipamento', nullif(_parametros->>'equipamento', ''));
      v_expira := interval '2 minutes';

    when 'cadastrar_usuario' then
      v_user_id := v_aluno.identificador_catraca;
      if v_user_id is null then
        -- Próximo número livre desta academia. Corrida entre dois cadastros
        -- simultâneos cai no índice único na conclusão, que devolve erro
        -- claro em vez de dois alunos com o mesmo número.
        select (coalesce(max(identificador_catraca::bigint), 0) + 1)::text into v_user_id
          from public.alunos
         where organization_id = v_cat.organization_id and identificador_catraca ~ '^\d{1,15}$';
      end if;
      if v_user_id !~ '^\d{1,15}$' then
        raise exception 'O identificador atual deste aluno (%) não é numérico; a Control iD só aceita número.', v_user_id;
      end if;
      select coalesce(nullif(btrim(p.full_name), ''), 'Aluno') into v_nome
        from public.profiles p where p.user_id = v_aluno.user_id;
      v_params := jsonb_build_object('user_id', v_user_id, 'nome', left(coalesce(v_nome, 'Aluno'), 60),
                                     'matricula', left(v_aluno.id::text, 8));
      v_expira := interval '10 minutes';

    when 'cadastrar_digital' then
      if v_aluno.identificador_catraca is null then
        raise exception 'Cadastre o aluno no equipamento antes da digital.';
      end if;
      if not public.aluno_consentiu_biometria(v_aluno.id) then
        raise exception 'O aluno ainda não autorizou o uso da digital no app (Perfil → Privacidade). A LGPD exige o consentimento dele antes do cadastro.';
      end if;
      v_params := jsonb_build_object('user_id', v_aluno.identificador_catraca,
                                     'equipamento', nullif(_parametros->>'equipamento', ''));
      v_expira := interval '5 minutes';

    when 'cadastrar_cartao' then
      if v_aluno.identificador_catraca is null then
        raise exception 'Cadastre o aluno no equipamento antes do cartão.';
      end if;
      v_params := jsonb_build_object('user_id', v_aluno.identificador_catraca,
                                     'equipamento', nullif(_parametros->>'equipamento', ''));
      v_expira := interval '5 minutes';

    else
      v_expira := interval '10 minutes';
  end case;

  insert into public.gateway_comandos (organization_id, catraca_id, tipo, parametros, aluno_id, motivo, solicitado_por, expira_em)
  values (v_cat.organization_id, _catraca_id, _tipo, v_params, _aluno_id, nullif(btrim(coalesce(_motivo, '')), ''), v_uid, now() + v_expira)
  returning id into v_id;

  if _tipo = 'liberar_catraca' then
    insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
    select v_uid, u.email, 'catraca.liberacao_remota', 'organizacao_catracas', _catraca_id, o.nome,
           jsonb_build_object('comando_id', v_id, 'motivo', _motivo, 'sentido', v_params->>'sentido', 'catraca', v_cat.nome)
      from public.organizations o
      left join auth.users u on u.id = v_uid
     where o.id = v_cat.organization_id;
  end if;

  return v_id;
end;
$$;

-- ── Retenção: histórico de equipamento no mesmo prazo do registro de acesso ─
create or replace function public.limpar_acessos_catraca_antigos(_lote integer default 5000)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  _corte timestamptz := now() - interval '13 months';
  _apagadas bigint := 0;
  _n int;
begin
  -- Em lotes pelo índice de created_at: a rodada diária normalmente apaga um
  -- dia de log, mas a primeira depois de um tempo parada pode pegar meses, e
  -- um DELETE único dessa tabela seguraria memória e WAL de uma vez.
  loop
    delete from public.acessos_catraca_logs
     where id in (
       select id from public.acessos_catraca_logs
        where created_at < _corte
        limit _lote
     );
    get diagnostics _n = row_count;
    _apagadas := _apagadas + _n;
    exit when _n < _lote;
  end loop;
  -- Histórico de saúde e ordens do Gateway: mesmo prazo, mesma justificativa.
  delete from public.gateway_eventos where ocorrido_em < _corte;
  delete from public.gateway_comandos where solicitado_em < _corte and status in ('concluido', 'falhou', 'expirado');
  return _apagadas;
end;
$$;

-- ── Permissões ─────────────────────────────────────────────────────────────
revoke execute on function public.registrar_telemetria_gateway(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.abrir_tarefa_remocao_equipamento(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.verificar_remocao_concluida(uuid) from public, anon, authenticated;
revoke execute on function public.expirar_comandos_gateway(uuid) from public, anon, authenticated;
revoke execute on function public.entregar_comandos_gateway(uuid) from public, anon, authenticated;
revoke execute on function public.concluir_comando_gateway(uuid, uuid, boolean, jsonb, text) from public, anon, authenticated;
revoke execute on function public.tarefa_equipamento_concluida() from public, anon, authenticated;
revoke execute on function public.solicitar_comando_gateway(uuid, text, jsonb, uuid, text) from public, anon;
grant execute on function public.solicitar_comando_gateway(uuid, text, jsonb, uuid, text) to authenticated;
grant execute on function public.registrar_telemetria_gateway(uuid, jsonb) to service_role;
grant execute on function public.entregar_comandos_gateway(uuid) to service_role;
grant execute on function public.concluir_comando_gateway(uuid, uuid, boolean, jsonb, text) to service_role;
grant execute on function public.expirar_comandos_gateway(uuid) to service_role;
grant execute on function public.situacao_gateway(timestamptz, timestamptz, text) to authenticated, service_role;

-- De hora em hora: vence ordens paradas mesmo quando o Gateway está
-- desligado (aí ninguém chama entregar_comandos_gateway). Formato horário,
-- que avaliar_rotinas() reconhece — se parar, a Visão Master acusa.
select cron.unschedule(jobid) from cron.job where jobname = 'arke-comandos-gateway';
select cron.schedule('arke-comandos-gateway', '17 * * * *', $$select public.expirar_comandos_gateway()$$);
