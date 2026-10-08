-- A equipe da ArkeFit entra por convite de um sócio, e sai pela retirada do
-- acesso (08/10/2026).
--
-- O pedido: chegou o terceiro sócio, e não havia como cadastrá-lo. As duas
-- contas da ArkeFit nasceram direto no banco, com os papéis `superadmin` e
-- `admin_arke`, e a tela Equipe ArkeFit só editava o registro profissional.
-- O convite mora na função `equipe-arkefit-convidar` (conta nova pelo convite
-- do Auth, sem senha); o banco guarda as regras que valem para qualquer
-- caminho.
--
-- 1. Ninguém se dá papel pela API. As regras de inclusão, alteração e
--    exclusão de `user_roles` (20261205010000) eram `has_role(admin_arke)`: o
--    Admin ARKE com as duas etapas se dava `superadmin` (a Visão Master
--    inteira, o dinheiro e a equipe) com um POST, e tirava o papel dos
--    sócios. Hoje as duas contas têm os dois papéis, e por isso ninguém subiu
--    de nível; com a primeira contratação como Admin ARKE, subiria. As regras
--    saem, e a permissão de escrever sai de `anon` e `authenticated`, como na
--    exclusão de alunos (20261408010000): o pedido é recusado com 42501, em
--    vez de responder 200 sem gravar. Quem escreve: a service role (o
--    convite) e as funções abaixo. A leitura fica como está.
-- 2. `papeis_da_arkefit()`: os papéis que a ArkeFit concede e tira, num lugar
--    só no banco. Espelha `PAPEIS_ARKEFIT` (src/lib/acessosArkefit.ts).
-- 3. `estado_conta_arkefit()`: convite enviado, sem as duas etapas, ou ativo.
-- 4. `get_superadmin_equipe_arkefit()` ganha a coluna `estado`. As colunas de
--    antes ficam (a tela publicada as lê); a assinatura muda, então a função
--    é recriada na mesma transação.
-- 5. `gravar_convite_equipe_arkefit()`: o perfil, os papéis, a linha da
--    equipe e a auditoria, juntos. Só a service role, depois do convite.
-- 6. `retirar_acesso_equipe_arkefit()`: tira os papéis, marca a equipe como
--    inativa, encerra as sessões e registra. Recusa tirar o próprio acesso e
--    o do último sócio com as duas etapas.
-- 7. O gatilho que nunca deixa a ArkeFit sem `superadmin`, por qualquer
--    caminho (a API, a service role, o SQL, a exclusão da conta).
-- 8. `emails_socios_para_aviso()` e `conta_da_equipe_arkefit()`: o que a
--    função lê de `auth.users`, que a API não expõe.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. user_roles: ninguém escreve pela API
-- ---------------------------------------------------------------------------
drop policy if exists "inclusão" on public.user_roles;
drop policy if exists "alteração" on public.user_roles;
drop policy if exists "exclusão" on public.user_roles;

revoke insert, update, delete, truncate on public.user_roles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Os papéis da ArkeFit
-- ---------------------------------------------------------------------------
-- Papel novo de um nível novo (o enum `app_role`) entra aqui e em `has_role`,
-- que só aceita papel da ArkeFit numa sessão verificada.
create or replace function public.papeis_da_arkefit()
returns public.app_role[]
language sql
immutable
set search_path = public
as $$
  select array['superadmin', 'admin_arke']::public.app_role[];
$$;

revoke execute on function public.papeis_da_arkefit() from public, anon, authenticated;
grant execute on function public.papeis_da_arkefit() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Onde a conta está no caminho de entrada
-- ---------------------------------------------------------------------------
-- O convite do Auth cria a conta sem senha (`encrypted_password` vazio), e o
-- link do e-mail confirma o e-mail e abre a primeira sessão. Qualquer um dos
-- três faltando é convite em aberto: a senha vazia sozinha não basta como
-- sinal, porque a conta criada por outro caminho do Auth sem senha ganha o
-- hash de uma senha aleatória (20261404010000).
create or replace function public.estado_conta_arkefit(_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when coalesce(u.encrypted_password, '') = '' or u.email_confirmed_at is null or u.last_sign_in_at is null
             then 'convite_enviado'
           when not exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified')
             then 'sem_duas_etapas'
           else 'ativo'
         end
    from auth.users u
   where u.id = _user_id;
$$;

revoke execute on function public.estado_conta_arkefit(uuid) from public, anon, authenticated;
grant execute on function public.estado_conta_arkefit(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. A lista da equipe, com o estado de cada conta
-- ---------------------------------------------------------------------------
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
  estado text
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
  select u.id,
         coalesce(nullif(btrim(p.full_name), ''), u.email)::text,
         u.email::text,
         array_agg(distinct r.role::text order by r.role::text),
         coalesce(e.mentor, false),
         e.cref,
         e.crn,
         coalesce(e.ativo, false),
         e.user_id is not null,
         public.estado_conta_arkefit(u.id)
    from public.user_roles r
    join auth.users u on u.id = r.user_id
    left join public.profiles p on p.user_id = u.id
    left join public.equipe_arkefit e on e.user_id = u.id
   where r.role = any(public.papeis_da_arkefit())
   group by u.id, p.full_name, u.email, e.mentor, e.cref, e.crn, e.ativo, e.user_id
   order by 2;
end;
$$;

revoke execute on function public.get_superadmin_equipe_arkefit() from public, anon;
grant execute on function public.get_superadmin_equipe_arkefit() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. O convite gravado
-- ---------------------------------------------------------------------------
-- A função `equipe-arkefit-convidar` chama esta depois de o Auth criar a
-- conta. Tudo numa transação: se falhar, nada fica, e a função apaga a conta.
-- Ela confere de novo o que o pedido não pode mudar: quem convida é sócio, os
-- papéis são da ArkeFit e a conta é um convite que acabou de nascer (sem
-- senha, sem papel e sem vínculo com academia nenhuma).
create or replace function public.gravar_convite_equipe_arkefit(
  _ator uuid,
  _user_id uuid,
  _nome text,
  _papeis public.app_role[],
  _acesso text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text := nullif(btrim(regexp_replace(coalesce(_nome, ''), '\s+', ' ', 'g')), '');
begin
  if _ator is null or not exists (select 1 from public.user_roles r where r.user_id = _ator and r.role = 'superadmin') then
    raise exception 'Só um sócio da ArkeFit convida para a equipe.' using errcode = '42501';
  end if;
  if coalesce(cardinality(_papeis), 0) = 0 or not (_papeis <@ public.papeis_da_arkefit()) then
    raise exception 'Acesso inválido.' using errcode = '22023';
  end if;
  if coalesce(_acesso, '') !~ '^[a-z_]{2,30}$' or v_nome is null or length(v_nome) > 120 then
    raise exception 'Convite inválido.' using errcode = '22023';
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

  insert into public.user_roles (user_id, role)
  select _user_id, p from unnest(_papeis) p
  on conflict (user_id, role) do nothing;

  -- Sócio não é mentor por padrão: a tela liga, com o registro profissional.
  insert into public.equipe_arkefit (user_id, mentor, ativo, atualizado_por)
  values (_user_id, false, true, _ator)
  on conflict (user_id) do update set ativo = true, atualizado_por = excluded.atualizado_por;

  -- Só ids e o nível: o e-mail e o nome moram na conta.
  perform public.registrar_auditoria(
    _ator, 'equipe_arkefit.convidada', 'auth.users', _user_id, null,
    jsonb_build_object('acesso', _acesso, 'papeis', to_jsonb(_papeis))
  );
end;
$$;

revoke execute on function public.gravar_convite_equipe_arkefit(uuid, uuid, text, public.app_role[], text) from public, anon, authenticated;
grant execute on function public.gravar_convite_equipe_arkefit(uuid, uuid, text, public.app_role[], text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Tirar o acesso
-- ---------------------------------------------------------------------------
-- Chamada pela função `equipe-arkefit-convidar` com a sessão de quem pede
-- (o e-mail aos outros sócios sai de lá). Pela API direta, um sócio
-- verificado também chega aqui: a retirada vale e fica na auditoria, sem o
-- e-mail.
create or replace function public.retirar_acesso_equipe_arkefit(_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ator uuid := auth.uid();
  v_papeis text[];
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
  if v_papeis is null then
    raise exception 'Essa conta não tem acesso da ArkeFit.';
  end if;

  -- O último sócio que entra de fato (senha e duas etapas) fica: sem ele,
  -- ninguém abre a Visão Master nem convida outro.
  if 'superadmin' = any(v_papeis) and not exists (
       select 1 from public.user_roles r
        where r.role = 'superadmin' and r.user_id <> _user_id
          and public.estado_conta_arkefit(r.user_id) = 'ativo') then
    raise exception 'Essa é a última conta de sócio com as duas etapas. Convide outro sócio antes de tirar este acesso.';
  end if;

  delete from public.user_roles where user_id = _user_id and role = any(public.papeis_da_arkefit());

  insert into public.equipe_arkefit (user_id, mentor, ativo, atualizado_por)
  values (_user_id, false, false, v_ator)
  on conflict (user_id) do update set ativo = false, atualizado_por = excluded.atualizado_por;

  -- As sessões abertas caem (os tokens de renovação vão junto, em cascata).
  -- O token de acesso que ainda não venceu não serve para nada da ArkeFit:
  -- `has_role` lê `user_roles` a cada pedido.
  delete from auth.sessions where user_id = _user_id;
  get diagnostics v_sessoes = row_count;

  perform public.registrar_auditoria(
    v_ator, 'equipe_arkefit.acesso_retirado', 'auth.users', _user_id, null,
    jsonb_build_object('papeis', to_jsonb(v_papeis), 'sessoes_encerradas', v_sessoes)
  );

  return jsonb_build_object('papeis', to_jsonb(v_papeis), 'sessoes_encerradas', v_sessoes);
end;
$$;

revoke execute on function public.retirar_acesso_equipe_arkefit(uuid) from public, anon;
grant execute on function public.retirar_acesso_equipe_arkefit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. A ArkeFit nunca fica sem sócio
-- ---------------------------------------------------------------------------
-- O piso, por qualquer caminho: a retirada já recusa o último sócio ativo, e
-- o gatilho recusa o último `superadmin` de todos, inclusive pela service
-- role, pelo SQL e pela exclusão da conta (a cascata passa por aqui).
-- `security definer` porque a exclusão da conta roda como o Auth, que não lê
-- `user_roles`. `after`: vê o resultado do comando inteiro.
create or replace function public.impedir_arkefit_sem_socio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.user_roles where role = 'superadmin') then
    raise exception 'A ArkeFit não pode ficar sem nenhum sócio (papel superadmin).';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_user_roles_sempre_um_socio on public.user_roles;
create trigger trg_user_roles_sempre_um_socio
  after delete or update of role on public.user_roles
  for each row
  when (old.role = 'superadmin')
  execute function public.impedir_arkefit_sem_socio();

-- Função de gatilho nasce com EXECUTE para o PUBLIC (20261215010000).
revoke execute on function public.impedir_arkefit_sem_socio() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. O que a função do convite lê de auth.users
-- ---------------------------------------------------------------------------
-- Os sócios que recebem o aviso de convite e de retirada: `superadmin` que
-- entra de fato (senha e duas etapas), sem quem pediu e sem a pessoa.
create or replace function public.emails_socios_para_aviso(_exceto uuid[])
returns table (email text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct u.email::text
    from public.user_roles r
    join auth.users u on u.id = r.user_id
   where r.role = 'superadmin'
     and u.email is not null
     and u.deleted_at is null
     and (u.banned_until is null or u.banned_until < now())
     and not (r.user_id = any(coalesce(_exceto, '{}'::uuid[])))
     and public.estado_conta_arkefit(r.user_id) = 'ativo';
$$;

revoke execute on function public.emails_socios_para_aviso(uuid[]) from public, anon, authenticated;
grant execute on function public.emails_socios_para_aviso(uuid[]) to service_role;

-- A conta da equipe, para reenviar o convite: só quem tem papel da ArkeFit.
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
     and exists (select 1 from public.user_roles r where r.user_id = u.id and r.role = any(public.papeis_da_arkefit()));
$$;

revoke execute on function public.conta_da_equipe_arkefit(uuid) from public, anon, authenticated;
grant execute on function public.conta_da_equipe_arkefit(uuid) to service_role;
