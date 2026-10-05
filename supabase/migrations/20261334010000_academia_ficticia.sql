-- Academia fictícia: demonstração e testes automáticos (05/10/2026).
--
-- A academia de demonstração (para vender) e a de testes automáticos (E2E)
-- têm alunos, mensalidades "pagas" e fila de verdade no banco, só que
-- inventados. Sem esta marca, elas entrariam no MRR, na receita e nas
-- contagens da Visão Master, na foto diária do MRR, na fila global e na
-- conferência financeira do Vigia, e o resumo semanal iria por e-mail a
-- caixas que não existem.
--
-- `ficticia` é definida só pela ArkeFit (trg_proteger_colunas_organizacao) ou
-- pelos scripts de semeadura. A academia fictícia continua funcionando
-- inteira: o que muda é ficar fora dos números da plataforma.
set lock_timeout = '5s';

alter table public.organizations add column if not exists ficticia boolean not null default false;
comment on column public.organizations.ficticia is
  'Academia de demonstração ou de testes automáticos: fica fora dos números da plataforma, da conferência financeira do Vigia e do resumo semanal por e-mail.';

create or replace function public.organizacao_ficticia(_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select o.ficticia from public.organizations o where o.id = _org), false);
$$;
revoke all on function public.organizacao_ficticia(uuid) from public, anon, authenticated;

-- A academia de testes automáticos já existe.
update public.organizations set ficticia = true where slug = 'homologacao';

create or replace function public.get_superadmin_overview()
 RETURNS TABLE(mrr_global numeric, arr_global numeric, take_rate_pct numeric, inadimplencia_pct numeric, academias_total bigint, academias_ativas bigint, retencao_tenants_pct numeric, alunos_ativos_global bigint, prescricoes_base_total bigint, checkins_mapa_total bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_receita_total        numeric;
  v_repasse_total        numeric;
  v_assinaturas_total    bigint;
  v_assinaturas_atrasadas bigint;
  v_academias_total      bigint;
  v_academias_canceladas bigint;
  v_mrr_arke             numeric;
  v_mrr_academia         numeric;
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.';
  end if;

  select coalesce(sum(valor), 0), coalesce(sum(coalesce(valor_repasse_arke, 0) - coalesce(taxa_gateway, 0)), 0)
    into v_receita_total, v_repasse_total
    from public.pagamentos
    where status = 'confirmado' and not public.organizacao_ficticia(organization_id);

  select count(*), count(*) filter (where status = 'atrasada')
    into v_assinaturas_total, v_assinaturas_atrasadas
    from public.aluno_assinaturas
   where not public.organizacao_ficticia(organization_id);

  select count(*), count(*) filter (where status = 'cancelado')
    into v_academias_total, v_academias_canceladas
    from public.organizations
   where not ficticia;

  select coalesce(sum(valor_cobrado), 0) into v_mrr_arke from public.aluno_assinaturas
   where status = 'ativa' and not public.organizacao_ficticia(organization_id);

  select coalesce(sum(
    case p.periodicidade
      when 'mensal' then m.valor_cobrado
      when 'trimestral' then m.valor_cobrado / 3
      when 'semestral' then m.valor_cobrado / 6
      when 'anual' then m.valor_cobrado / 12
    end
  ), 0) into v_mrr_academia
  from public.aluno_matriculas_academia m
  join public.planos_academia p on p.id = m.plano_id
  where m.status = 'ativa' and not public.organizacao_ficticia(m.organization_id);

  return query
  select
    v_mrr_arke + v_mrr_academia as mrr_global,
    (v_mrr_arke + v_mrr_academia) * 12 as arr_global,
    case when v_receita_total > 0
      then round(v_repasse_total / v_receita_total * 100, 2)
      else 0 end as take_rate_pct,
    case when v_assinaturas_total > 0
      then round(v_assinaturas_atrasadas::numeric / v_assinaturas_total::numeric * 100, 2)
      else 0 end as inadimplencia_pct,
    v_academias_total as academias_total,
    (select count(*) from public.organizations where status = 'ativo' and not ficticia) as academias_ativas,
    case when v_academias_total > 0
      then round((v_academias_total - v_academias_canceladas)::numeric / v_academias_total::numeric * 100, 2)
      else 0 end as retencao_tenants_pct,
    (select count(*) from public.alunos where not public.organizacao_ficticia(organization_id)) as alunos_ativos_global,
    (select count(*) from public.treinos where status = 'ativo' and not public.organizacao_ficticia(organization_id))
      + (select count(*) from public.dietas where status = 'ativo' and not public.organizacao_ficticia(organization_id)) as prescricoes_base_total,
    (select count(*) from public.checkins where not public.organizacao_ficticia(organization_id)) as checkins_mapa_total;
end;
$function$;

create or replace function public.get_superadmin_receita_historica(_meses integer DEFAULT 12)
 RETURNS TABLE(mes date, receita_metodo_arke numeric, receita_mensalidades numeric, receita_b2b numeric, receita_total numeric, repasse_arke numeric, mrr_contratado numeric, arr_contratado numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_meses integer := least(greatest(coalesce(_meses, 12), 1), 36);
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.';
  end if;

  return query
  with meses as (
    select generate_series(
             date_trunc('month', current_date) - make_interval(months => v_meses - 1),
             date_trunc('month', current_date),
             interval '1 month'
           )::date as mes
  ),
  pag as (
    select date_trunc('month', data_pagamento)::date as mes,
           sum(valor) as bruto,
           sum(coalesce(valor_repasse_arke, 0) - coalesce(taxa_gateway, 0)) as repasse
      from public.pagamentos
     where status = 'confirmado' and data_pagamento is not null and not public.organizacao_ficticia(organization_id)
     group by 1
  ),
  mens as (
    select date_trunc('month', data_pagamento)::date as mes,
           sum(valor) as bruto,
           sum(coalesce(valor_repasse_arke, 0) - coalesce(taxa_gateway, 0)) as repasse
      from public.mensalidades
     where status = 'confirmado' and data_pagamento is not null and not public.organizacao_ficticia(organization_id)
     group by 1
  ),
  b2b as (
    select date_trunc('month', data_pagamento)::date as mes,
           sum(valor) as bruto,
           sum(valor - coalesce(taxa_gateway, 0)) as repasse
      from public.cobrancas_b2b
     where status = 'confirmado' and data_pagamento is not null and not public.organizacao_ficticia(organization_id)
     group by 1
  ),
  snap as (
    select distinct on (date_trunc('month', data))
           date_trunc('month', data)::date as mes,
           mrr_global,
           arr_global
      from public.metricas_mrr_snapshot
     order by date_trunc('month', data), data desc
  )
  select
    m.mes,
    coalesce(p.bruto, 0)::numeric,
    coalesce(mn.bruto, 0)::numeric,
    coalesce(b.bruto, 0)::numeric,
    (coalesce(p.bruto, 0) + coalesce(mn.bruto, 0) + coalesce(b.bruto, 0))::numeric,
    (coalesce(p.repasse, 0) + coalesce(mn.repasse, 0) + coalesce(b.repasse, 0))::numeric,
    s.mrr_global,
    s.arr_global
  from meses m
  left join pag p on p.mes = m.mes
  left join mens mn on mn.mes = m.mes
  left join b2b b on b.mes = m.mes
  left join snap s on s.mes = m.mes
  order by m.mes;
end;
$function$;

create or replace function public.capturar_snapshot_mrr()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mrr_arke numeric;
  v_mrr_academia numeric;
  v_assinaturas integer;
  v_matriculas integer;
begin
  -- Mesmas fórmulas de get_superadmin_overview, para as duas séries
  -- baterem quando comparadas lado a lado.
  select coalesce(sum(valor_cobrado), 0), count(*)
    into v_mrr_arke, v_assinaturas
    from public.aluno_assinaturas
   where status = 'ativa' and not public.organizacao_ficticia(organization_id);

  select coalesce(sum(
           case p.periodicidade
             when 'mensal' then m.valor_cobrado
             when 'trimestral' then m.valor_cobrado / 3
             when 'semestral' then m.valor_cobrado / 6
             when 'anual' then m.valor_cobrado / 12
           end
         ), 0), count(*)
    into v_mrr_academia, v_matriculas
    from public.aluno_matriculas_academia m
    join public.planos_academia p on p.id = m.plano_id
   where m.status = 'ativa' and not public.organizacao_ficticia(m.organization_id);

  insert into public.metricas_mrr_snapshot (
    data, mrr_arke, mrr_academia, mrr_global, arr_global,
    assinaturas_ativas, matriculas_ativas, academias_ativas, alunos_total
  )
  values (
    current_date,
    v_mrr_arke,
    v_mrr_academia,
    v_mrr_arke + v_mrr_academia,
    (v_mrr_arke + v_mrr_academia) * 12,
    v_assinaturas,
    v_matriculas,
    (select count(*) from public.organizations where status = 'ativo' and not ficticia),
    (select count(*) from public.alunos where not public.organizacao_ficticia(organization_id))
  )
  on conflict (data) do update set
    mrr_arke = excluded.mrr_arke,
    mrr_academia = excluded.mrr_academia,
    mrr_global = excluded.mrr_global,
    arr_global = excluded.arr_global,
    assinaturas_ativas = excluded.assinaturas_ativas,
    matriculas_ativas = excluded.matriculas_ativas,
    academias_ativas = excluded.academias_ativas,
    alunos_total = excluded.alunos_total,
    created_at = now();
end;
$function$;

create or replace function public.organizacoes_para_briefing()
 RETURNS TABLE(organization_id uuid, semana date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.id, date_trunc('week', current_date::timestamp)::date
    from public.organizations o
   where o.status in ('ativo', 'trial')
     -- Academia fictícia (demonstração, testes): o e-mail iria a caixa que não existe.
     and not o.ficticia
     and (o.onboarding_completed or o.status = 'trial')
     and not exists (
       select 1 from public.briefings_enviados b
        where b.organization_id = o.id
          and b.semana = date_trunc('week', current_date::timestamp)::date
          and b.enviado_em is not null
     );
$function$;

create or replace function public.get_superadmin_fila_global()
 RETURNS TABLE(organization_id uuid, organizacao_nome text, status_org org_status, abertas bigint, vencidas bigint, criticas_abertas bigint, escaladas bigint, sem_responsavel bigint, concluidas_7d bigint, horas_pendencia_mais_antiga numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  where not o.ficticia
  -- Mais pendência vencida no topo; entre empates, quem tem fila maior.
  order by coalesce(a.vencidas, 0) desc, coalesce(a.abertas, 0) desc, o.nome asc;
end;
$function$;

create or replace function public.conferir_contas_financeiras()
 RETURNS TABLE(alvo text, organization_id uuid, descricao text, contexto jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   -- O dinheiro da academia fictícia é de mentira: a conta dela não é conferida.
   where not o.ficticia
   group by t.tipo, t.tabela, t.organization_id, o.nome;
$function$;

create or replace function public.proteger_colunas_organizacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_arkefit boolean;
begin
  if v_uid is null then
    return new;
  end if;
  v_arkefit := public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke');
  if v_arkefit then
    return new;
  end if;

  if new.plano_b2b is distinct from old.plano_b2b
     or new.limite_alunos is distinct from old.limite_alunos
     or new.valor_mensal_b2b is distinct from old.valor_mensal_b2b
     or new.asaas_subscription_id_b2b is distinct from old.asaas_subscription_id_b2b
     or new.asaas_customer_id_b2b is distinct from old.asaas_customer_id_b2b
     or new.repasse_tipo is distinct from old.repasse_tipo
     or new.repasse_valor is distinct from old.repasse_valor
     or new.ficticia is distinct from old.ficticia then
    raise exception 'Plano, limite de alunos, mensalidade B2B, repasse do Método e a marca de academia fictícia são definidos pela ArkeFit.' using errcode = '42501';
  end if;

  if new.asaas_wallet_id is distinct from old.asaas_wallet_id
     or new.asaas_conta_id is distinct from old.asaas_conta_id
     or new.asaas_conta_origem is distinct from old.asaas_conta_origem
     or new.asaas_conta_status is distinct from old.asaas_conta_status then
    raise exception 'A conta Asaas da academia é configurada pelo onboarding (Recebimentos), que confere a carteira antes de gravar.' using errcode = '42501';
  end if;

  if new.onboarding_completed is distinct from old.onboarding_completed
     and coalesce(current_setting('arke.concluindo_onboarding', true), '') <> 'sim' then
    raise exception 'O onboarding é concluído pelo checklist, quando todas as etapas estiverem prontas.' using errcode = '42501';
  end if;

  return new;
end;
$function$;
