-- Arke: achado de segurança na aplicação da Fase 2/3 — corrige o EXECUTE
-- concedido por padrão a PUBLIC nas funções RPC criadas em
-- 20260914_organization_rpcs.sql.
--
-- O Postgres concede EXECUTE a PUBLIC (todo mundo, incluindo os papéis
-- anon/authenticated do PostgREST) em toda função nova, por padrão.
-- create_organization_with_owner e accept_organization_invitation recebem
-- p_user_id como parâmetro em vez de derivar de auth.uid() internamente
-- (porque quem chama de verdade é o backend, com o uuid do usuário já
-- validado) — uma chamada direta via /rest/v1/rpc/... (fora do backend)
-- poderia forjar esse parâmetro e criar organizações/memberships em nome
-- de outro usuário. mcp__Supabase__get_advisors (security) pegou isso
-- ao aplicar a migração no projeto real. Devem ser exclusivas do backend
-- com service_role.

revoke execute on function public.create_organization_with_owner(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_organization_with_owner(uuid, uuid, text, text, text, text, text, text) to service_role;

revoke execute on function public.accept_organization_invitation(text, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_organization_invitation(text, uuid, text) to service_role;

-- As funções auxiliares (booleanas/leitura, criadas em
-- 20260914_core_rls_policies.sql e 20260914_super_admin_full_service_access.sql)
-- são seguras para chamada direta — só respondem sobre o próprio auth.uid()
-- do chamador, nunca vazam dado de outra organização — mas precisam
-- continuar executáveis por "authenticated", porque são usadas dentro das
-- políticas RLS (USING/WITH CHECK roda com o papel da sessão que fez a
-- consulta). Revoga de PUBLIC (o que também tira de "anon", que não tem
-- uso legítimo para elas) e concede explicitamente só a "authenticated".
revoke execute on function public.saas_is_org_member(uuid) from public;
revoke execute on function public.saas_is_org_admin(uuid) from public;
revoke execute on function public.saas_org_role(uuid) from public;
revoke execute on function public.saas_super_admin_has_access(uuid) from public;

grant execute on function public.saas_is_org_member(uuid) to authenticated;
grant execute on function public.saas_is_org_admin(uuid) to authenticated;
grant execute on function public.saas_org_role(uuid) to authenticated;
grant execute on function public.saas_super_admin_has_access(uuid) to authenticated;
