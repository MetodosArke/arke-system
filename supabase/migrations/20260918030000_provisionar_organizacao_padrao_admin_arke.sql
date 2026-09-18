-- =====================================================================
-- Auto-provisionamento de organização padrão para admin_arke (Super Admin)
-- em ambientes de homologação: o papel admin_arke é global por definição
-- (não pertence a nenhuma organização), mas as telas de precificação/split
-- (/admin/organizacao) e outras telas de staff operam sobre UMA
-- organização específica. Para permitir a homologação ponta a ponta sem
-- exigir que se crie uma organização manualmente antes, esta função
-- provisiona (ou reaproveita, de forma idempotente) uma organização
-- "Academia Piloto" e vincula o admin_arke a ela como gestor.
--
-- SECURITY DEFINER com checagem explícita de has_role — só quem já é
-- admin_arke pode chamar; não é uma porta para qualquer usuário
-- autoatribuir uma organização.
-- =====================================================================

create or replace function public.provisionar_organizacao_padrao()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _org_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin_arke') then
    raise exception 'Apenas admin_arke pode provisionar a organização padrão de homologação.';
  end if;

  -- Idempotente: se já houver vínculo ativo, retorna a organização existente.
  select organization_id into _org_id
  from public.organization_members
  where user_id = auth.uid() and status = 'active'
  limit 1;

  if _org_id is not null then
    return _org_id;
  end if;

  insert into public.organizations (nome, slug)
  values ('Academia Piloto', 'academia-piloto')
  on conflict (slug) do update set nome = public.organizations.nome
  returning id into _org_id;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (_org_id, auth.uid(), 'gestor', 'active')
  on conflict (organization_id, user_id)
    do update set role = 'gestor', status = 'active';

  return _org_id;
end;
$$;

revoke execute on function public.provisionar_organizacao_padrao() from public, anon;
grant execute on function public.provisionar_organizacao_padrao() to authenticated;
