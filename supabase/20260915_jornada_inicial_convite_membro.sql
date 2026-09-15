-- Fase 3 (Jornada inicial): convite de aluno, cadastro e acolhimento.
-- CLAUDE.md seção 9, item 3: "convite, cadastro, avaliação, acolhimento —
-- um membro percorre o fluxo completo".

-- Convite de aluno (distinto do convite de staff em saas_invitations:
-- este não cria vínculo em saas_memberships, e sim um profiles novo
-- quando aceito).
create table public.member_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  invited_by_user_id uuid references auth.users(id) on delete set null,
  email text not null,
  full_name text not null,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index member_invitations_org_status_idx on public.member_invitations (organization_id, status);

-- Evita duplicar convite pendente para o mesmo e-mail na mesma organização
-- (CLAUDE.md §6: "nunca duplicar tarefa aberta").
create unique index member_invitations_pending_email_idx on public.member_invitations (organization_id, lower(email)) where status = 'pending';

alter table public.member_invitations enable row level security;

create policy "Staff manages member invitations da própria organização"
  on public.member_invitations
  for all
  using (saas_is_org_staff(organization_id))
  with check (saas_is_org_staff(organization_id));

-- O aluno hoje só consegue LER seu próprio reuniao_acolhimento (RLS já
-- criada na Fase 4). Faltam as políticas para ele registrar/atualizar a
-- própria resposta (M.A.P.A. + acolhimento).
create policy "Alunos podem registrar seu próprio reuniao_acolhimento"
  on public.reuniao_acolhimento
  for insert
  with check (auth.uid() = aluno_id);

create policy "Alunos podem atualizar seu próprio reuniao_acolhimento"
  on public.reuniao_acolhimento
  for update
  using (auth.uid() = aluno_id)
  with check (auth.uid() = aluno_id);

-- Hardening (achado ao construir esta etapa, não introduzido por ela):
-- as políticas "Users can insert own profile" e "Users can update own
-- profile" não restringem organization_id, então um usuário autenticado
-- chamando o PostgREST diretamente poderia se auto-vincular a qualquer
-- organização. Isso viola a regra não negociável do CLAUDE.md §2
-- (isolamento entre academias garantido no servidor). organization_id só
-- pode ser definido/alterado pelo fluxo de convite, que roda com a
-- service_role.
--
-- A função fica no schema private (mesmo padrão de has_role em
-- 20260914_move_has_role_to_private_schema.sql) para não aparecer como
-- SECURITY DEFINER exposta via PostgREST — o gatilho resolve por OID,
-- então isso não muda o comportamento do trigger.
create or replace function private.prevent_self_profile_org_assignment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.organization_id is not null then
      raise exception 'organization_id só pode ser definido pelo fluxo de convite.';
    end if;
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id não pode ser alterado diretamente.';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_self_org_assignment
  before insert or update on public.profiles
  for each row execute function private.prevent_self_profile_org_assignment();
