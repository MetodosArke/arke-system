set lock_timeout = '5s';

-- Aluno menor de idade, parte 2: o aceite do responsável legal (decisão do
-- responsável, 06/10/2026).
--
-- O caminho: o aluno (ou a recepção, para a digital e o rosto) informa o nome
-- e o e-mail do responsável; a função `responsavel-pedido` grava o pedido aqui,
-- gera um token aleatório, guarda só o hash dele e manda o link por e-mail. A
-- página pública do link mostra os textos de consentimento que já existem e já
-- são versionados (saúde, biometria e os dois de IA), e o responsável marca
-- cada propósito. O aceite grava nome, e-mail, propósito, versão e hash do
-- texto, data e hora — um registro por propósito, como os consentimentos do
-- próprio aluno, porque finalidades diferentes pedem autorizações diferentes.
--
-- O aceite do responsável não substitui o consentimento do aluno: libera o
-- aluno para consentir. A trava (migration seguinte) olha este aceite.

-- ── A versão vigente do texto de cada propósito ─────────────────────────────
-- O aceite vale enquanto a versão for a vigente, a mesma regra do
-- consentimento do aluno: texto novo, aceite novo.
create or replace function public.versao_proposito_responsavel(_proposito text)
returns text
language sql
stable
set search_path = public
as $$
  select case _proposito
           when 'saude' then public.versao_consentimento_saude()
           when 'biometria' then public.versao_consentimento_biometrico()
           when 'ia_anamnese' then public.versao_consentimento_ia()
           when 'ia_chat' then public.versao_consentimento_ia()
         end;
$$;

revoke execute on function public.versao_proposito_responsavel(text) from public, anon;
grant execute on function public.versao_proposito_responsavel(text) to authenticated, service_role;

-- ── O pedido ────────────────────────────────────────────────────────────────
create table if not exists public.responsavel_pedidos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  responsavel_nome text not null,
  responsavel_email text not null,
  propositos text[] not null,
  -- SHA-256 do token do link. O token mesmo só existe no e-mail: o banco nunca
  -- o vê, como o do Gateway. Nulo até a função entregar o e-mail — pedido sem
  -- token não abre página nenhuma.
  token_hash text unique,
  expira_em timestamptz not null default now() + interval '7 days',
  pedido_por uuid references auth.users(id) on delete set null,
  pedido_pela text not null,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  respondido_em timestamptz,
  cancelado_em timestamptz,
  constraint responsavel_pedidos_nome check (char_length(btrim(responsavel_nome)) between 3 and 120),
  constraint responsavel_pedidos_email check (
    char_length(responsavel_email) <= 254 and responsavel_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint responsavel_pedidos_propositos check (
    cardinality(propositos) between 1 and 4
    and propositos <@ array['saude', 'biometria', 'ia_anamnese', 'ia_chat']::text[]),
  constraint responsavel_pedidos_token check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  constraint responsavel_pedidos_pela check (pedido_pela in ('aluno', 'academia'))
);

comment on table public.responsavel_pedidos is
  'Pedido de aceite ao responsável legal do aluno menor. O link leva um token cujo hash fica em token_hash; vale 7 dias. Grava só pela função (security definer ou service role).';

create index if not exists idx_responsavel_pedidos_aluno on public.responsavel_pedidos (aluno_id, criado_em desc);
create index if not exists idx_responsavel_pedidos_org on public.responsavel_pedidos (organization_id);
create index if not exists idx_responsavel_pedidos_pedido_por on public.responsavel_pedidos (pedido_por);

-- ── O aceite, um por propósito ──────────────────────────────────────────────
create table if not exists public.responsavel_aceites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  pedido_id uuid references public.responsavel_pedidos(id) on delete set null,
  proposito text not null,
  -- O que foi aceito: a versão e o SHA-256 do texto que a página mostrou
  -- (`_shared/textosResponsavel.ts`, conferido contra o texto do app por
  -- textosConsentimento.test.ts).
  versao_texto text not null,
  texto_sha256 text not null,
  responsavel_nome text not null,
  responsavel_email text not null,
  aceito_em timestamptz not null default now(),
  revogado_em timestamptz,
  revogado_por uuid references auth.users(id) on delete set null,
  constraint responsavel_aceites_proposito check (proposito in ('saude', 'biometria', 'ia_anamnese', 'ia_chat')),
  constraint responsavel_aceites_hash check (texto_sha256 ~ '^[0-9a-f]{64}$')
);

comment on table public.responsavel_aceites is
  'Aceite do responsável legal do aluno menor, por propósito (LGPD art. 14). Vale enquanto não revogado e na versão vigente do texto. Libera o aluno para consentir; não consente por ele.';

-- Um aceite vigente por aluno e propósito.
create unique index if not exists idx_responsavel_aceite_vigente
  on public.responsavel_aceites (aluno_id, proposito) where revogado_em is null;
create index if not exists idx_responsavel_aceites_org on public.responsavel_aceites (organization_id);
create index if not exists idx_responsavel_aceites_pedido on public.responsavel_aceites (pedido_id);
create index if not exists idx_responsavel_aceites_revogado_por on public.responsavel_aceites (revogado_por);

-- ── Quem lê ─────────────────────────────────────────────────────────────────
-- O próprio aluno, a equipe da academia (é ela quem fala com o responsável) e
-- a ArkeFit. Ninguém grava pela API: o pedido nasce em criar_pedido_responsavel
-- e o aceite em registrar_aceite_responsavel. Uma regra por operação; aqui só
-- há leitura. O hash do token não é legível por ninguém além da service role.
alter table public.responsavel_pedidos enable row level security;
alter table public.responsavel_aceites enable row level security;

drop policy if exists "leitura" on public.responsavel_pedidos;
create policy "leitura" on public.responsavel_pedidos for select to authenticated
  using (
    exists (select 1 from public.alunos a where a.id = responsavel_pedidos.aluno_id and a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke'::app_role)
    or public.has_role((select auth.uid()), 'superadmin'::app_role)
  );

drop policy if exists "leitura" on public.responsavel_aceites;
create policy "leitura" on public.responsavel_aceites for select to authenticated
  using (
    exists (select 1 from public.alunos a where a.id = responsavel_aceites.aluno_id and a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke'::app_role)
    or public.has_role((select auth.uid()), 'superadmin'::app_role)
  );

revoke all on public.responsavel_pedidos from public, anon, authenticated;
grant select (id, organization_id, aluno_id, responsavel_nome, responsavel_email, propositos, expira_em,
              pedido_por, pedido_pela, criado_em, enviado_em, respondido_em, cancelado_em)
  on public.responsavel_pedidos to authenticated;
grant all on public.responsavel_pedidos to service_role;

revoke all on public.responsavel_aceites from public, anon, authenticated;
grant select on public.responsavel_aceites to authenticated;
grant all on public.responsavel_aceites to service_role;

-- Na sessão simulada, ninguém pede nem aceita pelo aluno: a mesma trava dos
-- consentimentos (20261323010000). A service role (as funções) passa, porque
-- não tem sessão; quem simula entra pela tela, com a sessão marcada.
drop trigger if exists trg_autorizacao_da_propria_pessoa on public.responsavel_pedidos;
create trigger trg_autorizacao_da_propria_pessoa before insert or update on public.responsavel_pedidos
  for each row execute function public.recusar_autorizacao_em_sessao_simulada();
drop trigger if exists trg_autorizacao_da_propria_pessoa on public.responsavel_aceites;
create trigger trg_autorizacao_da_propria_pessoa before insert or update on public.responsavel_aceites
  for each row execute function public.recusar_autorizacao_em_sessao_simulada();

-- ── O aceite vigente ────────────────────────────────────────────────────────
-- Só para o banco (a trava) e a service role: a tela lê a tabela pela regra de
-- leitura. Saber se um aluno tem aceite do responsável é saber que ele é menor.
create or replace function public.aceite_responsavel_vigente(_aluno_id uuid, _proposito text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.responsavel_aceites r
     where r.aluno_id = _aluno_id
       and r.proposito = _proposito
       and r.revogado_em is null
       and r.versao_texto = public.versao_proposito_responsavel(_proposito)
  );
$$;

revoke execute on function public.aceite_responsavel_vigente(uuid, text) from public, anon, authenticated;
grant execute on function public.aceite_responsavel_vigente(uuid, text) to service_role;

-- ── O pedido nasce aqui ─────────────────────────────────────────────────────
-- Chamada pela função `responsavel-pedido` com a sessão de quem pede, para o
-- banco saber quem é e se a sessão é simulada. O pedido nasce sem token: só a
-- função, com a service role, grava o hash e manda o e-mail. Quem chamar isto
-- direto pela API cria um pedido que não abre página nenhuma.
--
-- Pedem: o próprio aluno (qualquer propósito) e a gestão ou a recepção da
-- academia (só a digital e o rosto, que é o que a recepção cadastra; saúde e
-- IA são do Método, e quem pede é o aluno).
create or replace function public.criar_pedido_responsavel(
  _aluno_id uuid, _nome text, _email text, _propositos text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_aluno public.alunos;
  v_pela text;
  v_nome text := btrim(regexp_replace(coalesce(_nome, ''), '[[:space:]]+', ' ', 'g'));
  v_email text := lower(btrim(coalesce(_email, '')));
  v_email_aluno text;
  v_propositos text[];
  v_id uuid;
  v_expira timestamptz;
  v_primeiro text;
  v_academia text;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if public.sessao_simulada() then
    raise exception 'Em perfil simulado, só a própria pessoa autoriza, retira a autorização, aceita ou assina. Peça a ela para fazer isso no app dela.'
      using errcode = 'P0001';
  end if;

  select * into v_aluno from public.alunos where id = _aluno_id;
  if v_aluno.id is null then
    raise exception 'Aluno não encontrado.' using errcode = '42501';
  end if;
  if v_aluno.user_id = v_uid then
    v_pela := 'aluno';
  elsif public.has_org_role(v_uid, v_aluno.organization_id, 'gestor')
        or public.has_org_role(v_uid, v_aluno.organization_id, 'recepcao') then
    v_pela := 'academia';
  else
    raise exception 'Só o próprio aluno, ou a gestão e a recepção da academia, pedem o aceite do responsável.'
      using errcode = '42501';
  end if;
  if v_aluno.anonimizado_em is not null then
    raise exception 'Aluno anonimizado.' using errcode = 'P0001';
  end if;

  case public.situacao_idade(v_aluno.data_nascimento)
    when 'desconhecida' then
      raise exception 'Informe a data de nascimento do aluno antes de pedir o aceite do responsável.' using errcode = 'P0001';
    when 'adulto' then
      raise exception 'O aceite do responsável só é pedido para aluno menor de 18 anos.' using errcode = 'P0001';
    else
      null;
  end case;

  if coalesce(cardinality(_propositos), 0) = 0
     or exists (select 1 from unnest(_propositos) p where not (p = any (array['saude', 'biometria', 'ia_anamnese', 'ia_chat']))) then
    raise exception 'Escolha o que o responsável vai autorizar.' using errcode = 'P0001';
  end if;
  if v_pela = 'academia' and exists (select 1 from unnest(_propositos) p where p <> 'biometria') then
    raise exception 'A academia pede ao responsável só a autorização da digital e do rosto. Saúde e inteligência artificial são pedidas pelo aluno, no app.'
      using errcode = '42501';
  end if;

  -- Sem repetir e sem o que o responsável já autorizou na versão vigente.
  select coalesce(array_agg(distinct p order by p), '{}'::text[]) into v_propositos
    from unnest(_propositos) p
   where not public.aceite_responsavel_vigente(_aluno_id, p);
  if cardinality(v_propositos) = 0 then
    raise exception 'O responsável já autorizou o que foi pedido.' using errcode = 'P0001';
  end if;

  if char_length(v_nome) < 3 or char_length(v_nome) > 120 or position(' ' in v_nome) = 0 then
    raise exception 'Informe o nome completo do responsável.' using errcode = 'P0001';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'E-mail do responsável inválido.' using errcode = 'P0001';
  end if;
  -- O link vai para quem autoriza: o e-mail de login do próprio aluno não é o
  -- do responsável.
  select lower(u.email) into v_email_aluno from auth.users u where u.id = v_aluno.user_id;
  if v_email = v_email_aluno then
    raise exception 'O e-mail precisa ser o do responsável, e não o do aluno.' using errcode = 'P0001';
  end if;

  -- O pedido novo substitui os abertos que pedem o mesmo: o link antigo para
  -- de valer, e só o último e-mail conta.
  update public.responsavel_pedidos
     set cancelado_em = now()
   where aluno_id = _aluno_id
     and respondido_em is null
     and cancelado_em is null
     and expira_em > now()
     and propositos && v_propositos;

  insert into public.responsavel_pedidos
    (organization_id, aluno_id, responsavel_nome, responsavel_email, propositos, pedido_por, pedido_pela)
  values
    (v_aluno.organization_id, _aluno_id, v_nome, v_email, v_propositos, v_uid, v_pela)
  returning id, expira_em into v_id, v_expira;

  -- O e-mail leva só o primeiro nome do aluno e o nome da academia.
  select nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), '') into v_primeiro
    from public.profiles p where p.user_id = v_aluno.user_id;
  select o.nome into v_academia from public.organizations o where o.id = v_aluno.organization_id;

  return jsonb_build_object(
    'id', v_id,
    'expira_em', v_expira,
    'propositos', to_jsonb(v_propositos),
    'pedido_pela', v_pela,
    'responsavel_nome', v_nome,
    'responsavel_email', v_email,
    'aluno_primeiro_nome', v_primeiro,
    'academia', v_academia
  );
end;
$$;

revoke execute on function public.criar_pedido_responsavel(uuid, text, text, text[]) from public, anon;
grant execute on function public.criar_pedido_responsavel(uuid, text, text, text[]) to authenticated;

-- ── A página do link ────────────────────────────────────────────────────────
-- Só a função pública `responsavel-aceite`, com a service role, lê e grava por
-- aqui, pelo hash do token. Pedido que não está aberto responde só a situação:
-- o link velho não mostra mais o nome de ninguém.
create or replace function public.consultar_pedido_responsavel(_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_p public.responsavel_pedidos;
  v_aluno public.alunos;
  v_primeiro text;
  v_academia text;
begin
  select * into v_p from public.responsavel_pedidos where token_hash = _token_hash;
  if v_p.id is null then
    return jsonb_build_object('situacao', 'inexistente');
  end if;
  select * into v_aluno from public.alunos where id = v_p.aluno_id;
  if v_p.cancelado_em is not null or v_aluno.anonimizado_em is not null
     or public.situacao_idade(v_aluno.data_nascimento) <> 'menor' then
    return jsonb_build_object('situacao', 'cancelado');
  end if;
  if v_p.respondido_em is not null then
    return jsonb_build_object('situacao', 'respondido', 'respondido_em', v_p.respondido_em);
  end if;
  if v_p.expira_em <= now() then
    return jsonb_build_object('situacao', 'expirado');
  end if;

  select nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), '') into v_primeiro
    from public.profiles p where p.user_id = v_aluno.user_id;
  select o.nome into v_academia from public.organizations o where o.id = v_p.organization_id;

  return jsonb_build_object(
    'situacao', 'aberto',
    'aluno_primeiro_nome', v_primeiro,
    'academia', v_academia,
    'responsavel_nome', v_p.responsavel_nome,
    'propositos', to_jsonb(v_p.propositos),
    'expira_em', v_p.expira_em
  );
end;
$$;

revoke execute on function public.consultar_pedido_responsavel(text) from public, anon, authenticated;
grant execute on function public.consultar_pedido_responsavel(text) to service_role;

-- O aceite. `_versoes` e `_hashes` são o que a página mostrou, por propósito;
-- a versão tem de ser a vigente (texto que mudou com a página aberta é
-- recusado, e a pessoa relê). Propósito não marcado não é aceito; nenhum
-- marcado é uma resposta também ("não autorizo"), e fecha o pedido.
--
-- `_ator` e `_sessao` são de quem abriu o link, quando havia sessão no
-- navegador: o próprio aluno não aceita por ele, nem uma sessão simulada.
create or replace function public.registrar_aceite_responsavel(
  _token_hash text, _nome text, _propositos text[], _versoes jsonb, _hashes jsonb, _ator uuid, _sessao uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.responsavel_pedidos;
  v_aluno public.alunos;
  v_nome text := btrim(regexp_replace(coalesce(_nome, ''), '[[:space:]]+', ' ', 'g'));
  v_prop text;
  v_n integer := 0;
begin
  select * into v_p from public.responsavel_pedidos where token_hash = _token_hash for update;
  if v_p.id is null then
    raise exception 'Link inválido.' using errcode = 'P0002';
  end if;
  if v_p.cancelado_em is not null then
    raise exception 'Este pedido foi substituído por um mais novo. Use o link do último e-mail.' using errcode = 'P0001';
  end if;
  if v_p.respondido_em is not null then
    raise exception 'Este pedido já foi respondido.' using errcode = 'P0001';
  end if;
  if v_p.expira_em <= now() then
    raise exception 'Este link expirou. Peça um novo ao aluno ou à academia.' using errcode = 'P0001';
  end if;

  select * into v_aluno from public.alunos where id = v_p.aluno_id;
  if v_aluno.anonimizado_em is not null or public.situacao_idade(v_aluno.data_nascimento) <> 'menor' then
    raise exception 'Este pedido não vale mais.' using errcode = 'P0001';
  end if;
  if _sessao is not null and exists (select 1 from public.sessoes_simuladas s where s.session_id = _sessao) then
    raise exception 'Em perfil simulado, ninguém aceita pelo responsável.' using errcode = 'P0001';
  end if;
  if _ator is not null and _ator = v_aluno.user_id then
    raise exception 'Quem autoriza é o responsável, e não o aluno. Abra o link no celular ou no computador do responsável.'
      using errcode = 'P0001';
  end if;
  if char_length(v_nome) < 3 or char_length(v_nome) > 120 or position(' ' in v_nome) = 0 then
    raise exception 'Informe o seu nome completo.' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(coalesce(_propositos, '{}'::text[])) p where not (p = any (v_p.propositos))) then
    raise exception 'O aceite traz um item que não estava no pedido.' using errcode = 'P0001';
  end if;

  for v_prop in select distinct p from unnest(coalesce(_propositos, '{}'::text[])) p loop
    if (_versoes ->> v_prop) is distinct from public.versao_proposito_responsavel(v_prop) then
      raise exception 'Um dos textos mudou desde que a página abriu. Recarregue a página para ler a versão nova.'
        using errcode = 'P0001';
    end if;
    if coalesce(_hashes ->> v_prop, '') !~ '^[0-9a-f]{64}$' then
      raise exception 'Hash do texto inválido.' using errcode = 'P0001';
    end if;

    -- O aceite anterior do mesmo propósito é encerrado, não reescrito: ele
    -- prova o que foi aceito naquela data.
    update public.responsavel_aceites
       set revogado_em = now()
     where aluno_id = v_p.aluno_id and proposito = v_prop and revogado_em is null;

    insert into public.responsavel_aceites
      (organization_id, aluno_id, pedido_id, proposito, versao_texto, texto_sha256, responsavel_nome, responsavel_email)
    values
      (v_p.organization_id, v_p.aluno_id, v_p.id, v_prop, _versoes ->> v_prop, _hashes ->> v_prop, v_nome, v_p.responsavel_email);
    v_n := v_n + 1;
  end loop;

  update public.responsavel_pedidos set respondido_em = now() where id = v_p.id;
  return v_n;
end;
$$;

revoke execute on function public.registrar_aceite_responsavel(text, text, text[], jsonb, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.registrar_aceite_responsavel(text, text, text[], jsonb, jsonb, uuid, uuid) to service_role;

-- ── Retirar o aceite ────────────────────────────────────────────────────────
-- Pelo aluno no app, pela equipe da academia (é a ela que o responsável pede)
-- ou pela ArkeFit. O consentimento que dependia do aceite cai junto, pelo
-- caminho que já existe, e apaga o que já apaga hoje:
--   * biometria: revogar_consentimento_biometrico (agenda a remoção da
--     digital e do rosto dos equipamentos);
--   * IA: o consentimento daquele propósito é revogado, e o gatilho
--     apagar_resumo_ao_revogar_ia apaga o que foi gerado;
--   * saúde: o aceite do termo deixa de valer (a versão sai; a data fica,
--     como prova de quando foi dado). Não há exclusão automática da anamnese
--     hoje, e esta função não inventa uma.
-- Se o aluno já fez 18 anos, o aceite do responsável não decide mais nada:
-- só é encerrado.
create or replace function public.revogar_aceite_responsavel(_aluno_id uuid, _proposito text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_aluno public.alunos;
begin
  select * into v_aluno from public.alunos where id = _aluno_id;
  if v_aluno.id is null then
    raise exception 'Aluno não encontrado.' using errcode = '42501';
  end if;
  if not (v_aluno.user_id = v_uid
          or public.is_org_staff(v_uid, v_aluno.organization_id)
          or public.has_role(v_uid, 'admin_arke')
          or public.has_role(v_uid, 'superadmin')) then
    raise exception 'Só o próprio aluno, a equipe da academia ou a ArkeFit retiram o aceite do responsável.'
      using errcode = '42501';
  end if;
  if _proposito is null or not (_proposito = any (array['saude', 'biometria', 'ia_anamnese', 'ia_chat'])) then
    raise exception 'Propósito desconhecido.' using errcode = 'P0001';
  end if;

  update public.responsavel_aceites
     set revogado_em = now(), revogado_por = v_uid
   where aluno_id = _aluno_id and proposito = _proposito and revogado_em is null;
  if not found or public.situacao_idade(v_aluno.data_nascimento) <> 'menor' then
    return;
  end if;

  if _proposito = 'biometria' then
    if exists (select 1 from public.aluno_consentimento_biometrico c
                where c.aluno_id = _aluno_id and c.revogado_em is null) then
      perform public.revogar_consentimento_biometrico(_aluno_id);
    end if;
  elsif _proposito in ('ia_anamnese', 'ia_chat') then
    update public.aluno_consentimento_ia
       set revogado_em = now(), revogado_por = v_uid
     where aluno_id = _aluno_id and proposito = substr(_proposito, 4) and revogado_em is null;
  else
    update public.anamnese_acolhimento
       set consentimento_lgpd_versao = null
     where aluno_id = _aluno_id and consentimento_lgpd_versao is not null;
  end if;
end;
$$;

revoke execute on function public.revogar_aceite_responsavel(uuid, text) from public, anon;
grant execute on function public.revogar_aceite_responsavel(uuid, text) to authenticated;
