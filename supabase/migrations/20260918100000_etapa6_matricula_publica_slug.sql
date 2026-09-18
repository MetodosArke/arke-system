-- =====================================================================
-- ARKE — ETAPA 6 (parte 1): Onboarding B2B & Auto-Matrícula por Slug
--
-- RPC pública (SECURITY DEFINER) para a página /p/:slug exibir nome da
-- academia e planos disponíveis sem precisar de GRANT/RLS amplos para
-- `anon` nas tabelas de organizations/planos_atacado/precificação (que
-- têm colunas sensíveis, como asaas_wallet_id e plano_b2b). A criação
-- da conta em si é feita pela Edge Function `matricula-publica`
-- (service role), não por esta função.
-- =====================================================================

create or replace function public.obter_organizacao_publica(_slug text)
returns table(organization_id uuid, nome text, planos jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id,
    o.nome,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'nivel_atacado', p.nivel_atacado,
          'nome', pa.nome,
          'descricao', pa.descricao,
          'valor_varejo', p.valor_varejo
        ) order by p.nivel_atacado
      )
      from public.organization_planos_precificacao p
      join public.planos_atacado pa on pa.id = p.nivel_atacado
      where p.organization_id = o.id
    ), '[]'::jsonb) as planos
  from public.organizations o
  where o.slug = _slug
    and o.status in ('ativo', 'trial');
$$;

grant execute on function public.obter_organizacao_publica(text) to anon, authenticated;
