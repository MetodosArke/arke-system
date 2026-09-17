-- =====================================================================
-- Tabela de Precificação ARKE — sugestão de varejo como padrão inicial
-- para novas organizações (a academia pode editar depois livremente)
-- =====================================================================

alter table public.planos_atacado
  add column valor_sugerido_varejo numeric(10,2);

update public.planos_atacado set valor_sugerido_varejo = 39.90 where id = 'essencial';
update public.planos_atacado set valor_sugerido_varejo = 119.00 where id = 'integrado';
update public.planos_atacado set valor_sugerido_varejo = 199.00 where id = 'integral';

alter table public.planos_atacado
  alter column valor_sugerido_varejo set not null;

-- ao criar uma organização, popula automaticamente a precificação de
-- varejo dos 3 níveis com a sugestão ARKE (a academia edita depois)
create or replace function public.seed_precificacao_sugerida()
returns trigger language plpgsql set search_path = public as $$
begin
  insert into public.organization_planos_precificacao (organization_id, nivel_atacado, valor_varejo, markup_pct)
  select
    new.id,
    p.id,
    p.valor_sugerido_varejo,
    round(((p.valor_sugerido_varejo - p.custo_mensal) / p.custo_mensal) * 100, 2)
  from public.planos_atacado p
  on conflict (organization_id, nivel_atacado) do nothing;
  return new;
end;
$$;

create trigger trg_organizations_seed_precificacao
  after insert on public.organizations
  for each row execute function public.seed_precificacao_sugerida();
