-- Freio de chamadas para as edge functions que custam fora do banco.
--
-- As funções que falam com o Asaas usam a conta da ArkeFit, que é uma só para
-- todas as academias: a cota é de 25.000 chamadas a cada 12 horas, e a
-- listagem de cobranças aceita 140 por minuto. Um laço com defeito ou
-- mal-intencionado numa academia esgotaria a cota de todas, e a cobrança de
-- todo mundo pararia por até 12 horas. O mesmo vale, em escala menor, para o
-- que manda e-mail e para o que chama a IA.
--
-- O freio conta chamadas por chave ("asaas:org:<id>", "asaas:user:<id>"...)
-- numa janela de tempo. Os limites ficam em cada função, folgados: uso de
-- verdade nunca chega neles; o que chega é laço.
--
-- Só a service role alcança a tabela e a função: quem decide o limite é a
-- edge function, depois de conferir quem chama.

create table if not exists public.freio_chamadas (
  id bigserial primary key,
  chave text not null,
  criado_em timestamptz not null default now()
);

create index if not exists freio_chamadas_chave_criado on public.freio_chamadas (chave, criado_em);

alter table public.freio_chamadas enable row level security;
-- Sem regra nenhuma: nem a equipe nem o aluno leem ou gravam pela API.
revoke all on public.freio_chamadas from anon, authenticated;
grant select, insert, delete on public.freio_chamadas to service_role;
grant usage on sequence public.freio_chamadas_id_seq to service_role;

-- Registra a chamada se ainda cabe na janela e devolve se cabe. A trava por
-- chave impede que duas chamadas simultâneas passem juntas no limite.
create or replace function public.registrar_chamada(_chave text, _limite integer, _janela_seg integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _n integer;
begin
  if _chave is null or length(_chave) = 0 or _limite is null or _limite < 1 or _janela_seg is null or _janela_seg < 1 then
    raise exception 'registrar_chamada: chave, limite e janela são obrigatórios' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('freio:' || _chave, 0));
  select count(*) into _n
    from public.freio_chamadas
   where chave = _chave
     and criado_em > now() - make_interval(secs => _janela_seg);
  if _n >= _limite then
    return false;
  end if;
  insert into public.freio_chamadas (chave) values (_chave);
  return true;
end;
$$;

revoke execute on function public.registrar_chamada(text, integer, integer) from public, anon, authenticated;
grant execute on function public.registrar_chamada(text, integer, integer) to service_role;

comment on function public.registrar_chamada(text, integer, integer) is
  'Freio das edge functions: registra a chamada se couber no limite da janela e devolve se coube. Só a service role.';

-- A limpeza diária do histórico passa a levar o freio: nenhuma janela usada
-- passa de um dia.
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

  return jsonb_build_object('cron', _cron, 'avisos_resumidos', _resumidos, 'avisos_apagados', _apagados, 'freio', _freio);
end;
$function$;
revoke execute on function public.limpar_historicos_antigos() from public, anon, authenticated;
