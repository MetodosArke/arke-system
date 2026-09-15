-- Fase 13 (Pagamentos Asaas em produção): vincula organização SaaS a
-- cliente/cobrança Asaas real.
-- CLAUDE.md seção 9, item 13: "Pagamentos Asaas em produção: cobrança
-- real + webhook registrado (ver 8.1) + tokenização (ver 8.2)".
--
-- Investigação encontrou uma falha de isolamento real: asaas_payments
-- não tinha organization_id, e o endpoint que lista pagamentos
-- persistidos (usado no Dashboard/Financeiro) não filtrava por
-- organização nenhuma — qualquer organização veria os pagamentos de
-- todas as outras. Corrigida em código (server/routers.ts) e aqui no
-- schema, que precisa da coluna para filtrar e de uma policy de leitura.

alter table public.saas_organizations
  add column if not exists asaas_customer_id text;

alter table public.asaas_payments
  add column if not exists organization_id uuid references public.saas_organizations(id) on delete set null;

create index if not exists asaas_payments_organization_idx on public.asaas_payments (organization_id, updated_at desc);

-- Staff da organização lê os próprios pagamentos (mesmo padrão
-- saas_is_org_staff já usado em atendimentos/turmas/leads). O caminho
-- real do app usa service_role (bypassa RLS) e já filtra por
-- organization_id em código — esta policy é defesa em profundidade.
drop policy if exists asaas_payments_org_staff_read on public.asaas_payments;
create policy asaas_payments_org_staff_read
  on public.asaas_payments for select to authenticated
  using (organization_id is not null and saas_is_org_staff(organization_id));
