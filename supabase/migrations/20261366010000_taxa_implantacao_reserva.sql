-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- Taxa de implantação: a emissão é reservada no banco antes do Asaas (06/10/2026).
--
-- Dois defeitos, da mesma raiz. A função gravava a taxa como `emitida` e,
-- depois, as parcelas em `cobrancas_b2b`, sem nada que segurasse o meio:
--
--   * falha parcial não se corrigia: com a taxa gravada e as parcelas não, a
--     nova tentativa batia na taxa `emitida` e recebia 409. As parcelas nunca
--     entravam em `cobrancas_b2b`, e por isso ficavam fora da conferência
--     diária e da inadimplência B2B;
--   * duas chamadas ao mesmo tempo passavam juntas pela conferência, as duas
--     consultavam o Asaas antes de qualquer uma criar, e cada uma criava um
--     parcelamento.
--
-- Agora a emissão começa por uma **reserva** (`emitindo`), única por
-- academia junto com a `emitida`. Quem não consegue a reserva não fala com o
-- Asaas. A reserva vale por alguns minutos (`reservada_ate`): a chamada que
-- termina mal a encurta, e a que morre no meio a deixa vencer. Em qualquer
-- dos dois casos, a próxima tentativa assume a reserva e procura a taxa no
-- Asaas pela referência antes de criar.

alter table public.taxas_implantacao add column if not exists reservada_ate timestamptz;

alter table public.taxas_implantacao drop constraint if exists taxas_implantacao_status_check;
alter table public.taxas_implantacao add constraint taxas_implantacao_status_check
  check (status in ('emitindo', 'emitida', 'cancelada'));

-- Uma taxa por academia, contando a que está sendo emitida.
drop index if exists public.taxas_implantacao_uma_por_academia;
create unique index taxas_implantacao_uma_por_academia
  on public.taxas_implantacao (organization_id) where status in ('emitindo', 'emitida');

-- Reserva a emissão da taxa de uma academia. Devolve a linha e a situação:
--   reservada    → a emissão é desta chamada (reserva nova, ou vencida e assumida);
--   em_andamento → outra chamada está emitindo agora;
--   emitida      → a taxa já foi emitida (a chamada pode completar o registro).
-- Só a edge function chama, com a service_role, depois de conferir que é a
-- ArkeFit com as duas etapas.
create or replace function public.reservar_taxa_implantacao(
  _organization_id uuid,
  _valor_total numeric,
  _parcelas integer,
  _primeiro_vencimento date,
  _criada_por uuid
)
returns table (taxa_id uuid, situacao text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_status text;
begin
  insert into public.taxas_implantacao as t
    (organization_id, valor_total, parcelas, primeiro_vencimento, status, reservada_ate, criada_por)
  values
    (_organization_id, _valor_total, _parcelas, _primeiro_vencimento, 'emitindo', now() + interval '3 minutes', _criada_por)
  -- O `where` repete o predicado do índice parcial; sem ele o Postgres não
  -- o infere e a instrução falha em tempo de execução.
  on conflict (organization_id) where status in ('emitindo', 'emitida')
  do update set
    valor_total = excluded.valor_total,
    parcelas = excluded.parcelas,
    primeiro_vencimento = excluded.primeiro_vencimento,
    reservada_ate = excluded.reservada_ate,
    criada_por = excluded.criada_por
  -- Só assume a reserva vencida. A emitida e a que está valendo ficam como estão.
  where t.status = 'emitindo' and (t.reservada_ate is null or t.reservada_ate <= now())
  returning t.id into v_id;

  if v_id is not null then
    return query select v_id, 'reservada'::text;
    return;
  end if;

  select t.id, t.status into v_id, v_status
    from public.taxas_implantacao t
   where t.organization_id = _organization_id and t.status in ('emitindo', 'emitida');
  return query select v_id, case when v_status = 'emitida' then 'emitida' else 'em_andamento' end;
end;
$$;

revoke execute on function public.reservar_taxa_implantacao(uuid, numeric, integer, date, uuid) from public, anon, authenticated;
grant execute on function public.reservar_taxa_implantacao(uuid, numeric, integer, date, uuid) to service_role;
