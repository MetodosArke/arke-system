-- Rodada final: decisões do responsável registradas em docs/DECISOES_PENDENTES.md.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Documentos legais revisados (dados da ArkeFit, IPCA, prazos, foro)
-- ─────────────────────────────────────────────────────────────────────────
insert into public.documentos_legais (tipo, versao, sha256) values
  ('termos_uso', '2026-09-22.2', '47946ceeeb61e25f6bf8d5d302520db8166c009af1a75f535581d016170ccdef'),
  ('privacidade', '2026-09-22.2', '3ef255908dd98c67dab15e84f26fee73ed4d3ffd201289d38b8b2f745a1ad969'),
  ('contrato_academia', '2026-09-22.2', '4f27a858ce37eaeb1318c52c9bc8d8f5b6e2b146a5feb27599bd05c47eb177e7')
on conflict (tipo, versao) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Tolerância de 7 dias na mensalidade B2B (contrato da academia, cláusula 2)
-- ─────────────────────────────────────────────────────────────────────────
-- A equipe só é bloqueada quando a cobrança passa 7 dias corridos do
-- vencimento sem pagamento. Antes do prazo, o painel avisa (a tela da
-- cobrança vencida continua listando), mas não tranca.
create or replace function public.organizacao_inadimplente_b2b(_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.cobrancas_b2b c
    where c.organization_id = _organization_id
      and c.status <> 'confirmado'
      and c.status in ('pendente', 'atrasado')
      and coalesce(c.vencimento, c.created_at::date) < current_date - 7
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Tolerância de 5 dias para o aluno marcado como inadimplente
-- ─────────────────────────────────────────────────────────────────────────
-- Pausado sai do app na hora (foi a academia que pausou). Inadimplente segue
-- usando por 5 dias corridos a contar da marcação, com aviso na tela.
create or replace function public.situacao_permite_app(_situacao public.situacao_aluno_academia, _desde timestamptz)
returns boolean
language sql
immutable
as $$
  select _situacao = 'em_dia'
      or (_situacao = 'inadimplente' and coalesce(_desde, now()) > now() - interval '5 days');
$$;

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
  if not public.situacao_permite_app(v_aluno.situacao_academia, v_aluno.situacao_academia_em) then
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

-- ─────────────────────────────────────────────────────────────────────────
-- 4. PAR-Q com "sim" e sem atestado válido bloqueia o treino
-- ─────────────────────────────────────────────────────────────────────────
-- Até a equipe registrar a validade de um atestado, o registro de treino é
-- recusado — aqui, no banco, para valer por qualquer caminho. O resto do app
-- segue aberto (dieta, chat, documentos: é por eles que o atestado chega).
create or replace function public.exigir_atestado_para_treinar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (
    select 1 from public.aluno_parq p
     where p.aluno_id = new.aluno_id
       and p.algum_sim
       and (p.atestado_validade is null or p.atestado_validade < current_date)
  ) then
    raise exception 'O treino fica liberado quando a academia registrar o seu atestado médico.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_exigir_atestado_para_treinar
  before insert on public.registro_treino
  for each row execute function public.exigir_atestado_para_treinar();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Chat com a nutricionista da academia no plano Free
-- ─────────────────────────────────────────────────────────────────────────
-- Com nutricionista na equipe, o aluno do Free fala com ela (é a academia que
-- paga a profissional). Sem nutricionista, o chat mostra o Método ARKE.
create or replace function public.academia_tem_nutricionista(_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_org_member(auth.uid(), _organization_id)
     and exists (select 1 from public.organization_members
                  where organization_id = _organization_id and role = 'nutricionista' and status = 'active');
$$;

revoke execute on function public.academia_tem_nutricionista(uuid) from public, anon;
grant execute on function public.academia_tem_nutricionista(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Buckets com dado pessoal passam a privados
-- ─────────────────────────────────────────────────────────────────────────
-- `dietas` era público e sem uso (vazio); `chat-videos` era público e guarda
-- vídeos do aluno no chat. Nenhum dos dois tinha arquivo. Os vídeos passam a
-- ficar em <organização>/<aluno>/, com a mesma regra de acesso dos atestados:
-- o próprio aluno e a equipe da academia dele. Exibição por link temporário.
update storage.buckets set public = false where id in ('dietas', 'chat-videos');

drop policy if exists "Authenticated reads dietas" on storage.objects;
drop policy if exists "Authenticated users can upload chat videos" on storage.objects;
drop policy if exists "Anyone can view chat videos" on storage.objects;
drop policy if exists "Users can delete own chat videos" on storage.objects;
drop policy if exists "usuário autenticado faz upload no próprio path de chat-videos" on storage.objects;
drop policy if exists "leitura pública dos vídeos de chat-videos" on storage.objects;
drop policy if exists "usuário remove os próprios vídeos de chat-videos" on storage.objects;

create policy "chat-videos: leitura" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-videos' and public.pode_acessar_atestado(name));
create policy "chat-videos: envio" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-videos' and public.pode_acessar_atestado(name));
create policy "chat-videos: exclusão" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-videos' and public.pode_acessar_atestado(name));

comment on function public.pode_acessar_atestado(text) is
  'Arquivo de aluno em <organização>/<aluno>/...: o próprio aluno e a equipe da academia dele. Usado pelos buckets atestados e chat-videos.';

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Funil de vendas (Kanban simples)
-- ─────────────────────────────────────────────────────────────────────────
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null check (length(btrim(nome)) >= 2),
  telefone text,
  email text,
  origem text,
  etapa text not null default 'novo'
    check (etapa in ('novo', 'contato', 'experimental', 'negociacao', 'matriculado', 'perdido')),
  aula_experimental_em timestamptz,
  observacao text,
  motivo_perda text,
  responsavel_id uuid references auth.users(id) on delete set null,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_org_etapa on public.leads (organization_id, etapa);

comment on table public.leads is
  'Funil de vendas da academia: interessados antes de virarem alunos (novo → contato → aula experimental → negociação → matriculado ou perdido).';

create trigger trg_leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

create policy "leitura" on public.leads
  for select to authenticated using (public.is_org_staff((select auth.uid()), organization_id));
create policy "inclusão" on public.leads
  for insert to authenticated with check (public.is_org_staff((select auth.uid()), organization_id));
create policy "alteração" on public.leads
  for update to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id))
  with check (public.is_org_staff((select auth.uid()), organization_id));
create policy "exclusão" on public.leads
  for delete to authenticated
  using (public.has_org_role((select auth.uid()), organization_id, 'gestor') or criado_por = (select auth.uid()));
