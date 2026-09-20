-- Painel de webhooks do Asaas na Visão Master.
--
-- Hoje `asaas_webhook_events` só é legível pela service_role (RLS habilitado
-- sem nenhuma policy), então o único jeito de saber se o gateway está
-- entregando evento é abrir o log da Edge Function. Durante a homologação
-- isso é exatamente o que mais se precisa olhar.
--
-- O ponto cego que este painel resolve: `processado = true` hoje significa
-- "a função terminou sem exceção", não "o evento teve efeito". Um
-- PAYMENT_CONFIRMED cujo payment_id não casa com nenhuma cobrança B2B,
-- mensalidade nem pagamento do Método ARKE percorre todos os ramos, não
-- atualiza nada e é marcado como processado do mesmo jeito. Do lado de fora
-- fica idêntico a um evento que funcionou — e é justamente o sintoma de
-- wallet/subscription configurada errado, que é o erro clássico de
-- homologação. Daí a coluna `resultado`.

alter table public.asaas_webhook_events
  add column if not exists resultado text;

comment on column public.asaas_webhook_events.resultado is
  'O que o evento efetivamente fez (qual registro atualizou) ou por que não fez nada. Gravado pela Edge Function asaas-webhook; distingue "processado com efeito" de "processado sem casar com nada".';

create index if not exists idx_asaas_webhook_events_created_at
  on public.asaas_webhook_events (created_at desc);

-- ---------------------------------------------------------------------
-- Lista de eventos
-- ---------------------------------------------------------------------
create or replace function public.get_superadmin_webhooks_asaas(_limite integer default 200)
returns table (
  id uuid,
  created_at timestamptz,
  processed_at timestamptz,
  tipo_evento text,
  asaas_event_id text,
  asaas_payment_id text,
  processado boolean,
  resultado text,
  erro text,
  situacao text,
  payload jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.';
  end if;

  return query
  select
    e.id,
    e.created_at,
    e.processed_at,
    e.tipo_evento,
    e.asaas_event_id,
    e.asaas_payment_id,
    e.processado,
    e.resultado,
    e.erro,
    case
      -- Exceção no processamento: o log guardou o evento e registrou o erro.
      when e.erro is not null then 'erro'
      -- Registrado mas nunca concluído. Só acontece se a função morreu no
      -- meio (timeout, deploy durante a execução) — o evento ficou pela metade.
      when not e.processado then 'pendente'
      -- Rodou até o fim sem casar com nenhum registro do banco.
      when e.resultado in ('sem_correspondencia', 'evento_ignorado', 'sem_payment_id') then 'sem_efeito'
      -- Eventos gravados antes desta migration não têm resultado registrado;
      -- não dá para afirmar retroativamente se tiveram efeito.
      when e.resultado is null then 'indeterminado'
      else 'ok'
    end,
    e.payload
  from public.asaas_webhook_events e
  order by e.created_at desc
  limit greatest(coalesce(_limite, 200), 1);
end;
$$;

-- ---------------------------------------------------------------------
-- Resumo (sobre todos os eventos, não só a página exibida)
-- ---------------------------------------------------------------------
create or replace function public.get_superadmin_webhooks_asaas_resumo()
returns table (
  total bigint,
  ultimas_24h bigint,
  erros bigint,
  pendentes bigint,
  sem_efeito bigint,
  primeiro_evento_em timestamptz,
  ultimo_evento_em timestamptz,
  horas_desde_ultimo numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.';
  end if;

  return query
  select
    count(*),
    count(*) filter (where e.created_at >= now() - interval '24 hours'),
    count(*) filter (where e.erro is not null),
    count(*) filter (where e.erro is null and not e.processado),
    count(*) filter (where e.erro is null and e.processado
      and e.resultado in ('sem_correspondencia', 'evento_ignorado', 'sem_payment_id')),
    min(e.created_at),
    max(e.created_at),
    case when max(e.created_at) is not null
      then round(extract(epoch from (now() - max(e.created_at))) / 3600, 1)
    end
  from public.asaas_webhook_events e;
end;
$$;
