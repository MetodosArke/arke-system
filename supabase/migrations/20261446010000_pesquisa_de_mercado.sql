-- A pesquisa de mercado com donos e gestores de academia (15/10/2026).
--
-- Uma página pública no site (`/pesquisa`), sem login, que pergunta quais
-- recursos de um sistema de gestão fazem diferença no dia a dia de quem toca
-- uma academia. É pesquisa neutra e anônima. O questionário mora num módulo
-- só (`supabase/functions/pesquisa-mercado/questionario.ts`), lido pela tela e
-- pela edge function `pesquisa-mercado`, que confere cada resposta contra a
-- lista fechada antes de chamar `registrar_pesquisa_mercado`.
--
-- Duas tabelas da plataforma, sem organization_id (a exceção declarada, como
-- `plataforma_config`: a pesquisa é da ArkeFit, não de uma academia), com o
-- RLS ligado e sem regra: só a service role e as funções abaixo.
--   1. `pesquisa_mercado_respostas`: as respostas em jsonb, a versão do
--      questionário e só a data, sem a hora. Nada liga a resposta ao e-mail.
--   2. `pesquisa_mercado_emails`: o e-mail de quem autorizou o uso dele, com a
--      data de cada uma das duas autorizações (receber o resultado; conhecer o
--      ArkeFit), sem ligação com a resposta. Sai 12 meses depois da última
--      autorização.
-- Nenhuma das duas guarda o IP: o freio da função usa o hash dele.
--
-- Quem marca "Quero também conhecer o ArkeFit" vira contato do Pipeline como
-- qualquer pedido do site (`origem = 'site'`, `origem_detalhe = 'Pesquisa de
-- mercado'`): a Letícia responde (`leads_para_agente_comercial` olha só a
-- origem) e o comercial recebe o mesmo aviso do formulário da página de vendas
-- (`lead-site/avisarComercial.ts`). Vão ao contato o nome, a academia e o
-- e-mail; as respostas, não. Quem só quer o resultado não vira contato.
--
-- A leitura: `get_superadmin_pesquisa_mercado()`, para a área comercial; e
-- `exportar_emails_pesquisa_mercado()`, só para o Sócio (duas etapas), que vai
-- para a auditoria.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. As respostas
-- ---------------------------------------------------------------------------
create table public.pesquisa_mercado_respostas (
  id uuid primary key default gen_random_uuid(),
  versao smallint not null check (versao > 0),
  respostas jsonb not null check (jsonb_typeof(respostas) = 'object' and octet_length(respostas::text) <= 20000),
  -- Só a data: com a hora, a resposta se ligaria ao e-mail e ao contato
  -- gravados no mesmo instante.
  respondida_em date not null default current_date
);

comment on table public.pesquisa_mercado_respostas is
  'Pesquisa de mercado do site (/pesquisa): as respostas, anônimas, com a versão do questionário e só a data. Tabela da plataforma, sem organization_id. Grava: registrar_pesquisa_mercado() (edge function pesquisa-mercado). Lê: get_superadmin_pesquisa_mercado() (área comercial).';

alter table public.pesquisa_mercado_respostas enable row level security;
revoke all on public.pesquisa_mercado_respostas from anon, authenticated;
grant select, insert, delete on public.pesquisa_mercado_respostas to service_role;

-- ---------------------------------------------------------------------------
-- 2. Os e-mails, só com autorização
-- ---------------------------------------------------------------------------
create table public.pesquisa_mercado_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique
    check (char_length(email) <= 200 and email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  resultado_autorizado_em timestamptz,
  conhecer_autorizado_em timestamptz,
  constraint pesquisa_mercado_emails_autorizado_check
    check (resultado_autorizado_em is not null or conhecer_autorizado_em is not null)
);

comment on table public.pesquisa_mercado_emails is
  'Pesquisa de mercado: o e-mail de quem autorizou, com a data de cada autorização (receber o resultado; conhecer o ArkeFit). Sem ligação com as respostas. Tabela da plataforma, sem organization_id. Grava: registrar_pesquisa_mercado(). Lê: exportar_emails_pesquisa_mercado() (Sócio). Sai 12 meses depois da última autorização.';

alter table public.pesquisa_mercado_emails enable row level security;
revoke all on public.pesquisa_mercado_emails from anon, authenticated;
grant select, insert, update, delete on public.pesquisa_mercado_emails to service_role;

-- ---------------------------------------------------------------------------
-- 3. Gravar: a resposta, o e-mail e o contato, numa transação só
-- ---------------------------------------------------------------------------
-- A edge function já validou tudo pelo questionário; as checagens das tabelas
-- são a última trava. Devolve o id do contato do Pipeline, quando houve.
create or replace function public.registrar_pesquisa_mercado(
  _versao smallint,
  _respostas jsonb,
  _email text default null,
  _resultado boolean default false,
  _conhecer boolean default false,
  _nome text default null,
  _academia text default null,
  _ip_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead uuid;
begin
  insert into public.pesquisa_mercado_respostas (versao, respostas) values (_versao, _respostas);

  if _email is not null and (coalesce(_resultado, false) or coalesce(_conhecer, false)) then
    -- A mesma pessoa respondendo de novo soma a autorização nova à antiga.
    insert into public.pesquisa_mercado_emails as e (email, resultado_autorizado_em, conhecer_autorizado_em)
    values (_email,
            case when _resultado then now() end,
            case when _conhecer then now() end)
    on conflict (email) do update
      set resultado_autorizado_em = coalesce(excluded.resultado_autorizado_em, e.resultado_autorizado_em),
          conhecer_autorizado_em = coalesce(excluded.conhecer_autorizado_em, e.conhecer_autorizado_em);
  end if;

  if coalesce(_conhecer, false) then
    insert into public.leads_comerciais (nome, academia, email, origem, origem_detalhe, ip_hash)
    values (_nome, _academia, _email, 'site', 'Pesquisa de mercado', _ip_hash)
    returning id into v_lead;
  end if;

  return v_lead;
end;
$$;

revoke execute on function public.registrar_pesquisa_mercado(smallint, jsonb, text, boolean, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_pesquisa_mercado(smallint, jsonb, text, boolean, boolean, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Ler: as respostas (área comercial) e os e-mails (Sócio)
-- ---------------------------------------------------------------------------
-- A tela pagina de mil em mil (`todasAsLinhas`), por respondida_em e id.
create or replace function public.get_superadmin_pesquisa_mercado()
returns table (id uuid, versao smallint, respondida_em date, respostas jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.acesso_arkefit('comercial') then
    raise exception 'Só a equipe comercial da ArkeFit vê a pesquisa de mercado.' using errcode = '42501';
  end if;

  return query
    select r.id, r.versao, r.respondida_em, r.respostas
      from public.pesquisa_mercado_respostas r;
end;
$$;

revoke execute on function public.get_superadmin_pesquisa_mercado() from public, anon;
grant execute on function public.get_superadmin_pesquisa_mercado() to authenticated;

-- Os e-mails, num valor só (sem o corte de mil linhas da API), e a exportação
-- vai para a auditoria, sem os endereços.
create or replace function public.exportar_emails_pesquisa_mercado()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lista jsonb;
begin
  if not public.has_role(v_uid, 'superadmin') then
    raise exception 'Só o Sócio, com as duas etapas, exporta os e-mails da pesquisa.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'email', e.email,
           'resultado_autorizado_em', e.resultado_autorizado_em,
           'conhecer_autorizado_em', e.conhecer_autorizado_em)
           order by e.email), '[]'::jsonb)
    into v_lista
    from public.pesquisa_mercado_emails e;

  perform public.registrar_auditoria(
    v_uid, 'pesquisa_mercado.emails_exportados', 'pesquisa_mercado_emails', null, null,
    jsonb_build_object('total', jsonb_array_length(v_lista)));

  return v_lista;
end;
$$;

revoke execute on function public.exportar_emails_pesquisa_mercado() from public, anon;
grant execute on function public.exportar_emails_pesquisa_mercado() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A guarda dos e-mails: 12 meses depois da última autorização
-- ---------------------------------------------------------------------------
create or replace function public.limpar_pesquisa_mercado_emails()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  apagados integer;
begin
  delete from public.pesquisa_mercado_emails
   where greatest(resultado_autorizado_em, conhecer_autorizado_em) < now() - interval '12 months';
  get diagnostics apagados = row_count;
  return apagados;
end;
$$;

revoke all on function public.limpar_pesquisa_mercado_emails() from public, anon, authenticated;

select cron.schedule('arke-retencao-pesquisa-mercado', '55 3 * * *', $cmd$select public.limpar_pesquisa_mercado_emails()$cmd$);
