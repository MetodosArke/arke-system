-- Etapa A do checklist de acervo/de-para: a biblioteca de exercícios
-- era só global (curada pela ARKE, admin_arke). Agora cada academia
-- também pode ter seus próprios exercícios (tipicamente importados de
-- um sistema antigo na migração) — organization_id null = padrão
-- ArkeFit, visível a todas as organizações; organization_id preenchido
-- = específico daquela academia, gerenciado pelo próprio gestor.
alter table public.exercicios_biblioteca
  add column organization_id uuid references public.organizations(id) on delete cascade,
  add column origem text not null default 'arke_padrao' check (origem in ('arke_padrao', 'importado')),
  add column ativo boolean not null default true;

create index idx_exercicios_biblioteca_organization_id on public.exercicios_biblioteca(organization_id);

-- troca a constraint antiga (nome, grupo_muscular) por uma que
-- considera a organização — dois exercícios de mesmo nome/grupo podem
-- existir em academias diferentes (ou um específico ao lado do global).
alter table public.exercicios_biblioteca drop constraint exercicios_biblioteca_nome_grupo_muscular_key;
alter table public.exercicios_biblioteca
  add constraint exercicios_biblioteca_org_nome_grupo_key
  unique nulls not distinct (organization_id, nome, grupo_muscular);

drop policy "admin_arke gerencia a biblioteca de exercicios" on public.exercicios_biblioteca;
-- a policy antiga de leitura ("using (true)") deixaria staff de uma
-- academia ver os exercícios importados de outra — precisa ficar
-- escopada igual ao resto do multitenant.
drop policy "staff le a biblioteca de exercicios" on public.exercicios_biblioteca;

create policy "staff lê exercícios globais e da própria organização"
  on public.exercicios_biblioteca for select
  to authenticated
  using (organization_id is null or public.is_org_member((select auth.uid()), organization_id));

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
