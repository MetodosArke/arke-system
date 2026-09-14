-- Fase 4 (Entrega profissional, CLAUDE.md §9): antes de qualquer tela de
-- profissional/aluno, a identidade precisa ter uma única fonte de verdade
-- de organização. Hoje existem três modelos desconectados (ModuleKey do
-- login, saas_memberships.role, e o papel "professor" do piloto); este
-- arquivo fecha a base disso no schema do piloto.
--
-- 1) Remove academia_id/academias (Fase 4 do plano de migração Supabase
--    já acordado antes, comentado em 20260914_core_schema_target.sql:
--    "backfill de organization_id a partir de academia_id" + "remoção de
--    academias/academia_id"). Confirmado com o cliente que não há dado
--    real de academia em produção (academias e saas_organizations com
--    0 linhas) — o backfill é desnecessário, dá para ir direto ao corte.
--    organization_id (saas_organizations) fica como única fonte de
--    verdade de tenant a partir daqui.
--
-- 2) Corrige um achado de segurança: as políticas RLS do papel "professor"
--    (piloto arke-app) davam acesso de leitura/escrita a TODOS os alunos
--    do banco, de qualquer organização — has_role(auth.uid(),'professor')
--    sem nenhum filtro por tenant. Isso contraria diretamente a regra não
--    negociável do CLAUDE.md §2 (isolamento entre academias) assim que
--    mais de uma organização existir. Substituídas por políticas
--    escopadas por organization_id, reaproveitando o mesmo padrão
--    saas_is_org_member/saas_org_role já validado na Fase 1.

alter table public.profiles drop column if exists academia_id;
alter table public.treinos drop column if exists academia_id;
drop table if exists public.academias;

create or replace function public.saas_is_org_staff(_org_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select public.saas_org_role(_org_id) in ('owner', 'admin', 'manager', 'professional')
$$;

drop policy if exists "Professor reads treinos" on public.treinos;
create policy "Staff reads treinos da própria organização"
  on public.treinos for select
  to authenticated
  using (organization_id is not null and public.saas_is_org_staff(organization_id));

drop policy if exists "Professor reads treino_exercicios" on public.treino_exercicios;
create policy "Staff reads treino_exercicios da própria organização"
  on public.treino_exercicios for select
  to authenticated
  using (exists (
    select 1 from public.treinos t
    where t.id = treino_exercicios.treino_id
      and t.organization_id is not null
      and public.saas_is_org_staff(t.organization_id)
  ));

drop policy if exists "Professor manages registro_treino" on public.registro_treino;
create policy "Staff manages registro_treino da própria organização"
  on public.registro_treino for all
  to authenticated
  using (exists (
    select 1 from public.treinos t
    where t.id = registro_treino.treino_id
      and t.organization_id is not null
      and public.saas_is_org_staff(t.organization_id)
  ));

drop policy if exists "Professor manages registro_serie" on public.registro_serie;
create policy "Staff manages registro_serie da própria organização"
  on public.registro_serie for all
  to authenticated
  using (exists (
    select 1 from public.registro_treino rt
    join public.treinos t on t.id = rt.treino_id
    where rt.id = registro_serie.registro_treino_id
      and t.organization_id is not null
      and public.saas_is_org_staff(t.organization_id)
  ));

drop policy if exists "Professor reads profiles" on public.profiles;
create policy "Staff reads profiles da própria organização"
  on public.profiles for select
  to authenticated
  using (organization_id is not null and public.saas_is_org_staff(organization_id));

drop policy if exists "Professors can read reuniao_acolhimento" on public.reuniao_acolhimento;
create policy "Staff reads reuniao_acolhimento da própria organização"
  on public.reuniao_acolhimento for select
  to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.user_id = reuniao_acolhimento.aluno_id
      and p.organization_id is not null
      and public.saas_is_org_staff(p.organization_id)
  ));
