-- O catálogo global "Padrão ArkeFit" (exercicios_biblioteca com
-- organization_id nulo) deixa de ser gerenciável por admin_arke e passa a
-- ser exclusivo do papel 'superadmin' — o dono da plataforma. Gestão por
-- organização (gestor/professor da própria academia) continua igual.
drop policy "admin_arke/gestor/professor gerencia biblioteca de exercícios" on public.exercicios_biblioteca;

create policy "superadmin gerencia biblioteca global"
  on public.exercicios_biblioteca for all
  using (organization_id is null and has_role((select auth.uid()), 'superadmin'::app_role))
  with check (organization_id is null and has_role((select auth.uid()), 'superadmin'::app_role));

create policy "gestor/professor gerencia biblioteca da própria organização"
  on public.exercicios_biblioteca for all
  using (
    organization_id is not null
    and (
      has_org_role((select auth.uid()), organization_id, 'gestor'::app_role)
      or has_org_role((select auth.uid()), organization_id, 'professor'::app_role)
      or has_role((select auth.uid()), 'admin_arke'::app_role)
    )
  )
  with check (
    organization_id is not null
    and (
      has_org_role((select auth.uid()), organization_id, 'gestor'::app_role)
      or has_org_role((select auth.uid()), organization_id, 'professor'::app_role)
      or has_role((select auth.uid()), 'admin_arke'::app_role)
    )
  );
