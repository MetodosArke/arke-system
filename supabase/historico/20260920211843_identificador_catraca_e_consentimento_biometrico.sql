-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

alter table public.alunos
  add column if not exists identificador_catraca text;

comment on column public.alunos.identificador_catraca is
  'Número/ID do usuário dentro da catraca física (ex.: user_id do Control iD). Preenchido no cadastro da biometria. Nulo para aluno sem acesso por catraca.';

create unique index if not exists idx_alunos_identificador_catraca_por_org
  on public.alunos (organization_id, identificador_catraca)
  where identificador_catraca is not null;

create table if not exists public.aluno_consentimento_biometrico (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  aluno_id              uuid not null references public.alunos(id) on delete cascade,
  aceito_em             timestamptz not null default now(),
  finalidade            text not null default 'Controle de acesso e frequência na academia',
  retencao_descricao    text not null default 'Durante a vigência da matrícula e pelo prazo legal de prescrição',
  template_no_servidor  boolean not null default false,
  revogado_em           timestamptz,
  revogado_por          uuid,
  excluido_do_equipamento_em timestamptz,
  created_at            timestamptz not null default now()
);

create unique index if not exists idx_consentimento_biometrico_aluno_vigente
  on public.aluno_consentimento_biometrico (aluno_id)
  where revogado_em is null;

create index if not exists idx_consentimento_biometrico_org
  on public.aluno_consentimento_biometrico (organization_id, aceito_em desc);

alter table public.aluno_consentimento_biometrico enable row level security;

drop policy if exists "staff da org gerencia consentimento biométrico dos seus alunos" on public.aluno_consentimento_biometrico;
create policy "staff da org gerencia consentimento biométrico dos seus alunos"
  on public.aluno_consentimento_biometrico for all to authenticated
  using (
    public.is_org_staff(( select auth.uid() ), organization_id)
    or public.has_role(( select auth.uid() ), 'admin_arke')
    or public.has_role(( select auth.uid() ), 'superadmin')
  )
  with check (
    public.is_org_staff(( select auth.uid() ), organization_id)
    or public.has_role(( select auth.uid() ), 'admin_arke')
    or public.has_role(( select auth.uid() ), 'superadmin')
  );

drop policy if exists "aluno vê o próprio consentimento biométrico" on public.aluno_consentimento_biometrico;
create policy "aluno vê o próprio consentimento biométrico"
  on public.aluno_consentimento_biometrico for select to authenticated
  using (
    exists (
      select 1 from public.alunos a
       where a.id = aluno_consentimento_biometrico.aluno_id
         and a.user_id = ( select auth.uid() )
    )
  );

create or replace function public.revogar_consentimento_biometrico(_aluno_id uuid)
returns table (identificador_catraca text, organization_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_identificador text;
begin
  select a.organization_id, a.identificador_catraca
    into v_org, v_identificador
    from public.alunos a where a.id = _aluno_id;

  if v_org is null then
    raise exception 'Aluno não encontrado.';
  end if;

  if not (public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')
          or public.is_org_staff(auth.uid(), v_org)
          or exists (select 1 from public.alunos a
                      where a.id = _aluno_id and a.user_id = auth.uid())) then
    raise exception 'Só a equipe da academia, a ArkeFit ou o próprio aluno podem revogar o consentimento biométrico.';
  end if;

  update public.aluno_consentimento_biometrico c
     set revogado_em = now(), revogado_por = auth.uid()
   where c.aluno_id = _aluno_id and c.revogado_em is null;

  update public.alunos a
     set identificador_catraca = null
   where a.id = _aluno_id;

  return query select v_identificador, v_org;
end; $$;

revoke all on function public.revogar_consentimento_biometrico(uuid) from public, anon;
grant execute on function public.revogar_consentimento_biometrico(uuid) to authenticated;
