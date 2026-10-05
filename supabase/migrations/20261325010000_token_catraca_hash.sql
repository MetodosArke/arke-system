-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- Token do Gateway Local guardado como hash.
--
-- O token autentica o Gateway na nuvem: com ele, qualquer um consulta quem
-- entra, sobe acesso e recebe as ordens daquela catraca. Até aqui ele morava
-- em claro em `organizacao_catracas.device_token`, e uma regra FOR ALL dava
-- leitura, alteração e exclusão a toda a equipe, professor e nutricionista
-- incluídos: qualquer um copiava o token da tela.
--
-- Agora o banco guarda só o SHA-256 (`device_token_hash`). O token nasce em
-- `criar_catraca()` e é trocado em `girar_token_catraca()`, as duas só da
-- gestão da academia e da ArkeFit, e cada uma o devolve **uma vez**. Quem
-- perde o token gera outro. O Gateway não muda: o token continua sendo um
-- UUID no `config.json`, e as funções da catraca conferem o hash dele.
--
-- A coluna `device_token` fica vazia aqui e sai em
-- `20261326010000_token_catraca_sem_coluna.sql`, depois do deploy: a tela
-- publicada ainda a lê.

alter table public.organizacao_catracas
  add column if not exists device_token_hash text,
  add column if not exists token_gerado_em timestamptz;

create unique index if not exists organizacao_catracas_device_token_hash_key
  on public.organizacao_catracas (device_token_hash);

-- Uma conta só, igual à de `_shared/tokenCatraca.ts`: SHA-256 do UUID em
-- minúsculas, em hexadecimal.
create or replace function public.hash_token_catraca(_token text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(lower(btrim(_token)), 'UTF8')), 'hex');
$$;

revoke execute on function public.hash_token_catraca(text) from public, anon, authenticated;

update public.organizacao_catracas
   set device_token_hash = public.hash_token_catraca(device_token::text),
       token_gerado_em = coalesce(token_gerado_em, created_at)
 where device_token is not null and device_token_hash is null;

alter table public.organizacao_catracas alter column device_token drop default;
alter table public.organizacao_catracas alter column device_token drop not null;
update public.organizacao_catracas set device_token = null where device_token is not null;

-- Quem cuida dos equipamentos: a gestão da academia e a ArkeFit. Responde só
-- sobre quem chama, para não servir de sonda do papel de outra pessoa.
create or replace function public.gere_catracas(_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from public.organization_members m
            where m.user_id = auth.uid() and m.organization_id = _organization_id
              and m.role = 'gestor' and m.status = 'active')
      or public.has_role(auth.uid(), 'superadmin')
      or public.has_role(auth.uid(), 'admin_arke');
$$;

revoke execute on function public.gere_catracas(uuid) from public, anon;
grant execute on function public.gere_catracas(uuid) to authenticated;

-- Uma regra por operação. A equipe lê (a recepção opera a tela); a gestão e a
-- ArkeFit alteram e excluem. Ninguém inclui pela API: a catraca nasce em
-- `criar_catraca()`, que gera o token.
drop policy if exists "staff/admin_arke gerencia catracas" on public.organizacao_catracas;
drop policy if exists "catracas: leitura" on public.organizacao_catracas;
drop policy if exists "catracas: alteração" on public.organizacao_catracas;
drop policy if exists "catracas: exclusão" on public.organizacao_catracas;

create policy "catracas: leitura" on public.organizacao_catracas
  for select to authenticated
  using (public.has_role((select auth.uid()), 'admin_arke')
      or public.is_org_staff((select auth.uid()), organization_id));

create policy "catracas: alteração" on public.organizacao_catracas
  for update to authenticated
  using (public.gere_catracas(organization_id))
  with check (public.gere_catracas(organization_id));

create policy "catracas: exclusão" on public.organizacao_catracas
  for delete to authenticated
  using (public.gere_catracas(organization_id));

-- Pela API, só nome, localização, status e o atraso de liberação mudam. O
-- hash e a data do token mudam só por `girar_token_catraca()`, que audita;
-- o sinal de vida e a telemetria, só pelas funções do Gateway.
revoke insert, update on public.organizacao_catracas from anon, authenticated;
grant update (nome, localizacao, status, delay_liberacao_seg) on public.organizacao_catracas to authenticated;

create or replace function public.criar_catraca(_organization_id uuid, _nome text, _localizacao text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nome text := btrim(coalesce(_nome, ''));
  v_token text := gen_random_uuid()::text;
  v_id uuid;
begin
  if v_uid is null or not public.gere_catracas(_organization_id) then
    raise exception 'Só a gestão da academia ou a ArkeFit cadastra catraca.' using errcode = '42501';
  end if;
  if v_nome = '' or length(v_nome) > 80 then
    raise exception 'Informe o nome do dispositivo, com até 80 caracteres.' using errcode = '22023';
  end if;

  insert into public.organizacao_catracas (organization_id, nome, localizacao, device_token_hash, token_gerado_em)
  values (_organization_id, v_nome, nullif(btrim(coalesce(_localizacao, '')), ''),
          public.hash_token_catraca(v_token), now())
  returning id into v_id;

  return jsonb_build_object('catraca_id', v_id, 'token', v_token);
end;
$$;

revoke execute on function public.criar_catraca(uuid, text, text) from public, anon;
grant execute on function public.criar_catraca(uuid, text, text) to authenticated;

-- Trocar o token: o anterior para de valer na hora, e o Gateway que o usa
-- fica recusado até receber o novo no `config.json`.
create or replace function public.girar_token_catraca(_catraca_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_nome text;
  v_org_nome text;
  v_token text := gen_random_uuid()::text;
begin
  select c.organization_id, c.nome, o.nome into v_org, v_nome, v_org_nome
    from public.organizacao_catracas c
    join public.organizations o on o.id = c.organization_id
   where c.id = _catraca_id;
  if v_org is null then
    raise exception 'Dispositivo não encontrado.' using errcode = 'P0002';
  end if;
  if v_uid is null or not public.gere_catracas(v_org) then
    raise exception 'Só a gestão da academia ou a ArkeFit troca o token da catraca.' using errcode = '42501';
  end if;

  update public.organizacao_catracas
     set device_token_hash = public.hash_token_catraca(v_token),
         token_gerado_em = now(),
         updated_at = now()
   where id = _catraca_id;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
  select v_uid, u.email, 'catraca.token_girado', 'organizacao_catracas', _catraca_id, v_org_nome,
         jsonb_build_object('catraca', v_nome)
    from (select 1) um
    left join auth.users u on u.id = v_uid;

  return v_token;
end;
$$;

revoke execute on function public.girar_token_catraca(uuid) from public, anon;
grant execute on function public.girar_token_catraca(uuid) to authenticated;

-- A ação de suporte da Visão Master passa a invalidar o token em vez de
-- gerar outro que ninguém veria: a gestão gera o novo na tela Catracas.
create or replace function public.superadmin_resetar_tokens_gateway(_organization_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_qtd integer;
begin
  update public.organizacao_catracas
     set device_token_hash = null,
         token_gerado_em = null,
         updated_at = now()
   where organization_id = _organization_id;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

revoke execute on function public.superadmin_resetar_tokens_gateway(uuid) from public, anon, authenticated;
grant execute on function public.superadmin_resetar_tokens_gateway(uuid) to service_role;
