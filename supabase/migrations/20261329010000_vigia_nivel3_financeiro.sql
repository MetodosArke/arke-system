-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- O Vigia ganha o nível 3: avisar uma pessoa.
--
-- Até aqui ele tinha dois níveis, agir sozinho e pedir aprovação. Os dois
-- avisos novos não têm ação que se possa executar: o webhook do Asaas calado
-- e a conta que não fecha precisam de alguém olhando. Nível 3 abre a
-- ocorrência e, passada a espera, a manda direto para uma pessoa, pelo mesmo
-- e-mail das tentativas esgotadas. Fecha sozinha quando o problema some.

alter table public.vigia_regras drop constraint if exists vigia_regras_nivel_check;
alter table public.vigia_regras add constraint vigia_regras_nivel_check check (nivel = any (array[1, 2, 3]));
alter table public.vigia_regras drop constraint if exists vigia_regras_modo_check;
alter table public.vigia_regras add constraint vigia_regras_modo_check
  check (modo = any (array['sombra', 'desligada', 'automatica', 'aprovacao', 'avisar']));
alter table public.vigia_regras drop constraint if exists vigia_regras_modo_nivel;
alter table public.vigia_regras add constraint vigia_regras_modo_nivel check (
     (nivel = 1 and modo = any (array['automatica', 'sombra', 'desligada']))
  or (nivel = 2 and modo = any (array['aprovacao', 'sombra', 'desligada']))
  or (nivel = 3 and modo = any (array['avisar', 'sombra', 'desligada'])));
-- Nível 3 não tem ferramenta; os outros dois sempre têm.
alter table public.vigia_regras alter column ferramenta drop not null;
alter table public.vigia_regras drop constraint if exists vigia_regras_ferramenta_nivel;
alter table public.vigia_regras add constraint vigia_regras_ferramenta_nivel check ((nivel = 3) = (ferramenta is null));
alter table public.vigia_ocorrencias drop constraint if exists vigia_ocorrencias_modo_check;
alter table public.vigia_ocorrencias add constraint vigia_ocorrencias_modo_check
  check (modo = any (array['sombra', 'automatica', 'aprovacao', 'avisar']));

-- Desde quando a nota fiscal automática está ligada. A conferência só cobra
-- nota de pagamento confirmado depois disso: a emissão não retroage.
alter table public.organizacao_fiscal add column if not exists emissao_ativa_desde timestamptz;
update public.organizacao_fiscal set emissao_ativa_desde = now() where emissao_ativa and emissao_ativa_desde is null;

create or replace function public.marcar_emissao_ativa_desde()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.emissao_ativa and (tg_op = 'INSERT' or not old.emissao_ativa) then
    new.emissao_ativa_desde := now();
  elsif not new.emissao_ativa then
    new.emissao_ativa_desde := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.marcar_emissao_ativa_desde() from public, anon, authenticated;

drop trigger if exists trg_emissao_ativa_desde on public.organizacao_fiscal;
create trigger trg_emissao_ativa_desde before insert or update of emissao_ativa on public.organizacao_fiscal
  for each row execute function public.marcar_emissao_ativa_desde();

-- Cobranças de academia de verdade (fora da homologação) que o Asaas deveria
-- estar avisando: emitidas e vencendo nos últimos 3 dias.
create or replace function public.cobrancas_esperando_aviso()
returns table (tabela text, id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select 'pagamentos', p.id from public.pagamentos p
    join public.organizations o on o.id = p.organization_id and o.status <> 'trial'
   where p.asaas_payment_id is not null and p.vencimento between current_date - 3 and current_date
  union all
  select 'mensalidades', m.id from public.mensalidades m
    join public.organizations o on o.id = m.organization_id and o.status <> 'trial'
   where m.asaas_payment_id is not null and m.vencimento between current_date - 3 and current_date
  union all
  select 'cobrancas_avulsas', c.id from public.cobrancas_avulsas c
    join public.organizations o on o.id = c.organization_id and o.status <> 'trial'
   where c.asaas_payment_id is not null and c.vencimento between current_date - 3 and current_date
  union all
  select 'cobrancas_b2b', b.id from public.cobrancas_b2b b
    join public.organizations o on o.id = b.organization_id and o.status <> 'trial'
   where b.asaas_payment_id is not null and b.vencimento between current_date - 3 and current_date;
$$;

revoke execute on function public.cobrancas_esperando_aviso() from public, anon, authenticated;

-- A conta de cada cobrança dos últimos 35 dias fecha?
--   * valor = repasse da ArkeFit + líquido da academia;
--   * cobrança paga da academia tem o lançamento de receita;
--   * com a nota ligada, cobrança paga depois disso tem a nota.
-- Agrupado por academia e tipo, para um caso virar uma ocorrência e não
-- cem. A cobrança confirmada há menos de 2 horas ainda está a caminho.
create or replace function public.conferir_contas_financeiras()
returns table (alvo text, organization_id uuid, descricao text, contexto jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with valor as (
    select 'pagamentos' as tabela, p.organization_id, p.id from public.pagamentos p
     where p.created_at > now() - interval '35 days'
       and p.valor_repasse_arke is not null and p.valor_liquido_academia is not null
       and abs(p.valor - (p.valor_repasse_arke + p.valor_liquido_academia)) > 0.01
    union all
    select 'mensalidades', m.organization_id, m.id from public.mensalidades m
     where m.created_at > now() - interval '35 days'
       and m.valor_repasse_arke is not null and m.valor_liquido_academia is not null
       and abs(m.valor - (m.valor_repasse_arke + m.valor_liquido_academia)) > 0.01
    union all
    select 'cobrancas_avulsas', c.organization_id, c.id from public.cobrancas_avulsas c
     where c.created_at > now() - interval '35 days'
       and c.valor_repasse_arke is not null and c.valor_liquido_academia is not null
       and abs(c.valor - (c.valor_repasse_arke + c.valor_liquido_academia)) > 0.01
  ),
  sem_lancamento as (
    select 'mensalidades' as tabela, m.organization_id, m.id from public.mensalidades m
     where m.status = 'confirmado' and m.updated_at between now() - interval '35 days' and now() - interval '2 hours'
       and not exists (select 1 from public.lancamentos_financeiros l
                        where l.organization_id = m.organization_id and l.origem_automatica = 'mensalidade:' || m.id::text)
    union all
    select 'cobrancas_avulsas', c.organization_id, c.id from public.cobrancas_avulsas c
     where c.status = 'confirmado' and c.updated_at between now() - interval '35 days' and now() - interval '2 hours'
       and not exists (select 1 from public.lancamentos_financeiros l
                        where l.organization_id = c.organization_id and l.origem_automatica = 'avulsa:' || c.id::text)
  ),
  sem_nota as (
    select 'mensalidades' as tabela, m.organization_id, m.id from public.mensalidades m
      join public.organizacao_fiscal f on f.organization_id = m.organization_id and f.emissao_ativa
     where m.status = 'confirmado' and m.updated_at between greatest(f.emissao_ativa_desde, now() - interval '35 days') and now() - interval '2 hours'
       and coalesce(m.valor_liquido_academia, m.valor) > 0
       and not exists (select 1 from public.notas_fiscais n where n.origem = 'mensalidade' and n.origem_id = m.id)
    union all
    select 'cobrancas_avulsas', c.organization_id, c.id from public.cobrancas_avulsas c
      join public.organizacao_fiscal f on f.organization_id = c.organization_id and f.emissao_ativa
     where c.status = 'confirmado' and c.updated_at between greatest(f.emissao_ativa_desde, now() - interval '35 days') and now() - interval '2 hours'
       and coalesce(c.valor_liquido_academia, c.valor) > 0
       and not exists (select 1 from public.notas_fiscais n where n.origem = 'avulsa' and n.origem_id = c.id)
    union all
    select 'pagamentos', p.organization_id, p.id from public.pagamentos p
      join public.organizacao_fiscal f on f.organization_id = p.organization_id and f.emissao_ativa
     where p.status = 'confirmado' and p.updated_at between greatest(f.emissao_ativa_desde, now() - interval '35 days') and now() - interval '2 hours'
       and coalesce(p.valor_liquido_academia, p.valor) > 0
       and not exists (select 1 from public.notas_fiscais n where n.origem = 'metodo' and n.origem_id = p.id)
  ),
  tudo as (
    select 'valor' as tipo, * from valor
    union all select 'lancamento', * from sem_lancamento
    union all select 'nota', * from sem_nota
  )
  select t.tipo || ':' || t.tabela || ':' || t.organization_id,
         t.organization_id,
         o.nome || ': ' || count(*) || ' cobrança(s) em ' || t.tabela
           || case t.tipo when 'valor' then ' com o valor diferente do repasse mais o líquido'
                          when 'lancamento' then ' pagas sem o lançamento de receita'
                          else ' pagas sem a nota fiscal' end,
         jsonb_build_object('tipo', t.tipo, 'tabela', t.tabela, 'ids', (array_agg(t.id order by t.id))[1:20])
    from tudo t
    join public.organizations o on o.id = t.organization_id
   group by t.tipo, t.tabela, t.organization_id, o.nome;
$$;

revoke execute on function public.conferir_contas_financeiras() from public, anon, authenticated;

insert into public.vigia_regras (codigo, nivel, titulo, acao, modo, espera_minutos, retentativa_minutos, max_tentativas, freio_alvos, ferramenta)
values
  ('webhook_calado', 3, 'O Asaas parou de mandar avisos',
   'Conferir no painel do Asaas se o webhook está ativo, apontando para o asaas-webhook, e se a fila de avisos dele está parada',
   'avisar', 30, null, 1, null, null),
  ('conta_nao_fecha', 3, 'Cobrança com a conta que não fecha',
   'Conferir a cobrança no Asaas e no banco: o valor é o repasse mais o líquido, e cada cobrança paga tem o lançamento e, com a nota ligada, a nota',
   'avisar', 60, null, 1, null, null)
on conflict (codigo) do nothing;

CREATE OR REPLACE FUNCTION public.vigia_detectar()
 RETURNS TABLE(regra text, alvo text, organization_id uuid, descricao text, contexto jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   group by w.tipo_evento
  union all
  -- O Asaas parou de avisar: 72 horas sem aviso nenhum com pelo menos 5
  -- cobranças de academias de verdade vencendo nos últimos 3 dias. Com
  -- menos, o silêncio é normal: boleto que vence no sábado segue pendente até
  -- o dia útil seguinte, sem aviso. Os reenvios da conferência e do Vigia
  -- não contam: são nossos, não do Asaas.
  select 'webhook_calado', 'asaas:silencio', null::uuid,
         'Nenhum aviso do Asaas desde ' || coalesce(to_char(s.ultimo, 'DD/MM HH24:MI'), 'sempre')
           || ', com ' || s.cobrancas || ' cobranças vencendo nos últimos 3 dias',
         jsonb_build_object('ultimo_aviso', s.ultimo, 'cobrancas', s.cobrancas)
    from (select (select max(w.created_at) from public.asaas_webhook_events w
                   where w.asaas_event_id not like 'reconciliacao:%' and w.asaas_event_id not like 'vigia:%') as ultimo,
                 (select count(*) from public.cobrancas_esperando_aviso()) as cobrancas) s
   where s.cobrancas >= 5 and (s.ultimo is null or s.ultimo < now() - interval '72 hours')
  union all
  -- A conferência diária consertou o que o webhook deixou para trás: 3 ou
  -- mais de uma vez, ou alguma em duas rodadas seguidas. É o sinal mais
  -- confiável de aviso perdido, porque compara com o próprio Asaas.
  select 'webhook_calado', 'asaas:correcoes', null::uuid,
         'A conferência de ' || to_char(v.executada_em, 'DD/MM HH24:MI') || ' corrigiu ' || v.corrigidas
           || ' cobrança(s) que o webhook não tinha atualizado'
           || case when coalesce(a.corrigidas, 0) > 0 then ', e a anterior corrigiu ' || a.corrigidas else '' end,
         jsonb_build_object('reconciliacao_id', v.id, 'corrigidas', v.corrigidas, 'anterior', a.corrigidas)
    from varredura v
    left join lateral (select x.corrigidas from public.reconciliacoes_asaas x
                        where x.modo = 'varredura' and x.executada_em < v.executada_em
                        order by x.executada_em desc limit 1) a on true
   where coalesce(v.corrigidas, 0) >= 3 or (coalesce(v.corrigidas, 0) >= 1 and coalesce(a.corrigidas, 0) >= 1)
  union all
  select 'conta_nao_fecha', c.alvo, c.organization_id, c.descricao, c.contexto
    from public.conferir_contas_financeiras() c
  union all
  -- A conferência diária achou cobrança com valor diferente no Asaas e no
  -- banco. Status ela corrige; valor não, porque não dá para saber qual dos
  -- dois está certo sem olhar.
  select 'conta_nao_fecha', 'asaas_valor:' || (e->>'pagamento'), null::uuid,
         'Cobrança ' || (e->>'pagamento') || ' (' || (e->>'origem') || ') vale R$ '
           || replace(e->>'asaas', '.', ',') || ' no Asaas e R$ ' || replace(e->>'banco', '.', ',') || ' no banco',
         jsonb_build_object('pagamento', e->>'pagamento', 'origem', e->>'origem', 'asaas', e->'asaas', 'banco', e->'banco', 'reconciliacao_id', v.id)
    from varredura v,
         jsonb_array_elements(case when jsonb_typeof(v.detalhes->'valores') = 'array' then v.detalhes->'valores' else '[]'::jsonb end) e
   where coalesce(e->>'pagamento', '') <> '';
$function$;

CREATE OR REPLACE FUNCTION public.vigia_varrer()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- executa; em aprovação abre o pedido; em avisar vai para uma pessoa; em
  -- sombra só registra.
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
           -- Nível 3 não tem ação: na hora de agir, vai para uma pessoa.
           escalaria_em = case when pend.rmodo = 'avisar' then coalesce(escalaria_em, now()) else escalaria_em end,
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
$function$;

CREATE OR REPLACE FUNCTION public.vigia_avisos_pendentes()
 RETURNS TABLE(id bigint, tipo text, regra text, titulo text, acao text, descricao text, desde timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.id,
         case when o.escalaria_em is not null then 'escalada' else 'aprovacao' end,
         o.regra, r.titulo, r.acao, o.descricao, coalesce(o.escalaria_em, o.acao_prevista_em)
    from public.vigia_ocorrencias o
    join public.vigia_regras r on r.codigo = o.regra
   where o.fechada_em is null and o.avisada_em is null
     and ((o.modo in ('automatica', 'avisar') and o.escalaria_em is not null)
          or (o.modo = 'aprovacao' and o.acao_prevista_em is not null and o.decisao is null))
   order by 7;
$function$;
