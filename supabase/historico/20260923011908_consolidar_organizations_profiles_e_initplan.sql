-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

drop policy if exists "admin_arke gerencia organizações" on public.organizations;
drop policy if exists "membros/admin_arke vê organização" on public.organizations;
drop policy if exists "gestor/superadmin atualiza organização" on public.organizations;

create policy "leitura" on public.organizations for select to authenticated
using (
  public.has_role((select auth.uid()), 'admin_arke')
  or public.is_org_member((select auth.uid()), id)
);

create policy "inclusão" on public.organizations for insert to authenticated
with check (public.has_role((select auth.uid()), 'admin_arke'));

create policy "alteração" on public.organizations for update to authenticated
using (
  public.has_role((select auth.uid()), 'admin_arke')
  or public.has_role((select auth.uid()), 'superadmin')
  or public.has_org_role((select auth.uid()), id, 'gestor')
)
with check (
  public.has_role((select auth.uid()), 'admin_arke')
  or public.has_role((select auth.uid()), 'superadmin')
  or public.has_org_role((select auth.uid()), id, 'gestor')
);

create policy "exclusão" on public.organizations for delete to authenticated
using (public.has_role((select auth.uid()), 'admin_arke'));

drop policy if exists "usuário gerencia o próprio perfil" on public.profiles;
drop policy if exists "staff/admin_arke vê perfis de membros" on public.profiles;

create policy "leitura" on public.profiles for select to authenticated
using (
  user_id = (select auth.uid())
  or public.has_role((select auth.uid()), 'admin_arke')
  or exists (
    select 1 from public.organization_members them
     where them.user_id = profiles.user_id
       and them.status = 'active'
       and (public.is_org_staff((select auth.uid()), them.organization_id)
            or public.has_role((select auth.uid()), 'admin_arke'))
  )
);

create policy "inclusão" on public.profiles for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "alteração" on public.profiles for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "exclusão" on public.profiles for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "ArkeFit lê as reconciliações" on public.reconciliacoes_asaas;
create policy "leitura" on public.reconciliacoes_asaas for select to authenticated
using (
  public.has_role((select auth.uid()), 'admin_arke')
  or public.has_role((select auth.uid()), 'superadmin')
);

create index if not exists idx_mensagens_mentor_remetente on public.mensagens_mentor (remetente_id);
create index if not exists idx_aceites_documentos_user on public.aceites_documentos (user_id);
create index if not exists idx_aluno_parq_org on public.aluno_parq (organization_id);
create index if not exists idx_aluno_parq_registrado_por on public.aluno_parq (atestado_registrado_por);
create index if not exists idx_alunos_situacao_por on public.alunos (situacao_academia_por);
create index if not exists idx_comunicados_criado_por on public.comunicados (criado_por);
create index if not exists idx_comunicados_lidos_org on public.comunicados_lidos (organization_id);
create index if not exists idx_comunicados_lidos_user on public.comunicados_lidos (user_id);
create index if not exists idx_contratos_matricula_criado_por on public.contratos_matricula (criado_por);
create index if not exists idx_leads_criado_por on public.leads (criado_por);
create index if not exists idx_leads_responsavel on public.leads (responsavel_id);
create index if not exists idx_plataforma_textos_updated_by on public.plataforma_textos (updated_by);
create index if not exists idx_aluno_assinaturas_contrato_org on public.aluno_assinaturas_contrato (organization_id);
create index if not exists idx_aluno_assinaturas_contrato_contrato on public.aluno_assinaturas_contrato (contrato_id);
