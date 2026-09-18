-- SuperAdmin — Onboarding Assistido e Operação Master:
-- get_superadmin_tenants ganha "tipo" (para o filtro Academia/Studio) e
-- "ultima_atividade" (health score — maior data entre check-in e treino
-- criado na organização, para identificar contas inativas antes do churn).
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
  ultima_atividade       timestamptz
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
    ) as ultima_atividade
  from public.organizations o
  order by o.created_at desc;
end;
$$;

-- -----------------------------------------------------------------
-- Ação de suporte: reseta o(s) token(s) de dispositivo do Gateway Local
-- de uma organização (organizacao_catracas.device_token). Não é
-- SECURITY DEFINER porque quem chama já é service_role (edge function).
-- -----------------------------------------------------------------
create or replace function public.superadmin_resetar_tokens_gateway(_organization_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_qtd integer;
begin
  update public.organizacao_catracas
    set device_token = gen_random_uuid()
    where organization_id = _organization_id;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- Revoga de PUBLIC (senão qualquer authenticated/anon poderia resetar o
-- token de gateway de QUALQUER organização via RPC direta — a função não
-- tem checagem de papel própria, quem autoriza é a edge function que a
-- chama com service_role) e concede só a service_role explicitamente.
revoke execute on function public.superadmin_resetar_tokens_gateway(uuid) from public;
grant execute on function public.superadmin_resetar_tokens_gateway(uuid) to service_role;
