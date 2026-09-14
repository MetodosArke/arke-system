-- Fecha o achado de segurança do advisor "Public Can Execute SECURITY
-- DEFINER Function" / "Signed-In Users Can Execute SECURITY DEFINER
-- Function" para has_role(_user_id uuid, _role app_role): a função vinha
-- do schema do piloto (Arke-Supabase-Setup.sql) e ficava exposta como RPC
-- pública em /rest/v1/rpc/has_role, permitindo checar o papel de QUALQUER
-- user_id arbitrário (anon incluso) — vazamento de informação.
--
-- Revogar EXECUTE de anon/authenticated NÃO é opção aqui: há 70+ políticas
-- RLS no schema do piloto que chamam has_role(auth.uid(), ...) para o
-- papel authenticated, e Postgres exige EXECUTE do papel que roda a
-- consulta para invocar a função dentro da própria política — revogar
-- quebraria essas políticas para todo usuário autenticado real.
--
-- A correção correta (também sugerida pelo próprio advisor: "move it out
-- of your exposed API schema") é mover a função para um schema não
-- exposto pelo PostgREST. Políticas RLS resolvem a função por OID no
-- momento da criação (create policy), então continuam funcionando sem
-- qualquer alteração, qualificadas ou não no texto original — confirmado
-- via pg_depend (só há dependentes pg_policy, nenhuma view/função).
--
-- A única exceção é saas_super_admin_has_access, que chama
-- public.has_role(...) dentro do próprio corpo SQL (não é uma política:
-- funções LANGUAGE sql resolvem nomes a cada execução, não por OID fixo)
-- — por isso é recriada abaixo apontando para private.has_role.

create schema if not exists private;
grant usage on schema private to postgres, anon, authenticated, service_role;

alter function public.has_role(uuid, app_role) set schema private;

create or replace function public.saas_super_admin_has_access(_org_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select private.has_role(auth.uid(), 'super_admin')
    and exists (
      select 1 from public.saas_organizations o
      where o.id = _org_id and o.full_service_enabled
    )
$$;
