set lock_timeout = '5s';

-- O cadastro completo da equipe da ArkeFit (08/10/2026).
--
-- O pedido: "Em breve, com os primeiros clientes, precisamos destes dados
-- para cadastrar no CNPJ novo se for o caso, enviar as informações para a
-- contabilidade, tirar o pró-labore, essas coisas." Até aqui a equipe tinha
-- só o nome (em `profiles`), o e-mail de login e o registro profissional
-- (`equipe_arkefit`). Os dados que o contrato social, a contabilidade e a
-- folha pedem não tinham onde morar.
--
-- 1. `equipe_arkefit_cadastro`: identificação, filiação, contato, endereço,
--    documentos trabalhistas, vínculo com a ArkeFit e pagamento. Tabela da
--    plataforma, sem `organization_id`, exceção declarada como
--    `equipe_arkefit`. Uma linha por pessoa (`user_id`), que some com a conta.
-- 2. Quem vê: só os sócios (`superadmin` numa sessão verificada) e a própria
--    pessoa, também com as duas etapas. Nem o Admin ARKE, nem o futuro nível
--    Financeiro (`docs/DECISOES_PENDENTES.md`). Nenhuma sessão simulada.
-- 3. Quem grava: só `salvar_cadastro_equipe_arkefit()`. A escrita pela API sai
--    de `anon` e `authenticated` (recusada com 42501, como em `user_roles`).
--    A pessoa muda os próprios dados pessoais e bancários; o vínculo, a
--    remuneração, a participação e as observações, só um sócio.
-- 4. A auditoria: cada gravação registra `equipe_arkefit.cadastro_alterado`
--    com os NOMES dos campos que mudaram, nunca os valores: a trilha não tem
--    prazo, e CPF, conta e salário não cabem nela.
-- 5. A exportação para a contabilidade: `exportar_cadastros_equipe_arkefit()`
--    devolve as fichas e registra `equipe_arkefit.cadastro_exportado`, com
--    quem exportou e de quem (só ids). Só o sócio exporta a equipe toda.
-- 6. O nome de exibição (`profiles.full_name`) muda por
--    `renomear_equipe_arkefit()`, só pelo sócio, com
--    `equipe_arkefit.nome_alterado` na auditoria (só ids).
-- 7. Os documentos anexos: o bucket privado `equipe-arkefit-documentos`, com
--    o caminho `<user_id>/<arquivo>`. O sócio lê, grava e apaga; a pessoa lê e
--    grava os próprios. As regras de `storage.objects` continuam uma por
--    operação: o bucket entra nas que existem.

-- ---------------------------------------------------------------------------
-- 1. A tabela
-- ---------------------------------------------------------------------------
-- UF do Brasil: as 27. Função imutável para a mesma lista valer nas três UFs.
create or replace function public.uf_brasileira(_uf text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select _uf in ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
                 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO');
$$;

create table if not exists public.equipe_arkefit_cadastro (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Identificação
  nome_completo text not null,
  nome_social text,
  cpf text,
  rg_numero text,
  rg_orgao_emissor text,
  rg_uf text,
  rg_data_emissao date,
  data_nascimento date,
  nacionalidade text,
  naturalidade_cidade text,
  naturalidade_uf text,
  estado_civil text,
  regime_bens text,
  profissao text,
  nome_mae text,
  nome_pai text,
  -- Contato (o e-mail de contato não é o de login, que mora na conta)
  telefone text,
  email_contato text,
  -- Endereço
  endereco_cep text,
  endereco_logradouro text,
  endereco_numero text,
  endereco_complemento text,
  endereco_bairro text,
  endereco_cidade text,
  endereco_uf text,
  -- Documentos trabalhistas e previdenciários
  pis_pasep_nit text,
  ctps_numero text,
  ctps_serie text,
  titulo_eleitor text,
  -- Vínculo com a ArkeFit
  vinculo_tipo text,
  cargo text,
  data_entrada date,
  data_saida date,
  pj_cnpj text,
  pj_razao_social text,
  participacao_capital numeric(5, 2),
  socio_administrador boolean,
  -- Pagamento
  banco text,
  agencia text,
  conta text,
  conta_tipo text,
  pix_tipo text,
  pix_chave text,
  remuneracao_mensal numeric(12, 2),
  -- Controle
  observacoes text,
  atualizado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint equipe_arkefit_cadastro_nome check (length(btrim(nome_completo)) between 3 and 160),
  constraint equipe_arkefit_cadastro_tamanhos check (
    coalesce(length(nome_social), 0) <= 160
    and coalesce(length(rg_numero), 0) <= 20
    and coalesce(length(rg_orgao_emissor), 0) <= 30
    and coalesce(length(nacionalidade), 0) <= 60
    and coalesce(length(naturalidade_cidade), 0) <= 100
    and coalesce(length(profissao), 0) <= 100
    and coalesce(length(nome_mae), 0) <= 160
    and coalesce(length(nome_pai), 0) <= 160
    and coalesce(length(email_contato), 0) <= 160
    and coalesce(length(endereco_logradouro), 0) <= 160
    and coalesce(length(endereco_numero), 0) <= 20
    and coalesce(length(endereco_complemento), 0) <= 100
    and coalesce(length(endereco_bairro), 0) <= 100
    and coalesce(length(endereco_cidade), 0) <= 100
    and coalesce(length(ctps_numero), 0) <= 20
    and coalesce(length(ctps_serie), 0) <= 10
    and coalesce(length(cargo), 0) <= 100
    and coalesce(length(pj_razao_social), 0) <= 160
    and coalesce(length(banco), 0) <= 100
    and coalesce(length(pix_chave), 0) <= 160
    and coalesce(length(observacoes), 0) <= 2000
  ),
  -- Só os dígitos, como em `profiles` (20261368010000), e válido pelo módulo 11.
  constraint equipe_arkefit_cadastro_cpf check (cpf is null or (cpf ~ '^[0-9]{11}$' and public.cpf_valido(cpf))),
  constraint equipe_arkefit_cadastro_ufs check (
    (rg_uf is null or public.uf_brasileira(rg_uf))
    and (naturalidade_uf is null or public.uf_brasileira(naturalidade_uf))
    and (endereco_uf is null or public.uf_brasileira(endereco_uf))
  ),
  constraint equipe_arkefit_cadastro_cep check (endereco_cep is null or endereco_cep ~ '^[0-9]{8}$'),
  constraint equipe_arkefit_cadastro_telefone check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  constraint equipe_arkefit_cadastro_email check (email_contato is null or email_contato ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint equipe_arkefit_cadastro_pis check (pis_pasep_nit is null or pis_pasep_nit ~ '^[0-9]{11}$'),
  constraint equipe_arkefit_cadastro_titulo check (titulo_eleitor is null or titulo_eleitor ~ '^[0-9]{12}$'),
  constraint equipe_arkefit_cadastro_estado_civil check (
    estado_civil is null or estado_civil in ('solteiro', 'casado', 'uniao_estavel', 'separado', 'divorciado', 'viuvo')
  ),
  -- O contrato social pede o regime de bens de quem é casado ou vive em união estável.
  constraint equipe_arkefit_cadastro_regime_bens check (
    regime_bens is null
    or (regime_bens in ('comunhao_parcial', 'comunhao_universal', 'separacao_total', 'separacao_obrigatoria', 'participacao_final_aquestos')
        and estado_civil in ('casado', 'uniao_estavel'))
  ),
  constraint equipe_arkefit_cadastro_vinculo check (
    vinculo_tipo is null or vinculo_tipo in ('socio', 'clt', 'pj', 'autonomo', 'estagio')
  ),
  -- O CNPJ alfanumérico da Receita (2026): 12 letras ou dígitos e 2 dígitos verificadores.
  constraint equipe_arkefit_cadastro_pj check (
    (pj_cnpj is null or pj_cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$')
    and (vinculo_tipo = 'pj' or (pj_cnpj is null and pj_razao_social is null))
  ),
  constraint equipe_arkefit_cadastro_socio check (
    (participacao_capital is null or participacao_capital between 0 and 100)
    and (vinculo_tipo = 'socio' or (participacao_capital is null and socio_administrador is null))
  ),
  constraint equipe_arkefit_cadastro_datas check (
    (data_nascimento is null or data_nascimento >= date '1900-01-01')
    and (data_saida is null or data_entrada is null or data_saida >= data_entrada)
    and (data_entrada is null or data_nascimento is null or data_entrada > data_nascimento)
    and (rg_data_emissao is null or data_nascimento is null or rg_data_emissao >= data_nascimento)
  ),
  constraint equipe_arkefit_cadastro_conta check (
    (agencia is null or agencia ~ '^[0-9]{1,6}(-?[0-9Xx])?$')
    and (conta is null or conta ~ '^[0-9]{1,20}(-?[0-9Xx])?$')
    and (conta_tipo is null or conta_tipo in ('corrente', 'poupanca', 'pagamento', 'salario'))
  ),
  constraint equipe_arkefit_cadastro_pix check (
    (pix_tipo is null or pix_tipo in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria'))
    and ((pix_tipo is null) = (pix_chave is null))
  ),
  constraint equipe_arkefit_cadastro_remuneracao check (remuneracao_mensal is null or remuneracao_mensal >= 0)
);

comment on table public.equipe_arkefit_cadastro is
  'Cadastro completo de quem é da equipe da ArkeFit (contrato social, contabilidade, pró-labore e folha). Tabela da plataforma, sem organização. Lê: o sócio verificado e a própria pessoa. Grava: só salvar_cadastro_equipe_arkefit().';

drop trigger if exists trg_equipe_arkefit_cadastro_updated_at on public.equipe_arkefit_cadastro;
create trigger trg_equipe_arkefit_cadastro_updated_at
  before update on public.equipe_arkefit_cadastro
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Quem é da equipe, e quem vê o cadastro
-- ---------------------------------------------------------------------------
-- Da equipe hoje: tem papel da ArkeFit, ou está ativo em `equipe_arkefit`.
create or replace function public.equipe_arkefit_atual(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user_id is not null and (
    exists (select 1 from public.user_roles r where r.user_id = _user_id and r.role = any(public.papeis_da_arkefit()))
    or exists (select 1 from public.equipe_arkefit e where e.user_id = _user_id and e.ativo)
  );
$$;

-- Da equipe hoje ou antes: quem saiu (a retirada deixa a linha inativa) ainda
-- tem o cadastro que a contabilidade pede na saída.
create or replace function public.equipe_arkefit_alguma_vez(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user_id is not null and (
    exists (select 1 from public.user_roles r where r.user_id = _user_id and r.role = any(public.papeis_da_arkefit()))
    or exists (select 1 from public.equipe_arkefit e where e.user_id = _user_id)
  );
$$;

revoke execute on function public.equipe_arkefit_atual(uuid) from public, anon, authenticated;
revoke execute on function public.equipe_arkefit_alguma_vez(uuid) from public, anon, authenticated;
grant execute on function public.equipe_arkefit_atual(uuid) to service_role;
grant execute on function public.equipe_arkefit_alguma_vez(uuid) to service_role;

-- Quem chama pode ver o cadastro de `_user_id`? Responde só sobre quem chama.
-- O sócio: `has_role` já exige a sessão verificada. A própria pessoa: da
-- equipe hoje, e também com as duas etapas, porque o cadastro tem a conta
-- onde ela recebe. Nenhuma sessão simulada.
create or replace function public.pode_ver_cadastro_equipe_arkefit(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and not public.sessao_simulada()
     and public.equipe_arkefit_alguma_vez(_user_id)
     and (
       public.has_role(auth.uid(), 'superadmin')
       or (_user_id = auth.uid()
           and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
           and public.equipe_arkefit_atual(_user_id))
     );
$$;

revoke execute on function public.pode_ver_cadastro_equipe_arkefit(uuid) from public, anon;
grant execute on function public.pode_ver_cadastro_equipe_arkefit(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Leitura pela regra; escrita só pela função
-- ---------------------------------------------------------------------------
alter table public.equipe_arkefit_cadastro enable row level security;

drop policy if exists "leitura" on public.equipe_arkefit_cadastro;
create policy "leitura" on public.equipe_arkefit_cadastro for select to authenticated
  using (public.pode_ver_cadastro_equipe_arkefit(user_id));

-- Sem regra de inclusão, alteração ou exclusão, e sem a permissão: o pedido
-- direto pela API é recusado com 42501, em vez de responder 200 sem gravar.
revoke all on public.equipe_arkefit_cadastro from public, anon, authenticated;
grant select on public.equipe_arkefit_cadastro to authenticated;
grant select, insert, update, delete on public.equipe_arkefit_cadastro to service_role;

-- ---------------------------------------------------------------------------
-- 4. Gravar
-- ---------------------------------------------------------------------------
-- Os campos que a própria pessoa muda: os dados dela e onde recebe.
create or replace function public.campos_cadastro_equipe_pessoais()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'nome_completo', 'nome_social', 'cpf', 'rg_numero', 'rg_orgao_emissor', 'rg_uf', 'rg_data_emissao',
    'data_nascimento', 'nacionalidade', 'naturalidade_cidade', 'naturalidade_uf', 'estado_civil', 'regime_bens',
    'profissao', 'nome_mae', 'nome_pai',
    'telefone', 'email_contato',
    'endereco_cep', 'endereco_logradouro', 'endereco_numero', 'endereco_complemento', 'endereco_bairro',
    'endereco_cidade', 'endereco_uf',
    'pis_pasep_nit', 'ctps_numero', 'ctps_serie', 'titulo_eleitor',
    'banco', 'agencia', 'conta', 'conta_tipo', 'pix_tipo', 'pix_chave'
  ]::text[];
$$;

-- Os que só um sócio muda: o vínculo, a remuneração, a participação e as
-- observações. A pessoa lê todos.
create or replace function public.campos_cadastro_equipe_do_socio()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'vinculo_tipo', 'cargo', 'data_entrada', 'data_saida', 'pj_cnpj', 'pj_razao_social',
    'participacao_capital', 'socio_administrador', 'remuneracao_mensal', 'observacoes'
  ]::text[];
$$;

revoke execute on function public.campos_cadastro_equipe_pessoais() from public, anon, authenticated;
revoke execute on function public.campos_cadastro_equipe_do_socio() from public, anon, authenticated;
grant execute on function public.campos_cadastro_equipe_pessoais() to service_role;
grant execute on function public.campos_cadastro_equipe_do_socio() to service_role;

-- Grava só os campos que vierem em `_dados` (os outros ficam como estão).
-- Texto chega aparado, e vazio vira nulo. Devolve os campos que mudaram.
create or replace function public.salvar_cadastro_equipe_arkefit(_user_id uuid, _dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ator uuid := auth.uid();
  v_socio boolean;
  v_propria boolean;
  v_atual public.equipe_arkefit_cadastro;
  v_novo public.equipe_arkefit_cadastro;
  v_limpo jsonb := '{}'::jsonb;
  v_chave text;
  v_valor jsonb;
  v_fora text[];
  v_campos text[];
begin
  if v_ator is null or public.sessao_simulada() then
    raise exception 'Em perfil simulado, ou sem entrar, ninguém muda o cadastro da equipe ArkeFit.' using errcode = '42501';
  end if;

  v_socio := public.has_role(v_ator, 'superadmin');
  v_propria := _user_id = v_ator
               and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
               and public.equipe_arkefit_atual(v_ator);
  if not (v_socio or v_propria) then
    raise exception 'Só um sócio da ArkeFit, ou a própria pessoa, com a verificação em duas etapas, muda este cadastro.' using errcode = '42501';
  end if;
  if not public.equipe_arkefit_alguma_vez(_user_id) then
    raise exception 'Essa conta não é da equipe ArkeFit.' using errcode = '22023';
  end if;
  if _dados is null or jsonb_typeof(_dados) <> 'object' then
    raise exception 'Cadastro inválido.' using errcode = '22023';
  end if;

  select array_agg(k order by k) into v_fora
    from jsonb_object_keys(_dados) k
   where k <> all (public.campos_cadastro_equipe_pessoais() || public.campos_cadastro_equipe_do_socio());
  if v_fora is not null then
    raise exception 'O cadastro não tem estes campos: %.', array_to_string(v_fora, ', ') using errcode = '22023';
  end if;

  -- A pessoa não muda o vínculo, a remuneração nem a participação: nem mandar pode.
  if not v_socio then
    select array_agg(k order by k) into v_fora
      from jsonb_object_keys(_dados) k
     where k = any (public.campos_cadastro_equipe_do_socio());
    if v_fora is not null then
      raise exception 'Só um sócio muda o vínculo, a remuneração, a participação e as observações (%).', array_to_string(v_fora, ', ')
        using errcode = '42501';
    end if;
  end if;

  for v_chave, v_valor in select e.key, e.value from jsonb_each(_dados) e loop
    if jsonb_typeof(v_valor) = 'string' then
      v_valor := case when btrim(v_valor #>> '{}') = '' then 'null'::jsonb else to_jsonb(btrim(v_valor #>> '{}')) end;
    end if;
    v_limpo := v_limpo || jsonb_build_object(v_chave, v_valor);
  end loop;

  select * into v_atual from public.equipe_arkefit_cadastro c where c.user_id = _user_id for update;
  v_novo := jsonb_populate_record(v_atual, v_limpo);

  -- Sem a máscara. Só saem pontos, traços, barras, parênteses e espaços:
  -- tirar tudo que não é dígito faria lixo virar vazio e passar (20261368010000).
  v_novo.cpf := public.cpf_sem_mascara(v_novo.cpf);
  v_novo.telefone := nullif(regexp_replace(v_novo.telefone, '[.()/+[:space:]-]', '', 'g'), '');
  v_novo.endereco_cep := nullif(regexp_replace(v_novo.endereco_cep, '[.[:space:]-]', '', 'g'), '');
  v_novo.pis_pasep_nit := nullif(regexp_replace(v_novo.pis_pasep_nit, '[./[:space:]-]', '', 'g'), '');
  v_novo.titulo_eleitor := nullif(regexp_replace(v_novo.titulo_eleitor, '[./[:space:]-]', '', 'g'), '');
  v_novo.pj_cnpj := nullif(upper(regexp_replace(v_novo.pj_cnpj, '[./[:space:]-]', '', 'g')), '');
  v_novo.rg_uf := upper(v_novo.rg_uf);
  v_novo.naturalidade_uf := upper(v_novo.naturalidade_uf);
  v_novo.endereco_uf := upper(v_novo.endereco_uf);
  v_novo.email_contato := lower(v_novo.email_contato);

  if v_novo.nome_completo is null then
    raise exception 'Informe o nome completo.' using errcode = '22023';
  end if;
  if v_novo.data_nascimento > current_date or v_novo.rg_data_emissao > current_date then
    raise exception 'A data de nascimento e a emissão do RG não podem ser no futuro.' using errcode = '22023';
  end if;

  select coalesce(array_agg(n.key order by n.key), '{}') into v_campos
    from jsonb_each(to_jsonb(v_novo)) n
   where n.key <> all (array['user_id', 'atualizado_por', 'created_at', 'updated_at'])
     and n.value is distinct from coalesce(to_jsonb(v_atual) -> n.key, 'null'::jsonb);

  if cardinality(v_campos) = 0 then
    return jsonb_build_object('campos', '[]'::jsonb);
  end if;

  if v_atual.user_id is null then
    v_novo.user_id := _user_id;
    v_novo.atualizado_por := v_ator;
    v_novo.created_at := now();
    v_novo.updated_at := now();
    insert into public.equipe_arkefit_cadastro select (v_novo).*;
  else
    update public.equipe_arkefit_cadastro c
       set nome_completo = v_novo.nome_completo,
           nome_social = v_novo.nome_social,
           cpf = public.cpf_sem_mascara(v_novo.cpf),
           rg_numero = v_novo.rg_numero,
           rg_orgao_emissor = v_novo.rg_orgao_emissor,
           rg_uf = v_novo.rg_uf,
           rg_data_emissao = v_novo.rg_data_emissao,
           data_nascimento = v_novo.data_nascimento,
           nacionalidade = v_novo.nacionalidade,
           naturalidade_cidade = v_novo.naturalidade_cidade,
           naturalidade_uf = v_novo.naturalidade_uf,
           estado_civil = v_novo.estado_civil,
           regime_bens = v_novo.regime_bens,
           profissao = v_novo.profissao,
           nome_mae = v_novo.nome_mae,
           nome_pai = v_novo.nome_pai,
           telefone = v_novo.telefone,
           email_contato = v_novo.email_contato,
           endereco_cep = v_novo.endereco_cep,
           endereco_logradouro = v_novo.endereco_logradouro,
           endereco_numero = v_novo.endereco_numero,
           endereco_complemento = v_novo.endereco_complemento,
           endereco_bairro = v_novo.endereco_bairro,
           endereco_cidade = v_novo.endereco_cidade,
           endereco_uf = v_novo.endereco_uf,
           pis_pasep_nit = v_novo.pis_pasep_nit,
           ctps_numero = v_novo.ctps_numero,
           ctps_serie = v_novo.ctps_serie,
           titulo_eleitor = v_novo.titulo_eleitor,
           vinculo_tipo = v_novo.vinculo_tipo,
           cargo = v_novo.cargo,
           data_entrada = v_novo.data_entrada,
           data_saida = v_novo.data_saida,
           pj_cnpj = v_novo.pj_cnpj,
           pj_razao_social = v_novo.pj_razao_social,
           participacao_capital = v_novo.participacao_capital,
           socio_administrador = v_novo.socio_administrador,
           banco = v_novo.banco,
           agencia = v_novo.agencia,
           conta = v_novo.conta,
           conta_tipo = v_novo.conta_tipo,
           pix_tipo = v_novo.pix_tipo,
           pix_chave = v_novo.pix_chave,
           remuneracao_mensal = v_novo.remuneracao_mensal,
           observacoes = v_novo.observacoes,
           atualizado_por = v_ator
     where c.user_id = _user_id;
  end if;

  -- Os nomes dos campos, nunca os valores: a trilha não tem prazo.
  perform public.registrar_auditoria(
    v_ator, 'equipe_arkefit.cadastro_alterado', 'auth.users', _user_id, null,
    jsonb_build_object('campos', to_jsonb(v_campos), 'pela_propria_pessoa', v_ator = _user_id, 'novo', v_atual.user_id is null)
  );

  return jsonb_build_object('campos', to_jsonb(v_campos));
end;
$$;

revoke execute on function public.salvar_cadastro_equipe_arkefit(uuid, jsonb) from public, anon;
grant execute on function public.salvar_cadastro_equipe_arkefit(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Exportar para a contabilidade
-- ---------------------------------------------------------------------------
-- Sem `_user_ids`: a equipe toda, só o sócio. Com a lista: cada um precisa
-- ser alguém que quem pede pode ver (a pessoa, só a própria ficha). A trilha
-- guarda quem exportou e de quem, sem os dados.
create or replace function public.exportar_cadastros_equipe_arkefit(_user_ids uuid[] default null)
returns setof public.equipe_arkefit_cadastro
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ator uuid := auth.uid();
  v_ids uuid[];
begin
  if v_ator is null or public.sessao_simulada() then
    raise exception 'Em perfil simulado, ou sem entrar, ninguém baixa as fichas da equipe ArkeFit.' using errcode = '42501';
  end if;

  if _user_ids is null then
    if not public.has_role(v_ator, 'superadmin') then
      raise exception 'Só um sócio da ArkeFit, com a verificação em duas etapas, baixa as fichas da equipe toda.' using errcode = '42501';
    end if;
    select coalesce(array_agg(c.user_id order by c.nome_completo), '{}') into v_ids
      from public.equipe_arkefit_cadastro c;
  else
    if exists (select 1 from unnest(_user_ids) u where u is null or not public.pode_ver_cadastro_equipe_arkefit(u)) then
      raise exception 'Você só baixa a própria ficha.' using errcode = '42501';
    end if;
    select coalesce(array_agg(c.user_id order by c.nome_completo), '{}') into v_ids
      from public.equipe_arkefit_cadastro c
     where c.user_id = any (_user_ids);
  end if;

  if cardinality(v_ids) = 0 then
    raise exception 'Ainda não há cadastro para baixar.' using errcode = 'P0002';
  end if;

  perform public.registrar_auditoria(
    v_ator, 'equipe_arkefit.cadastro_exportado', 'auth.users',
    case when cardinality(v_ids) = 1 then v_ids[1] end, null,
    jsonb_build_object('de', to_jsonb(v_ids), 'quantidade', cardinality(v_ids), 'equipe_toda', _user_ids is null)
  );

  return query
    select c.* from public.equipe_arkefit_cadastro c
     where c.user_id = any (v_ids)
     order by c.nome_completo;
end;
$$;

revoke execute on function public.exportar_cadastros_equipe_arkefit(uuid[]) from public, anon;
grant execute on function public.exportar_cadastros_equipe_arkefit(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. O nome de exibição
-- ---------------------------------------------------------------------------
-- O nome da lista da equipe e de todo o sistema (`profiles.full_name`). Só o
-- sócio verificado muda o de alguém da equipe (o próprio inclusive); a
-- trilha guarda só ids, como `equipe.nome_alterado` (20261407010000).
create or replace function public.renomear_equipe_arkefit(_user_id uuid, _nome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ator uuid := auth.uid();
  v_nome text := nullif(btrim(regexp_replace(coalesce(_nome, ''), '\s+', ' ', 'g')), '');
  v_antes text;
begin
  if not public.has_role(v_ator, 'superadmin') or public.sessao_simulada() then
    raise exception 'Só um sócio da ArkeFit, com a verificação em duas etapas, muda o nome de alguém da equipe.' using errcode = '42501';
  end if;
  if _user_id is null
     or not exists (select 1 from public.user_roles r where r.user_id = _user_id and r.role = any(public.papeis_da_arkefit())) then
    raise exception 'Essa conta não é da equipe ArkeFit.' using errcode = '22023';
  end if;
  if v_nome is null or length(v_nome) < 2 or length(v_nome) > 120 then
    raise exception 'Informe um nome de 2 a 120 letras.' using errcode = '22023';
  end if;

  select p.full_name into v_antes from public.profiles p where p.user_id = _user_id for update;
  if v_antes is not distinct from v_nome then
    return;
  end if;

  insert into public.profiles (user_id, full_name, status)
  values (_user_id, v_nome, 'active')
  on conflict (user_id) do update set full_name = excluded.full_name;

  perform public.registrar_auditoria(
    v_ator, 'equipe_arkefit.nome_alterado', 'auth.users', _user_id, null,
    jsonb_build_object('mudou', 'nome')
  );
end;
$$;

revoke execute on function public.renomear_equipe_arkefit(uuid, text) from public, anon;
grant execute on function public.renomear_equipe_arkefit(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Os documentos anexos
-- ---------------------------------------------------------------------------
-- RG ou CNH, CPF, comprovante de residência, contrato e outro: PDF, JPG ou
-- PNG, até 10 MB (o contrato escaneado passa dos 5 MB dos termos).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('equipe-arkefit-documentos', 'equipe-arkefit-documentos', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- `<user_id>/<arquivo>`, e só: a pasta é a pessoa. Ler e enviar seguem quem
-- vê o cadastro (o sócio, ou a própria pessoa); apagar, só o sócio.
create or replace function public.pode_ver_documento_equipe_arkefit(_caminho text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(_caminho, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$' then
    return false;
  end if;
  return public.pode_ver_cadastro_equipe_arkefit(split_part(_caminho, '/', 1)::uuid);
end;
$$;

create or replace function public.pode_apagar_documento_equipe_arkefit(_caminho text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(_caminho, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$' then
    return false;
  end if;
  return public.has_role(auth.uid(), 'superadmin')
     and not public.sessao_simulada()
     and public.equipe_arkefit_alguma_vez(split_part(_caminho, '/', 1)::uuid);
end;
$$;

-- A regra roda como o usuário logado: sem isto ela daria erro em vez de negar.
revoke execute on function public.pode_ver_documento_equipe_arkefit(text) from public, anon;
revoke execute on function public.pode_apagar_documento_equipe_arkefit(text) from public, anon;
grant execute on function public.pode_ver_documento_equipe_arkefit(text) to authenticated;
grant execute on function public.pode_apagar_documento_equipe_arkefit(text) to authenticated;

-- As regras de storage.objects são uma por operação: o bucket entra nas que
-- existem, com o texto vigente de cada uma (20261214, 20261250, 20261322).
-- A alteração não muda: ninguém sobrescreve um documento; trocar é enviar
-- outro e o sócio apagar o velho.
alter policy "objetos: leitura" on storage.objects using (
  (bucket_id = any (array['avatars', 'email-assets', 'exercicio-videos', 'exercicio-imagens', 'feed-images']))
  or ((bucket_id = any (array['atestados', 'chat-videos', 'termos-biometria'])) and public.pode_acessar_atestado(name))
  or (bucket_id = 'equipe-arkefit-documentos' and public.pode_ver_documento_equipe_arkefit(name))
);

alter policy "objetos: inclusão" on storage.objects
  with check (
    (
      (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
      or (bucket_id = 'feed-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
      or (bucket_id = any (array['exercicio-videos', 'exercicio-imagens']) and public.pode_gravar_midia_exercicio((storage.foldername(name))[1]))
      or (bucket_id = any (array['atestados', 'chat-videos']) and public.pode_acessar_atestado(name))
      or (bucket_id = 'termos-biometria' and public.pode_gravar_termo_biometria(name))
      or (bucket_id = 'equipe-arkefit-documentos' and public.pode_ver_documento_equipe_arkefit(name))
    )
    and public.envio_dentro_do_teto(bucket_id, name)
  );

alter policy "objetos: exclusão" on storage.objects using (
  (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  or (bucket_id = 'feed-images' and (storage.foldername(name))[1] = auth.uid()::text)
  or (bucket_id = any (array['exercicio-videos','exercicio-imagens'])
      and public.pode_gravar_midia_exercicio((storage.foldername(name))[1]))
  or (bucket_id = any (array['atestados','chat-videos']) and public.pode_acessar_atestado(name))
  or (bucket_id = 'equipe-arkefit-documentos' and public.pode_apagar_documento_equipe_arkefit(name))
);
