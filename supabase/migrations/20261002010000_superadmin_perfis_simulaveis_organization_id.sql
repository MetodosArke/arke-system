-- impersonar-perfil localizava o vínculo ativo do usuário-alvo só por
-- user_id (.eq("status","active").maybeSingle()) — quebra com um erro
-- genérico assim que a mesma pessoa tem mais de um vínculo ativo (ex.:
-- aluno numa organização e gestor em outra, cenário já possível desde que
-- uma conta existente pode ser vinculada como gestor de uma organização
-- nova). get_superadmin_perfis_simulaveis() não devolvia organization_id,
-- então o picker do SuperAdmin não tinha como desambiguar qual vínculo
-- simular — precisa devolver para a Edge Function filtrar por
-- (organization_id, user_id), que é a chave única real da tabela.
drop function if exists public.get_superadmin_perfis_simulaveis();

create or replace function public.get_superadmin_perfis_simulaveis()
returns table (
  user_id           uuid,
  organization_id   uuid,
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
    m.organization_id,
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
