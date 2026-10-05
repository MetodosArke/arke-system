-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'remetente_mentor') then
    create type public.remetente_mentor as enum ('aluno', 'mentor');
  end if;
end $$;

create table if not exists public.mensagens_mentor (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  remetente_id uuid not null references auth.users(id) on delete cascade,
  remetente_tipo public.remetente_mentor not null,
  mensagem text not null check (length(btrim(mensagem)) between 1 and 4000),
  lida boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_mensagens_mentor_aluno on public.mensagens_mentor (aluno_id, created_at desc);
create index if not exists idx_mensagens_mentor_nao_lidas on public.mensagens_mentor (lida, created_at desc) where not lida;
create index if not exists idx_mensagens_mentor_org on public.mensagens_mentor (organization_id);

alter table public.mensagens_mentor enable row level security;

create policy "leitura" on public.mensagens_mentor for select to authenticated
using (
  exists (select 1 from public.alunos a
           where a.id = mensagens_mentor.aluno_id and a.user_id = (select auth.uid()))
  or public.has_role((select auth.uid()), 'admin_arke')
  or public.has_role((select auth.uid()), 'superadmin')
);

create policy "inclusão" on public.mensagens_mentor for insert to authenticated
with check (
  remetente_id = (select auth.uid())
  and (
    (remetente_tipo = 'aluno'
      and exists (select 1 from public.alunos a
                   where a.id = mensagens_mentor.aluno_id and a.user_id = (select auth.uid())))
    or (remetente_tipo = 'mentor'
      and (public.has_role((select auth.uid()), 'admin_arke')
        or public.has_role((select auth.uid()), 'superadmin')))
  )
);

create policy "alteração" on public.mensagens_mentor for update to authenticated
using (
  exists (select 1 from public.alunos a
           where a.id = mensagens_mentor.aluno_id and a.user_id = (select auth.uid()))
  or public.has_role((select auth.uid()), 'admin_arke')
  or public.has_role((select auth.uid()), 'superadmin')
)
with check (
  exists (select 1 from public.alunos a
           where a.id = mensagens_mentor.aluno_id and a.user_id = (select auth.uid()))
  or public.has_role((select auth.uid()), 'admin_arke')
  or public.has_role((select auth.uid()), 'superadmin')
);

create or replace function public.proteger_conteudo_mensagem_mentor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.mensagem is distinct from old.mensagem
     or new.remetente_id is distinct from old.remetente_id
     or new.remetente_tipo is distinct from old.remetente_tipo
     or new.aluno_id is distinct from old.aluno_id then
    raise exception 'Mensagem do mentor não pode ser editada; só a marca de lida muda.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.proteger_conteudo_mensagem_mentor() from public, anon, authenticated;

drop trigger if exists trg_proteger_conteudo_mensagem_mentor on public.mensagens_mentor;
create trigger trg_proteger_conteudo_mensagem_mentor
  before update on public.mensagens_mentor
  for each row execute function public.proteger_conteudo_mensagem_mentor();

comment on table public.mensagens_mentor is
  'Chat do aluno do Método ARKE com o mentor da ArkeFit. A academia NÃO lê este canal — é o que permite ao aluno falar do que não contaria à equipe local.';
