-- Bruno, o agente de implantação (semana 2 do plano dos agentes, 03/10/2026).
--
-- Leva a academia do primeiro acesso ao painel até a primeira entrada de um
-- aluno: a configuração inicial (as seis etapas de sempre), a liberação do
-- app, a primeira entrada registrada (catraca com o Gateway, ou check-in por
-- QR Code na recepção) e o kit de lançamento, que só sai depois dela. De hora
-- em hora, a edge function `agente-implantacao` confere onde cada academia
-- está e manda o próximo passo; todo dia confere a aprovação da conta no
-- Asaas; pede a evasão dos 6 meses anteriores, que é a base da medida de
-- resultado; e, com 1 dia útil parado na mesma etapa, abre um chamado para a
-- ArkeFit ligar (comentário do responsável no workspace, 28/09/2026: uma
-- etapa parada no início trava a operação inteira da academia).
--
-- Sem IA: as mensagens são modelos fixos. Tudo o que o Bruno faz fica em
-- `implantacao_mensagens`, com o motivo — para a academia, é a prova de que o
-- serviço está acontecendo. Ele substitui o lembrete de onboarding de 3 em 3
-- dias, que sai daqui inteiro.

-- ── Interruptor e assinatura ───────────────────────────────────────────────
insert into public.plataforma_config (chave, valor, descricao)
values ('agente_implantacao_ativo', 0, 'Bruno, o agente de implantação: 1 manda o próximo passo às academias em implantação.')
on conflict (chave) do nothing;

insert into public.plataforma_textos (chave, valor, descricao)
values ('agente_implantacao_assinatura', 'Equipe de implantação ArkeFit', 'Assinatura dos e-mails do agente de implantação.')
on conflict (chave) do nothing;

-- ── Andamento de cada academia ─────────────────────────────────────────────
create table public.implantacao (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  iniciada_em timestamptz not null default now(),
  -- A etapa principal pendente, como o agente a viu na última rodada, e desde
  -- quando. É o relógio do "1 dia útil parado".
  etapa_atual text,
  etapa_atual_desde timestamptz,
  -- Kit de lançamento enviado: a implantação terminou.
  concluida_em timestamptz,
  asaas_conferido_em timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.implantacao enable row level security;

create table public.implantacao_mensagens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tipo text not null check (tipo in (
    'boas_vindas', 'proximo_passo', 'lembrete', 'pedido_evasao',
    'asaas_aprovada', 'asaas_recusada', 'kit_lancamento', 'chamado_arkefit'
  )),
  -- Idempotência: a mesma mensagem não sai duas vezes (etapa, ou etapa:n).
  chave text not null,
  etapa text,
  motivo text not null,
  status text not null default 'reservada' check (status in ('reservada', 'enviada', 'falhou')),
  destinatarios integer,
  resend_id text,
  erro text,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  unique (organization_id, tipo, chave)
);
alter table public.implantacao_mensagens enable row level security;
create index implantacao_mensagens_org_idx on public.implantacao_mensagens (organization_id, criado_em desc);

-- A evasão dos 6 meses antes do ArkeFit, tirada do sistema antigo: é a base
-- com que a medida de resultado compara os 6 meses com ele. Por mês: alunos
-- ativos no começo e quantos saíram.
create table public.academia_evasao_anterior (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mes date not null check (extract(day from mes) = 1),
  alunos_inicio integer not null check (alunos_inicio > 0),
  saidas integer not null check (saidas >= 0),
  informado_por uuid references auth.users(id) on delete set null,
  informado_em timestamptz not null default now(),
  primary key (organization_id, mes),
  check (saidas <= alunos_inicio)
);
alter table public.academia_evasao_anterior enable row level security;

-- O chamado da ArkeFit: academia parada há 1 dia útil, ou conta do Asaas
-- recusada. Ciclo completo: motivo, responsável, prazo, ação, desfecho e
-- próxima checagem.
create table public.implantacao_chamados (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  etapa text not null,
  motivo text not null,
  aberto_em timestamptz not null default now(),
  prazo timestamptz not null,
  responsavel_id uuid references auth.users(id) on delete set null,
  acao text,
  desfecho text,
  concluido_em timestamptz,
  proxima_checagem timestamptz,
  check ((concluido_em is null) = (desfecho is null))
);
alter table public.implantacao_chamados enable row level security;
create unique index implantacao_chamados_um_aberto on public.implantacao_chamados (organization_id) where concluido_em is null;
create index implantacao_chamados_responsavel_idx on public.implantacao_chamados (responsavel_id);
create index academia_evasao_anterior_informado_por_idx on public.academia_evasao_anterior (informado_por);

-- Leitura: a equipe da academia vê o próprio andamento, as mensagens e a
-- evasão; a ArkeFit vê tudo. Os chamados são só da ArkeFit. Escrita só pelas
-- funções abaixo — sem regra de inclusão, alteração ou exclusão.
create policy "leitura" on public.implantacao for select to authenticated using (
  public.is_org_staff((select auth.uid()), organization_id)
  or public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke')
);
create policy "leitura" on public.implantacao_mensagens for select to authenticated using (
  public.is_org_staff((select auth.uid()), organization_id)
  or public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke')
);
create policy "leitura" on public.academia_evasao_anterior for select to authenticated using (
  public.is_org_staff((select auth.uid()), organization_id)
  or public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke')
);
create policy "leitura" on public.implantacao_chamados for select to authenticated using (
  public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke')
);
revoke all on public.implantacao, public.implantacao_mensagens, public.academia_evasao_anterior, public.implantacao_chamados from anon;
revoke insert, update, delete on public.implantacao, public.implantacao_mensagens, public.academia_evasao_anterior, public.implantacao_chamados from authenticated;

-- ── As etapas ──────────────────────────────────────────────────────────────
-- As seis da configuração vêm de onboarding_etapas_interno, sem cópia. Depois
-- delas, a liberação do app, a primeira entrada (no autônomo, que não tem
-- catraca nem check-in por QR, o primeiro aluno no app) e o lançamento.
-- `principal` é a sequência que o agente acompanha; a evasão anterior e a
-- aprovação do Asaas aparecem no painel, mas não travam nada.
create or replace function public.implantacao_etapas(_organization_id uuid)
returns table(etapa text, ordem integer, principal boolean, concluida boolean, detalhe text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o public.organizations%rowtype;
  v_concluida timestamptz;
  v_primeira timestamptz;
  v_gateway boolean;
  v_n integer;
begin
  select * into o from public.organizations where id = _organization_id;
  if not found then
    return;
  end if;
  select i.concluida_em into v_concluida from public.implantacao i where i.organization_id = _organization_id;

  return query
    select e.etapa,
           array_position(array['dados', 'recebimentos', 'planos', 'equipe', 'alunos', 'contrato'], e.etapa)::integer,
           true, e.concluida, e.detalhe
      from public.onboarding_etapas_interno(_organization_id) e;

  etapa := 'liberacao';
  ordem := 7;
  principal := true;
  concluida := o.onboarding_completed;
  detalhe := case
    when o.onboarding_completed then 'App liberado aos alunos em ' || to_char(coalesce(o.onboarding_concluido_em, o.updated_at), 'DD/MM/YYYY')
    else 'Com as seis etapas prontas, conclua para liberar o app aos alunos'
  end;
  return next;

  if o.tipo = 'profissional_autonomo' then
    select min(a.primeiro_acesso_em) into v_primeira
      from public.alunos a where a.organization_id = _organization_id and a.primeiro_acesso_em is not null;
    etapa := 'primeiro_aluno_app';
    ordem := 8;
    principal := true;
    concluida := v_primeira is not null;
    detalhe := case
      when v_primeira is not null then 'Primeiro aluno no app em ' || to_char(v_primeira, 'DD/MM/YYYY')
      else 'Mande o convite de primeiro acesso aos seus alunos'
    end;
    return next;
  else
    select min(p.registrada_em) into v_primeira from public.presencas p where p.organization_id = _organization_id;
    select exists (
      select 1 from public.organizacao_catracas c
        join public.gateway_telemetria t on t.catraca_id = c.id
       where c.organization_id = _organization_id and c.status = 'ativo'
    ) into v_gateway;
    etapa := 'primeira_entrada';
    ordem := 8;
    principal := true;
    concluida := v_primeira is not null;
    detalhe := case
      when v_primeira is not null then 'Primeira entrada em ' || to_char(v_primeira, 'DD/MM/YYYY')
      when v_gateway then 'Catraca no ar: falta a primeira entrada de um aluno'
      else 'Catraca com o Gateway, ou check-in por QR Code na recepção'
    end;
    return next;
  end if;

  etapa := 'lancamento';
  ordem := 9;
  principal := true;
  concluida := v_concluida is not null;
  detalhe := case
    when v_concluida is not null then 'Kit de lançamento enviado em ' || to_char(v_concluida, 'DD/MM/YYYY')
    else 'O kit para chamar todos os alunos sai depois da primeira entrada'
  end;
  return next;

  select count(*) into v_n from public.academia_evasao_anterior e where e.organization_id = _organization_id;
  etapa := 'evasao_anterior';
  ordem := 10;
  principal := false;
  concluida := v_n >= 6;
  detalhe := case
    when v_n >= 6 then 'Informada'
    when v_n > 0 then v_n || ' de 6 meses informados'
    else 'Evasão dos 6 meses antes do ArkeFit'
  end;
  return next;

  etapa := 'asaas_aprovada';
  ordem := 11;
  principal := false;
  concluida := o.asaas_wallet_id is not null
               and (o.asaas_conta_origem is distinct from 'criada' or o.asaas_conta_status = 'APPROVED');
  detalhe := case
    when o.asaas_wallet_id is null then 'Conta de recebimentos ainda não configurada'
    when o.asaas_conta_origem is distinct from 'criada' then 'Conta Asaas da própria academia'
    when o.asaas_conta_status = 'APPROVED' then 'Conta aprovada pelo Asaas'
    when o.asaas_conta_status = 'REJECTED' then 'Conta recusada pelo Asaas: veja o motivo no e-mail deles'
    else 'Aguardando a aprovação do Asaas'
  end;
  return next;
end;
$$;
revoke execute on function public.implantacao_etapas(uuid) from public, anon, authenticated;
grant execute on function public.implantacao_etapas(uuid) to service_role;

-- Os 6 meses antes do mês em que a academia começou no ArkeFit.
create or replace function public.janela_evasao_anterior(_organization_id uuid)
returns table(inicio date, fim date)
language sql
stable
security definer
set search_path = public
as $$
  select (date_trunc('month', o.created_at) - interval '6 months')::date,
         (date_trunc('month', o.created_at) - interval '1 month')::date
    from public.organizations o where o.id = _organization_id;
$$;
revoke execute on function public.janela_evasao_anterior(uuid) from public, anon, authenticated;
grant execute on function public.janela_evasao_anterior(uuid) to service_role;

-- ── O painel da academia ───────────────────────────────────────────────────
create or replace function public.get_implantacao_organizacao(_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  i public.implantacao%rowtype;
  o public.organizations%rowtype;
  v_janela record;
begin
  if not (public.is_org_staff(v_uid, _organization_id)
          or public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'Acesso restrito à equipe da academia.' using errcode = '42501';
  end if;
  select * into o from public.organizations where id = _organization_id;
  if not found then
    return null;
  end if;
  select * into i from public.implantacao where organization_id = _organization_id;
  select * into v_janela from public.janela_evasao_anterior(_organization_id);

  return jsonb_build_object(
    'etapas', coalesce((select jsonb_agg(to_jsonb(e) order by e.ordem) from public.implantacao_etapas(_organization_id) e), '[]'::jsonb),
    'iniciada_em', coalesce(i.iniciada_em, o.created_at),
    'etapa_atual', i.etapa_atual,
    'etapa_atual_desde', i.etapa_atual_desde,
    'concluida_em', i.concluida_em,
    'slug', o.slug,
    'agente_ativo', coalesce((select valor = 1 from public.plataforma_config where chave = 'agente_implantacao_ativo'), false),
    'mensagens', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', m.tipo, 'etapa', m.etapa, 'motivo', m.motivo, 'enviado_em', m.enviado_em)
                       order by m.enviado_em desc)
        from (select * from public.implantacao_mensagens m
               where m.organization_id = _organization_id and m.status = 'enviada' and m.tipo <> 'chamado_arkefit'
               order by m.enviado_em desc limit 30) m
    ), '[]'::jsonb),
    'evasao_janela', jsonb_build_object('inicio', v_janela.inicio, 'fim', v_janela.fim),
    'evasao', coalesce((
      select jsonb_agg(jsonb_build_object('mes', e.mes, 'alunos_inicio', e.alunos_inicio, 'saidas', e.saidas) order by e.mes)
        from public.academia_evasao_anterior e where e.organization_id = _organization_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.get_implantacao_organizacao(uuid) from public, anon;
grant execute on function public.get_implantacao_organizacao(uuid) to authenticated, service_role;

-- A gestão (ou a ArkeFit) informa a evasão dos 6 meses anteriores. Substitui
-- o que havia: a tela manda sempre os meses que tem.
create or replace function public.salvar_evasao_anterior(_organization_id uuid, _meses jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_janela record;
  v_item jsonb;
  v_mes date;
  v_inicio integer;
  v_saidas integer;
  v_n integer := 0;
begin
  if not (public.has_org_role(v_uid, _organization_id, 'gestor')
          or public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'Só a gestão da academia informa a evasão anterior.' using errcode = '42501';
  end if;
  if jsonb_typeof(_meses) is distinct from 'array' then
    raise exception 'Formato inválido.' using errcode = '22023';
  end if;
  select * into v_janela from public.janela_evasao_anterior(_organization_id);
  if v_janela.inicio is null then
    raise exception 'Academia não encontrada.' using errcode = 'P0002';
  end if;

  delete from public.academia_evasao_anterior where organization_id = _organization_id;
  for v_item in select * from jsonb_array_elements(_meses) loop
    begin
      v_mes := (v_item->>'mes' || '-01')::date;
      v_inicio := (v_item->>'alunos_inicio')::integer;
      v_saidas := (v_item->>'saidas')::integer;
    exception when others then
      raise exception 'Mês ou número inválido.' using errcode = '22023';
    end;
    if v_mes < v_janela.inicio or v_mes > v_janela.fim then
      raise exception 'O mês % está fora dos 6 meses antes do ArkeFit.', to_char(v_mes, 'MM/YYYY') using errcode = '22023';
    end if;
    if v_inicio is null or v_inicio <= 0 then
      raise exception 'Em %, informe quantos alunos estavam ativos no começo do mês.', to_char(v_mes, 'MM/YYYY') using errcode = '22023';
    end if;
    if v_saidas is null or v_saidas < 0 or v_saidas > v_inicio then
      raise exception 'Em %, as saídas vão de zero aos alunos ativos no começo do mês.', to_char(v_mes, 'MM/YYYY') using errcode = '22023';
    end if;
    insert into public.academia_evasao_anterior (organization_id, mes, alunos_inicio, saidas, informado_por)
    values (_organization_id, v_mes, v_inicio, v_saidas, v_uid)
    on conflict (organization_id, mes) do update
      set alunos_inicio = excluded.alunos_inicio, saidas = excluded.saidas,
          informado_por = excluded.informado_por, informado_em = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.salvar_evasao_anterior(uuid, jsonb) from public, anon;
grant execute on function public.salvar_evasao_anterior(uuid, jsonb) to authenticated;

-- ── O agente ───────────────────────────────────────────────────────────────
-- Quem está em implantação: academia (e autônomo) ativa ou inadimplente, sem
-- encerramento em andamento, que ainda não recebeu o kit — ou que recebeu e
-- ainda espera a aprovação do Asaas, que o agente confere todo dia. Trial é
-- homologação e fica de fora. A linha de `implantacao` nasce aqui, com a data
-- de criação da academia.
create or replace function public.implantacoes_para_agente()
returns table(
  organization_id uuid, nome text, slug text, tipo text, status text,
  emails text[], etapas jsonb,
  iniciada_em timestamptz, etapa_atual text, etapa_atual_desde timestamptz, concluida_em timestamptz,
  asaas_conta_origem text, asaas_conta_status text, asaas_conferido_em timestamptz,
  mensagens jsonb, chamados jsonb, evasao_inicio date, evasao_fim date
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  insert into public.implantacao (organization_id, iniciada_em)
  select o.id, o.created_at
    from public.organizations o
   where o.status in ('ativo', 'inadimplente')
     and not exists (select 1 from public.implantacao i where i.organization_id = o.id)
  on conflict (organization_id) do nothing;

  return query
  select o.id, o.nome, o.slug, o.tipo::text, o.status::text,
         array(
           select distinct lower(btrim(x.email)) from (
             select o.email_contato as email
             union all
             select u.email from public.organization_members m join auth.users u on u.id = m.user_id
              where m.organization_id = o.id and m.role = 'gestor' and m.status = 'active'
           ) x where coalesce(btrim(x.email), '') ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
         ),
         coalesce((select jsonb_agg(to_jsonb(e) order by e.ordem) from public.implantacao_etapas(o.id) e), '[]'::jsonb),
         i.iniciada_em, i.etapa_atual, i.etapa_atual_desde, i.concluida_em,
         o.asaas_conta_origem, o.asaas_conta_status, i.asaas_conferido_em,
         coalesce((select jsonb_agg(jsonb_build_object('tipo', m.tipo, 'chave', m.chave, 'etapa', m.etapa, 'status', m.status,
                                                       'criado_em', m.criado_em, 'enviado_em', m.enviado_em))
                     from public.implantacao_mensagens m where m.organization_id = o.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('etapa', c.etapa, 'aberto_em', c.aberto_em,
                                                       'concluido_em', c.concluido_em, 'proxima_checagem', c.proxima_checagem))
                     from public.implantacao_chamados c where c.organization_id = o.id), '[]'::jsonb),
         (date_trunc('month', o.created_at) - interval '6 months')::date,
         (date_trunc('month', o.created_at) - interval '1 month')::date
    from public.organizations o
    join public.implantacao i on i.organization_id = o.id
   where o.status in ('ativo', 'inadimplente')
     and not exists (select 1 from public.organizacao_encerramentos en
                      where en.organization_id = o.id and en.retirado_em is null and en.eliminada_em is null)
     and (i.concluida_em is null
          or (o.asaas_conta_origem = 'criada' and o.asaas_conta_status is distinct from 'APPROVED'))
   order by i.iniciada_em;
end;
$$;
revoke execute on function public.implantacoes_para_agente() from public, anon, authenticated;
grant execute on function public.implantacoes_para_agente() to service_role;

-- A etapa principal pendente que o agente viu. Mudou: o relógio recomeça.
create or replace function public.registrar_etapa_implantacao(_organization_id uuid, _etapa text)
returns timestamptz
language sql
security definer
set search_path = public
as $$
  insert into public.implantacao as i (organization_id, etapa_atual, etapa_atual_desde)
  values (_organization_id, _etapa, now())
  on conflict (organization_id) do update
    set etapa_atual = excluded.etapa_atual,
        etapa_atual_desde = case when i.etapa_atual is distinct from excluded.etapa_atual or i.etapa_atual_desde is null
                                 then now() else i.etapa_atual_desde end,
        updated_at = now()
  returning etapa_atual_desde;
$$;
revoke execute on function public.registrar_etapa_implantacao(uuid, text) from public, anon, authenticated;
grant execute on function public.registrar_etapa_implantacao(uuid, text) to service_role;

-- Reserva a mensagem antes do envio, no desenho da Letícia: duas rodadas não
-- mandam a mesma. A que falhou, ou cuja reserva tem mais de 15 minutos (rodada
-- que caiu), pode ser tentada de novo.
create or replace function public.reservar_mensagem_implantacao(
  _organization_id uuid, _tipo text, _chave text, _etapa text, _motivo text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with r as (
    insert into public.implantacao_mensagens as m (organization_id, tipo, chave, etapa, motivo)
    values (_organization_id, _tipo, _chave, _etapa, _motivo)
    on conflict (organization_id, tipo, chave) do update
      set status = 'reservada', criado_em = now(), erro = null, motivo = excluded.motivo
      where m.status = 'falhou' or (m.status = 'reservada' and m.criado_em < now() - interval '15 minutes')
    returning 1
  )
  select exists (select 1 from r);
$$;
revoke execute on function public.reservar_mensagem_implantacao(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.reservar_mensagem_implantacao(uuid, text, text, text, text) to service_role;

create or replace function public.concluir_mensagem_implantacao(
  _organization_id uuid, _tipo text, _chave text, _ok boolean, _resend_id text, _erro text, _destinatarios integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.implantacao_mensagens
     set status = case when _ok then 'enviada' else 'falhou' end,
         enviado_em = case when _ok then now() end,
         resend_id = _resend_id,
         erro = case when _ok then null else left(coalesce(_erro, 'Falhou sem detalhe.'), 300) end,
         destinatarios = _destinatarios
   where organization_id = _organization_id and tipo = _tipo and chave = _chave;
$$;
revoke execute on function public.concluir_mensagem_implantacao(uuid, text, text, boolean, text, text, integer) from public, anon, authenticated;
grant execute on function public.concluir_mensagem_implantacao(uuid, text, text, boolean, text, text, integer) to service_role;

-- Abre o chamado da ArkeFit. Um aberto por academia; e a mesma etapa só volta
-- a chamar depois da próxima checagem combinada no desfecho do anterior
-- (desfecho sem próxima checagem encerra o assunto daquela etapa).
create or replace function public.abrir_chamado_implantacao(_organization_id uuid, _etapa text, _motivo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if exists (select 1 from public.implantacao_chamados where organization_id = _organization_id and concluido_em is null) then
    return null;
  end if;
  if exists (select 1 from public.implantacao_chamados
              where organization_id = _organization_id and etapa = _etapa
                and (proxima_checagem is null or proxima_checagem > now())) then
    return null;
  end if;
  insert into public.implantacao_chamados (organization_id, etapa, motivo, prazo)
  values (_organization_id, _etapa, _motivo, public.prazo_util(now(), 4))
  on conflict do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.abrir_chamado_implantacao(uuid, text, text) from public, anon, authenticated;
grant execute on function public.abrir_chamado_implantacao(uuid, text, text) to service_role;

create or replace function public.marcar_implantacao_concluida(_organization_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.implantacao set concluida_em = coalesce(concluida_em, now()), updated_at = now()
   where organization_id = _organization_id;
$$;
revoke execute on function public.marcar_implantacao_concluida(uuid) from public, anon, authenticated;
grant execute on function public.marcar_implantacao_concluida(uuid) to service_role;

-- A consulta diária ao Asaas: grava a situação quando veio, e a hora da
-- tentativa sempre, para uma falha não virar uma consulta por hora.
create or replace function public.registrar_conferencia_asaas_implantacao(_organization_id uuid, _status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if _status is not null then
    update public.organizations set asaas_conta_status = _status, asaas_conta_status_em = now() where id = _organization_id;
  end if;
  update public.implantacao set asaas_conferido_em = now(), updated_at = now() where organization_id = _organization_id;
end;
$$;
revoke execute on function public.registrar_conferencia_asaas_implantacao(uuid, text) from public, anon, authenticated;
grant execute on function public.registrar_conferencia_asaas_implantacao(uuid, text) to service_role;

-- ── A ArkeFit ──────────────────────────────────────────────────────────────
create or replace function public.definir_agente_implantacao(_ativo boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not (public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'Só a ArkeFit liga o agente de implantação.' using errcode = '42501';
  end if;
  update public.plataforma_config set valor = case when _ativo then 1 else 0 end, updated_at = now(), updated_by = v_uid
   where chave = 'agente_implantacao_ativo';
  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, detalhes)
  select v_uid, u.email, case when _ativo then 'agente_implantacao.ligar' else 'agente_implantacao.desligar' end,
         'plataforma_config', null, jsonb_build_object('ativo', _ativo)
    from (select 1) um
    left join auth.users u on u.id = v_uid;
end;
$$;
revoke execute on function public.definir_agente_implantacao(boolean) from public, anon;
grant execute on function public.definir_agente_implantacao(boolean) to authenticated;

create or replace function public.get_superadmin_implantacoes()
returns table(
  organization_id uuid, nome text, tipo text, status text,
  iniciada_em timestamptz, etapa_atual text, etapa_atual_desde timestamptz, concluida_em timestamptz,
  etapas_feitas integer, etapas_total integer,
  asaas_conta_status text, evasao_meses integer,
  ultima_mensagem jsonb, chamado jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if not (public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return query
  select o.id, o.nome, o.tipo::text, o.status::text,
         i.iniciada_em, i.etapa_atual, i.etapa_atual_desde, i.concluida_em,
         (select count(*)::integer from public.implantacao_etapas(o.id) e where e.principal and e.concluida),
         (select count(*)::integer from public.implantacao_etapas(o.id) e where e.principal),
         o.asaas_conta_status,
         (select count(*)::integer from public.academia_evasao_anterior ev where ev.organization_id = o.id),
         (select jsonb_build_object('tipo', m.tipo, 'etapa', m.etapa, 'enviado_em', m.enviado_em)
            from public.implantacao_mensagens m
           where m.organization_id = o.id and m.status = 'enviada'
           order by m.enviado_em desc limit 1),
         (select jsonb_build_object('id', c.id, 'etapa', c.etapa, 'motivo', c.motivo, 'aberto_em', c.aberto_em, 'prazo', c.prazo)
            from public.implantacao_chamados c
           where c.organization_id = o.id and c.concluido_em is null)
    from public.implantacao i
    join public.organizations o on o.id = i.organization_id
   where i.concluida_em is null or i.concluida_em > now() - interval '30 days'
   order by (select 1 from public.implantacao_chamados c where c.organization_id = o.id and c.concluido_em is null) nulls last,
            i.concluida_em nulls first, i.etapa_atual_desde nulls last;
end;
$$;
revoke execute on function public.get_superadmin_implantacoes() from public, anon;
grant execute on function public.get_superadmin_implantacoes() to authenticated;

create or replace function public.concluir_chamado_implantacao(
  _chamado_id uuid, _acao text, _desfecho text, _proxima_checagem timestamptz default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  if not (public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'Só a ArkeFit encerra o chamado de implantação.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(_acao, ''))) < 3 or length(btrim(coalesce(_desfecho, ''))) < 3 then
    raise exception 'Registre o que foi feito e o desfecho.' using errcode = '22023';
  end if;
  if _proxima_checagem is not null and _proxima_checagem <= now() then
    raise exception 'A próxima checagem precisa ser no futuro.' using errcode = '22023';
  end if;
  update public.implantacao_chamados
     set acao = btrim(_acao), desfecho = btrim(_desfecho), proxima_checagem = _proxima_checagem,
         responsavel_id = v_uid, concluido_em = now()
   where id = _chamado_id and concluido_em is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Chamado não encontrado ou já encerrado.' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.concluir_chamado_implantacao(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.concluir_chamado_implantacao(uuid, text, text, timestamptz) to authenticated;

-- ── O lembrete antigo sai inteiro ──────────────────────────────────────────
select cron.unschedule(jobid) from cron.job where jobname = 'arke-lembrete-onboarding';
drop function if exists public.organizacoes_onboarding_parado();
drop function if exists public.registrar_lembrete_onboarding(uuid);
drop function if exists public.conferir_token_lembrete_onboarding(text);
delete from vault.secrets where name = 'lembrete_onboarding_token';
delete from public.execucoes_agendadas where nome = 'lembrete-onboarding';
delete from public.alertas_rotinas where nome = 'arke-lembrete-onboarding';
alter table public.organizations drop column if exists onboarding_lembrete_em, drop column if exists onboarding_lembretes;

-- ── A rotina ───────────────────────────────────────────────────────────────
-- De hora em hora, aos 20 minutos, com o token do alerta de rotinas. A função
-- registra o próprio desfecho (execucoes_agendadas) e entra na vigilância de
-- sempre. Manda e-mail a academias, então não entra na lista das rotinas que
-- o Vigia roda de novo sozinho.
insert into public.execucoes_agendadas (nome, ultima_ok) values ('agente-implantacao', now())
on conflict (nome) do nothing;

select cron.unschedule(jobid) from cron.job where jobname = 'arke-agente-implantacao';
select cron.schedule(
  'arke-agente-implantacao',
  '20 * * * *',
  $cron$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/agente-implantacao',
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
