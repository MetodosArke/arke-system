-- Teste hostil de isolamento multi-tenant (org A vs org B) encontrou um
-- gap real: treinos/dietas/profiles/treino_exercicios/reuniao_acolhimento
-- ainda usam o padrão antigo do piloto arke-app (private.has_role(...,
-- 'admin'/'super_admin')) sem nenhum gate por organização, enquanto o
-- resto do modelo SaaS multi-tenant (saas_organizations, saas_units etc.)
-- já usa saas_super_admin_has_access(_org_id), que só libera acesso de
-- super_admin a uma organização com full_service_enabled = true (CLAUDE.md
-- §2: "Acesso a dados individuais só quando necessário/autorizado").
-- Resultado: um usuário com user_roles.role IN ('admin','super_admin')
-- tinha leitura/escrita irrestrita a treino/dieta/perfil/acolhimento de
-- QUALQUER organização, mesmo sem full_service_enabled. Não é o cenário
-- "organização A lê organização B" (isso já falhava corretamente em todos
-- os testes), mas é uma inconsistência real no mesmo princípio de
-- isolamento. Corrigido: para linhas com organization_id preenchido
-- (modelo SaaS), o bypass de admin/super_admin passa a exigir
-- saas_super_admin_has_access(organization_id); para linhas legadas do
-- piloto arke-app (organization_id nulo, sem conceito de organização),
-- o bypass antigo é mantido sem alteração de comportamento.

drop policy if exists "Admin manages treinos" on public.treinos;
create policy "Admin manages treinos" on public.treinos for all to authenticated
  using (
    (organization_id is null and (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin')))
    or (organization_id is not null and public.saas_super_admin_has_access(organization_id))
  );

drop policy if exists "Aluno reads own treinos" on public.treinos;
create policy "Aluno reads own treinos" on public.treinos for select to authenticated
  using (
    (aluno_id = auth.uid() and estado_publicacao = 'publicado')
    or (organization_id is null and (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin')))
    or (organization_id is not null and public.saas_super_admin_has_access(organization_id))
  );

drop policy if exists "Admin manages dietas" on public.dietas;
create policy "Admin manages dietas" on public.dietas for all to authenticated
  using (
    (organization_id is null and (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin')))
    or (organization_id is not null and public.saas_super_admin_has_access(organization_id))
  );

drop policy if exists "Aluno reads own dietas" on public.dietas;
create policy "Aluno reads own dietas" on public.dietas for select to authenticated
  using (
    (aluno_id = auth.uid() and estado_publicacao = 'publicado')
    or (organization_id is null and (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin')))
    or (organization_id is not null and public.saas_super_admin_has_access(organization_id))
  );

drop policy if exists "Admins can delete profiles" on public.profiles;
create policy "Admins can delete profiles" on public.profiles for delete to authenticated
  using (
    (organization_id is null and (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin')))
    or (organization_id is not null and public.saas_super_admin_has_access(organization_id))
  );

drop policy if exists "Admins update profiles" on public.profiles;
create policy "Admins update profiles" on public.profiles for update to authenticated
  using (
    (organization_id is null and (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin')))
    or (organization_id is not null and public.saas_super_admin_has_access(organization_id))
  )
  with check (
    (organization_id is null and (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin')))
    or (organization_id is not null and public.saas_super_admin_has_access(organization_id))
  );

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles for select to authenticated
  using (
    (user_id = auth.uid())
    or (organization_id is null and (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin')))
    or (organization_id is not null and public.saas_super_admin_has_access(organization_id))
  );

drop policy if exists "Admins full access on reuniao_acolhimento" on public.reuniao_acolhimento;
create policy "Admins full access on reuniao_acolhimento" on public.reuniao_acolhimento for all to authenticated
  using (
    exists (
      select 1 from public.profiles p where p.user_id = reuniao_acolhimento.aluno_id and (
        (p.organization_id is null and (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin')))
        or (p.organization_id is not null and public.saas_super_admin_has_access(p.organization_id))
      )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p where p.user_id = reuniao_acolhimento.aluno_id and (
        (p.organization_id is null and (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin')))
        or (p.organization_id is not null and public.saas_super_admin_has_access(p.organization_id))
      )
    )
  );

drop policy if exists "Admin manages treino_exercicios" on public.treino_exercicios;
create policy "Admin manages treino_exercicios" on public.treino_exercicios for all to authenticated
  using (
    exists (
      select 1 from public.treinos t where t.id = treino_exercicios.treino_id and (
        (t.organization_id is null and (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin')))
        or (t.organization_id is not null and public.saas_super_admin_has_access(t.organization_id))
      )
    )
  );

drop policy if exists "Read treino_exercicios" on public.treino_exercicios;
create policy "Read treino_exercicios" on public.treino_exercicios for select to authenticated
  using (
    exists (
      select 1 from public.treinos t where t.id = treino_exercicios.treino_id and (
        t.aluno_id = auth.uid()
        or (t.organization_id is null and (private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'super_admin')))
        or (t.organization_id is not null and public.saas_super_admin_has_access(t.organization_id))
      )
    )
  );
