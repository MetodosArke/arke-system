-- Taxa de implantação (24/09/2026).
--
-- Decisão dos sócios: a implantação do sistema é cobrada à parte, com valor e
-- parcelamento definidos em cada contrato; R$ 1.490 é o valor de referência
-- (Visão Master → Configurações). A cobrança é B2B, da ArkeFit à academia:
-- cada parcela vira uma linha de `cobrancas_b2b`, então entra sozinha no
-- webhook, na conferência diária com o Asaas e na regra de inadimplência B2B.
insert into public.plataforma_config (chave, valor, descricao)
values ('taxa_implantacao_referencia', 1490, 'Taxa de implantação de referência (R$), sugerida ao emitir; o valor de cada contrato é livre.')
on conflict (chave) do nothing;

create table public.taxas_implantacao (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  valor_total numeric(12, 2) not null check (valor_total >= 5),
  parcelas integer not null check (parcelas between 1 and 12),
  primeiro_vencimento date not null,
  -- Id do parcelamento no Asaas; nulo quando é à vista (uma cobrança só).
  asaas_installment_id text unique,
  status text not null default 'emitida' check (status in ('emitida', 'cancelada')),
  criada_por uuid,
  created_at timestamptz not null default now()
);

-- Uma taxa emitida por academia: emitir de novo seria cobrar a implantação duas vezes.
create unique index taxas_implantacao_uma_por_academia
  on public.taxas_implantacao (organization_id) where status = 'emitida';

alter table public.taxas_implantacao enable row level security;

create policy "taxas_implantacao leitura" on public.taxas_implantacao
  for select to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin')
    or public.has_role(auth.uid(), 'admin_arke')
    or public.has_org_role(auth.uid(), organization_id, 'gestor')
  );

grant select on public.taxas_implantacao to authenticated;
grant all on public.taxas_implantacao to service_role;
