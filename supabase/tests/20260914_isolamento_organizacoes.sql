-- Teste de isolamento entre organizações — critério de aceite #1 do MVP
-- (CLAUDE.md, seção 10: "uma academia não acessa dados de outra").
--
-- Como rodar: SQL Editor do Supabase (como postgres/owner), DEPOIS de
-- aplicar, nesta ordem: Arke-Supabase-Setup.sql, 20260912_portal_unified.sql,
-- 20260914_core_schema_target.sql, 20260914_core_rls_policies.sql,
-- 20260914_super_admin_full_service_access.sql.
--
-- Cobre também a regra comercial de que super_admin (Administrador Arke)
-- só acessa os dados de uma organização quando ela contratou o serviço
-- completo (full_service_enabled = true).
--
-- O teste roda inteiro dentro de uma transação com ROLLBACK no final: não
-- deixa nenhum dado no banco e pode ser executado quantas vezes for
-- necessário. Se algo falhar, o script aborta com "FALHA: ..."; se
-- terminar sem erro, o isolamento está funcionando.

begin;

-- IDs fixos só para este teste (não usar em produção)
--   usuário A: 00000000-0000-0000-0000-00000000a001 / organização A: ...a0001
--   usuário B: 00000000-0000-0000-0000-00000000b001 / organização B: ...b0001

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'teste-isolamento-a@arkefit.com.br', '', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'teste-isolamento-b@arkefit.com.br', '', now(), now(), now());

insert into public.saas_organizations (id, name, slug, module, plan, status)
values
  ('00000000-0000-0000-0000-0000000a0001', 'Academia Teste A', 'academia-teste-a-isolamento', 'academia', 'starter', 'active'),
  ('00000000-0000-0000-0000-0000000b0001', 'Academia Teste B', 'academia-teste-b-isolamento', 'academia', 'starter', 'active');

insert into public.saas_memberships (organization_id, auth_user_id, role, status)
values
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000a001', 'owner', 'active'),
  ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-00000000b001', 'owner', 'active');

insert into public.saas_audit_logs (organization_id, auth_user_id, action, entity)
values
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000a001', 'teste', 'organization'),
  ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-00000000b001', 'teste', 'organization');

-- ---------------------------------------------------------------------
-- Simula a sessão autenticada do usuário A e checa o que ele enxerga
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000a001';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}';

do $$
declare
  visible_orgs int;
  leaked boolean;
begin
  select count(*) into visible_orgs from public.saas_organizations;
  if visible_orgs <> 1 then
    raise exception 'FALHA: usuário A deveria ver exatamente 1 organização (a própria), viu %', visible_orgs;
  end if;

  select exists(select 1 from public.saas_organizations where id = '00000000-0000-0000-0000-0000000b0001') into leaked;
  if leaked then raise exception 'FALHA: usuário A conseguiu ver a organização B em saas_organizations'; end if;

  select exists(select 1 from public.saas_memberships where organization_id = '00000000-0000-0000-0000-0000000b0001') into leaked;
  if leaked then raise exception 'FALHA: usuário A conseguiu ver memberships da organização B'; end if;

  select exists(select 1 from public.saas_audit_logs where organization_id = '00000000-0000-0000-0000-0000000b0001') into leaked;
  if leaked then raise exception 'FALHA: usuário A conseguiu ver auditoria da organização B'; end if;

  raise notice 'OK: usuário A não enxerga nenhum dado da organização B.';
end $$;

-- ---------------------------------------------------------------------
-- Volta para superusuário e simula a sessão do usuário B, checando o
-- sentido inverso (B não pode ver nada de A)
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000b001';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b001","role":"authenticated"}';

do $$
declare leaked boolean;
begin
  select exists(select 1 from public.saas_organizations where id = '00000000-0000-0000-0000-0000000a0001') into leaked;
  if leaked then raise exception 'FALHA: usuário B conseguiu ver a organização A em saas_organizations'; end if;

  select exists(select 1 from public.saas_memberships where organization_id = '00000000-0000-0000-0000-0000000a0001') into leaked;
  if leaked then raise exception 'FALHA: usuário B conseguiu ver memberships da organização A'; end if;

  select exists(select 1 from public.saas_audit_logs where organization_id = '00000000-0000-0000-0000-0000000a0001') into leaked;
  if leaked then raise exception 'FALHA: usuário B conseguiu ver auditoria da organização A'; end if;

  raise notice 'OK: usuário B não enxerga nenhum dado da organização A.';
end $$;

-- ---------------------------------------------------------------------
-- Usuário A (owner da organização A) não pode escrever na organização B
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000a001';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}';

do $$
begin
  begin
    update public.saas_organizations set name = 'Invadida' where id = '00000000-0000-0000-0000-0000000b0001';
    if found then
      raise exception 'FALHA: usuário A conseguiu atualizar a organização B';
    end if;
  exception when insufficient_privilege then
    null; -- esperado: RLS bloqueou antes mesmo de tentar
  end;
  raise notice 'OK: usuário A não conseguiu escrever na organização B.';
end $$;

-- ---------------------------------------------------------------------
-- super_admin (Administrador Arke) sem serviço completo contratado por
-- nenhuma das duas organizações: não deve enxergar nenhuma delas
-- (supabase/20260914_super_admin_full_service_access.sql)
-- ---------------------------------------------------------------------
reset role;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'teste-isolamento-super@arkefit.com.br', '', now(), now(), now());

insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000c001', 'super_admin');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000c001';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}';

do $$
declare visible_orgs int;
begin
  select count(*) into visible_orgs from public.saas_organizations;
  if visible_orgs <> 0 then
    raise exception 'FALHA: super_admin sem serviço completo contratado não deveria ver nenhuma organização, viu %', visible_orgs;
  end if;
  raise notice 'OK: super_admin sem serviço completo contratado não vê nenhuma organização.';
end $$;

-- ---------------------------------------------------------------------
-- Organização A contrata o serviço completo: super_admin passa a
-- enxergar A, mas continua sem acesso a B
-- ---------------------------------------------------------------------
reset role;
update public.saas_organizations set full_service_enabled = true where id = '00000000-0000-0000-0000-0000000a0001';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000c001';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}';

do $$
declare visible_orgs int; leaked boolean;
begin
  select count(*) into visible_orgs from public.saas_organizations;
  if visible_orgs <> 1 then
    raise exception 'FALHA: super_admin deveria ver exatamente 1 organização (A, com serviço completo ativo), viu %', visible_orgs;
  end if;

  select exists(select 1 from public.saas_organizations where id = '00000000-0000-0000-0000-0000000a0001') into leaked;
  if not leaked then raise exception 'FALHA: super_admin deveria enxergar a organização A, que tem serviço completo ativo'; end if;

  select exists(select 1 from public.saas_organizations where id = '00000000-0000-0000-0000-0000000b0001') into leaked;
  if leaked then raise exception 'FALHA: super_admin viu a organização B, que não contratou o serviço completo'; end if;

  raise notice 'OK: super_admin só enxerga a organização que contratou o serviço completo.';
end $$;

reset role;

rollback;
