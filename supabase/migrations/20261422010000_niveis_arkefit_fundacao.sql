-- Os níveis da equipe da ArkeFit, lote 1: a fundação (08/10/2026).
--
-- A decisão do responsável de 08/10/2026: a equipe contratada pela ArkeFit
-- ganha níveis de acesso (Suporte, Comercial, Mentor e Financeiro), além do
-- Sócio, que já existe. Cada nível abre áreas da Visão Master, e a pergunta
-- "esta pessoa abre esta área?" mora num lugar só no banco:
-- `acesso_arkefit(área)`. O espelho no app é `src/lib/acessosArkefit.ts`.
--
-- O desenho:
--   * o nível mora em `equipe_arkefit.niveis` (uma lista: a pessoa pode ter
--     mais de um). **Nível nunca grava `user_roles`**: só o Sócio tem
--     `superadmin` e `admin_arke`. Papel novo no enum `app_role` ficou de
--     fora de propósito: as regras de RLS citam papéis pelo nome, o
--     `admin_arke` é gestor de toda academia, valor de enum não se remove, e
--     `add value` não roda na mesma transação;
--   * `acesso_arkefit(área)`: o Sócio (`has_role` superadmin, que já exige as
--     duas etapas) passa em tudo; o nível passa só com a sessão verificada
--     (aal2), ativo, fora de sessão simulada, e só nas áreas dele. Área
--     desconhecida é erro (22023), e não "não";
--   * `niveis_arkefit_abertos()`: os níveis que já podem ser dados. A regra
--     da decisão é que ninguém recebe nível antes de a área dele estar no ar:
--     aqui a lista nasce vazia, e cada lote que põe uma área no ar abre o
--     nível dela (o Mentor no lote 3, o Suporte no lote 4). Comercial e
--     Financeiro ficam para a entrega 2;
--   * a pessoa lê a própria linha de `equipe_arkefit`, mesmo antes das duas
--     etapas: é por ela que o app sabe que a conta é da equipe e pede o
--     cadastro do aplicativo autenticador;
--   * `equipe_metodo()` passa a ser o Mentor (`acesso_arkefit('mentoria')`)
--     ou o Admin ARKE, e vira `security definer`: a regra de leitura de
--     `equipe_arkefit` a chama, e ela lê `equipe_arkefit` (sem o definer, a
--     leitura entraria na própria regra);
--   * a lista da equipe, o salvar, o convite gravado, a retirada do acesso e
--     o reenvio passam a conhecer os níveis.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Os níveis na equipe
-- ---------------------------------------------------------------------------
alter table public.equipe_arkefit
  add column if not exists niveis text[] not null default '{}';

alter table public.equipe_arkefit drop constraint if exists equipe_arkefit_niveis_validos;
alter table public.equipe_arkefit
  add constraint equipe_arkefit_niveis_validos
  check (niveis <@ array['suporte', 'comercial', 'mentor', 'financeiro']::text[]);

comment on column public.equipe_arkefit.niveis is
  'Os níveis da equipe contratada (suporte, comercial, mentor, financeiro). Cada um abre áreas da Visão Master por acesso_arkefit(área). O Sócio não tem nível: tem os papéis superadmin e admin_arke.';

-- ---------------------------------------------------------------------------
-- 2. Os níveis que já podem ser dados
-- ---------------------------------------------------------------------------
-- Espelho de `NIVEIS` (src/lib/acessosArkefit.ts, `aberto`) e do espelho da
-- função do convite. Cada lote que põe uma área no ar redefine esta lista.
create or replace function public.niveis_arkefit_abertos()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[]::text[];
$$;

revoke execute on function public.niveis_arkefit_abertos() from public, anon;
grant execute on function public.niveis_arkefit_abertos() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A pergunta de cada área
-- ---------------------------------------------------------------------------
-- O `case` é o mesmo de `NIVEIS_DA_AREA` (src/lib/acessosArkefit.ts);
-- `acessosArkefit.guarda.test.ts` falha se os dois divergirem.
--
-- A ordem é a do custo: a área (sem consulta), o Sócio (uma leitura de
-- `user_roles` pelo índice único), a sessão (sem consulta) e a linha da
-- equipe (pela chave). A sessão simulada só é conferida para quem já passou.
create or replace function public.acesso_arkefit(_area text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_niveis text[];
begin
  v_niveis := case _area
    when 'carteira'   then array['suporte', 'comercial', 'financeiro']
    when 'cadastro'   then array['comercial']
    when 'comercial'  then array['comercial']
    when 'suporte'    then array['suporte']
    when 'operacao'   then array['suporte']
    when 'mentoria'   then array['mentor']
    when 'financeiro' then array['financeiro']
    when 'socio'      then array[]::text[]
  end;
  if v_niveis is null then
    raise exception 'Área desconhecida: %', coalesce(_area, '(nula)') using errcode = '22023';
  end if;

  -- O Sócio passa em tudo. `has_role` já exige as duas etapas de quem chama.
  if public.has_role(auth.uid(), 'superadmin') then
    return true;
  end if;

  -- O nível só vale com as duas etapas.
  if coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then
    return false;
  end if;

  return exists (
           select 1 from public.equipe_arkefit e
            where e.user_id = auth.uid() and e.ativo and e.niveis && v_niveis
         )
     -- A sessão simulada é de outra pessoa, aberta pela ArkeFit: o nível de
     -- quem foi simulado não vale nela.
     and not public.sessao_simulada();
end;
$$;

comment on function public.acesso_arkefit(text) is
  'Quem chama abre esta área da Visão Master? O Sócio sempre; o nível da equipe (equipe_arkefit.niveis) só com as duas etapas, ativo e fora de sessão simulada. Área desconhecida: 22023.';

revoke execute on function public.acesso_arkefit(text) from public, anon;
grant execute on function public.acesso_arkefit(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. O Método: o Mentor ou o Admin ARKE
-- ---------------------------------------------------------------------------
-- Antes: superadmin ou admin_arke. O Sócio tem os dois, e segue passando. O
-- Mentor passa pela área `mentoria`; as regras que usam esta função já pedem
-- o aluno do Método (`aluno_no_metodo`) ou a biblioteca do Método, e as
-- funções que a usavam sozinha passam a pedir o aluno do Método no lote 3.
--
-- Cerca de vinte regras a chamam linha a linha (sem o `(select ...)`). A
-- sessão vem primeiro: sem as duas etapas, nem o papel da ArkeFit nem o
-- nível valem (`has_role` e `acesso_arkefit` exigem aal2), e a resposta sai
-- sem ler tabela nenhuma. Antes, a sessão só com a senha (o aluno, a gestão
-- sem as duas etapas) fazia duas leituras de `user_roles` por linha.
create or replace function public.equipe_metodo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and (public.has_role(auth.uid(), 'admin_arke') or public.acesso_arkefit('mentoria'));
$$;

revoke execute on function public.equipe_metodo() from public, anon;
grant execute on function public.equipe_metodo() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Quem lê a equipe
-- ---------------------------------------------------------------------------
-- A própria linha, sempre (o app lê o nível antes das duas etapas para pedir
-- o cadastro do aplicativo); a equipe do Método se enxerga, como antes (o
-- nome e o registro de quem prescreveu); o Sócio lê tudo. Escrever continua
-- só pelas funções abaixo.
alter policy "leitura" on public.equipe_arkefit
  using (
    user_id = (select auth.uid())
    or (select public.equipe_metodo())
    or (select public.acesso_arkefit('socio'))
  );

-- ---------------------------------------------------------------------------
-- 6. A lista da equipe, com os níveis
-- ---------------------------------------------------------------------------
-- Quem tem papel da ArkeFit (o Sócio) e quem tem nível. A coluna nova vai no
-- fim; a tela publicada lê as de antes. A assinatura muda: recriada na mesma
-- transação.
drop function if exists public.get_superadmin_equipe_arkefit();

create function public.get_superadmin_equipe_arkefit()
returns table (
  user_id uuid,
  nome text,
  email text,
  papeis text[],
  mentor boolean,
  cref text,
  crn text,
  ativo boolean,
  cadastrado boolean,
  estado text,
  niveis text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.' using errcode = '42501';
  end if;

  return query
  with pessoas as (
    select r.user_id from public.user_roles r where r.role = any(public.papeis_da_arkefit())
    union
    select e.user_id from public.equipe_arkefit e where cardinality(e.niveis) > 0
  )
  select u.id,
         coalesce(nullif(btrim(p.full_name), ''), u.email)::text,
         u.email::text,
         coalesce((select array_agg(distinct r.role::text order by r.role::text)
                     from public.user_roles r
                    where r.user_id = u.id and r.role = any(public.papeis_da_arkefit())), '{}'::text[]),
         coalesce(e.mentor, false),
         e.cref,
         e.crn,
         coalesce(e.ativo, false),
         e.user_id is not null,
         public.estado_conta_arkefit(u.id),
         coalesce(e.niveis, '{}'::text[])
    from pessoas x
    join auth.users u on u.id = x.user_id
    left join public.profiles p on p.user_id = u.id
    left join public.equipe_arkefit e on e.user_id = u.id
   order by 2;
end;
$$;

revoke execute on function public.get_superadmin_equipe_arkefit() from public, anon;
grant execute on function public.get_superadmin_equipe_arkefit() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Salvar a equipe, com os níveis
-- ---------------------------------------------------------------------------
-- `_niveis` nulo mantém os níveis de hoje (a tela publicada não manda). O
-- Sócio não tem nível: ele já abre tudo. Quem não é Sócio:
--   * só recebe nível aberto (`niveis_arkefit_abertos()`);
--   * fica com ao menos um nível: tirar todo o acesso é a retirada, que
--     encerra as sessões e avisa os sócios;
--   * é mentor exatamente quando tem o nível Mentor.
-- O antes e o depois vão para a Auditoria, como já iam.
drop function if exists public.salvar_equipe_arkefit(uuid, boolean, text, text, boolean);

create or replace function public.salvar_equipe_arkefit(
  _user_id uuid,
  _mentor boolean,
  _cref text,
  _crn text,
  _ativo boolean,
  _niveis text[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cref text := nullif(btrim(_cref), '');
  v_crn text := nullif(btrim(_crn), '');
  v_antes jsonb;
  v_tem_papel boolean;
  v_socio boolean;
  v_niveis text[];
  v_mentor boolean;
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Só o Super Admin cadastra a equipe da ArkeFit.' using errcode = '42501';
  end if;

  v_tem_papel := exists (
    select 1 from public.user_roles r
     where r.user_id = _user_id and r.role = any(public.papeis_da_arkefit())
  );
  v_socio := exists (select 1 from public.user_roles r where r.user_id = _user_id and r.role = 'superadmin');

  select to_jsonb(e) - 'updated_at' - 'created_at' into v_antes
    from public.equipe_arkefit e where e.user_id = _user_id;

  -- Da equipe: tem papel da ArkeFit, ou tem nível. A conta que teve o acesso
  -- retirado volta só por convite novo, que avisa os sócios.
  if not v_tem_papel and coalesce(jsonb_array_length(v_antes -> 'niveis'), 0) = 0 then
    raise exception 'Essa conta não é da equipe da ArkeFit.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct n order by n), '{}'::text[]) into v_niveis
    from unnest(coalesce(_niveis, array(select jsonb_array_elements_text(coalesce(v_antes -> 'niveis', '[]'::jsonb))))) n
   where nullif(btrim(n), '') is not null;

  if v_socio and cardinality(v_niveis) > 0 then
    raise exception 'O sócio já abre toda a Visão Master: nível é para a equipe contratada.' using errcode = '22023';
  end if;
  if _niveis is not null and not (v_niveis <@ public.niveis_arkefit_abertos()) then
    raise exception 'Esse nível ainda não está no ar.' using errcode = '22023';
  end if;
  if not v_tem_papel and cardinality(v_niveis) = 0 then
    raise exception 'Para tirar todo o acesso, use “Tirar o acesso” na lista: ele encerra as sessões e avisa os sócios.'
      using errcode = '22023';
  end if;

  -- O mentor da equipe contratada é quem tem o nível Mentor; o do Sócio, a
  -- chave da tela ("Atende como mentor").
  v_mentor := case when v_tem_papel then coalesce(_mentor, true) else 'mentor' = any(v_niveis) end;

  insert into public.equipe_arkefit (user_id, mentor, cref, crn, ativo, niveis, atualizado_por)
  values (_user_id, v_mentor, v_cref, v_crn, coalesce(_ativo, true), v_niveis, auth.uid())
  on conflict (user_id) do update
     set mentor = excluded.mentor,
         cref = excluded.cref,
         crn = excluded.crn,
         ativo = excluded.ativo,
         niveis = excluded.niveis,
         atualizado_por = excluded.atualizado_por;

  -- Quem pode prescrever é informação que se explica depois: fica na Auditoria.
  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, detalhes)
  values (
    auth.uid(),
    (select u.email from auth.users u where u.id = auth.uid()),
    'equipe_arkefit_salva',
    'equipe_arkefit',
    _user_id,
    jsonb_build_object(
      'antes', v_antes,
      'depois', jsonb_build_object('mentor', v_mentor, 'cref', v_cref, 'crn', v_crn,
                                   'ativo', coalesce(_ativo, true), 'niveis', to_jsonb(v_niveis))
    )
  );
end;
$$;

revoke execute on function public.salvar_equipe_arkefit(uuid, boolean, text, text, boolean, text[]) from public, anon;
grant execute on function public.salvar_equipe_arkefit(uuid, boolean, text, text, boolean, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. O convite gravado, com os níveis
-- ---------------------------------------------------------------------------
-- Um convite é do Sócio (os papéis `superadmin` e `admin_arke`, sem nível)
-- ou da equipe contratada (os níveis, sem papel nenhum): nunca os dois. O
-- nível só entra aberto. O Mentor nasce `mentor`, com o CREF e o CRN quando
-- informados. A assinatura antiga (sem os níveis) sai; a nova aceita a
-- chamada antiga, pelos padrões, e o convite do Sócio segue igual.
drop function if exists public.gravar_convite_equipe_arkefit(uuid, uuid, text, public.app_role[], text);

create or replace function public.gravar_convite_equipe_arkefit(
  _ator uuid,
  _user_id uuid,
  _nome text,
  _papeis public.app_role[],
  _acesso text,
  _niveis text[] default '{}',
  _cref text default null,
  _crn text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text := nullif(btrim(regexp_replace(coalesce(_nome, ''), '\s+', ' ', 'g')), '');
  v_papeis public.app_role[] := coalesce(_papeis, '{}'::public.app_role[]);
  v_niveis text[];
  v_mentor boolean;
  v_cref text := nullif(btrim(coalesce(_cref, '')), '');
  v_crn text := nullif(btrim(coalesce(_crn, '')), '');
begin
  if _ator is null or not exists (select 1 from public.user_roles r where r.user_id = _ator and r.role = 'superadmin') then
    raise exception 'Só um sócio da ArkeFit convida para a equipe.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct n order by n), '{}'::text[]) into v_niveis
    from unnest(coalesce(_niveis, '{}'::text[])) n
   where nullif(btrim(n), '') is not null;

  -- Sócio (papéis, sem nível) ou equipe contratada (nível, sem papel).
  if (cardinality(v_papeis) = 0) = (cardinality(v_niveis) = 0) then
    raise exception 'Acesso inválido.' using errcode = '22023';
  end if;
  if cardinality(v_papeis) > 0 and not (_papeis <@ public.papeis_da_arkefit()) then
    raise exception 'Acesso inválido.' using errcode = '22023';
  end if;
  if not (v_niveis <@ public.niveis_arkefit_abertos()) then
    raise exception 'Esse nível ainda não está no ar.' using errcode = '22023';
  end if;
  if coalesce(_acesso, '') !~ '^[a-z_]{2,30}$' or v_nome is null or length(v_nome) > 120 then
    raise exception 'Convite inválido.' using errcode = '22023';
  end if;

  v_mentor := 'mentor' = any(v_niveis);
  -- O registro profissional é do Mentor; fora dele, não se grava.
  if not v_mentor then
    v_cref := null;
    v_crn := null;
  end if;
  if (v_cref is not null and length(v_cref) not between 4 and 30) or (v_crn is not null and length(v_crn) not between 3 and 30) then
    raise exception 'Registro profissional inválido.' using errcode = '22023';
  end if;

  if public.estado_conta_arkefit(_user_id) is distinct from 'convite_enviado'
     or exists (select 1 from public.user_roles r where r.user_id = _user_id)
     or exists (select 1 from public.organization_members m where m.user_id = _user_id)
     or exists (select 1 from public.alunos a where a.user_id = _user_id) then
    raise exception 'A conta não é um convite novo.' using errcode = '22023';
  end if;

  insert into public.profiles (user_id, full_name, status)
  values (_user_id, v_nome, 'active')
  on conflict (user_id) do update set full_name = excluded.full_name, status = 'active';

  -- Só o Sócio ganha papel; o nível nunca grava `user_roles`.
  insert into public.user_roles (user_id, role)
  select _user_id, p from unnest(v_papeis) p
  on conflict (user_id, role) do nothing;

  -- Sócio não é mentor por padrão: a tela liga, com o registro profissional.
  insert into public.equipe_arkefit (user_id, mentor, cref, crn, ativo, niveis, atualizado_por)
  values (_user_id, v_mentor, v_cref, v_crn, true, v_niveis, _ator)
  on conflict (user_id) do update
     set mentor = excluded.mentor,
         cref = excluded.cref,
         crn = excluded.crn,
         ativo = true,
         niveis = excluded.niveis,
         atualizado_por = excluded.atualizado_por;

  -- Só ids e o nível: o e-mail e o nome moram na conta.
  perform public.registrar_auditoria(
    _ator, 'equipe_arkefit.convidada', 'auth.users', _user_id, null,
    jsonb_build_object('acesso', _acesso, 'papeis', to_jsonb(v_papeis), 'niveis', to_jsonb(v_niveis))
  );
end;
$$;

revoke execute on function public.gravar_convite_equipe_arkefit(uuid, uuid, text, public.app_role[], text, text[], text, text) from public, anon, authenticated;
grant execute on function public.gravar_convite_equipe_arkefit(uuid, uuid, text, public.app_role[], text, text[], text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Tirar o acesso: os papéis e os níveis
-- ---------------------------------------------------------------------------
-- As regras de antes ficam (o próprio acesso e o último sócio nunca), e a
-- conta só com nível também sai: os níveis zeram e a linha fica inativa.
create or replace function public.retirar_acesso_equipe_arkefit(_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ator uuid := auth.uid();
  v_papeis text[];
  v_niveis text[];
  v_sessoes integer;
begin
  if not public.has_role(v_ator, 'superadmin') or public.sessao_simulada() then
    raise exception 'Só um sócio da ArkeFit, com a verificação em duas etapas, tira o acesso da equipe.' using errcode = '42501';
  end if;
  if _user_id is null or _user_id = v_ator then
    raise exception 'Você não pode tirar o próprio acesso. Peça a outro sócio.';
  end if;

  select array_agg(r.role::text order by r.role::text) into v_papeis
    from public.user_roles r
   where r.user_id = _user_id and r.role = any(public.papeis_da_arkefit());
  select e.niveis into v_niveis from public.equipe_arkefit e where e.user_id = _user_id;
  if v_papeis is null and coalesce(cardinality(v_niveis), 0) = 0 then
    raise exception 'Essa conta não tem acesso da ArkeFit.';
  end if;

  -- O último sócio que entra de fato (senha e duas etapas) fica: sem ele,
  -- ninguém abre a Visão Master nem convida outro.
  if 'superadmin' = any(coalesce(v_papeis, '{}'::text[])) and not exists (
       select 1 from public.user_roles r
        where r.role = 'superadmin' and r.user_id <> _user_id
          and public.estado_conta_arkefit(r.user_id) = 'ativo') then
    raise exception 'Essa é a última conta de sócio com as duas etapas. Convide outro sócio antes de tirar este acesso.';
  end if;

  delete from public.user_roles where user_id = _user_id and role = any(public.papeis_da_arkefit());

  insert into public.equipe_arkefit (user_id, mentor, ativo, niveis, atualizado_por)
  values (_user_id, false, false, '{}', v_ator)
  on conflict (user_id) do update
     set ativo = false, mentor = false, niveis = '{}', atualizado_por = excluded.atualizado_por;

  -- As sessões abertas caem (os tokens de renovação vão junto, em cascata).
  -- O token de acesso que ainda não venceu não serve para nada da ArkeFit:
  -- `has_role` e `acesso_arkefit` leem o banco a cada pedido.
  delete from auth.sessions where user_id = _user_id;
  get diagnostics v_sessoes = row_count;

  perform public.registrar_auditoria(
    v_ator, 'equipe_arkefit.acesso_retirado', 'auth.users', _user_id, null,
    jsonb_build_object('papeis', to_jsonb(coalesce(v_papeis, '{}'::text[])),
                       'niveis', to_jsonb(coalesce(v_niveis, '{}'::text[])),
                       'sessoes_encerradas', v_sessoes)
  );

  return jsonb_build_object('papeis', to_jsonb(coalesce(v_papeis, '{}'::text[])),
                            'niveis', to_jsonb(coalesce(v_niveis, '{}'::text[])),
                            'sessoes_encerradas', v_sessoes);
end;
$$;

revoke execute on function public.retirar_acesso_equipe_arkefit(uuid) from public, anon;
grant execute on function public.retirar_acesso_equipe_arkefit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. O reenvio do convite: também para quem só tem nível
-- ---------------------------------------------------------------------------
create or replace function public.conta_da_equipe_arkefit(_user_id uuid)
returns table (email text, nome text, estado text)
language sql
stable
security definer
set search_path = public
as $$
  select u.email::text,
         coalesce(nullif(btrim(p.full_name), ''), '')::text,
         public.estado_conta_arkefit(u.id)
    from auth.users u
    left join public.profiles p on p.user_id = u.id
   where u.id = _user_id
     and (exists (select 1 from public.user_roles r where r.user_id = u.id and r.role = any(public.papeis_da_arkefit()))
          or exists (select 1 from public.equipe_arkefit e where e.user_id = u.id and cardinality(e.niveis) > 0));
$$;

revoke execute on function public.conta_da_equipe_arkefit(uuid) from public, anon, authenticated;
grant execute on function public.conta_da_equipe_arkefit(uuid) to service_role;
