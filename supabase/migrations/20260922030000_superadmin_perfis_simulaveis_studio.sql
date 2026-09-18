-- Agora que "studio" é um tipo de organização real e distinto (com
-- turmas/agendamentos próprios), separa a categoria de simulação do
-- SuperAdmin: "academia" e "studio" deixam de compartilhar a mesma
-- categoria "academia_studio" — cada uma aponta para gestores reais do
-- respectivo tipo.
create or replace function public.get_superadmin_perfis_simulaveis()
returns table (
  user_id           uuid,
  full_name         text,
  email             text,
  organizacao_nome  text,
  categoria         text
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
    m.user_id,
    p.full_name,
    u.email::text,
    o.nome as organizacao_nome,
    case
      when m.role = 'aluno' then 'aluno'
      when m.role = 'gestor' and o.tipo = 'academia' then 'academia'
      when m.role = 'gestor' and o.tipo = 'studio' then 'studio'
      when m.role = 'gestor' and o.tipo = 'profissional_autonomo' and o.especialidade_profissional = 'professor' then 'personal'
      when m.role = 'gestor' and o.tipo = 'profissional_autonomo' and o.especialidade_profissional = 'nutricionista' then 'nutricionista'
      else null
    end as categoria
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where m.status = 'active'
    and (
      m.role = 'aluno'
      or (m.role = 'gestor' and o.tipo in ('academia', 'studio', 'profissional_autonomo'))
    )
  order by p.full_name nulls last;
end;
$$;
