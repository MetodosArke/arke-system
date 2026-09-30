-- Pipeline comercial da ArkeFit (30/09/2026).
--
-- "Contatos do site" vira o CRM comercial da ArkeFit: o mesmo quadro recebe
-- quem pediu demonstração pela página de vendas e quem a equipe anota à mão:
-- quem chamou no WhatsApp, quem ligou, quem foi indicado e quem foi achado em
-- prospecção. Por isso a tabela deixa de se chamar `leads_site`.
--
-- - `origem` passa a ser o canal (site, whatsapp, telefone, indicacao,
--   prospeccao). O que a coluna guardava até aqui, a UTM ou o site de onde o
--   visitante veio, continua em `origem_detalhe`. Nos outros canais, ali fica
--   quem indicou ou onde o contato foi achado.
-- - As etapas do quadro: novo, qualificacao, demonstracao, negociacao, ganho,
--   perdido. Perdido exige o motivo, que é o que ensina.
-- - `observacao` vira `observacoes_vendedor`, que é o que ela sempre foi:
--   anotação da equipe, que nunca vai para e-mail nem para a IA.
--
-- A Letícia continua respondendo sozinha só a quem veio do site. Nos outros
-- canais ela entra quando alguém da ArkeFit aciona, pelo botão do cartão
-- (`acionar_agente_comercial`). Acionar depende de mais um interruptor,
-- `agente_comercial_outras_origens`, que nasce desligado e é ligado pela
-- migration da Política que descreve esses canais. É o mesmo desenho do
-- `agente_comercial_ia`.
--
-- A tabela estava vazia quando esta migration foi escrita, e as etapas antigas
-- são convertidas por segurança.

-- ── Nome ───────────────────────────────────────────────────────────────────
alter table public.leads_site rename to leads_comerciais;
alter table public.leads_site_mensagens rename to leads_comerciais_mensagens;

alter table public.leads_comerciais rename constraint leads_site_pkey to leads_comerciais_pkey;
alter table public.leads_comerciais_mensagens rename constraint leads_site_mensagens_pkey to leads_comerciais_mensagens_pkey;
alter table public.leads_comerciais_mensagens rename constraint leads_site_mensagens_lead_id_fkey to leads_comerciais_mensagens_lead_id_fkey;
alter table public.leads_comerciais_mensagens rename constraint leads_site_mensagens_lead_id_etapa_key to leads_comerciais_mensagens_lead_id_etapa_key;
alter index public.leads_site_created_at_idx rename to leads_comerciais_created_at_idx;
alter index public.leads_site_ip_idx rename to leads_comerciais_ip_idx;
alter index public.leads_site_token_parar_idx rename to leads_comerciais_token_parar_idx;
alter index public.leads_site_mensagens_lead_idx rename to leads_comerciais_mensagens_lead_idx;

alter table public.leads_comerciais rename column origem to origem_detalhe;
alter table public.leads_comerciais rename column observacao to observacoes_vendedor;

-- ── Contato anotado à mão ──────────────────────────────────────────────────
-- Quem chamou no WhatsApp pode não ter dado e-mail. Na prospecção, muitas
-- vezes não se sabe o nome de ninguém. Continua exigido o nome da academia e
-- pelo menos um jeito de falar com ela.
alter table public.leads_comerciais alter column nome drop not null;
alter table public.leads_comerciais alter column telefone drop not null;
alter table public.leads_comerciais alter column email drop not null;
alter table public.leads_comerciais
  add constraint leads_comerciais_contato_check check (telefone is not null or email is not null);

alter table public.leads_comerciais
  add column origem text not null default 'site'
    constraint leads_comerciais_origem_check
    check (origem in ('site', 'whatsapp', 'telefone', 'indicacao', 'prospeccao')),
  add column interesse text
    constraint leads_comerciais_interesse_check
    check (interesse in ('evasao', 'inadimplencia', 'catraca', 'atendimento', 'migracao', 'outro')),
  add column motivo_perda text constraint leads_comerciais_motivo_perda_check check (char_length(motivo_perda) between 2 and 300),
  add column status_desde timestamptz not null default now(),
  add column criado_por uuid,
  add column agente_acionado_em timestamptz,
  add column agente_acionado_por uuid;

-- Prospecção sempre com a fonte: é o que o primeiro e-mail conta à academia
-- (de onde veio o contato dela), e o que a ArkeFit responde se perguntarem.
alter table public.leads_comerciais
  add constraint leads_comerciais_fonte_check
  check (origem <> 'prospeccao' or coalesce(char_length(btrim(origem_detalhe)), 0) >= 2);

comment on column public.leads_comerciais.origem is
  'Canal: site (formulário da página de vendas), whatsapp, telefone, indicacao ou prospeccao.';
comment on column public.leads_comerciais.origem_detalhe is
  'No site, a UTM ou o site de onde o visitante veio. Na indicação, quem indicou. Na prospecção, onde o contato foi achado (vai no primeiro e-mail).';
comment on column public.leads_comerciais.observacoes_vendedor is
  'Anotações da equipe comercial. Nunca vão para e-mail nem para a IA.';
comment on column public.leads_comerciais.mensagem is
  'O que a academia contou: escrito por ela no site, ou anotado pela equipe depois de uma conversa. É o único texto que pode ir à IA da Letícia.';

-- ── Etapas do quadro ───────────────────────────────────────────────────────
alter table public.leads_comerciais drop constraint leads_site_status_check;
update public.leads_comerciais
   set status = case status
                  when 'em_contato' then 'qualificacao'
                  when 'proposta' then 'negociacao'
                  when 'fechado' then 'ganho'
                  when 'descartado' then 'perdido'
                  else status
                end;
update public.leads_comerciais set motivo_perda = 'Não informado' where status = 'perdido' and motivo_perda is null;
alter table public.leads_comerciais
  add constraint leads_comerciais_status_check
  check (status in ('novo', 'qualificacao', 'demonstracao', 'negociacao', 'ganho', 'perdido'));
alter table public.leads_comerciais
  add constraint leads_comerciais_perdido_check check (status <> 'perdido' or motivo_perda is not null);

comment on table public.leads_comerciais is
  'Pipeline comercial da ArkeFit: contatos do site (edge function lead-site) e os anotados pela equipe. Só a ArkeFit lê e escreve.';
comment on table public.leads_comerciais_mensagens is
  'E-mails da Letícia a cada contato. Saem junto com o contato (cascade), inclusive na guarda de 12 meses.';

-- ── Acesso ─────────────────────────────────────────────────────────────────
-- Uma regra por operação, todas só da ArkeFit (has_role já exige a sessão
-- verificada em duas etapas). "leitura" e "alteração" vieram com a tabela.
create policy "inclusão" on public.leads_comerciais for insert to authenticated
  with check (has_role((select auth.uid()), 'superadmin'::app_role) or has_role((select auth.uid()), 'admin_arke'::app_role));
create policy "exclusão" on public.leads_comerciais for delete to authenticated
  using (has_role((select auth.uid()), 'superadmin'::app_role) or has_role((select auth.uid()), 'admin_arke'::app_role));

-- Por coluna: o que a Letícia controla (token, acionamento, parada) e o que
-- o formulário registrou (IP, aviso por e-mail, chegada) não se escreve pela
-- API. Acionar a Letícia é por `acionar_agente_comercial`.
revoke all on public.leads_comerciais from anon, authenticated;
grant select, delete on public.leads_comerciais to authenticated;
grant insert (nome, academia, cidade, uf, telefone, email, alunos_faixa, sistema_atual, mensagem, origem,
              origem_detalhe, interesse, observacoes_vendedor, status, motivo_perda)
  on public.leads_comerciais to authenticated;
grant update (nome, academia, cidade, uf, telefone, email, alunos_faixa, sistema_atual, mensagem, origem,
              origem_detalhe, interesse, observacoes_vendedor, status, motivo_perda)
  on public.leads_comerciais to authenticated;
grant all on public.leads_comerciais to service_role;

-- ── Regras que valem para qualquer caminho ─────────────────────────────────
-- Substitui o carimbo antigo. Só o trabalho de uma pessoa carimba (a edge
-- function, sem usuário, marca o aviso e a Letícia sem mexer no andamento).
drop trigger if exists trg_carimbar_lead_site on public.leads_comerciais;
drop function if exists public.carimbar_lead_site();

create or replace function public.proteger_lead_comercial()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.status_desde := now();
    if v_uid is not null then
      -- Contato do site entra só pelo formulário: é o que liga a resposta
      -- automática, e um "site" anotado à mão receberia e-mail sozinho.
      if new.origem = 'site' then
        raise exception 'Contato do site entra só pelo formulário da página de vendas. Escolha o canal por onde a academia chegou.'
          using errcode = '22023';
      end if;
      new.criado_por := v_uid;
      new.atualizado_em := now();
      new.atualizado_por := v_uid;
    end if;
  else
    if new.status is distinct from old.status then
      new.status_desde := now();
      if new.status <> 'perdido' then
        new.motivo_perda := null;
      end if;
    end if;
    if v_uid is not null then
      if (old.origem = 'site') <> (new.origem = 'site') then
        raise exception 'O canal "site" não se troca: ele diz que o contato veio do formulário.' using errcode = '22023';
      end if;
      if old.origem = 'site' and new.mensagem is distinct from old.mensagem then
        raise exception 'O que a academia escreveu no site não se edita. Anote em Observações do vendedor.' using errcode = '22023';
      end if;
      new.atualizado_em := now();
      new.atualizado_por := v_uid;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.proteger_lead_comercial() from public, anon, authenticated;

create trigger trg_proteger_lead_comercial
  before insert or update on public.leads_comerciais
  for each row execute function public.proteger_lead_comercial();

-- ── Guarda de 12 meses ─────────────────────────────────────────────────────
-- A mesma regra para todos os canais: sem andamento há 12 meses e não virou
-- cliente, sai. "Ganho" fica, porque virou relação com o cliente.
select cron.unschedule('arke-retencao-contatos-site');
drop function if exists public.limpar_leads_site_antigos();

create or replace function public.limpar_leads_comerciais_antigos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  apagados integer;
begin
  delete from public.leads_comerciais
   where status <> 'ganho'
     and coalesce(atualizado_em, created_at) < now() - interval '12 months';
  get diagnostics apagados = row_count;
  return apagados;
end;
$$;
revoke all on function public.limpar_leads_comerciais_antigos() from public, anon, authenticated;

select cron.schedule('arke-retencao-leads-comerciais', '50 3 * * *', $cmd$select public.limpar_leads_comerciais_antigos()$cmd$);

-- ── Letícia ────────────────────────────────────────────────────────────────
insert into public.plataforma_config (chave, valor, descricao) values
  ('agente_comercial_outras_origens', 0,
   'A Letícia pode ser acionada para contatos de WhatsApp, telefone, indicação e prospecção: 1 sim, 0 só o site. Ligada pela migration da Política que descreve esses canais.')
on conflict (chave) do nothing;

-- O que está para sair. Continua sendo o único lugar com a regra:
-- - só fala com quem está em "Novos": mover o cartão adiante é a equipe
--   assumindo o contato, e a Letícia para;
-- - site: a primeira sai na hora, só para contatos que chegaram depois de ela
--   ser ligada e há menos de 24 h;
-- - outros canais: só depois de acionada, com a Política cobrindo esses
--   canais, a primeira em horário útil e até 3 dias depois do acionamento
--   (acionamento esquecido com ela desligada não vira e-mail semanas depois);
-- - lembretes no 2º e no 5º dia depois da primeira, em horário útil.
drop function if exists public.leads_para_agente_comercial(integer);
create function public.leads_para_agente_comercial(_limite integer default 20)
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
  categoria text,
  origem text,
  origem_detalhe text
)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select coalesce((select valor = 1 from public.plataforma_config where chave = 'agente_comercial_ativo'), false) as ativo,
           coalesce((select valor = 1 from public.plataforma_config where chave = 'agente_comercial_outras_origens'), false) as outras,
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
    from public.leads_comerciais l, cfg
    where cfg.ativo and cfg.agenda is not null and cfg.desde is not null
      and l.status = 'novo'
      and l.agente_parou_em is null
      and l.email is not null
      and (l.origem = 'site' or (cfg.outras and l.agente_acionado_em is not null))
  ),
  enviadas as (
    select m.lead_id,
           max(m.enviado_em) filter (where m.etapa = 'primeira' and m.situacao = 'enviada') as primeira_em,
           bool_or(m.etapa = 'retorno_1') as tem_r1,
           bool_or(m.etapa = 'retorno_1' and m.situacao = 'enviada') as r1_enviado,
           bool_or(m.etapa = 'retorno_2') as tem_r2,
           max(m.categoria) filter (where m.etapa = 'primeira') as categoria
    from public.leads_comerciais_mensagens m
    group by m.lead_id
  ),
  devidas as (
    select a.id, 'primeira'::text as etapa, a.created_at, null::text as categoria
    from abertos a, cfg, util
    where not exists (select 1 from public.leads_comerciais_mensagens m where m.lead_id = a.id and m.etapa = 'primeira')
      and (
        (a.origem = 'site' and a.created_at >= cfg.desde and a.created_at > now() - interval '24 hours')
        or (a.origem <> 'site' and util.dentro and a.agente_acionado_em > now() - interval '3 days')
      )
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
  select d.id, d.etapa, l.nome, l.academia, l.email, l.alunos_faixa, l.sistema_atual, l.mensagem, l.token_parar,
         coalesce(d.categoria, l.interesse), l.origem, l.origem_detalhe
  from devidas d
  join public.leads_comerciais l on l.id = d.id
  order by d.created_at
  limit greatest(1, least(coalesce(_limite, 20), 100));
$$;
revoke execute on function public.leads_para_agente_comercial(integer) from public, anon, authenticated;
grant execute on function public.leads_para_agente_comercial(integer) to service_role;

create or replace function public.reservar_mensagem_agente_comercial(_lead_id uuid, _etapa text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  delete from public.leads_comerciais_mensagens
   where lead_id = _lead_id and etapa = _etapa
     and situacao = 'enviando' and reservado_em < now() - interval '15 minutes';
  insert into public.leads_comerciais_mensagens (lead_id, etapa)
  values (_lead_id, _etapa)
  on conflict (lead_id, etapa) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.reservar_mensagem_agente_comercial(uuid, text) from public, anon, authenticated;
grant execute on function public.reservar_mensagem_agente_comercial(uuid, text) to service_role;

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
    update public.leads_comerciais_mensagens
       set situacao = 'enviada', enviado_em = now(), assunto = left(_assunto, 200), corpo = left(_corpo, 6000),
           origem_texto = _origem_texto, categoria = _categoria, resend_id = _resend_id
     where id = _id;
  else
    delete from public.leads_comerciais_mensagens where id = _id returning lead_id into v_lead;
    if _endereco_invalido and v_lead is not null then
      update public.leads_comerciais
         set agente_parou_em = now(), agente_parou_motivo = 'endereco_invalido'
       where id = v_lead and agente_parou_em is null;
    end if;
  end if;
end;
$$;
revoke execute on function public.concluir_mensagem_agente_comercial(uuid, boolean, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.concluir_mensagem_agente_comercial(uuid, boolean, text, text, text, text, text, boolean) to service_role;

create or replace function public.parar_agente_comercial(_token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.leads_comerciais
     set agente_parou_em = now(), agente_parou_motivo = 'pediu_para_parar'
   where token_parar = _token and agente_parou_em is null;
$$;
revoke execute on function public.parar_agente_comercial(uuid) from public, anon, authenticated;
grant execute on function public.parar_agente_comercial(uuid) to service_role;

-- Acionar a Letícia para um contato que não veio do site. Só a ArkeFit, e
-- auditado: é a decisão de mandar e-mail a alguém de fora. Acionar de novo
-- não faz nada. Cada recusa diz o que falta.
create or replace function public.acionar_agente_comercial(_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  l public.leads_comerciais%rowtype;
begin
  if not (public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'Só a ArkeFit aciona a Letícia.' using errcode = '42501';
  end if;

  select * into l from public.leads_comerciais where id = _lead_id for update;
  if not found then
    raise exception 'Contato não encontrado.' using errcode = 'P0002';
  end if;
  if l.origem = 'site' then
    raise exception 'Contato do site já recebe a resposta da Letícia sozinho.' using errcode = '22023';
  end if;
  if l.agente_acionado_em is not null then
    return;
  end if;
  if l.status <> 'novo' then
    raise exception 'A Letícia só fala com contatos em Novos. Volte o cartão para Novos antes de acionar.' using errcode = '22023';
  end if;
  if l.email is null then
    raise exception 'Cadastre o e-mail do contato: a Letícia escreve por e-mail.' using errcode = '22023';
  end if;
  if l.agente_parou_em is not null then
    raise exception 'Este contato pediu para não receber mais e-mails, ou o endereço não existe.' using errcode = '22023';
  end if;
  if not coalesce((select valor = 1 from public.plataforma_config where chave = 'agente_comercial_ativo'), false) then
    raise exception 'A Letícia está desligada. Ligue-a no painel da resposta automática (precisa do link da agenda).' using errcode = '22023';
  end if;
  if not coalesce((select valor = 1 from public.plataforma_config where chave = 'agente_comercial_outras_origens'), false) then
    raise exception 'A Letícia só fala com contatos do site até a Política de Privacidade descrever os outros canais.' using errcode = '22023';
  end if;

  update public.leads_comerciais
     set agente_acionado_em = now(), agente_acionado_por = v_uid
   where id = _lead_id;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, detalhes)
  select v_uid, u.email, 'agente_comercial.acionar', 'leads_comerciais', _lead_id,
         jsonb_build_object('origem', l.origem)
    from (select 1) um
    left join auth.users u on u.id = v_uid;
end;
$$;
revoke execute on function public.acionar_agente_comercial(uuid) from public, anon;
grant execute on function public.acionar_agente_comercial(uuid) to authenticated;
