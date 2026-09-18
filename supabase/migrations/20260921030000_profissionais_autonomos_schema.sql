-- Profissionais Autônomos: distingue organizações do tipo "academia"
-- (modelo B2B existente) do novo tipo "profissional_autonomo" (personal
-- trainer / nutricionista com carteira própria de alunos, sem estrutura
-- física de academia). O profissional autônomo vira "gestor" da própria
-- organização de 1 — reaproveita 100% do RLS e das telas de staff já
-- existentes (alunos, treinos, dietas), sem precisar de tabelas novas
-- para isso.

create type public.organization_tipo as enum ('academia', 'profissional_autonomo');

alter table public.organizations
  add column tipo public.organization_tipo not null default 'academia',
  add column especialidade_profissional public.app_role,
  add constraint especialidade_profissional_valida
    check (especialidade_profissional is null or especialidade_profissional in ('professor', 'nutricionista'));

comment on column public.organizations.especialidade_profissional is
  'Só preenchido quando tipo = profissional_autonomo: se a organização de 1 é de um personal (professor) ou nutricionista.';

-- -----------------------------------------------------------------
-- RPC: lista de profissionais autônomos para o painel do SuperAdmin
-- (mesmo padrão de get_superadmin_tenants: SECURITY DEFINER checando o
-- papel internamente, RLS de organizations continua escopado por tenant).
-- -----------------------------------------------------------------
create or replace function public.get_superadmin_profissionais_autonomos()
returns table (
  organization_id uuid,
  nome text,
  especialidade public.app_role,
  status public.org_status,
  email text,
  status_convite text,
  alunos_total bigint,
  created_at timestamptz
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
    o.especialidade_profissional as especialidade,
    o.status,
    u.email::text,
    p.status as status_convite,
    (select count(*) from public.alunos a where a.organization_id = o.id) as alunos_total,
    o.created_at
  from public.organizations o
  join public.organization_members m on m.organization_id = o.id and m.role = 'gestor'
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where o.tipo = 'profissional_autonomo'
  order by o.created_at desc;
end;
$$;

revoke execute on function public.get_superadmin_profissionais_autonomos() from public;
grant execute on function public.get_superadmin_profissionais_autonomos() to authenticated;
