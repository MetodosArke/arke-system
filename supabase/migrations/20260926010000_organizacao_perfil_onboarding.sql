-- Reestruturação do painel /admin: Homes por papel + expansão da tela
-- Organização. Adiciona ao perfil do estabelecimento os campos de
-- contato/marca (logo, telefone, endereço) e um marcador explícito de
-- onboarding concluído, usado pelo banner nas Homes para orientar a
-- academia/studio a terminar a configuração inicial.
alter table public.organizations
  add column if not exists logo_url text,
  add column if not exists telefone text,
  add column if not exists endereco text,
  add column if not exists onboarding_completed boolean not null default false;

-- Organizações que já configuraram o split de pagamento evidentemente já
-- passaram pelo onboarding — não faz sentido reabrir o banner para elas.
update public.organizations
  set onboarding_completed = true
  where asaas_wallet_id is not null;
