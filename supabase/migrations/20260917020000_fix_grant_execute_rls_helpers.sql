-- =====================================================================
-- CORREÇÃO: as funções de apoio ao RLS (has_role, is_org_member,
-- has_org_role, is_org_staff) são chamadas de dentro de USING/WITH CHECK
-- das policies. A role `authenticated` (usada pelo PostgREST) PRECISA de
-- EXECUTE nelas — do contrário toda policy que as usa falha com
-- "permission denied for function" para qualquer usuário autenticado.
--
-- O hardening da Fase 1 revogou EXECUTE de `anon`/`authenticated` para
-- evitar a chamada direta via /rest/v1/rpc/<funcao>, mas isso quebrou o
-- uso legítimo dentro das próprias policies. Mantemos `anon` e `PUBLIC`
-- revogados (nenhuma policy é declarada `to anon`) e restauramos apenas
-- para `authenticated`.
-- =====================================================================

grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_org_member(uuid, uuid) to authenticated;
grant execute on function public.has_org_role(uuid, uuid, public.app_role) to authenticated;
grant execute on function public.is_org_staff(uuid, uuid) to authenticated;

-- `gerar_tarefas_ativacao_pendente` permanece bloqueada para anon/authenticated:
-- ela não é usada dentro de nenhuma policy, só é executada pelo pg_cron.
