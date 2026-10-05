-- Medidor de uso das IAs (Rodada B, 05/10/2026).
--
-- Cada chamada das quatro IAs que não são o Sentinela (Letícia, assistente
-- da academia, leitura de dieta em PDF e Vigia) vira uma linha: o resultado
-- (ok, recusada pela trava, indisponível), os tokens e a latência. Nenhum
-- texto: nem a pergunta, nem a resposta. O Sentinela segue congelado e fica
-- de fora.
--
-- A Visão Master lê por get_superadmin_uso_ia(), com o custo estimado pela
-- tabela de preços (ia_precos), em dólar, pela tabela pública da AWS.
set lock_timeout = '5s';

create table public.ia_chamadas (
  id bigserial primary key,
  feita_em timestamptz not null default now(),
  agente text not null check (agente in ('leticia', 'assistente', 'dieta_pdf', 'vigia')),
  organization_id uuid references public.organizations(id) on delete set null,
  modelo text not null,
  resultado text not null check (resultado in ('ok', 'recusada_trava', 'indisponivel')),
  tokens_entrada integer check (tokens_entrada >= 0),
  tokens_saida integer check (tokens_saida >= 0),
  latencia_ms integer check (latencia_ms >= 0)
);

comment on table public.ia_chamadas is
  'Uma linha por chamada às IAs (menos o Sentinela): resultado, tokens e latência. Sem texto nenhum. Só a service role grava; a ArkeFit lê por get_superadmin_uso_ia().';

create index ia_chamadas_feita_em on public.ia_chamadas (feita_em);
create index ia_chamadas_organization_id on public.ia_chamadas (organization_id);

-- RLS ligada e sem regra: só a service role (as edge functions) grava e lê.
alter table public.ia_chamadas enable row level security;
grant select, insert on public.ia_chamadas to service_role;
grant usage on sequence public.ia_chamadas_id_seq to service_role;

create table public.ia_precos (
  modelo text primary key,
  entrada_usd_por_milhao numeric(10, 4) not null check (entrada_usd_por_milhao >= 0),
  saida_usd_por_milhao numeric(10, 4) not null check (saida_usd_por_milhao >= 0),
  conferido_em date not null,
  fonte text not null
);

comment on table public.ia_precos is
  'Preço por milhão de tokens de cada modelo, para o custo estimado do medidor de uso. Atualizar quando a AWS mudar o preço ou o modelo mudar.';

alter table public.ia_precos enable row level security;
grant select on public.ia_precos to service_role;

insert into public.ia_precos (modelo, entrada_usd_por_milhao, saida_usd_por_milhao, conferido_em, fonte) values
  ('anthropic.claude-3-haiku-20240307-v1:0', 0.25, 1.25, '2026-10-05', 'Tabela de preços do Amazon Bedrock (sob demanda)'),
  ('global.anthropic.claude-sonnet-4-6', 3.00, 15.00, '2026-10-05', 'Tabela de preços do Amazon Bedrock (perfil global)');

create or replace function public.get_superadmin_uso_ia(_dias integer default 30)
returns table (
  agente text,
  chamadas integer,
  ok integer,
  recusadas_trava integer,
  indisponiveis integer,
  tokens_entrada bigint,
  tokens_saida bigint,
  custo_usd numeric,
  latencia_media_ms integer,
  latencia_max_ms integer,
  sem_preco boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return query
  select c.agente,
         count(*)::int,
         count(*) filter (where c.resultado = 'ok')::int,
         count(*) filter (where c.resultado = 'recusada_trava')::int,
         count(*) filter (where c.resultado = 'indisponivel')::int,
         coalesce(sum(c.tokens_entrada), 0)::bigint,
         coalesce(sum(c.tokens_saida), 0)::bigint,
         round(coalesce(sum(coalesce(c.tokens_entrada, 0) * p.entrada_usd_por_milhao
                          + coalesce(c.tokens_saida, 0) * p.saida_usd_por_milhao) / 1000000, 0), 4),
         avg(c.latencia_ms)::int,
         max(c.latencia_ms)::int,
         bool_or(p.modelo is null and c.tokens_entrada is not null)
    from public.ia_chamadas c
    left join public.ia_precos p on p.modelo = c.modelo
   where c.feita_em > now() - make_interval(days => greatest(1, least(coalesce(_dias, 30), 400)))
   group by c.agente
   order by c.agente;
end;
$$;

revoke all on function public.get_superadmin_uso_ia(integer) from public, anon;
grant execute on function public.get_superadmin_uso_ia(integer) to authenticated;

-- A limpeza diária passa a apagar o medidor depois de 13 meses.
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

  -- O medidor de uso das IAs guarda 13 meses, como os avisos do Asaas.
  delete from public.ia_chamadas where feita_em < now() - interval '13 months';
  get diagnostics _ia = row_count;

  return jsonb_build_object('cron', _cron, 'avisos_resumidos', _resumidos, 'avisos_apagados', _apagados,
                            'freio', _freio, 'sessoes_simuladas', _simuladas, 'ia_chamadas', _ia);
end;
$function$;
