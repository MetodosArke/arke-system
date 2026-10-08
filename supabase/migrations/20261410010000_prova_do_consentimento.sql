set lock_timeout = '5s';

-- A prova do consentimento (auditoria de prontidão, frente E, 07/10/2026).
--
-- Um consentimento só vale como prova se diz quem aceitou, quando, qual texto
-- (a versão e o SHA-256) e de onde. O achado: o próprio aluno gravava os campos
-- que provam o dele. `aluno_consentimento_ia` aceitava, pela API, a finalidade,
-- a versão, a data e o provedor que o aluno mandasse, e a regra de alteração
-- deixava ele reescrever a linha inteira (inclusive desfazer uma retirada).
-- `aluno_consentimento_biometrico` aceitava a origem ("termo_assinado"), a data
-- e quem registrou. O consentimento de saúde gravava a data do relógio do
-- celular. E nenhum dos três guardava o hash do texto nem o navegador.
--
-- O que muda:
--
-- 1. Quem grava pela API só escolhe o que é dele escolher: o aluno e o
--    propósito. O resto sai do banco: a data (`now()`), a versão vigente, o
--    hash do texto (`hash_texto_consentimento`) e o navegador, lido do
--    cabeçalho da requisição (`navegador_da_requisicao`), e não do corpo. Por
--    privilégio de coluna (o que a API pode mandar) e por gatilho (o que o
--    banco carimba). A retirada pela API é carimbada com a hora do banco e com
--    quem retirou; a autorização retirada não volta: autoriza-se de novo, numa
--    linha nova.
-- 2. O aceite dos documentos legais copia a versão e o hash do documento na
--    linha do aceite (`documentos_legais` é editável pela ArkeFit; a cópia
--    congela o que foi aceito), e o navegador passa a vir do cabeçalho. O mesmo
--    navegador na assinatura do contrato de matrícula.
-- 3. O aceite do responsável pelo menor ganha o navegador (a função
--    `responsavel-aceite` manda o do cabeçalho), e o banco confere o hash que a
--    função manda contra o da tabela.
--
-- **IP fica de fora, de propósito.** A Política (seção 7) diz que o IP é
-- guardado só nos registros de acesso, por 6 meses (Marco Civil, art. 15,
-- `registros_acesso_aplicacao`), e, cifrado, no limite de tentativas e no
-- contato pelo site. O consentimento é guardado enquanto for preciso provar
-- a autorização, muito além de 6 meses: guardar o IP nele seria guardar o IP
-- por mais tempo do que a Política promete. Nos 6 meses, o IP de um aceite se
-- acha pelos registros de acesso da pessoa naquele dia.
--
-- As linhas de antes ficam como estão: sem hash e sem navegador quer dizer
-- "gravado antes de 07/10/2026"; a versão continua dizendo qual texto. O
-- aceite dos documentos é a exceção: a cópia da versão e do hash vem do
-- documento a que ele aponta, que é a mesma informação, só congelada.

-- ── 0. O navegador de quem pede ─────────────────────────────────────────────
-- Do cabeçalho `user-agent` da requisição, e só quando quem pede é uma pessoa
-- (a sessão do app). A função do servidor (service role) manda o navegador de
-- quem a chamou como parâmetro, porque o cabeçalho que chega ao banco é o
-- dela. Sem requisição (uma rotina, um script), nulo.
create or replace function public.navegador_da_requisicao()
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_papel text;
  v_cabecalhos jsonb;
begin
  begin
    v_papel := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
    v_cabecalhos := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if v_papel is null or v_papel not in ('authenticated', 'anon') then
    return null;
  end if;
  return nullif(left(btrim(v_cabecalhos ->> 'user-agent'), 300), '');
end;
$$;

comment on function public.navegador_da_requisicao() is
  'O navegador (user-agent) da requisição de uma pessoa, lido do cabeçalho. Nulo para a service role e fora de requisição. Usado pelos gatilhos da prova do consentimento.';

-- Os gatilhos rodam com o papel de quem grava (não são security definer, para
-- saber se a gravação veio pela API): precisam de EXECUTE.
revoke execute on function public.navegador_da_requisicao() from public, anon;
grant execute on function public.navegador_da_requisicao() to authenticated, service_role;

-- ── 1. O hash de cada texto de consentimento ────────────────────────────────
-- O SHA-256 do texto que o aluno lê no app (e o responsável lê na página do
-- link), por propósito e versão: título e parágrafos, um por linha
-- (`textoCanonico()` em src/lib/textosConsentimento.ts). A mesma tabela de
-- `_shared/responsavel.ts`. `provaDoConsentimento.guarda.test.ts` recalcula o
-- hash do texto do app e falha se a versão vigente de um propósito não estiver
-- aqui. Texto novo: versão nova, e uma linha nova aqui, na migration que muda a
-- versão (depois de o texto estar no ar). As linhas antigas ficam.
create or replace function public.hash_texto_consentimento(_proposito text, _versao text)
returns text
language sql
immutable
set search_path = public
as $$
  select case _proposito || '@' || coalesce(_versao, '')
           when 'saude@2026-09-23' then '7917bba2d63139fcd507e40d98667254e897afd51091d8c4b4b6a3c691720bc1'
           when 'biometria@2026-10-03' then '72b7b71db4cc6355a8e834509eee84ee0987aea37b4ed026f0c998157e1d5b5f'
           when 'ia_anamnese@2026-09-23.4' then '2ed0994c040636d6fc4e03e633d1b01152873c37d6a4dde2ac769952bcc100b8'
           when 'ia_chat@2026-09-23.4' then 'e01ab8cfd98136124d012471e6abfccc3cba244ed81d3e521e488c9438d831f3'
         end;
$$;

revoke execute on function public.hash_texto_consentimento(text, text) from public, anon;
grant execute on function public.hash_texto_consentimento(text, text) to authenticated, service_role;

-- ── 2. IA ───────────────────────────────────────────────────────────────────
alter table public.aluno_consentimento_ia
  add column if not exists texto_sha256 text,
  add column if not exists user_agent text;

comment on column public.aluno_consentimento_ia.texto_sha256 is
  'SHA-256 do texto consentido (hash_texto_consentimento), carimbado pelo banco. Nulo: gravado antes de 07/10/2026.';
comment on column public.aluno_consentimento_ia.user_agent is
  'Navegador de quem autorizou, do cabeçalho da requisição. Sem IP, de propósito: ver 20261410010000.';

-- A versão padrão passa a ser a vigente, e não um texto repetido em cada
-- migration de versão nova.
alter table public.aluno_consentimento_ia
  alter column versao_texto set default public.versao_consentimento_ia();

-- Pela API, o aluno manda o aluno, a academia e o propósito; e, para retirar,
-- só a data da retirada (que o banco troca pela hora dele).
revoke insert, update, delete on public.aluno_consentimento_ia from anon, authenticated;
grant insert (organization_id, aluno_id, proposito) on public.aluno_consentimento_ia to authenticated;
grant update (revogado_em) on public.aluno_consentimento_ia to authenticated;

create or replace function public.prova_consentimento_ia()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_pela_api boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    if v_pela_api then
      new.aceito_em := now();
      new.created_at := now();
      new.versao_texto := public.versao_consentimento_ia();
      new.revogado_em := null;
      new.revogado_por := null;
    end if;
    new.texto_sha256 := public.hash_texto_consentimento('ia_' || new.proposito, new.versao_texto);
    new.user_agent := coalesce(public.navegador_da_requisicao(), left(new.user_agent, 300));
    return new;
  end if;

  if v_pela_api then
    if (new.organization_id, new.aluno_id, new.proposito, new.versao_texto, new.aceito_em, new.finalidade,
        new.retencao_descricao, new.provedor, new.texto_sha256, new.user_agent, new.created_at)
       is distinct from
       (old.organization_id, old.aluno_id, old.proposito, old.versao_texto, old.aceito_em, old.finalidade,
        old.retencao_descricao, old.provedor, old.texto_sha256, old.user_agent, old.created_at) then
      raise exception 'A prova da autorização não se altera. Para mudar, retire a autorização e autorize de novo.'
        using errcode = '42501';
    end if;
    if old.revogado_em is not null then
      if new.revogado_em is distinct from old.revogado_em or new.revogado_por is distinct from old.revogado_por then
        raise exception 'Esta autorização já foi retirada. Para voltar, autorize de novo.' using errcode = 'P0001';
      end if;
    elsif new.revogado_em is not null then
      new.revogado_em := now();
      new.revogado_por := auth.uid();
    end if;
  else
    -- As funções do banco retiram (a saída do aluno, a retirada do aceite do
    -- responsável); o hash e o navegador não mudam por elas.
    new.texto_sha256 := old.texto_sha256;
    new.user_agent := old.user_agent;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prova_do_consentimento on public.aluno_consentimento_ia;
create trigger trg_prova_do_consentimento before insert or update on public.aluno_consentimento_ia
  for each row execute function public.prova_consentimento_ia();

-- ── 3. Biometria ────────────────────────────────────────────────────────────
alter table public.aluno_consentimento_biometrico
  add column if not exists texto_sha256 text,
  add column if not exists user_agent text;

comment on column public.aluno_consentimento_biometrico.texto_sha256 is
  'SHA-256 do texto do termo consentido (hash_texto_consentimento), carimbado pelo banco. Nulo: gravado antes de 07/10/2026.';
comment on column public.aluno_consentimento_biometrico.user_agent is
  'Navegador de quem gravou: o aluno no app, ou a recepção que anexou o termo assinado. Sem IP, de propósito: ver 20261410010000.';

-- O app autoriza por consentir_biometria (o aluno) e pelo termo assinado (a
-- recepção), funções do banco. Pela API, a regra de inclusão continua, mas só
-- com o aluno e a academia: a origem, o termo, quem registrou e a data saem
-- do banco.
revoke insert, update, delete on public.aluno_consentimento_biometrico from anon, authenticated;
grant insert (organization_id, aluno_id) on public.aluno_consentimento_biometrico to authenticated;

create or replace function public.prova_consentimento_biometrico()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      new.aceito_em := now();
      new.created_at := now();
      new.versao_texto := public.versao_consentimento_biometrico();
      new.origem := 'app';
      new.termo_arquivo := null;
      new.registrado_por := null;
      new.template_no_servidor := false;
      new.revogado_em := null;
      new.revogado_por := null;
      new.excluido_do_equipamento_em := null;
    end if;
    new.texto_sha256 := public.hash_texto_consentimento('biometria', new.versao_texto);
    new.user_agent := coalesce(public.navegador_da_requisicao(), left(new.user_agent, 300));
  else
    new.texto_sha256 := old.texto_sha256;
    new.user_agent := old.user_agent;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prova_do_consentimento on public.aluno_consentimento_biometrico;
create trigger trg_prova_do_consentimento before insert or update on public.aluno_consentimento_biometrico
  for each row execute function public.prova_consentimento_biometrico();

-- ── 4. Saúde ────────────────────────────────────────────────────────────────
-- O consentimento mora na anamnese, que a equipe também escreve: o gatilho do
-- titular (20261361010000) confere quem concede; este carimba a data, o hash e
-- o navegador na concessão, e não deixa a API mexer neles fora dela. Roda
-- depois dos outros gatilhos da tabela (a ordem é a do nome).
alter table public.anamnese_acolhimento
  add column if not exists consentimento_lgpd_sha256 text,
  add column if not exists consentimento_lgpd_user_agent text;

comment on column public.anamnese_acolhimento.consentimento_lgpd_sha256 is
  'SHA-256 do termo de saúde consentido (hash_texto_consentimento), carimbado pelo banco na concessão. Fica depois da retirada, como prova do que foi aceito. Nulo: gravado antes de 07/10/2026.';
comment on column public.anamnese_acolhimento.consentimento_lgpd_user_agent is
  'Navegador de quem consentiu, do cabeçalho da requisição. Sem IP, de propósito: ver 20261410010000.';

create or replace function public.prova_consentimento_saude()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.consentimento_lgpd_aceito_em is not null
     and (tg_op = 'INSERT'
          or new.consentimento_lgpd_aceito_em is distinct from old.consentimento_lgpd_aceito_em
          or (new.consentimento_lgpd_versao is not null
              and new.consentimento_lgpd_versao is distinct from old.consentimento_lgpd_versao)
          or new.aluno_id is distinct from old.aluno_id) then
    -- Concessão (só o titular chega aqui: o gatilho do titular recusa os
    -- outros). A data é a do banco, e não a do relógio do celular.
    new.consentimento_lgpd_aceito_em := now();
    new.consentimento_lgpd_sha256 := public.hash_texto_consentimento('saude', new.consentimento_lgpd_versao);
    new.consentimento_lgpd_user_agent := public.navegador_da_requisicao();
  elsif tg_op = 'INSERT' then
    new.consentimento_lgpd_sha256 := null;
    new.consentimento_lgpd_user_agent := null;
  else
    new.consentimento_lgpd_sha256 := old.consentimento_lgpd_sha256;
    new.consentimento_lgpd_user_agent := old.consentimento_lgpd_user_agent;
    -- A retirada é de `revogar_consentimento_saude`, uma função do banco: pela
    -- API, a data dela não se escreve.
    if current_user in ('authenticated', 'anon') then
      new.consentimento_lgpd_revogado_em := old.consentimento_lgpd_revogado_em;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prova_do_consentimento on public.anamnese_acolhimento;
create trigger trg_prova_do_consentimento before insert or update on public.anamnese_acolhimento
  for each row execute function public.prova_consentimento_saude();

-- ── 5. Documentos legais e contrato de matrícula ────────────────────────────
alter table public.aceites_documentos
  add column if not exists versao text,
  add column if not exists texto_sha256 text;

comment on column public.aceites_documentos.versao is
  'Versão do documento aceito, copiada de documentos_legais na gravação: a linha do aceite se explica sozinha.';
comment on column public.aceites_documentos.texto_sha256 is
  'SHA-256 do texto aceito, copiado de documentos_legais na gravação (que a ArkeFit pode editar): a cópia congela o que foi aceito.';

-- As linhas de antes: a cópia do documento a que cada uma aponta. Antes do
-- gatilho, que não deixa mudar a cópia depois de gravada.
update public.aceites_documentos a
   set versao = d.versao, texto_sha256 = d.sha256
  from public.documentos_legais d
 where d.id = a.documento_id
   and a.texto_sha256 is null;

create or replace function public.prova_aceite_documento()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    select d.versao, d.sha256 into new.versao, new.texto_sha256
      from public.documentos_legais d
     where d.id = new.documento_id;
    new.user_agent := coalesce(public.navegador_da_requisicao(), left(new.user_agent, 300));
  else
    new.versao := old.versao;
    new.texto_sha256 := old.texto_sha256;
    new.user_agent := old.user_agent;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prova_do_consentimento on public.aceites_documentos;
create trigger trg_prova_do_consentimento before insert or update on public.aceites_documentos
  for each row execute function public.prova_aceite_documento();

-- O contrato de matrícula já guardava o hash do texto assinado, calculado pelo
-- banco; o navegador vinha do parâmetro, e passa a vir do cabeçalho.
create or replace function public.prova_assinatura_contrato()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.user_agent := coalesce(public.navegador_da_requisicao(), left(new.user_agent, 300));
  return new;
end;
$$;

drop trigger if exists trg_prova_do_consentimento on public.aluno_assinaturas_contrato;
create trigger trg_prova_do_consentimento before insert on public.aluno_assinaturas_contrato
  for each row execute function public.prova_assinatura_contrato();

-- ── 6. O aceite do responsável pelo menor ───────────────────────────────────
alter table public.responsavel_aceites
  add column if not exists user_agent text;

comment on column public.responsavel_aceites.user_agent is
  'Navegador de quem aceitou pelo link, que a função responsavel-aceite lê do cabeçalho. O responsável não tem conta, e os registros de acesso não o alcançam. Sem IP, de propósito: ver 20261410010000.';

-- A assinatura nova leva o navegador; a antiga sai, para o PostgREST não ficar
-- com duas. A função publicada antes desta migration chama sem o navegador e
-- continua funcionando (o parâmetro tem padrão): a ordem é migration, depois
-- a função.
drop function if exists public.registrar_aceite_responsavel(text, text, text[], jsonb, jsonb, uuid, uuid);

create or replace function public.registrar_aceite_responsavel(
  _token_hash text, _nome text, _propositos text[], _versoes jsonb, _hashes jsonb, _ator uuid, _sessao uuid,
  _user_agent text default null
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
  v_hash_banco text;
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
    -- O hash que a função manda tem de ser o do texto daquela versão: a
    -- tabela do banco e a da função (`_shared/responsavel.ts`) são a mesma.
    v_hash_banco := public.hash_texto_consentimento(v_prop, _versoes ->> v_prop);
    if v_hash_banco is not null and v_hash_banco <> (_hashes ->> v_prop) then
      raise exception 'Hash do texto inválido.' using errcode = 'P0001';
    end if;

    -- O aceite anterior do mesmo propósito é encerrado, não reescrito: ele
    -- prova o que foi aceito naquela data.
    update public.responsavel_aceites
       set revogado_em = now()
     where aluno_id = v_p.aluno_id and proposito = v_prop and revogado_em is null;

    insert into public.responsavel_aceites
      (organization_id, aluno_id, pedido_id, proposito, versao_texto, texto_sha256, responsavel_nome, responsavel_email,
       user_agent)
    values
      (v_p.organization_id, v_p.aluno_id, v_p.id, v_prop, _versoes ->> v_prop, _hashes ->> v_prop, v_nome,
       v_p.responsavel_email, nullif(left(btrim(coalesce(_user_agent, '')), 300), ''));
    v_n := v_n + 1;
  end loop;

  update public.responsavel_pedidos set respondido_em = now() where id = v_p.id;
  return v_n;
end;
$$;

revoke execute on function public.registrar_aceite_responsavel(text, text, text[], jsonb, jsonb, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.registrar_aceite_responsavel(text, text, text[], jsonb, jsonb, uuid, uuid, text) to service_role;

-- ── Higiene: função de gatilho não é alcançável pela API ────────────────────
-- O bloco idempotente de 20261215010000, de novo, porque esta rodada criou
-- funções de gatilho.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.assinatura);
  end loop;
end $$;
