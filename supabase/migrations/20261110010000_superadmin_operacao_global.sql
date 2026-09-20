-- Operação global: saúde dos Gateways Locais e fila de atendimento
-- somada de todas as academias.
--
-- Sobre "gateway online": organizacao_catracas.status é um campo definido
-- na mão no cadastro ('ativo'), não sinal de vida — uma catraca desligada
-- há semanas continua 'ativo' ali. E ausência de acesso também não prova
-- nada: academia pequena de madrugada não tem catraca girando, e marcar
-- isso como "offline" seria alarme falso.
--
-- O que serve de sinal real: o Gateway Local chama
-- catraca-sincronizar-alunos num setInterval de 5 minutos
-- (sincronizar_alunos_intervalo_ms), independente de movimento. Gravar o
-- horário dessa chamada dá um heartbeat de verdade.

alter table public.organizacao_catracas
  add column if not exists ultimo_heartbeat_em timestamptz;

comment on column public.organizacao_catracas.ultimo_heartbeat_em is
  'Última chamada do Gateway Local a catraca-sincronizar-alunos. É o sinal de vida do dispositivo; status é cadastro manual e não serve para isso.';

-- ---------------------------------------------------------------------
-- Gateways
-- ---------------------------------------------------------------------
create or replace function public.get_superadmin_gateways()
returns table (
  catraca_id uuid,
  organization_id uuid,
  organizacao_nome text,
  nome text,
  localizacao text,
  status text,
  driver text,
  ultimo_heartbeat_em timestamptz,
  minutos_sem_heartbeat numeric,
  situacao text,
  acessos_24h bigint
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
    c.id,
    c.organization_id,
    o.nome,
    c.nome,
    c.localizacao,
    c.status,
    c.driver,
    c.ultimo_heartbeat_em,
    case when c.ultimo_heartbeat_em is not null
      then round(extract(epoch from (now() - c.ultimo_heartbeat_em)) / 60, 1)
    end,
    case
      -- Nunca reportou: ou o Gateway Local nunca foi instalado nessa
      -- unidade, ou nunca conseguiu autenticar. É diferente de ter caído.
      when c.ultimo_heartbeat_em is null then 'nunca_conectou'
      -- 3 ciclos de sync perdidos (5 min cada). Um único ciclo perdido
      -- é ruído de rede; 15 minutos em silêncio é queda.
      when c.ultimo_heartbeat_em < now() - interval '15 minutes' then 'offline'
      else 'online'
    end,
    (select count(*) from public.acessos_catraca_logs l
      where l.catraca_id = c.id and l.created_at >= now() - interval '24 hours')
  from public.organizacao_catracas c
  join public.organizations o on o.id = c.organization_id
  -- Quem está pior primeiro: offline antes de nunca conectou, e online
  -- por último. O painel existe para achar problema.
  order by
    case
      when c.ultimo_heartbeat_em is null then 1
      when c.ultimo_heartbeat_em < now() - interval '15 minutes' then 0
      else 2
    end,
    c.ultimo_heartbeat_em asc nulls last,
    o.nome asc;
end;
$$;

-- ---------------------------------------------------------------------
-- Fila de atendimento somada de toda a plataforma
-- ---------------------------------------------------------------------
create or replace function public.get_superadmin_fila_global()
returns table (
  organization_id uuid,
  organizacao_nome text,
  status_org org_status,
  abertas bigint,
  vencidas bigint,
  criticas_abertas bigint,
  escaladas bigint,
  sem_responsavel bigint,
  concluidas_7d bigint,
  horas_pendencia_mais_antiga numeric
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
  with abertas_cte as (
    select
      t.organization_id,
      count(*) as abertas,
      count(*) filter (where t.sla_prazo < now()) as vencidas,
      count(*) filter (where t.prioridade = 'critica') as criticas,
      count(*) filter (where t.escalada_em is not null) as escaladas,
      count(*) filter (where t.responsavel_id is null) as sem_responsavel,
      min(t.created_at) as mais_antiga
    from public.tarefas t
    where t.status in ('aberta', 'em_andamento', 'aguardando')
    group by t.organization_id
  ),
  concluidas_cte as (
    select t.organization_id, count(*) as concluidas_7d
    from public.tarefas t
    where t.status = 'concluida' and t.updated_at >= now() - interval '7 days'
    group by t.organization_id
  )
  select
    o.id,
    o.nome,
    o.status,
    coalesce(a.abertas, 0),
    coalesce(a.vencidas, 0),
    coalesce(a.criticas, 0),
    coalesce(a.escaladas, 0),
    coalesce(a.sem_responsavel, 0),
    coalesce(cc.concluidas_7d, 0),
    case when a.mais_antiga is not null
      then round(extract(epoch from (now() - a.mais_antiga)) / 3600, 1)
    end
  from public.organizations o
  left join abertas_cte a on a.organization_id = o.id
  left join concluidas_cte cc on cc.organization_id = o.id
  -- Mais pendência vencida no topo; entre empates, quem tem fila maior.
  order by coalesce(a.vencidas, 0) desc, coalesce(a.abertas, 0) desc, o.nome asc;
end;
$$;
