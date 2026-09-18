-- SuperAdmin — Módulo Definitivo de Cobrança B2B (Asaas) e Gestão Fiscal
-- do Tenant: campos fiscais/gestão na organização + tabela de cobranças
-- avulsas emitidas pela ARKE contra a academia/studio (SaaS mensalidade,
-- taxa de implantação etc. — direção oposta do split de aluno: aqui a
-- ARKE é a credora e o tenant é o cliente Asaas).

alter table public.organizations
  add column if not exists cnpj_cpf text,
  add column if not exists asaas_customer_id_b2b text,
  add column if not exists trial_vencimento date;

-- get_superadmin_tenants ganha os campos fiscais/gestão (cnpj_cpf,
-- trial_vencimento) e o e-mail do gestor master (para visualizar/editar
-- direto no modal de edição, sem precisar de uma tela separada).
drop function if exists public.get_superadmin_tenants();

create or replace function public.get_superadmin_tenants()
returns table (
  organization_id       uuid,
  nome                   text,
  slug                   text,
  status                 public.org_status,
  plano_b2b              public.plano_b2b,
  tipo                   public.organization_tipo,
  created_at             timestamptz,
  alunos_total           bigint,
  mrr_organizacao        numeric,
  assinaturas_atrasadas  bigint,
  ultima_atividade       timestamptz,
  cnpj_cpf               text,
  trial_vencimento       date,
  gestor_email           text
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
    o.id as organization_id,
    o.nome,
    o.slug,
    o.status,
    o.plano_b2b,
    o.tipo,
    o.created_at,
    (select count(*) from public.alunos a where a.organization_id = o.id) as alunos_total,
    coalesce((select sum(s.valor_cobrado) from public.aluno_assinaturas s
              where s.organization_id = o.id and s.status = 'ativa'), 0) as mrr_organizacao,
    (select count(*) from public.aluno_assinaturas s
      where s.organization_id = o.id and s.status = 'atrasada') as assinaturas_atrasadas,
    greatest(
      (select max(c.created_at) from public.checkins c where c.organization_id = o.id),
      (select max(t.created_at) from public.treinos t where t.organization_id = o.id)
    ) as ultima_atividade,
    o.cnpj_cpf,
    o.trial_vencimento,
    (
      select u.email
      from public.organization_members m
      join auth.users u on u.id = m.user_id
      where m.organization_id = o.id and m.role = 'gestor' and m.status = 'active'
      order by m.created_at asc
      limit 1
    ) as gestor_email
  from public.organizations o
  order by o.created_at desc;
end;
$$;

-- -----------------------------------------------------------------
-- Cobranças B2B avulsas (ARKE cobrando a academia/studio — mensalidade
-- SaaS, taxa de implantação etc.), emitidas manualmente pelo SuperAdmin.
-- Direção oposta da tabela `pagamentos` (que registra o aluno pagando a
-- academia, com split); aqui não há split — o valor vai inteiro para a
-- conta Asaas da própria ARKE (dona da ASAAS_API_KEY configurada).
-- -----------------------------------------------------------------
create table public.cobrancas_b2b (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  valor               numeric not null check (valor > 0),
  descricao           text not null,
  forma_pagamento     text not null check (forma_pagamento in ('PIX', 'CREDIT_CARD')),
  status              text not null default 'pendente' check (status in ('pendente', 'confirmado', 'atrasado', 'estornado', 'erro')),
  asaas_customer_id   text,
  asaas_payment_id    text unique,
  invoice_url         text,
  pix_copia_cola      text,
  pix_qr_code_base64  text,
  erro_detalhe        text,
  criado_por          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_cobrancas_b2b_organization on public.cobrancas_b2b(organization_id);
create index idx_cobrancas_b2b_asaas_payment on public.cobrancas_b2b(asaas_payment_id);

alter table public.cobrancas_b2b enable row level security;

-- Só o SuperAdmin enxerga o faturamento B2B da ARKE — leitura direta pelo
-- client (histórico na aba "Faturamento"); toda escrita passa pela Edge
-- Function `asaas-emitir-cobranca-b2b` (service_role, ignora RLS) ou pelo
-- webhook do Asaas (idem), nunca por update direto do superadmin.
create policy "superadmin lê cobrancas_b2b"
  on public.cobrancas_b2b for select
  to authenticated
  using (public.has_role(auth.uid(), 'superadmin'));

create trigger set_updated_at_cobrancas_b2b
  before update on public.cobrancas_b2b
  for each row execute function public.set_updated_at();
