-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

alter table public.exercicios_biblioteca
  add column organization_id uuid references public.organizations(id) on delete cascade,
  add column origem text not null default 'arke_padrao' check (origem in ('arke_padrao', 'importado')),
  add column ativo boolean not null default true;

create index idx_exercicios_biblioteca_organization_id on public.exercicios_biblioteca(organization_id);

alter table public.exercicios_biblioteca drop constraint exercicios_biblioteca_nome_grupo_muscular_key;
alter table public.exercicios_biblioteca
  add constraint exercicios_biblioteca_org_nome_grupo_key
  unique nulls not distinct (organization_id, nome, grupo_muscular);

drop policy "admin_arke gerencia a biblioteca de exercicios" on public.exercicios_biblioteca;

create policy "admin_arke gerencia biblioteca global"
  on public.exercicios_biblioteca for all
  to authenticated
  using (organization_id is null and public.has_role((select auth.uid()), 'admin_arke'))
  with check (organization_id is null and public.has_role((select auth.uid()), 'admin_arke'));

create policy "staff gerencia a biblioteca da própria organização"
  on public.exercicios_biblioteca for all
  to authenticated
  using (organization_id is not null and public.is_org_staff((select auth.uid()), organization_id))
  with check (organization_id is not null and public.is_org_staff((select auth.uid()), organization_id));
