-- Portando o Feed Social do app original — com uma correção estrutural
-- importante: lá o feed era 100% global (sem coluna de tenant nenhuma,
-- RLS `USING (true)` em tudo), então qualquer usuário via qualquer
-- academia. Isso não pode ser copiado assim num sistema multitenant —
-- aqui todo post/like/comentário carrega organization_id e o RLS
-- filtra por ele. Aluno e staff podem postar (é um mural da comunidade
-- da própria academia).
create table public.feed_posts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  content         text not null default '',
  image_url       text,
  created_at      timestamptz not null default now()
);

create index idx_feed_posts_org on public.feed_posts(organization_id, created_at desc);

alter table public.feed_posts enable row level security;

create policy "membro da org vê os posts do feed"
  on public.feed_posts for select to authenticated
  using (public.is_org_member(auth.uid(), organization_id));

create policy "membro da org publica no feed"
  on public.feed_posts for insert to authenticated
  with check (user_id = auth.uid() and public.is_org_member(auth.uid(), organization_id));

create policy "autor apaga o próprio post"
  on public.feed_posts for delete to authenticated
  using (user_id = auth.uid());

create policy "staff da org apaga qualquer post"
  on public.feed_posts for delete to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create table public.feed_likes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  post_id         uuid not null references public.feed_posts(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (post_id, user_id)
);

alter table public.feed_likes enable row level security;

create policy "membro da org vê as curtidas do feed"
  on public.feed_likes for select to authenticated
  using (public.is_org_member(auth.uid(), organization_id));

create policy "membro da org gerencia as próprias curtidas"
  on public.feed_likes for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_org_member(auth.uid(), organization_id));

create table public.feed_comments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  post_id         uuid not null references public.feed_posts(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  content         text not null,
  created_at      timestamptz not null default now()
);

create index idx_feed_comments_post on public.feed_comments(post_id, created_at);

alter table public.feed_comments enable row level security;

create policy "membro da org vê os comentários do feed"
  on public.feed_comments for select to authenticated
  using (public.is_org_member(auth.uid(), organization_id));

create policy "membro da org comenta no feed"
  on public.feed_comments for insert to authenticated
  with check (user_id = auth.uid() and public.is_org_member(auth.uid(), organization_id));

create policy "autor apaga o próprio comentário"
  on public.feed_comments for delete to authenticated
  using (user_id = auth.uid());

create policy "staff da org apaga qualquer comentário"
  on public.feed_comments for delete to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

-- ---------------------------------------------------------------------
-- Nomes/avatares de autores: profiles não tem organization_id, então em
-- vez de dar SELECT amplo na tabela (vazaria nome/avatar de gente de
-- outras academias), uma RPC estreita devolve só os perfis de quem é
-- membro da MESMA organização do chamador.
-- ---------------------------------------------------------------------
create or replace function public.obter_perfis_publicos_org()
returns table (user_id uuid, full_name text, avatar_url text)
language sql
security definer
set search_path = public
stable
as $$
  select p.user_id, p.full_name, p.avatar_url
  from public.profiles p
  join public.organization_members om on om.user_id = p.user_id
  where om.status = 'active'
    and om.organization_id in (
      select om2.organization_id from public.organization_members om2
      where om2.user_id = auth.uid() and om2.status = 'active'
    );
$$;

revoke execute on function public.obter_perfis_publicos_org() from public;
grant execute on function public.obter_perfis_publicos_org() to authenticated;

-- ---------------------------------------------------------------------
-- Storage: bucket público pra fotos do feed, mesmo padrão já usado em
-- chat-videos (path prefixado por user_id; upload/delete só no próprio
-- path; leitura pública pela URL).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('feed-images', 'feed-images', true)
on conflict (id) do nothing;

create policy "usuário autenticado faz upload no próprio path de feed-images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'feed-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "leitura pública dos posts de feed-images"
  on storage.objects for select to public
  using (bucket_id = 'feed-images');

create policy "usuário remove as próprias imagens de feed-images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'feed-images' and (storage.foldername(name))[1] = auth.uid()::text);
