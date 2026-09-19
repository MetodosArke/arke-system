-- Deixa o módulo financeiro bem mais próximo de um ERP, mesmo
-- continuando com inputs manuais na maior parte: plano de contas
-- estruturado (em vez de texto livre), contas a pagar/receber com
-- vencimento e recorrência mensal automática, e integração automática
-- com o que o sistema já sabe (mensalidade da academia confirmada e
-- fechamento de folha pago viram lançamento sozinhos — sem o gestor
-- digitar de novo algo que o próprio ArkeFit já registrou).

create type public.lancamento_status as enum ('pendente', 'pago', 'atrasado', 'cancelado');
create type public.recorrencia_tipo as enum ('nenhuma', 'mensal');

create table public.plano_contas (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  tipo              public.lancamento_financeiro_tipo not null,
  nome              text not null,
  categoria_pai_id  uuid references public.plano_contas(id) on delete set null,
  ativo             boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (organization_id, tipo, nome)
);

create index idx_plano_contas_organization_id on public.plano_contas(organization_id);

alter table public.plano_contas enable row level security;

create policy "gestor gerencia plano_contas"
  on public.plano_contas for all
  to authenticated
  using (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'));

-- categoria (texto) vira um snapshot denormalizado do nome da conta no
-- momento do lançamento — prática comum de ERP: renomear a conta
-- depois não reescreve o histórico. categoria_id é a referência viva.
alter table public.lancamentos_financeiros
  alter column categoria drop not null,
  add column categoria_id uuid references public.plano_contas(id) on delete set null,
  add column status public.lancamento_status not null default 'pago',
  add column vencimento date,
  add column data_pagamento date,
  add column contato text, -- fornecedor/cliente/quem recebe ou paga — texto livre por enquanto, sem cadastro formal ainda
  add column forma_pagamento text,
  add column recorrencia public.recorrencia_tipo not null default 'nenhuma',
  add column lancamento_origem_id uuid references public.lancamentos_financeiros(id) on delete set null,
  add column origem_automatica text;

-- lançamentos já existentes (todos manuais, já "acontecidos") ganham
-- data_pagamento = data, mantendo o comportamento anterior.
update public.lancamentos_financeiros set data_pagamento = data where data_pagamento is null;

create unique index idx_lancamentos_financeiros_origem_automatica
  on public.lancamentos_financeiros(organization_id, origem_automatica)
  where origem_automatica is not null;
create index idx_lancamentos_financeiros_categoria_id on public.lancamentos_financeiros(categoria_id);
create index idx_lancamentos_financeiros_status_vencimento on public.lancamentos_financeiros(organization_id, status, vencimento);
create index idx_lancamentos_financeiros_lancamento_origem_id on public.lancamentos_financeiros(lancamento_origem_id);

-- -----------------------------------------------------------------
-- Integração automática: mensalidade da academia confirmada vira
-- receita; fechamento de folha pago vira despesa. Idempotente via
-- origem_automatica (unique index acima), então mesmo que o trigger
-- rode mais de uma vez pro mesmo evento não duplica.
-- -----------------------------------------------------------------
create or replace function public.lancar_receita_mensalidade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_categoria_id uuid;
begin
  if new.status = 'confirmado' and old.status is distinct from 'confirmado' then
    select id into v_categoria_id from public.plano_contas
      where organization_id = new.organization_id and tipo = 'receita' and nome = 'Mensalidades (automático)';
    if v_categoria_id is null then
      insert into public.plano_contas (organization_id, tipo, nome)
        values (new.organization_id, 'receita', 'Mensalidades (automático)')
        returning id into v_categoria_id;
    end if;

    insert into public.lancamentos_financeiros
      (organization_id, tipo, categoria_id, categoria, descricao, valor, data, status, data_pagamento, origem_automatica)
    values
      (new.organization_id, 'receita', v_categoria_id, 'Mensalidades (automático)', 'Mensalidade da academia paga via Asaas',
       new.valor_liquido_academia, coalesce(new.data_pagamento, current_date), 'pago', coalesce(new.data_pagamento, current_date),
       'mensalidade:' || new.id::text)
    on conflict (organization_id, origem_automatica) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_lancar_receita_mensalidade
  after update on public.mensalidades
  for each row execute function public.lancar_receita_mensalidade();

create or replace function public.lancar_despesa_folha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_categoria_id uuid;
begin
  if new.status = 'pago' and old.status is distinct from 'pago' then
    select id into v_categoria_id from public.plano_contas
      where organization_id = new.organization_id and tipo = 'despesa' and nome = 'Folha de pagamento (automático)';
    if v_categoria_id is null then
      insert into public.plano_contas (organization_id, tipo, nome)
        values (new.organization_id, 'despesa', 'Folha de pagamento (automático)')
        returning id into v_categoria_id;
    end if;

    insert into public.lancamentos_financeiros
      (organization_id, tipo, categoria_id, categoria, descricao, valor, data, status, data_pagamento, origem_automatica)
    values
      (new.organization_id, 'despesa', v_categoria_id, 'Folha de pagamento (automático)', 'Fechamento de folha do mês',
       new.valor_total, coalesce(new.data_pagamento, current_date), 'pago', coalesce(new.data_pagamento, current_date),
       'folha_pagamento:' || new.id::text)
    on conflict (organization_id, origem_automatica) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_lancar_despesa_folha
  after update on public.staff_folha_pagamentos
  for each row execute function public.lancar_despesa_folha();

-- -----------------------------------------------------------------
-- Recorrência mensal (despesas fixas tipo aluguel, ou qualquer
-- receita/despesa que se repete todo mês): gera a próxima ocorrência
-- como 'pendente' ~5 dias antes do vencimento, encadeando via
-- lancamento_origem_id. Só o lançamento "na ponta" da cadeia (sem
-- filho ainda) gera o próximo — por isso não duplica mesmo rodando
-- todo dia.
-- -----------------------------------------------------------------
create or replace function public.gerar_lancamentos_recorrentes()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lancamentos_financeiros
    (organization_id, tipo, categoria_id, categoria, descricao, valor, data, vencimento, status, contato, forma_pagamento, recorrencia, lancamento_origem_id, registrado_por)
  select
    l.organization_id, l.tipo, l.categoria_id, l.categoria, l.descricao, l.valor,
    (coalesce(l.vencimento, l.data) + interval '1 month')::date,
    (coalesce(l.vencimento, l.data) + interval '1 month')::date,
    'pendente', l.contato, l.forma_pagamento, 'mensal', l.id, l.registrado_por
  from public.lancamentos_financeiros l
  where l.recorrencia = 'mensal'
    and (coalesce(l.vencimento, l.data) + interval '1 month' - interval '5 days')::date <= current_date
    and not exists (select 1 from public.lancamentos_financeiros f where f.lancamento_origem_id = l.id);
end;
$$;

create or replace function public.marcar_lancamentos_atrasados()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lancamentos_financeiros
  set status = 'atrasado'
  where status = 'pendente' and vencimento < current_date;

  insert into public.tarefas (organization_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
  select
    l.organization_id,
    (case when l.tipo = 'despesa' then 'Conta a pagar atrasada: ' else 'Conta a receber atrasada: ' end)
      || coalesce(l.categoria, 'Lançamento') || ' (venceu em ' || to_char(l.vencimento, 'DD/MM/YYYY') || ')',
    'media',
    now() + interval '24 hours',
    'lancamento_atrasado:' || l.id::text,
    'cobranca'
  from public.lancamentos_financeiros l
  where l.status = 'atrasado'
  on conflict (organization_id, origem_evento) do nothing;
end;
$$;

select cron.schedule(
  'arke-lancamentos-recorrentes',
  '0 5 * * *',
  $$select public.gerar_lancamentos_recorrentes();$$
);

select cron.schedule(
  'arke-lancamentos-atrasados',
  '0 6 * * *',
  $$select public.marcar_lancamentos_atrasados();$$
);

revoke execute on function public.lancar_receita_mensalidade() from public;
revoke execute on function public.lancar_despesa_folha() from public;
revoke execute on function public.gerar_lancamentos_recorrentes() from public;
revoke execute on function public.marcar_lancamentos_atrasados() from public;
