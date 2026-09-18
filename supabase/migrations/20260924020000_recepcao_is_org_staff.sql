-- Recepção passa a contar como staff da organização para efeitos de RLS
-- (mesmo tratamento de gestor/professor/nutricionista) — sem isso, o
-- papel existiria no enum mas ninguém com ele conseguiria de fato
-- trabalhar em nenhuma tela (alunos, treinos, dietas, tarefas etc.).
create or replace function public.is_org_staff(_user_id uuid, _organization_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where user_id = _user_id
      and organization_id = _organization_id
      and role in ('gestor', 'professor', 'nutricionista', 'recepcao')
      and status = 'active'
  )
$$;
