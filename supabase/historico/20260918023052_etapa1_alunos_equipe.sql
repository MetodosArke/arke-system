-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

alter table public.profiles add column cpf text;

create policy "staff da organização vê perfis de membros da própria organização"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1 from public.organization_members them
      where them.user_id = profiles.user_id
        and them.status = 'active'
        and (public.is_org_staff(auth.uid(), them.organization_id) or public.has_role(auth.uid(), 'admin_arke'))
    )
  );
