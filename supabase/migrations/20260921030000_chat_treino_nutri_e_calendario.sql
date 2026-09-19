-- Portando do app original: chat aluno<->treinador, chat aluno<->nutricionista
-- (por dieta ativa, com vídeo no chat treino) e o diário/calendário pessoal
-- de atividade do aluno. Chat é conteúdo do produto Método ARKE — gate por
-- metodo_arke_status fica no frontend (RLS aqui só garante isolamento por
-- tenant e que cada aluno só mexe na própria thread).

create type public.remetente_tipo_treino as enum ('aluno', 'treinador');
create type public.remetente_tipo_dieta as enum ('aluno', 'nutricionista');

-- ---------------------------------------------------------------------
-- push_subscriptions: tabela de nível de usuário (não por tenant, igual
-- profiles/user_roles) — cada endpoint de push é do usuário, não da org.
-- ---------------------------------------------------------------------
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

create policy "usuário gerencia as próprias push subscriptions"
  on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- treino_calendario: diário de atividade do aluno (entradas manuais);
-- combinado no frontend com registro_treino (entradas automáticas) pra
-- formar o calendário mensal.
-- ---------------------------------------------------------------------
create table public.treino_calendario (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  data            date not null,
  tipos           text[] not null default '{}',
  duracao_min     integer,
  distancia_km    numeric,
  intensidade     text not null default 'moderada' check (intensidade in ('leve', 'moderada', 'intensa', 'maxima')),
  detalhes        text,
  observacoes     text,
  created_at      timestamptz not null default now()
);

create index idx_treino_calendario_aluno_data on public.treino_calendario(aluno_id, data);

alter table public.treino_calendario enable row level security;

create policy "aluno gerencia o próprio calendário de treino"
  on public.treino_calendario for all to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

create policy "staff da org vê o calendário dos alunos"
  on public.treino_calendario for select to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

-- ---------------------------------------------------------------------
-- mensagens_treino: chat aluno <-> treinador (professor), uma thread por
-- aluno; suporta anexo de vídeo (upload no bucket chat-videos).
-- ---------------------------------------------------------------------
create table public.mensagens_treino (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  remetente_id    uuid not null references auth.users(id) on delete cascade,
  remetente_tipo  public.remetente_tipo_treino not null,
  mensagem        text not null,
  video_url       text,
  lida            boolean not null default false,
  created_at      timestamptz not null default now()
);

create index idx_mensagens_treino_aluno on public.mensagens_treino(aluno_id, created_at);

alter table public.mensagens_treino enable row level security;

create policy "aluno usa o próprio chat de treino"
  on public.mensagens_treino for all to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()))
  with check (
    exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid())
    and remetente_id = auth.uid()
    and remetente_tipo = 'aluno'
  );

create policy "staff da org usa o chat de treino dos alunos"
  on public.mensagens_treino for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (
    (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
    and remetente_id = auth.uid()
    and remetente_tipo = 'treinador'
  );

-- ---------------------------------------------------------------------
-- mensagens_dieta: chat aluno <-> nutricionista, escopado pela dieta ativa
-- (igual ao original — se não tem dieta cadastrada, não tem chat).
-- ---------------------------------------------------------------------
create table public.mensagens_dieta (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  dieta_id        uuid not null references public.dietas(id) on delete cascade,
  remetente_id    uuid not null references auth.users(id) on delete cascade,
  remetente_tipo  public.remetente_tipo_dieta not null,
  mensagem        text not null,
  lida            boolean not null default false,
  created_at      timestamptz not null default now()
);

create index idx_mensagens_dieta_dieta on public.mensagens_dieta(dieta_id, created_at);

alter table public.mensagens_dieta enable row level security;

create policy "aluno usa o próprio chat de nutrição"
  on public.mensagens_dieta for all to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()))
  with check (
    exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid())
    and remetente_id = auth.uid()
    and remetente_tipo = 'aluno'
  );

create policy "staff da org usa o chat de nutrição dos alunos"
  on public.mensagens_dieta for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (
    (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
    and remetente_id = auth.uid()
    and remetente_tipo = 'nutricionista'
  );

-- ---------------------------------------------------------------------
-- Storage: bucket privado para vídeos do chat de treino, path prefixado
-- por user_id (dono do upload — aluno ou o professor que respondeu).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('chat-videos', 'chat-videos', true)
on conflict (id) do nothing;

create policy "usuário autenticado faz upload no próprio path de chat-videos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "leitura pública dos vídeos de chat-videos"
  on storage.objects for select to public
  using (bucket_id = 'chat-videos');

create policy "usuário remove os próprios vídeos de chat-videos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'chat-videos' and (storage.foldername(name))[1] = auth.uid()::text);
