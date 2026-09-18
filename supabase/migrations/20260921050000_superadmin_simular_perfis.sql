-- Simulação de Visão de Perfil pelo SuperAdmin: lista usuários reais que
-- podem ser "simulados" (login como) para testar o frontend de cada tipo
-- de perfil (Aluno / Academia / Studio / Personal Trainer / Nutricionista).
-- Academia e Studio hoje compartilham exatamente a mesma tela no código
-- (não existe uma UI de "studio" separada) — por isso caem na mesma
-- categoria 'academia_studio' aqui; se um dia o produto ganhar uma
-- experiência própria para studios, esta função é o lugar certo para
-- separar a categoria de verdade.
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
      when m.role = 'gestor' and o.tipo = 'academia' then 'academia_studio'
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
      or (m.role = 'gestor' and o.tipo = 'academia')
      or (m.role = 'gestor' and o.tipo = 'profissional_autonomo')
    )
  order by p.full_name nulls last;
end;
$$;

revoke execute on function public.get_superadmin_perfis_simulaveis() from public;
grant execute on function public.get_superadmin_perfis_simulaveis() to authenticated;
