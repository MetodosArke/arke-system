-- Os níveis da equipe da ArkeFit, lote 6: o Financeiro (08/10/2026).
--
-- O Financeiro contratado cuida do dinheiro da Visão Master: os indicadores
-- e a receita, o MRR e as atrasadas de cada academia (na carteira, lote 4), a
-- mensalidade B2B (o plano e o valor), o repasse do Método (o da academia e a
-- exceção por nível), a taxa de implantação, as cobranças B2B, a conta das
-- cobranças da academia, os avisos do Asaas e a reconciliação. O status da
-- academia, cancelar, excluir, o trial e a marca de academia fictícia
-- continuam do Sócio. Ele não vê dado de aluno nem de saúde.
--
-- O que muda:
--   1. o nível Financeiro passa a poder ser dado (`niveis_arkefit_abertos`);
--   2. as leituras (indicadores, receita, avisos do Asaas, a situação da
--      conta das cobranças, o valor da mensalidade) perguntam pela área
--      `financeiro`; a da conta e a do valor seguem também do gestor da
--      academia;
--   3. as tabelas do dinheiro (cobranças B2B, taxa de implantação,
--      reconciliação, a exceção de repasse por nível e a própria academia) se
--      leem com a área `financeiro`;
--   4. a escrita sai do update direto e vai para três funções, que conferem a
--      área e deixam a trilha na Auditoria: `definir_mensalidade_b2b` (o plano
--      e o valor), `definir_repasse_organizacao` e `definir_repasse_por_nivel`.
--      A regra de alteração de `organizations` continua do Sócio (e do gestor,
--      na própria academia): o Financeiro que tentar o update direto atinge 0
--      linhas. Aplicar a tabela de referência (`aplicar_repasse_referencia`)
--      também passa à área;
--   5. as travas das colunas da academia (`proteger_colunas_organizacao`) e da
--      exceção por nível (`proteger_repasse_por_nivel`) aceitam o Financeiro só
--      nas colunas de dinheiro. Sem usuário (o aviso do Asaas, as rotinas, a
--      service role), as duas seguem passando primeiro, como antes;
--   6. a regra única (FOR ALL) de `plataforma_config` vira uma por operação: o
--      Sócio lê e grava tudo; o Financeiro lê as chaves de dinheiro (a taxa de
--      implantação de referência e a taxa do gateway); o Comercial lê os
--      interruptores da Letícia, que o cartão do Pipeline mostra.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. O nível Financeiro está no ar
-- ---------------------------------------------------------------------------
create or replace function public.niveis_arkefit_abertos()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['mentor', 'suporte', 'comercial', 'financeiro']::text[];
$$;

-- ---------------------------------------------------------------------------
-- 2. Os indicadores e a receita (os textos de 20261334010000)
-- ---------------------------------------------------------------------------
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
  if not public.acesso_arkefit('financeiro') then
    raise exception 'Acesso restrito à equipe da ArkeFit.' using errcode = '42501';
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
  if not public.acesso_arkefit('financeiro') then
    raise exception 'Acesso restrito à equipe da ArkeFit.' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- 3. Os avisos do Asaas (os textos de 20261112010000)
-- ---------------------------------------------------------------------------
-- O aviso é gravado reduzido ao que o webhook lê (`trg_minimizar_aviso_asaas`).
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
  if not public.acesso_arkefit('financeiro') then
    raise exception 'Acesso restrito à equipe da ArkeFit.' using errcode = '42501';
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
  if not public.acesso_arkefit('financeiro') then
    raise exception 'Acesso restrito à equipe da ArkeFit.' using errcode = '42501';
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

revoke execute on function public.get_superadmin_overview() from public, anon;
grant execute on function public.get_superadmin_overview() to authenticated;
revoke execute on function public.get_superadmin_receita_historica(integer) from public, anon;
grant execute on function public.get_superadmin_receita_historica(integer) to authenticated;
revoke execute on function public.get_superadmin_webhooks_asaas(integer) from public, anon;
grant execute on function public.get_superadmin_webhooks_asaas(integer) to authenticated;
revoke execute on function public.get_superadmin_webhooks_asaas_resumo() from public, anon;
grant execute on function public.get_superadmin_webhooks_asaas_resumo() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A conta das cobranças e o valor da mensalidade: o Financeiro ou o gestor
-- ---------------------------------------------------------------------------
-- O texto de 20261391010000; o gestor da academia segue vendo a da própria.
create or replace function public.situacao_cobranca_conta_academia(_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
  v_uid uuid := auth.uid();
  v_ligado boolean;
  v_registrado timestamptz;
begin
  if not (
    public.acesso_arkefit('financeiro')
    or exists (
      select 1 from public.organization_members m
       where m.organization_id = _organization_id and m.user_id = v_uid
         and m.status = 'active' and m.role = 'gestor'
    )
  ) then
    raise exception 'Sem permissão para ver a cobrança desta academia.' using errcode = '42501';
  end if;

  select o.cobranca_conta_academia into v_ligado from public.organizations o where o.id = _organization_id;
  if not found then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;
  select w.registrado_em into v_registrado from public.asaas_webhook_academia w where w.organization_id = _organization_id;

  return jsonb_build_object(
    'ligado', v_ligado,
    -- A chave da conta da academia no cofre (a mesma da nota fiscal): só se existe.
    'chave_conectada', exists (select 1 from vault.secrets s where s.name = 'asaas_subconta:' || _organization_id::text),
    'webhook_registrado_em', v_registrado,
    'plano_vivas_arkefit', (
      select count(*) from public.aluno_matriculas_academia m
       where m.organization_id = _organization_id and m.conta_asaas = 'arkefit'
         and m.status in ('ativa', 'pausada') and m.asaas_subscription_id is not null),
    'plano_vivas_academia', (
      select count(*) from public.aluno_matriculas_academia m
       where m.organization_id = _organization_id and m.conta_asaas = 'academia'
         and m.status in ('ativa', 'pausada') and m.asaas_subscription_id is not null),
    'avulsas_abertas_academia', (
      select count(*) from public.cobrancas_avulsas c
       where c.organization_id = _organization_id and c.conta_asaas = 'academia'
         and c.status in ('pendente', 'atrasado'))
  );
end;
$$;

revoke execute on function public.situacao_cobranca_conta_academia(uuid) from public, anon;
grant execute on function public.situacao_cobranca_conta_academia(uuid) to authenticated;

-- O texto de 20261274010000. Sem usuário (as funções do Asaas, a service
-- role) segue passando: é por ela que a assinatura nasce com o valor certo.
create or replace function public.valor_mensal_b2b(_organization_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not (public.acesso_arkefit('financeiro')
              or public.has_org_role(auth.uid(), _organization_id, 'gestor')) then
    raise exception 'Acesso restrito.' using errcode = '42501';
  end if;
  return (select coalesce(o.valor_mensal_b2b, p.valor_mensal)
            from public.organizations o
            left join public.planos_b2b_precos p on p.plano = o.plano_b2b
           where o.id = _organization_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. As tabelas do dinheiro se leem com a área `financeiro`
-- ---------------------------------------------------------------------------
-- O Sócio abre a área sempre. O Admin ARKE solto sai destas regras: só os
-- sócios o têm, e eles passam pelo `superadmin` (o roteiro de produção do
-- lote 7 confere que não há conta com `admin_arke` sem `superadmin`).
-- A regra de leitura das cobranças B2B nasceu "superadmin lê cobrancas_b2b"
-- (20260928010000): passa a se chamar "leitura", como as outras.
drop policy if exists "superadmin lê cobrancas_b2b" on public.cobrancas_b2b;
drop policy if exists "leitura" on public.cobrancas_b2b;
create policy "leitura" on public.cobrancas_b2b for select to authenticated
  using ((select public.acesso_arkefit('financeiro')));

-- A taxa de implantação é também do gestor da academia (a fatura dele).
alter policy "taxas_implantacao leitura" on public.taxas_implantacao
  using (
    (select public.acesso_arkefit('financeiro'))
    or public.has_org_role((select auth.uid()), organization_id, 'gestor')
  );

alter policy "leitura" on public.reconciliacoes_asaas
  using ((select public.acesso_arkefit('financeiro')));

-- A exceção de repasse por nível mora na linha do preço de varejo, que é da
-- academia: a equipe dela segue lendo.
alter policy "leitura" on public.organization_planos_precificacao
  using (
    has_org_role((select auth.uid()), organization_id, 'gestor'::app_role)
    or is_org_member((select auth.uid()), organization_id)
    or (select public.acesso_arkefit('financeiro'))
  );

-- A academia: a ficha do Financeiro lê o plano, o valor, o repasse e a
-- assinatura direto da tabela (como a do Sócio). Escrever continua do Sócio e
-- do gestor; o Financeiro grava pelas funções da seção 7.
alter policy "leitura" on public.organizations
  using (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
    or is_org_member((select auth.uid()), id)
    or (select public.acesso_arkefit('financeiro'))
  );

-- ---------------------------------------------------------------------------
-- 6. As travas das colunas: o Financeiro só nas colunas de dinheiro
-- ---------------------------------------------------------------------------
-- O texto de 20261391010000. A ordem fica: sem usuário passa; o modo da
-- cobrança só pela ficha; o Sócio (e o Admin ARKE) passa; o plano, o limite, o
-- valor e o repasse passam com a área `financeiro` (conferida só quando uma
-- delas muda: o gestor que salva o cadastro não paga a pergunta); a marca de
-- academia fictícia, os ids da assinatura B2B no Asaas, a conta e o
-- onboarding seguem como antes.
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

  if new.cobranca_conta_academia is distinct from old.cobranca_conta_academia
     and coalesce(current_setting('arke.modo_cobranca', true), '') <> 'sim' then
    raise exception 'A cobrança na conta da academia é ligada e desligada pela ficha da organização na Visão Master, que registra o webhook na conta dela.' using errcode = '42501';
  end if;

  v_arkefit := public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke');
  if v_arkefit then
    return new;
  end if;

  if (new.plano_b2b is distinct from old.plano_b2b
      or new.limite_alunos is distinct from old.limite_alunos
      or new.valor_mensal_b2b is distinct from old.valor_mensal_b2b
      or new.repasse_tipo is distinct from old.repasse_tipo
      or new.repasse_valor is distinct from old.repasse_valor)
     and not public.acesso_arkefit('financeiro') then
    raise exception 'Plano, limite de alunos, mensalidade B2B e repasse do Método são definidos pela ArkeFit.' using errcode = '42501';
  end if;

  if new.ficticia is distinct from old.ficticia
     or new.asaas_subscription_id_b2b is distinct from old.asaas_subscription_id_b2b
     or new.asaas_customer_id_b2b is distinct from old.asaas_customer_id_b2b then
    raise exception 'A marca de academia fictícia e a assinatura B2B no Asaas são definidas pela ArkeFit.' using errcode = '42501';
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

-- O texto de 20261338010000: a trava toda é das colunas de repasse.
create or replace function public.proteger_repasse_por_nivel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Sem usuário é a service role ou uma rotina; a ArkeFit passa com as duas
  -- etapas (has_role e acesso_arkefit já exigem): o Sócio e o Financeiro.
  if v_uid is null or public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if (tg_op = 'INSERT' and (new.repasse_tipo is not null or new.repasse_valor is not null))
     or (tg_op = 'UPDATE'
         and (new.repasse_tipo is distinct from old.repasse_tipo or new.repasse_valor is distinct from old.repasse_valor))
     or (tg_op = 'DELETE' and (old.repasse_tipo is not null or old.repasse_valor is not null)) then
    if not public.acesso_arkefit('financeiro') then
      raise exception 'O repasse do Método é definido pela ArkeFit.' using errcode = '42501';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Função de gatilho nasce com EXECUTE para o PUBLIC (20261215010000).
revoke execute on function public.proteger_colunas_organizacao() from public, anon, authenticated;
revoke execute on function public.proteger_repasse_por_nivel() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. A escrita do dinheiro: três funções, com a trilha na Auditoria
-- ---------------------------------------------------------------------------

-- O plano e o valor da mensalidade B2B. `_plano` nulo mantém o plano;
-- `_mudar_valor` diz se o valor muda (o valor nulo é o preço de tabela; zero
-- é a unidade de rede, que não paga mensalidade própria). O limite de alunos
-- acompanha o plano (`trg_limite_segue_plano`). A troca de plano já vai à
-- Auditoria pelo gatilho da academia; a do valor, aqui. A assinatura que já
-- existe no Asaas segue no valor dela até a ficha levar o valor novo
-- (`asaas-assinatura-b2b`, `alterar_valor`).
create or replace function public.definir_mensalidade_b2b(
  _organization_id uuid,
  _plano public.plano_b2b default null,
  _valor_mensal numeric default null,
  _mudar_valor boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations%rowtype;
  v_plano public.plano_b2b;
  v_valor numeric;
begin
  if not public.acesso_arkefit('financeiro') then
    raise exception 'Só a equipe da ArkeFit com acesso ao financeiro define a mensalidade B2B.' using errcode = '42501';
  end if;
  if _plano is null and not coalesce(_mudar_valor, false) then
    raise exception 'Informe o plano ou o valor.' using errcode = '22023';
  end if;
  if coalesce(_mudar_valor, false) and _valor_mensal is not null and (_valor_mensal < 0 or _valor_mensal > 100000) then
    raise exception 'Valor inválido: de zero a R$ 100.000.' using errcode = '22023';
  end if;

  select * into v_org from public.organizations where id = _organization_id for update;
  if v_org.id is null then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;

  v_plano := coalesce(_plano, v_org.plano_b2b);
  v_valor := case when coalesce(_mudar_valor, false) then round(_valor_mensal, 2) else v_org.valor_mensal_b2b end;
  if v_plano is not distinct from v_org.plano_b2b and v_valor is not distinct from v_org.valor_mensal_b2b then
    return;
  end if;

  update public.organizations
     set plano_b2b = v_plano,
         valor_mensal_b2b = v_valor
   where id = _organization_id;

  if v_valor is distinct from v_org.valor_mensal_b2b then
    perform public.registrar_auditoria(
      auth.uid(), 'organizacao.mensalidade_b2b_definida', 'organizations', _organization_id, v_org.nome,
      jsonb_build_object('valor_mensal_b2b', jsonb_build_object('de', v_org.valor_mensal_b2b, 'para', v_valor))
    );
  end if;
end;
$$;

comment on function public.definir_mensalidade_b2b(uuid, public.plano_b2b, numeric, boolean) is
  'O plano e o valor da mensalidade B2B da academia, pela área financeiro da equipe ArkeFit (o Financeiro e o Sócio). O valor nulo é o preço de tabela.';

revoke execute on function public.definir_mensalidade_b2b(uuid, public.plano_b2b, numeric, boolean) from public, anon;
grant execute on function public.definir_mensalidade_b2b(uuid, public.plano_b2b, numeric, boolean) to authenticated;

-- O repasse do Método negociado com a academia: o líquido que a ArkeFit
-- retém por aluno (a taxa do gateway vai por cima). Vale para assinaturas
-- novas: a que já existe segue com o repasse travado na criação.
create or replace function public.definir_repasse_organizacao(_organization_id uuid, _tipo text, _valor numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations%rowtype;
  v_valor numeric := round(_valor, 2);
begin
  if not public.acesso_arkefit('financeiro') then
    raise exception 'Só a equipe da ArkeFit com acesso ao financeiro define o repasse do Método.' using errcode = '42501';
  end if;
  if _tipo is null or _tipo not in ('fixo', 'percentual') then
    raise exception 'O repasse é um valor fixo ou um percentual.' using errcode = '22023';
  end if;
  if v_valor is null or v_valor < 0 or (_tipo = 'percentual' and v_valor > 100) or (_tipo = 'fixo' and v_valor > 100000) then
    raise exception 'Valor de repasse inválido para este tipo.' using errcode = '22023';
  end if;

  select * into v_org from public.organizations where id = _organization_id for update;
  if v_org.id is null then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;
  if v_org.repasse_tipo is not distinct from _tipo and v_org.repasse_valor is not distinct from v_valor then
    return;
  end if;

  update public.organizations
     set repasse_tipo = _tipo, repasse_valor = v_valor
   where id = _organization_id;

  perform public.registrar_auditoria(
    auth.uid(), 'repasse_metodo.definido', 'organizations', _organization_id, v_org.nome,
    jsonb_build_object(
      'repasse_tipo', jsonb_build_object('de', v_org.repasse_tipo, 'para', _tipo),
      'repasse_valor', jsonb_build_object('de', v_org.repasse_valor, 'para', v_valor)
    )
  );
end;
$$;

comment on function public.definir_repasse_organizacao(uuid, text, numeric) is
  'O repasse do Método negociado com a academia, pela área financeiro da equipe ArkeFit (o Financeiro e o Sócio).';

revoke execute on function public.definir_repasse_organizacao(uuid, text, numeric) from public, anon;
grant execute on function public.definir_repasse_organizacao(uuid, text, numeric) to authenticated;

-- A exceção de repasse por nível do Método, dentro da academia. Tipo e valor
-- nulos tiram a exceção (vale o repasse da academia). A linha do nível é a do
-- preço de varejo da academia: se ainda não existe, nasce com o varejo
-- sugerido da tabela de referência, como em `aplicar_repasse_referencia`.
create or replace function public.definir_repasse_por_nivel(
  _organization_id uuid,
  _nivel public.nivel_atacado,
  _tipo text,
  _valor numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_existe boolean;
  v_tipo_antes text;
  v_valor_antes numeric;
  v_custo numeric;
  v_varejo numeric;
  v_valor numeric := round(_valor, 2);
begin
  if not public.acesso_arkefit('financeiro') then
    raise exception 'Só a equipe da ArkeFit com acesso ao financeiro define o repasse do Método.' using errcode = '42501';
  end if;
  if (_tipo is null) <> (_valor is null) then
    raise exception 'Informe o tipo e o valor, ou deixe os dois em branco para valer o repasse da academia.' using errcode = '22023';
  end if;
  if _tipo is not null and (_tipo not in ('fixo', 'percentual') or v_valor < 0
                            or (_tipo = 'percentual' and v_valor > 100) or (_tipo = 'fixo' and v_valor > 100000)) then
    raise exception 'Valor de repasse inválido para este tipo.' using errcode = '22023';
  end if;

  select nome into v_nome from public.organizations where id = _organization_id;
  if not found then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;
  select custo_mensal, valor_sugerido_varejo into v_custo, v_varejo from public.planos_atacado where id = _nivel;
  if not found then
    raise exception 'Nível do Método não encontrado.' using errcode = 'P0002';
  end if;

  select true, repasse_tipo, repasse_valor into v_existe, v_tipo_antes, v_valor_antes
    from public.organization_planos_precificacao
   where organization_id = _organization_id and nivel_atacado = _nivel
   for update;
  v_existe := coalesce(v_existe, false);
  if (v_existe and v_tipo_antes is not distinct from _tipo and v_valor_antes is not distinct from v_valor)
     or (not v_existe and _tipo is null) then
    return;
  end if;

  insert into public.organization_planos_precificacao
    (organization_id, nivel_atacado, valor_varejo, markup_pct, repasse_tipo, repasse_valor)
  values
    (_organization_id, _nivel, v_varejo,
     case when coalesce(v_custo, 0) > 0 then round(((v_varejo - v_custo) / v_custo) * 100, 2) else 0 end,
     _tipo, v_valor)
  on conflict (organization_id, nivel_atacado) do update
    set repasse_tipo = excluded.repasse_tipo,
        repasse_valor = excluded.repasse_valor,
        updated_at = now();

  perform public.registrar_auditoria(
    auth.uid(), 'repasse_metodo.excecao_definida', 'organization_planos_precificacao', _organization_id, v_nome,
    jsonb_build_object(
      'nivel', _nivel,
      'repasse_tipo', jsonb_build_object('de', v_tipo_antes, 'para', _tipo),
      'repasse_valor', jsonb_build_object('de', v_valor_antes, 'para', v_valor)
    )
  );
end;
$$;

comment on function public.definir_repasse_por_nivel(uuid, public.nivel_atacado, text, numeric) is
  'A exceção de repasse por nível do Método na academia, pela área financeiro da equipe ArkeFit (o Financeiro e o Sócio). Tipo e valor nulos tiram a exceção.';

revoke execute on function public.definir_repasse_por_nivel(uuid, public.nivel_atacado, text, numeric) from public, anon;
grant execute on function public.definir_repasse_por_nivel(uuid, public.nivel_atacado, text, numeric) to authenticated;

-- A tabela de referência vira o negociado da academia num clique (o texto de
-- 20261307010000), agora pela área.
create or replace function public.aplicar_repasse_referencia(_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_org text;
  v_padrao numeric;
  v_niveis jsonb := '{}'::jsonb;
  r record;
begin
  if not public.acesso_arkefit('financeiro') then
    raise exception 'Só a equipe da ArkeFit com acesso ao financeiro define o repasse do Método.' using errcode = '42501';
  end if;

  select nome into v_org from public.organizations where id = _organization_id;
  if not found then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;

  select custo_mensal into v_padrao from public.planos_atacado where id = 'integrado' and disponivel;
  if v_padrao is null then
    raise exception 'A tabela de referência não tem o Integrado disponível.' using errcode = '22023';
  end if;

  update public.organizations set repasse_tipo = 'fixo', repasse_valor = v_padrao where id = _organization_id;

  -- A exceção só existe onde a referência do nível difere do padrão; nos
  -- outros níveis ela é limpa, para valer o padrão que acabou de ser gravado.
  for r in select id, custo_mensal, valor_sugerido_varejo from public.planos_atacado where disponivel loop
    insert into public.organization_planos_precificacao
      (organization_id, nivel_atacado, valor_varejo, markup_pct, repasse_tipo, repasse_valor)
    values
      (_organization_id, r.id, r.valor_sugerido_varejo,
       round(((r.valor_sugerido_varejo - r.custo_mensal) / r.custo_mensal) * 100, 2),
       case when r.custo_mensal <> v_padrao then 'fixo' end,
       case when r.custo_mensal <> v_padrao then r.custo_mensal end)
    on conflict (organization_id, nivel_atacado) do update
      set repasse_tipo = excluded.repasse_tipo,
          repasse_valor = excluded.repasse_valor,
          updated_at = now();
    v_niveis := v_niveis || jsonb_build_object(r.id::text, r.custo_mensal);
  end loop;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
  select v_uid, u.email, 'repasse_metodo.referencia_aplicada', 'organizations', _organization_id, v_org,
         jsonb_build_object('padrao', v_padrao, 'niveis', v_niveis)
    from (select 1) um
    left join auth.users u on u.id = v_uid;

  return jsonb_build_object('padrao', v_padrao, 'niveis', v_niveis);
end;
$function$;

revoke execute on function public.aplicar_repasse_referencia(uuid) from public, anon;
grant execute on function public.aplicar_repasse_referencia(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. A configuração da plataforma: uma regra por operação
-- ---------------------------------------------------------------------------
-- Antes, uma regra só (FOR ALL) do Sócio e do Admin ARKE. Quem lê do lado da
-- academia passa por funções `security definer`. Agora: o Sócio lê e grava
-- tudo; o Financeiro lê as chaves de dinheiro; o Comercial, os interruptores
-- da Letícia. Gravar continua do Sócio (Configurações, a equipe, os agentes).
drop policy if exists "ArkeFit gerencia plataforma_config" on public.plataforma_config;
drop policy if exists "admin_arke gerencia plataforma_config" on public.plataforma_config;

drop policy if exists "leitura" on public.plataforma_config;
create policy "leitura" on public.plataforma_config for select to authenticated
  using (
    (select public.acesso_arkefit('socio'))
    or (chave in ('taxa_implantacao_referencia', 'taxa_processamento_percentual', 'taxa_processamento_fixa', 'taxa_processamento_minima')
        and (select public.acesso_arkefit('financeiro')))
    or (chave in ('agente_comercial_ativo', 'agente_comercial_ia', 'agente_comercial_outras_origens')
        and (select public.acesso_arkefit('comercial')))
  );

drop policy if exists "inclusão" on public.plataforma_config;
create policy "inclusão" on public.plataforma_config for insert to authenticated
  with check ((select public.acesso_arkefit('socio')));

drop policy if exists "alteração" on public.plataforma_config;
create policy "alteração" on public.plataforma_config for update to authenticated
  using ((select public.acesso_arkefit('socio')))
  with check ((select public.acesso_arkefit('socio')));

drop policy if exists "exclusão" on public.plataforma_config;
create policy "exclusão" on public.plataforma_config for delete to authenticated
  using ((select public.acesso_arkefit('socio')));
