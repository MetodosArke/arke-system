-- get_superadmin_profissionais_autonomos() usava INNER JOIN em
-- organization_members (role = 'gestor'). Isso escondia silenciosamente
-- qualquer organização profissional_autonomo sem gestor vinculado — exatamente
-- o estado em que ficaram duas organizações "André Aquino" (criadas por uma
-- falha parcial em convidar-profissional-autonomo que não foi revertida por
-- completo): a Home/get_superadmin_overview e a tabela de Gestão de Tenants
-- contam direto de `organizations` e mostravam as 2, mas a aba "Profissionais"
-- ficava vazia porque o JOIN as excluía. Troca para LEFT JOIN + expõe
-- `sem_gestor` para a UI conseguir sinalizar esses casos em vez de escondê-los.
drop function if exists public.get_superadmin_profissionais_autonomos();

create or replace function public.get_superadmin_profissionais_autonomos()
returns table (
  organization_id uuid,
  nome text,
  especialidade public.app_role,
  status public.org_status,
  email text,
  status_convite text,
  alunos_total bigint,
  created_at timestamptz,
  sem_gestor boolean
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
    o.created_at,
    (m.user_id is null) as sem_gestor
  from public.organizations o
  left join public.organization_members m on m.organization_id = o.id and m.role = 'gestor' and m.status = 'active'
  left join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where o.tipo = 'profissional_autonomo'
  order by o.created_at desc;
end;
$$;

revoke execute on function public.get_superadmin_profissionais_autonomos() from public;
grant execute on function public.get_superadmin_profissionais_autonomos() to authenticated;
