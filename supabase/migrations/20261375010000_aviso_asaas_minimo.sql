-- O aviso do Asaas guardado no mínimo (auditoria de prontidão, 06/10/2026).
--
-- O que estava errado: o `asaas-webhook` grava o aviso inteiro em
-- `asaas_webhook_events.payload`, e ele fica assim 90 dias (depois vira um
-- resumo, e sai aos 13 meses). O aviso de cobrança traz muito mais que a
-- situação: o `creditCardToken` (com ele, a conta da ArkeFit cobra o cartão
-- de novo), os links do boleto e do comprovante, o nosso número, o Pix, os
-- estornos, o split. A Política de Privacidade diz que a plataforma guarda só
-- a situação das cobranças, os 4 últimos dígitos e a bandeira do cartão.
--
-- O que muda:
--   1. `minimizar_aviso_asaas()` reduz o aviso ao que o processamento lê
--      (`asaas-webhook`: id, evento, e da cobrança id, cliente, assinatura,
--      referência, situação, forma, valores, descrição, datas e o link da
--      fatura) mais os 4 dígitos e a bandeira. `aviso_asaas.guarda.test.ts`
--      confere que todo campo que o webhook lê está aqui: o reprocessamento
--      (Vigia, `vigia-aprovar`) reenvia ao webhook o aviso guardado, e ele tem
--      de continuar funcionando com o aviso reduzido.
--   2. Um gatilho aplica isso em toda gravação, antes de ela chegar à
--      tabela: o webhook não muda (é de outra frente), e o aviso que a
--      conferência diária reenvia (a cobrança inteira, lida da API) também
--      passa por aqui.
--   3. O que já está guardado é reduzido agora.
--   4. O resumo, que tira também o link da fatura, a descrição e as datas
--      de pagamento, passa de 90 para 30 dias. O reprocessamento olha só os
--      últimos 7 dias, e só aviso não processado — o resumo só toca processado.
--      A exclusão continua aos 13 meses (rastro do que o gateway avisou).

set lock_timeout = '5s';

-- ── 1. O aviso reduzido ────────────────────────────────────────────────────
create or replace function public.minimizar_aviso_asaas(_payload jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select case
    when jsonb_typeof(_payload) is distinct from 'object' then _payload
    else jsonb_strip_nulls(jsonb_build_object(
      'id', _payload -> 'id',
      'event', _payload -> 'event',
      'dateCreated', _payload -> 'dateCreated',
      'resumido_em', _payload -> 'resumido_em',
      'payment', case when jsonb_typeof(p) = 'object' then jsonb_build_object(
        'id', p -> 'id',
        'customer', p -> 'customer',
        'subscription', p -> 'subscription',
        'externalReference', p -> 'externalReference',
        'status', p -> 'status',
        'billingType', p -> 'billingType',
        'value', p -> 'value',
        'netValue', p -> 'netValue',
        'description', p -> 'description',
        'dueDate', p -> 'dueDate',
        'paymentDate', p -> 'paymentDate',
        'clientPaymentDate', p -> 'clientPaymentDate',
        'confirmedDate', p -> 'confirmedDate',
        'invoiceUrl', p -> 'invoiceUrl',
        'deleted', p -> 'deleted',
        -- Do cartão, só o que a Política promete guardar: os 4 últimos
        -- dígitos e a bandeira. O token fica de fora.
        'creditCard', case when jsonb_typeof(p -> 'creditCard') = 'object' then jsonb_build_object(
          'creditCardNumber', to_jsonb(right(p -> 'creditCard' ->> 'creditCardNumber', 4)),
          'creditCardBrand', p -> 'creditCard' -> 'creditCardBrand') end) end))
  end
  from (select _payload -> 'payment' as p) as aviso;
$$;

comment on function public.minimizar_aviso_asaas(jsonb) is
  'O aviso do Asaas reduzido ao que o asaas-webhook lê, mais os 4 dígitos e a bandeira do cartão. Aplicado pelo gatilho trg_minimizar_aviso_asaas.';

revoke execute on function public.minimizar_aviso_asaas(jsonb) from public, anon, authenticated;
grant execute on function public.minimizar_aviso_asaas(jsonb) to service_role;

-- ── 2. Em toda gravação ────────────────────────────────────────────────────
create or replace function public.minimizar_aviso_asaas_ao_gravar()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.payload := public.minimizar_aviso_asaas(new.payload);
  return new;
end;
$$;

drop trigger if exists trg_minimizar_aviso_asaas on public.asaas_webhook_events;
create trigger trg_minimizar_aviso_asaas
  before insert or update of payload on public.asaas_webhook_events
  for each row execute function public.minimizar_aviso_asaas_ao_gravar();

-- Função de gatilho nasce com EXECUTE para o PUBLIC (20261215010000).
revoke execute on function public.minimizar_aviso_asaas_ao_gravar() from public, anon, authenticated;

-- ── 3. O que já está guardado ──────────────────────────────────────────────
-- O gatilho já reduz na gravação; a comparação evita reescrever linha que
-- não muda (o resumo antigo já é menor que o aviso reduzido).
update public.asaas_webhook_events
   set payload = public.minimizar_aviso_asaas(payload)
 where payload is distinct from public.minimizar_aviso_asaas(payload);

-- ── 4. O resumo aos 30 dias ────────────────────────────────────────────────
-- A mesma limpeza de 20261333010000, com o resumo do aviso do Asaas aos 30
-- dias (eram 90).
create or replace function public.limpar_historicos_antigos()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _cron integer;
  _resumidos integer;
  _apagados integer;
  _freio integer;
  _simuladas integer;
  _ia integer;
begin
  delete from cron.job_run_details where end_time < now() - interval '30 days';
  get diagnostics _cron = row_count;

  -- O aviso do Asaas já é gravado reduzido (trg_minimizar_aviso_asaas). Aos
  -- 30 dias, processado, perde também o link da fatura, a descrição e as
  -- datas: fica o que prova o que o gateway avisou. O reprocessamento olha
  -- só os últimos 7 dias, e só o não processado.
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
     and created_at < now() - interval '30 days'
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

  -- O medidor de uso das IAs guarda 13 meses, como os avisos do Asaas.
  delete from public.ia_chamadas where feita_em < now() - interval '13 months';
  get diagnostics _ia = row_count;

  return jsonb_build_object('cron', _cron, 'avisos_resumidos', _resumidos, 'avisos_apagados', _apagados,
                            'freio', _freio, 'sessoes_simuladas', _simuladas, 'ia_chamadas', _ia);
end;
$function$;
