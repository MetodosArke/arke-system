-- Letícia, o agente comercial (semana 1 do plano dos agentes, 28/09/2026).
--
-- Responde o contato da página de vendas por e-mail em minutos e leva à
-- demonstração com o Jean: sem preço, sem plano, sem promessa. O e-mail é um
-- modelo nosso; a inteligência artificial (em São Paulo) escreve só uma ou
-- duas frases sobre o que a academia contou, e essas frases passam por uma
-- checagem que recusa número, valor, plano e promessa (edge function
-- `agente-comercial`, `fluxo.ts`). Até dois lembretes, no 2º e no 5º dia, só
-- em dia útil, das 9h às 19h.
--
-- Para quando: alguém da ArkeFit mexe no contato (o status sai de "novo"), a
-- pessoa clica em "não quero mais receber" (link em todo e-mail), ou o
-- endereço não existe.
--
-- Desligada até duas coisas existirem: o link da agenda e a frase da Política
-- que descreve a resposta automática. A IA tem interruptor próprio
-- (`agente_comercial_ia`), ligado pela migration da Política; sem ele o
-- e-mail sai só com o texto nosso.
--
-- Tabelas da plataforma, sem organization_id, como `leads_site`: o contato
-- ainda não é cliente de academia nenhuma.

-- ── Contato ────────────────────────────────────────────────────────────────
alter table public.leads_site
  add column token_parar uuid not null default gen_random_uuid(),
  add column agente_parou_em timestamptz,
  add column agente_parou_motivo text
    check (agente_parou_motivo in ('pediu_para_parar', 'endereco_invalido'));

create unique index leads_site_token_parar_idx on public.leads_site (token_parar);

comment on column public.leads_site.token_parar is
  'Vai no link "não quero mais receber" de cada e-mail da resposta automática. Não identifica a pessoa por si.';

-- ── O que a Letícia mandou ─────────────────────────────────────────────────
create table public.leads_site_mensagens (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads_site(id) on delete cascade,
  etapa text not null check (etapa in ('primeira', 'retorno_1', 'retorno_2')),
  -- A linha nasce "enviando" antes do e-mail sair: é a reserva que impede duas
  -- rodadas de mandarem a mesma mensagem.
  situacao text not null default 'enviando' check (situacao in ('enviando', 'enviada')),
  reservado_em timestamptz not null default now(),
  enviado_em timestamptz,
  assunto text check (char_length(assunto) <= 200),
  corpo text check (char_length(corpo) <= 6000),
  origem_texto text check (origem_texto in ('ia', 'modelo')),
  categoria text check (categoria in ('evasao', 'inadimplencia', 'catraca', 'atendimento', 'migracao', 'outro')),
  resend_id text,
  unique (lead_id, etapa)
);

comment on table public.leads_site_mensagens is
  'E-mails da resposta automática (Letícia) a cada contato do site. Sai junto com o contato (cascade), inclusive na guarda de 12 meses.';

create index leads_site_mensagens_lead_idx on public.leads_site_mensagens (lead_id);

alter table public.leads_site_mensagens enable row level security;

-- Só leitura, só a ArkeFit. Quem escreve é a edge function (service role).
create policy "leitura" on public.leads_site_mensagens for select to authenticated
  using (has_role((select auth.uid()), 'superadmin'::app_role) or has_role((select auth.uid()), 'admin_arke'::app_role));

revoke all on public.leads_site_mensagens from anon, authenticated;
grant select on public.leads_site_mensagens to authenticated;
grant all on public.leads_site_mensagens to service_role;

-- ── Configuração ───────────────────────────────────────────────────────────
insert into public.plataforma_config (chave, valor, descricao) values
  ('agente_comercial_ativo', 0, 'Resposta automática ao contato do site (Letícia): 1 ligada, 0 desligada. Muda por definir_agente_comercial().'),
  ('agente_comercial_ia', 0, 'A resposta automática usa IA (em São Paulo) para as frases sobre o que o contato contou: 1 sim, 0 só o texto fixo. Ligada pela migration da Política que descreve isso.')
on conflict (chave) do nothing;

insert into public.plataforma_textos (chave, valor, descricao) values
  ('agenda_demonstracao_url', null, 'Link da agenda do Jean para demonstrações (Google Agenda ou Calendly). Sem ele a resposta automática não liga.'),
  ('agente_comercial_ativado_em', null, 'Quando a resposta automática foi ligada pela última vez. Contato anterior a isso não recebe a primeira mensagem.'),
  ('agente_comercial_assinatura', 'Equipe comercial ArkeFit', 'Quem assina o e-mail da resposta automática.')
on conflict (chave) do nothing;

-- Liga, desliga e troca o link da agenda. Só a ArkeFit, e auditado.
create or replace function public.definir_agente_comercial(_ativo boolean, _agenda_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_agenda text := nullif(btrim(_agenda_url), '');
  v_estava boolean;
begin
  if not (public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'Só a ArkeFit configura a resposta automática.' using errcode = '42501';
  end if;
  if v_agenda is not null and v_agenda !~ '^https://[^[:space:]]+$' then
    raise exception 'O link da agenda precisa começar com https://.' using errcode = '22023';
  end if;
  if _ativo and v_agenda is null then
    raise exception 'Cadastre o link da agenda antes de ligar a resposta automática.' using errcode = '22023';
  end if;

  select valor = 1 into v_estava from public.plataforma_config where chave = 'agente_comercial_ativo';

  update public.plataforma_textos set valor = v_agenda, updated_at = now(), updated_by = v_uid
   where chave = 'agenda_demonstracao_url';
  update public.plataforma_config set valor = case when _ativo then 1 else 0 end, updated_at = now(), updated_by = v_uid
   where chave = 'agente_comercial_ativo';
  -- Ligar marca a hora: quem pediu contato antes disso já foi atendido por
  -- gente e não recebe a primeira mensagem de repente.
  if _ativo and not coalesce(v_estava, false) then
    update public.plataforma_textos set valor = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MSOF'), updated_at = now(), updated_by = v_uid
     where chave = 'agente_comercial_ativado_em';
  end if;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, detalhes)
  select v_uid, u.email, case when _ativo then 'agente_comercial.ligar' else 'agente_comercial.desligar' end,
         'plataforma_config', null, jsonb_build_object('ativo', _ativo, 'agenda', v_agenda)
    from (select 1) um
    left join auth.users u on u.id = v_uid;
end;
$$;
revoke execute on function public.definir_agente_comercial(boolean, text) from public, anon;
grant execute on function public.definir_agente_comercial(boolean, text) to authenticated;

-- ── O que está para sair ───────────────────────────────────────────────────
-- A regra de quando cada mensagem sai mora aqui, num lugar só. Datas e horas
-- em Brasília (o fuso do banco, fixado aqui mesmo assim, porque decide se um
-- lembrete sai às 8h ou às 11h).
create or replace function public.leads_para_agente_comercial(_limite integer default 20)
returns table (
  lead_id uuid,
  etapa text,
  nome text,
  academia text,
  email text,
  alunos_faixa text,
  sistema_atual text,
  mensagem text,
  token_parar uuid,
  categoria text
)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select coalesce((select valor = 1 from public.plataforma_config where chave = 'agente_comercial_ativo'), false) as ativo,
           nullif(btrim((select valor from public.plataforma_textos where chave = 'agenda_demonstracao_url')), '') as agenda,
           (select nullif(valor, '')::timestamptz from public.plataforma_textos where chave = 'agente_comercial_ativado_em') as desde
  ),
  agora as (
    select (now() at time zone 'America/Sao_Paulo') as local
  ),
  util as (
    select extract(isodow from local) between 1 and 5
           and local::time >= time '09:00' and local::time < time '19:00' as dentro
    from agora
  ),
  abertos as (
    select l.*
    from public.leads_site l, cfg
    where cfg.ativo and cfg.agenda is not null and cfg.desde is not null
      and l.status = 'novo'
      and l.agente_parou_em is null
  ),
  enviadas as (
    select m.lead_id,
           max(m.enviado_em) filter (where m.etapa = 'primeira' and m.situacao = 'enviada') as primeira_em,
           bool_or(m.etapa = 'primeira') as tem_primeira,
           bool_or(m.etapa = 'retorno_1') as tem_r1,
           bool_or(m.etapa = 'retorno_1' and m.situacao = 'enviada') as r1_enviado,
           bool_or(m.etapa = 'retorno_2') as tem_r2,
           max(m.categoria) filter (where m.etapa = 'primeira') as categoria
    from public.leads_site_mensagens m
    group by m.lead_id
  ),
  devidas as (
    select a.id, 'primeira'::text as etapa, a.created_at, null::text as categoria
    from abertos a, cfg
    where not exists (select 1 from public.leads_site_mensagens m where m.lead_id = a.id and m.etapa = 'primeira')
      and a.created_at >= cfg.desde
      and a.created_at > now() - interval '24 hours'
    union all
    select a.id, 'retorno_1', a.created_at, e.categoria
    from abertos a
    join enviadas e on e.lead_id = a.id, util
    where util.dentro and e.primeira_em is not null and not e.tem_r1
      and now() >= e.primeira_em + interval '2 days'
    union all
    select a.id, 'retorno_2', a.created_at, e.categoria
    from abertos a
    join enviadas e on e.lead_id = a.id, util
    where util.dentro and e.primeira_em is not null and e.r1_enviado and not e.tem_r2
      and now() >= e.primeira_em + interval '5 days'
  )
  select d.id, d.etapa, l.nome, l.academia, l.email, l.alunos_faixa, l.sistema_atual, l.mensagem, l.token_parar, d.categoria
  from devidas d
  join public.leads_site l on l.id = d.id
  order by d.created_at
  limit greatest(1, least(coalesce(_limite, 20), 100));
$$;
revoke execute on function public.leads_para_agente_comercial(integer) from public, anon, authenticated;
grant execute on function public.leads_para_agente_comercial(integer) to service_role;

-- Reserva a mensagem antes do envio. Devolve o id da reserva, ou nulo se
-- outra rodada já a pegou. Reserva de mais de 15 minutos sem conclusão é de
-- uma rodada que caiu no meio: sai, e esta rodada tenta de novo. O envio usa
-- uma chave de idempotência no Resend, então a mensagem não sai duas vezes
-- mesmo que a primeira rodada tenha chegado a enviar.
create or replace function public.reservar_mensagem_agente_comercial(_lead_id uuid, _etapa text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  delete from public.leads_site_mensagens
   where lead_id = _lead_id and etapa = _etapa
     and situacao = 'enviando' and reservado_em < now() - interval '15 minutes';
  insert into public.leads_site_mensagens (lead_id, etapa)
  values (_lead_id, _etapa)
  on conflict (lead_id, etapa) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.reservar_mensagem_agente_comercial(uuid, text) from public, anon, authenticated;
grant execute on function public.reservar_mensagem_agente_comercial(uuid, text) to service_role;

-- Conclui a reserva: enviada guarda o que saiu; não enviada apaga a reserva,
-- e a próxima rodada tenta de novo. Endereço inválido para a Letícia de vez.
create or replace function public.concluir_mensagem_agente_comercial(
  _id uuid,
  _enviada boolean,
  _assunto text default null,
  _corpo text default null,
  _origem_texto text default null,
  _categoria text default null,
  _resend_id text default null,
  _endereco_invalido boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead uuid;
begin
  if _enviada then
    update public.leads_site_mensagens
       set situacao = 'enviada', enviado_em = now(), assunto = left(_assunto, 200), corpo = left(_corpo, 6000),
           origem_texto = _origem_texto, categoria = _categoria, resend_id = _resend_id
     where id = _id;
  else
    delete from public.leads_site_mensagens where id = _id returning lead_id into v_lead;
    if _endereco_invalido and v_lead is not null then
      update public.leads_site
         set agente_parou_em = now(), agente_parou_motivo = 'endereco_invalido'
       where id = v_lead and agente_parou_em is null;
    end if;
  end if;
end;
$$;
revoke execute on function public.concluir_mensagem_agente_comercial(uuid, boolean, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.concluir_mensagem_agente_comercial(uuid, boolean, text, text, text, text, text, boolean) to service_role;

-- "Não quero mais receber". Responde igual exista ou não o token, para o link
-- não servir de sonda.
create or replace function public.parar_agente_comercial(_token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.leads_site
     set agente_parou_em = now(), agente_parou_motivo = 'pediu_para_parar'
   where token_parar = _token and agente_parou_em is null;
$$;
revoke execute on function public.parar_agente_comercial(uuid) from public, anon, authenticated;
grant execute on function public.parar_agente_comercial(uuid) to service_role;

-- ── Rotina ─────────────────────────────────────────────────────────────────
-- De 5 em 5 minutos, com o token do alerta de rotinas guardado no Vault. A
-- própria função registra o desfecho (execucoes_agendadas), e a rotina entra
-- na vigilância de sempre. Envia e-mail a quem está fora da plataforma, então
-- não entra na lista das rotinas que o Vigia roda de novo sozinho.
select cron.schedule(
  'arke-agente-comercial',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/agente-comercial',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$
);
