-- Repasse da ArkeFit configurável por organização (23/09/2026).
--
-- Até aqui a retenção da ArkeFit vinha de `planos_atacado.custo_mensal`, fixa
-- por nível e igual para todas as academias (Integrado R$ 45, Elite R$ 85).
-- O modelo comercial novo negocia contrato a contrato: cada academia tem porte
-- e ticket médio diferentes, então a retenção passa a viver na organização, em
-- valor fixo por aluno ou em percentual do que for cobrado dele.
--
-- **Nome:** o documento de conceito chama isto de `split_type`/`split_value`.
-- Aqui não, de propósito: neste código "split" já significa **a fatia da
-- academia**, que é o que vai no payload do Asaas. Usar a mesma palavra para a
-- retenção da ArkeFit — exatamente o oposto — seria plantar um erro caro no
-- lugar mais caro possível. `repasse_*` é o termo que o resto do sistema já usa
-- (`valor_repasse_arke`).
--
-- **A taxa do gateway continua saindo do lado da academia** (decisão de
-- 23/09/2026, que confirma a de 21/09). Como a academia recebe um valor
-- **fixo** no split, o que o Asaas desconta sai do que sobra — então somar a
-- taxa ao repasse faz a ArkeFit receber o valor negociado limpo. `repasse_valor`
-- é, portanto, o líquido desejado.
--
-- **O percentual não exige nada novo do Asaas.** Quem vai no payload é sempre a
-- fatia da academia, em `fixedValue`; o percentual é só a forma de calcular a
-- retenção antes disso.

-- ── 1. A configuração ──────────────────────────────────────────────────────
--
-- `check` em vez de enum: são dois valores de configuração, não um estado com
-- ciclo de vida, e um enum novo custaria uma migration só para ele por causa
-- da regra de ADD VALUE em transação.
alter table public.organizations
  add column if not exists repasse_tipo text not null default 'fixo',
  add column if not exists repasse_valor numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_repasse_tipo_valido') then
    alter table public.organizations
      add constraint organizations_repasse_tipo_valido
      check (repasse_tipo in ('fixo', 'percentual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_repasse_valor_valido') then
    alter table public.organizations
      add constraint organizations_repasse_valor_valido
      check (
        repasse_valor is null
        or (repasse_valor >= 0 and (repasse_tipo <> 'percentual' or repasse_valor <= 100))
      );
  end if;
end $$;

comment on column public.organizations.repasse_tipo is
  'Como a retencao da ArkeFit e calculada no Metodo: valor fixo por aluno ou percentual do valor cobrado dele.';
comment on column public.organizations.repasse_valor is
  'Quanto a ArkeFit retem, liquido (a taxa do gateway e somada a parte). Nulo = nao negociado: a cobranca do Metodo e recusada ate configurar.';

-- Backfill: a única organização existente segue exatamente como estava
-- (Integrado, R$ 45 fixos), para a mudança não alterar comportamento nenhum.
update public.organizations
   set repasse_tipo = 'fixo',
       repasse_valor = 45.00
 where repasse_valor is null;

-- ── 2. A conta, num lugar só ───────────────────────────────────────────────
--
-- Devolve NULL quando a academia não tem repasse negociado, e quem chama
-- recusa com mensagem. Cair num valor padrão seria pior: cobraria o aluno com
-- uma divisão que ninguém acordou, e o erro só apareceria no extrato.
create or replace function public.repasse_arke(_organization_id uuid, _valor_cobrado numeric)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
           when o.repasse_valor is null then null
           when o.repasse_tipo = 'percentual'
             then round(coalesce(_valor_cobrado, 0) * o.repasse_valor / 100, 2)
                  + public.arke_taxa_processamento(_valor_cobrado)
           else round(o.repasse_valor, 2) + public.arke_taxa_processamento(_valor_cobrado)
         end
    from public.organizations o
   where o.id = _organization_id;
$$;

comment on function public.repasse_arke(uuid, numeric) is
  'Quanto a ArkeFit retem de uma cobranca do Metodo: o negociado com a academia mais a taxa de processamento. NULL quando nao ha repasse negociado.';

revoke execute on function public.repasse_arke(uuid, numeric) from public;
grant execute on function public.repasse_arke(uuid, numeric) to authenticated, service_role;

-- ── 3. Quem pode mexer ─────────────────────────────────────────────────────
--
-- Sem esta trava, o gestor alteraria o próprio repasse pela política de UPDATE
-- de `organizations` e se daria retenção zero. É a mesma razão de plano,
-- limite de alunos e mensalidade B2B já estarem protegidos aqui.
create or replace function public.proteger_colunas_organizacao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
     or new.repasse_valor is distinct from old.repasse_valor then
    raise exception 'Plano, limite de alunos, mensalidade B2B e repasse do Método são definidos pela ArkeFit.' using errcode = '42501';
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
$$;

revoke execute on function public.proteger_colunas_organizacao() from public;
