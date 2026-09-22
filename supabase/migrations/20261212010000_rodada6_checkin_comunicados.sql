-- Rodada 6: check-in por QR Code (frequência de quem não tem catraca) e
-- comunicados em massa da academia para os alunos.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Check-in por QR Code
-- ─────────────────────────────────────────────────────────────────────────
-- A recepção mostra um QR que muda a cada 10 minutos (Visão da equipe →
-- Check-in QR). O código sai de um segredo da academia que ninguém lê pela
-- API — nem o aluno: se ele pudesse ler, calcularia o código de casa. Aceita
-- o código atual e o anterior, para quem escaneou na virada.
create table public.organizacao_segredo_checkin (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  segredo text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  criado_em timestamptz not null default now()
);

alter table public.organizacao_segredo_checkin enable row level security;
-- Sem nenhuma política: só as funções abaixo (security definer) leem.

create table public.presencas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  dia date not null default (now() at time zone 'America/Sao_Paulo')::date,
  registrada_em timestamptz not null default now(),
  origem text not null default 'qr' check (origem in ('qr', 'manual')),
  unique (aluno_id, dia)
);

create index presencas_org_dia on public.presencas (organization_id, dia);

comment on table public.presencas is
  'Frequência na academia: uma presença por aluno por dia, pelo QR Code da recepção (ou lançada pela equipe).';

alter table public.presencas enable row level security;

create policy "leitura" on public.presencas
  for select to authenticated
  using (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
  );
create policy "inclusão" on public.presencas
  for insert to authenticated
  with check (public.is_org_staff((select auth.uid()), organization_id) and origem = 'manual');
create policy "exclusão" on public.presencas
  for delete to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id));

create or replace function public.codigo_checkin(_organization_id uuid, _janela bigint)
returns text
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  select upper(substr(encode(hmac(_organization_id::text || ':' || _janela::text, s.segredo, 'sha256'), 'hex'), 1, 8))
    from public.organizacao_segredo_checkin s
   where s.organization_id = _organization_id;
$$;

revoke execute on function public.codigo_checkin(uuid, bigint) from public, anon, authenticated;

-- Para a tela da recepção: o código da janela atual e quantos segundos faltam.
create or replace function public.codigo_checkin_atual(_organization_id uuid)
returns table (codigo text, segundos_restantes int)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agora bigint := floor(extract(epoch from now()));
begin
  if not public.is_org_staff(auth.uid(), _organization_id) then
    raise exception 'Só a equipe da academia exibe o QR de check-in.' using errcode = '42501';
  end if;
  insert into public.organizacao_segredo_checkin (organization_id) values (_organization_id) on conflict do nothing;
  codigo := public.codigo_checkin(_organization_id, v_agora / 600);
  segundos_restantes := 600 - (v_agora % 600)::int;
  return next;
end;
$$;

revoke execute on function public.codigo_checkin_atual(uuid) from public, anon;
grant execute on function public.codigo_checkin_atual(uuid) to authenticated;

-- O aluno escaneia e registra a própria presença. Devolve 'registrada',
-- 'ja_registrada' ou o motivo da recusa.
create or replace function public.registrar_presenca_qr(_organization_id uuid, _codigo text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_janela bigint := floor(extract(epoch from now()))::bigint / 600;
  v_aluno public.alunos%rowtype;
  v_id uuid;
begin
  select * into v_aluno from public.alunos
   where organization_id = _organization_id and user_id = auth.uid() and anonimizado_em is null;
  if not found then
    raise exception 'Você não é aluno desta academia.' using errcode = '42501';
  end if;
  if v_aluno.situacao_academia <> 'em_dia' then
    raise exception 'Sua matrícula não está ativa. Fale com a recepção.' using errcode = '42501';
  end if;
  if upper(btrim(coalesce(_codigo, ''))) not in (public.codigo_checkin(_organization_id, v_janela),
                                                 public.codigo_checkin(_organization_id, v_janela - 1)) then
    raise exception 'Este QR Code expirou. Escaneie o da tela da recepção de novo.' using errcode = '22023';
  end if;
  insert into public.presencas (organization_id, aluno_id, origem) values (_organization_id, v_aluno.id, 'qr')
  on conflict (aluno_id, dia) do nothing
  returning id into v_id;
  return case when v_id is null then 'ja_registrada' else 'registrada' end;
end;
$$;

revoke execute on function public.registrar_presenca_qr(uuid, text) from public, anon;
grant execute on function public.registrar_presenca_qr(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Comunicados em massa
-- ─────────────────────────────────────────────────────────────────────────
create table public.comunicados (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  titulo text not null check (length(btrim(titulo)) between 3 and 120),
  mensagem text not null check (length(btrim(mensagem)) between 3 and 2000),
  publico text not null default 'alunos' check (publico in ('alunos', 'equipe', 'todos')),
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  expira_em date
);

create index comunicados_org on public.comunicados (organization_id, criado_em desc);

alter table public.comunicados enable row level security;

-- Aluno lê o que é para alunos; a equipe lê tudo da academia. Quem publica é
-- gestor ou recepção.
create policy "leitura" on public.comunicados
  for select to authenticated
  using (
    public.is_org_staff((select auth.uid()), organization_id)
    or (publico in ('alunos', 'todos') and exists (
          select 1 from public.alunos a where a.organization_id = comunicados.organization_id and a.user_id = (select auth.uid())))
  );
create policy "inclusão" on public.comunicados
  for insert to authenticated
  with check (
    (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_org_role((select auth.uid()), organization_id, 'recepcao'))
    and criado_por = (select auth.uid())
  );
create policy "exclusão" on public.comunicados
  for delete to authenticated
  using (public.has_org_role((select auth.uid()), organization_id, 'gestor') or criado_por = (select auth.uid()));

create table public.comunicados_lidos (
  comunicado_id uuid not null references public.comunicados(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lido_em timestamptz not null default now(),
  primary key (comunicado_id, user_id)
);

alter table public.comunicados_lidos enable row level security;

create policy "leitura" on public.comunicados_lidos
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_staff((select auth.uid()), organization_id));
create policy "inclusão" on public.comunicados_lidos
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_org_member((select auth.uid()), organization_id));
