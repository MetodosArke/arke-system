-- Fase 8 (Gestão: prazos, capacidade, indicadores).
--
-- Achado ao construir esta etapa (bug, não introduzido por ela): a
-- migração de versionamento (20260914_treino_dieta_versionamento.sql)
-- adicionou organization_id só em `treinos`, não em `dietas` — mas
-- server/supabaseAdmin.ts's createDieta já envia organization_id no
-- corpo do INSERT desde a Fase 4 (telas de profissional e aluno), o
-- que faz a mutação real "criar plano alimentar" falhar hoje em
-- produção (PostgREST rejeita coluna inexistente). dieta_revisoes já
-- tinha essa coluna (criada do zero na mesma migração), só dietas
-- ficou de fora. Corrigido aqui porque os indicadores de entrega desta
-- fase (Fase 8) também precisam filtrar dietas por organização.
alter table public.dietas
  add column if not exists organization_id uuid references public.saas_organizations(id) on delete set null;

create index if not exists idx_dietas_organization on public.dietas (organization_id);

-- Também faltava a política de leitura por staff (treinos já tinha o
-- equivalente desde a Fase 4) — sem ela, hoje só admin/super_admin ou
-- o próprio aluno conseguem ler uma dieta via RLS.
create policy "Staff reads dietas da própria organização"
  on public.dietas for select
  using (organization_id is not null and saas_is_org_staff(organization_id));
