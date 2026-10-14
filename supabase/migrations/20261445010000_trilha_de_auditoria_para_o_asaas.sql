-- A esteira de auditoria do contrato BaaS com o Asaas (14/10/2026).
--
-- O contrato multa (nível 2) a entrega atrasada ou incompleta de
-- "informações, logs, evidências" para auditoria, e o parecer de 13/10 pede
-- o registro de quem fez o quê, de qual IP e quando, pronto para exportar. A
-- revisão de segurança de 13/10 achou duas lacunas:
--   1. a mudança em `plataforma_config` e `plataforma_textos` (a taxa do
--      gateway, os interruptores, o link da agenda...) não ia para a trilha,
--      salvo as poucas que passam por uma função que registra;
--   2. a tentativa de entrar que falha ficava só nos logs do Supabase, que
--      guardam por pouco tempo.
--
-- O que muda:
--   1. Um gatilho em cada uma das duas tabelas grava toda inclusão, alteração e
--      exclusão em `auditoria_acoes_sensiveis`: quem (`auth.uid()`; nulo é o
--      servidor: a service role ou uma migration), a chave, o valor de antes e
--      o de depois. Nenhuma das duas guarda segredo: `plataforma_config` só
--      guarda número, e `plataforma_textos` é lida por toda sessão logada
--      (regra "leitura", 20261210020000). Por isso o valor vai inteiro.
--   2. `tentativas_login_falhas`: a tentativa de entrar que falhou, por 6
--      meses, como os registros de acesso. O IP só como hash (o mesmo SHA-256
--      com pimenta do limite de tentativas), a conta pelo id quando existe e,
--      quando não existe, só o hash do e-mail digitado: a Política (seção 2)
--      não prevê o e-mail de quem errou o endereço, e a trilha não guarda
--      e-mail. A senha nunca chega aqui. Quem grava é a função
--      `registrar-falha-login`, chamada pela tela de entrar depois do erro.
--   3. A rotina `arke-registros-de-acesso` passa a apagar também as tentativas
--      com mais de 6 meses, respeitando a ordem judicial de preservação.
--   4. `exportar_trilha_auditoria(de, até)`: a exportação do período na Visão
--      Master → Auditoria. Só o Sócio, com as duas etapas (`has_role`), e a
--      exportação vai ela mesma para a trilha.

set lock_timeout = '5s';

-- ── 1. A configuração da plataforma na trilha ──────────────────────────────

create or replace function public.auditar_configuracao_plataforma()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chave jsonb;
  v_de jsonb;
  v_para jsonb;
begin
  -- Toda chave, sem lista: chave nova cai na trilha no dia em que nasce
  -- (`trilhaDeAuditoria.guarda`).
  if tg_op = 'INSERT' then
    v_chave := to_jsonb(new.chave);
    v_para := to_jsonb(new.valor);
  elsif tg_op = 'DELETE' then
    v_chave := to_jsonb(old.chave);
    v_de := to_jsonb(old.valor);
  else
    -- A descrição e o carimbo de quem mudou não são a configuração.
    if new.chave is not distinct from old.chave and new.valor is not distinct from old.valor then
      return null;
    end if;
    v_chave := case when new.chave is distinct from old.chave
                    then jsonb_build_object('de', old.chave, 'para', new.chave)
                    else to_jsonb(new.chave) end;
    v_de := to_jsonb(old.valor);
    v_para := to_jsonb(new.valor);
  end if;

  perform public.registrar_auditoria(
    auth.uid(), 'configuracao.alterada', tg_table_name, null, null,
    jsonb_build_object('chave', v_chave, 'valor', jsonb_build_object('de', v_de, 'para', v_para)));
  return null;
end;
$$;

revoke execute on function public.auditar_configuracao_plataforma() from public, anon, authenticated;

drop trigger if exists trg_auditar_plataforma_config on public.plataforma_config;
create trigger trg_auditar_plataforma_config
  after insert or update or delete on public.plataforma_config
  for each row execute function public.auditar_configuracao_plataforma();

drop trigger if exists trg_auditar_plataforma_textos on public.plataforma_textos;
create trigger trg_auditar_plataforma_textos
  after insert or update or delete on public.plataforma_textos
  for each row execute function public.auditar_configuracao_plataforma();

-- ── 2. As tentativas de entrar que falham ──────────────────────────────────

-- Tabela da plataforma, sem organização: a tentativa é da pessoa na aplicação,
-- e muitas vezes nem se sabe quem é. Exceção declarada, como os registros de
-- acesso.
create table if not exists public.tentativas_login_falhas (
  id uuid primary key default gen_random_uuid(),
  em timestamptz not null default now(),
  -- A conta, quando o e-mail digitado é de alguém.
  user_id uuid,
  -- SHA-256 com pimenta do e-mail digitado, só quando a conta não existe.
  email_hash text check (email_hash ~ '^[0-9a-f]{64}$'),
  -- SHA-256 com pimenta do IP, como no limite de tentativas. Nunca o endereço.
  ip_hash text check (ip_hash ~ '^[0-9a-f]{64}$'),
  -- O código do erro do Auth (invalid_credentials, email_not_confirmed...).
  motivo text not null check (motivo ~ '^[a-z0-9_]{1,40}$'),
  check (user_id is null or email_hash is null)
);

create index if not exists idx_tentativas_login_falhas_em on public.tentativas_login_falhas (em);

comment on table public.tentativas_login_falhas is
  'Tentativas de entrar que falharam, por 6 meses: a conta (ou o hash do e-mail digitado), o hash do IP e o codigo do erro. So a service role grava; a leitura e a exportacao da trilha pela Visao Master (Socio, duas etapas).';

alter table public.tentativas_login_falhas enable row level security;
revoke all on public.tentativas_login_falhas from anon, authenticated;

-- O e-mail chega em claro só para achar a conta; não é gravado.
create or replace function public.registrar_falha_login(_email text, _email_hash text, _ip_hash text, _motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if coalesce(_email_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'registrar_falha_login: o hash do e-mail é obrigatório' using errcode = '22023';
  end if;
  select u.id into v_user from auth.users u where u.email = lower(btrim(_email)) limit 1;
  insert into public.tentativas_login_falhas (user_id, email_hash, ip_hash, motivo)
  values (v_user, case when v_user is null then _email_hash end, _ip_hash, _motivo);
end;
$$;

revoke execute on function public.registrar_falha_login(text, text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_falha_login(text, text, text, text) to service_role;

-- ── 3. Os 6 meses: a mesma rotina dos registros de acesso ──────────────────
-- O texto de 20261381010000, com as tentativas.
create or replace function public.limpar_registros_acesso_aplicacao()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  m integer;
begin
  delete from public.registros_acesso_aplicacao r
   where r.dia < (current_date - interval '6 months')::date
     and not exists (
       select 1 from public.registros_acesso_preservacoes p
        where p.user_id = r.user_id and p.ate >= current_date
     );
  get diagnostics n = row_count;

  delete from public.tentativas_login_falhas t
   where t.em < now() - interval '6 months'
     and not exists (
       select 1 from public.registros_acesso_preservacoes p
        where p.user_id = t.user_id and p.ate >= current_date
     );
  get diagnostics m = row_count;

  return n + m;
end;
$$;

revoke all on function public.limpar_registros_acesso_aplicacao() from public, anon, authenticated;
grant execute on function public.limpar_registros_acesso_aplicacao() to service_role;

-- ── 4. A exportação do período ─────────────────────────────────────────────
-- Uma linha por registro das três fontes, para o CSV da Visão Master. A tela
-- pagina de mil em mil (`todasAsLinhas`), ordenando por quando, registro e
-- chave.
-- ponytail: cada página relê o período inteiro (paginação por deslocamento);
-- serve enquanto o período tiver poucas centenas de milhares de linhas. Acima
-- disso, paginar por cursor (quando, chave).
create or replace function public.exportar_trilha_auditoria(_de date, _ate date)
returns table (
  registro text,
  chave text,
  quando timestamptz,
  ultimo_em timestamptz,
  pessoa_id uuid,
  email_de_quem_fez text,
  ip text,
  ip_hash text,
  email_hash text,
  acao text,
  entidade text,
  entidade_id uuid,
  organizacao text,
  detalhes jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.has_role(v_uid, 'superadmin') then
    raise exception 'Só o Sócio, com as duas etapas, exporta a trilha de auditoria.' using errcode = '42501';
  end if;
  if _de is null or _ate is null or _ate < _de or _ate - _de > 366 then
    raise exception 'Escolha um período de até 366 dias.' using errcode = '22023';
  end if;

  -- A exportação vai para a trilha uma vez, e não uma por página.
  if not exists (
    select 1 from public.auditoria_acoes_sensiveis a
     where a.acao = 'auditoria.exportada'
       and a.ator_user_id = v_uid
       and a.created_at > now() - interval '1 hour'
       and a.detalhes ->> 'de' = _de::text
       and a.detalhes ->> 'ate' = _ate::text
  ) then
    perform public.registrar_auditoria(
      v_uid, 'auditoria.exportada', 'auditoria_acoes_sensiveis', null, null,
      jsonb_build_object('de', _de, 'ate', _ate));
  end if;

  return query
    select 'acao_sensivel'::text, a.id::text, a.created_at, null::timestamptz, a.ator_user_id, a.ator_email,
           null::text, null::text, null::text, a.acao, a.entidade, a.entidade_id, a.organizacao_nome, a.detalhes
      from public.auditoria_acoes_sensiveis a
     where a.created_at >= _de::timestamptz and a.created_at < (_ate + 1)::timestamptz
    union all
    select 'acesso', r.user_id::text || '|' || host(r.ip) || '|' || r.dia::text, r.primeiro_em, r.ultimo_em, r.user_id, null,
           host(r.ip), null, null, null, null, null, null, null
      from public.registros_acesso_aplicacao r
     where r.dia between _de and _ate
    union all
    select 'entrada_que_falhou', t.id::text, t.em, null, t.user_id, null,
           null, t.ip_hash, t.email_hash, t.motivo, null, null, null, null
      from public.tentativas_login_falhas t
     where t.em >= _de::timestamptz and t.em < (_ate + 1)::timestamptz;
end;
$$;

revoke execute on function public.exportar_trilha_auditoria(date, date) from public, anon;
grant execute on function public.exportar_trilha_auditoria(date, date) to authenticated;
