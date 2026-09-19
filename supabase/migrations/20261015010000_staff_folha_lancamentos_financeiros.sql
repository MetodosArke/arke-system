-- Etapa 4 da frente de operação nativa da academia: folha (salário/
-- pró-labore) e um livro-caixa manual — o ArkeFit NÃO vira um ERP
-- financeiro completo. Aqui só registra e totaliza o que o gestor já
-- apurou na contabilidade externa dele (ou o salário/pró-labore fixo
-- de cada profissional), sem calcular impostos, DAS, folha de INSS
-- etc. Fechamento de folha é uma ação deliberada do gestor por mês
-- (RPC), não automática — junta o valor_base cadastrado com a soma
-- das comissões já lançadas na Etapa 3 pra aquele profissional naquele
-- mês.

create type public.folha_tipo as enum ('salario_fixo', 'pro_labore', 'comissionado');
create type public.folha_pagamento_status as enum ('pendente', 'pago');
create type public.lancamento_financeiro_tipo as enum ('receita', 'despesa');

create table public.staff_folha (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  tipo            public.folha_tipo not null,
  valor_base      numeric(10,2) check (valor_base is null or valor_base >= 0), -- null quando tipo = comissionado (só ganha comissão)
  ativo           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index idx_staff_folha_organization_id on public.staff_folha(organization_id);

create table public.staff_folha_pagamentos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  competencia     date not null, -- sempre dia 1 do mês
  valor_base      numeric(10,2) not null default 0,
  valor_comissoes numeric(10,2) not null default 0,
  valor_total     numeric(10,2) not null default 0,
  status          public.folha_pagamento_status not null default 'pendente',
  data_pagamento  date,
  observacao      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id, competencia)
);

create index idx_staff_folha_pagamentos_organization_id on public.staff_folha_pagamentos(organization_id);
create index idx_staff_folha_pagamentos_user_id on public.staff_folha_pagamentos(user_id);

create table public.lancamentos_financeiros (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tipo            public.lancamento_financeiro_tipo not null,
  categoria       text not null,
  descricao       text,
  valor           numeric(10,2) not null check (valor >= 0),
  data            date not null default current_date,
  registrado_por  uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_lancamentos_financeiros_organization_id on public.lancamentos_financeiros(organization_id);
create index idx_lancamentos_financeiros_data on public.lancamentos_financeiros(organization_id, data);

create trigger trg_staff_folha_updated_at
  before update on public.staff_folha
  for each row execute function public.set_updated_at();

create trigger trg_staff_folha_pagamentos_updated_at
  before update on public.staff_folha_pagamentos
  for each row execute function public.set_updated_at();

create trigger trg_lancamentos_financeiros_updated_at
  before update on public.lancamentos_financeiros
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------
-- RLS — tudo aqui é dado financeiro sensível: só gestor/admin_arke.
-- Diferente de horários/comissões, o profissional NÃO vê a própria
-- folha por padrão (o gestor decide comunicar isso fora do sistema,
-- por ora); é mais fácil abrir depois do que fechar.
-- -----------------------------------------------------------------
alter table public.staff_folha enable row level security;
alter table public.staff_folha_pagamentos enable row level security;
alter table public.lancamentos_financeiros enable row level security;

create policy "gestor gerencia staff_folha"
  on public.staff_folha for all
  to authenticated
  using (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'));

create policy "gestor gerencia staff_folha_pagamentos"
  on public.staff_folha_pagamentos for all
  to authenticated
  using (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'));

create policy "gestor gerencia lancamentos_financeiros"
  on public.lancamentos_financeiros for all
  to authenticated
  using (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'));

-- -----------------------------------------------------------------
-- Fechamento de folha: soma valor_base (cadastrado em staff_folha) +
-- comissões já lançadas (Etapa 3, staff_comissoes_lancamentos) pra
-- aquele profissional naquele mês. Ação deliberada do gestor — pode
-- rodar de novo pra atualizar os valores antes de marcar como pago
-- (upsert por (organization_id, user_id, competencia)).
-- -----------------------------------------------------------------
create or replace function public.gerar_fechamento_folha(_user_id uuid, _competencia date)
returns public.staff_folha_pagamentos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_valor_base numeric := 0;
  v_valor_comissoes numeric := 0;
  v_competencia date := date_trunc('month', _competencia)::date;
  v_result public.staff_folha_pagamentos;
begin
  select organization_id into v_org_id
    from public.organization_members
    where user_id = _user_id and status = 'active'
    limit 1;
  if v_org_id is null then
    raise exception 'Profissional sem organização ativa.';
  end if;

  if not (public.has_org_role(auth.uid(), v_org_id, 'gestor') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Sem permissão para gerar fechamento de folha.';
  end if;

  select coalesce(valor_base, 0) into v_valor_base
    from public.staff_folha
    where user_id = _user_id and organization_id = v_org_id and ativo;

  select coalesce(sum(valor_comissao), 0) into v_valor_comissoes
    from public.staff_comissoes_lancamentos
    where user_id = _user_id and organization_id = v_org_id and competencia = v_competencia;

  insert into public.staff_folha_pagamentos
    (organization_id, user_id, competencia, valor_base, valor_comissoes, valor_total)
  values
    (v_org_id, _user_id, v_competencia, coalesce(v_valor_base, 0), v_valor_comissoes, coalesce(v_valor_base, 0) + v_valor_comissoes)
  on conflict (organization_id, user_id, competencia) do update
    set valor_base = excluded.valor_base,
        valor_comissoes = excluded.valor_comissoes,
        valor_total = excluded.valor_total,
        updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

revoke execute on function public.gerar_fechamento_folha(uuid, date) from public;
grant execute on function public.gerar_fechamento_folha(uuid, date) to authenticated;
