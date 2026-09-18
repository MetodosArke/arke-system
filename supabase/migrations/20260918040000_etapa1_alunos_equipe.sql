-- =====================================================================
-- ETAPA 1 — Módulo do Gestor B2B & Gestão de Equipe
-- =====================================================================

-- Telefone já existia em profiles; CPF é o campo que faltava para o
-- cadastro de aluno (Nome, E-mail, Telefone, CPF, Plano).
alter table public.profiles add column cpf text;

-- Antes só existiam policies de SELECT em `profiles` para o próprio
-- usuário ou para admin_arke (todos os perfis). Sem uma policy para o
-- staff da organização, a tela de Alunos/Equipe do gestor não conseguia
-- resolver full_name/telefone/cpf de ninguém além de si mesmo — a query
-- `select ... from profiles where user_id in (...)` voltava vazia por RLS.
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

-- =====================================================================
-- Achado durante a validação funcional acima: NENHUM trigger cria a linha
-- de `profiles` ao registrar um usuário no Supabase Auth — nem no
-- self-signup (/auth/register) nem em usuários criados manualmente. Isso
-- deixava `profile` sempre nulo no AuthContext para qualquer conta que
-- nunca teve a linha inserida à mão, e o cadastro de aluno/equipe desta
-- etapa depende de `profiles` existir de forma confiável para gravar
-- nome/telefone/cpf. Corrigido com o trigger padrão do Supabase.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Postgres concede EXECUTE a PUBLIC por padrão em funções novas — esta só
-- deve rodar como trigger (depende do registro `new`), nunca via RPC direto.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Backfill: cria a linha de profiles para usuários já existentes que
-- nunca tiveram uma (ex.: as contas admin_arke usadas nos testes desta
-- sessão).
insert into public.profiles (user_id, full_name)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', '')
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null;
