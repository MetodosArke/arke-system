-- A equipe só com o e-mail provado (auditoria de prontidão, 06/10/2026).
--
-- A gestão nova já esperava a prova do e-mail (20261362010000): a conta que já
-- existia entrava pendente e só virava gestão pelo link do e-mail. A equipe
-- não tinha a mesma trava:
--   * o cadastro da equipe (`cadastrar-membro-equipe`) criava a conta com o
--     e-mail confirmado e uma senha temporária que voltava para quem
--     cadastrava. A gestão ficava com a senha da conta de outra pessoa, e o
--     e-mail nunca era provado;
--   * a parceria do profissional autônomo (`convidar_parceiro_autonomo`)
--     ligava na hora, como professor ou nutricionista, a conta que já
--     existisse com o e-mail digitado. Quem se matriculasse antes com o e-mail
--     de uma nutricionista, com uma senha só dele, passaria a ler a ficha
--     completa dos alunos do painel.
--
-- No molde da gestão:
--   1. a ativação pelo link (`ativar_gestao_pendente`) passa a ativar também o
--      vínculo pendente de professor, nutricionista e recepção. O nome fica,
--      porque o app publicado a chama depois de definir a senha;
--   2. a parceria liga a conta que já existe como PENDENTE (a função que manda
--      o link é `cadastrar-membro-equipe`, que a tela nova passa a chamar);
--   3. o vínculo pendente não vira ativo por fora do link: pela API, nem a
--      gestão nem a ArkeFit trocam `pending` por `active` (a tela da Equipe
--      oferecia "Ativar" para quem não estava ativo). O que roda com a
--      permissão de uma função do banco ou do servidor (`service_role`) segue
--      podendo, porque é assim que a ativação pelo link grava.

set lock_timeout = '5s';

-- ── 1. A ativação pelo link ────────────────────────────────────────────────
create or replace function public.ativar_gestao_pendente()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_vinculo record;
  v_total integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if public.sessao_simulada() then
    raise exception 'Em perfil simulado, só a própria pessoa autoriza, retira a autorização, aceita ou assina. Peça a ela para fazer isso no app dela.'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1
      from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) m
     where m ->> 'method' in ('recovery', 'invite', 'magiclink', 'otp', 'email/signup', 'email_change')
  ) then
    raise exception 'A gestão é ligada depois de você entrar pelo link enviado ao seu e-mail e definir a senha.'
      using errcode = '42501';
  end if;

  for v_vinculo in
    update public.organization_members m
       set status = 'active'
     where m.user_id = v_uid
       and m.role in ('gestor', 'professor', 'nutricionista', 'recepcao')
       and m.status = 'pending'
    returning m.organization_id, m.role
  loop
    v_total := v_total + 1;
    perform public.registrar_auditoria(
      v_uid,
      case when v_vinculo.role = 'gestor' then 'gestao.ativada_pelo_email' else 'equipe.ativada_pelo_email' end,
      'organizations', v_vinculo.organization_id,
      (select o.nome from public.organizations o where o.id = v_vinculo.organization_id),
      jsonb_build_object('papel', v_vinculo.role)
    );
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.ativar_gestao_pendente() from public, anon;
grant execute on function public.ativar_gestao_pendente() to authenticated;

comment on function public.ativar_gestao_pendente() is
  'Ativa o vínculo pendente (gestão e equipe) de quem entrou pelo link do e-mail e definiu a senha. Nunca em perfil simulado.';

-- ── 2. A parceria do autônomo liga a conta que já existe como pendente ─────
create or replace function public.convidar_parceiro_autonomo(_organization_id uuid, _email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations%rowtype;
  v_papel public.app_role;
  v_user uuid;
  v_atual public.organization_members%rowtype;
  v_status text;
begin
  select * into v_org from public.organizations where id = _organization_id;
  if v_org.id is null or v_org.tipo <> 'profissional_autonomo' then
    raise exception 'A parceria é do painel do profissional autônomo.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_members m
     where m.organization_id = _organization_id and m.user_id = auth.uid() and m.role = 'gestor' and m.status = 'active'
  ) then
    raise exception 'Só o dono do painel convida parceiros.' using errcode = '42501';
  end if;

  v_papel := case when v_org.especialidade_profissional = 'nutricionista' then 'professor' else 'nutricionista' end;

  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(_email));
  if v_user is null then
    raise exception 'Não há conta no ArkeFit com esse e-mail. Informe o nome para mandar o convite por e-mail.'
      using errcode = 'P0002';
  end if;
  if v_user = auth.uid() then
    raise exception 'Esse e-mail é o seu.' using errcode = '22023';
  end if;

  select * into v_atual from public.organization_members m
   where m.organization_id = _organization_id and m.user_id = v_user;
  if v_atual.id is not null and v_atual.role not in ('professor', 'nutricionista') then
    raise exception 'Essa pessoa já está no seu painel com outro papel.' using errcode = '23505';
  end if;

  -- Quem já está ativo continua; o resto espera a prova do e-mail.
  v_status := case when v_atual.status = 'active' then 'active' else 'pending' end;
  insert into public.organization_members (organization_id, user_id, role, status)
  values (_organization_id, v_user, v_papel, v_status)
  on conflict (organization_id, user_id) do update set role = excluded.role, status = excluded.status;

  return jsonb_build_object(
    'user_id', v_user,
    'papel', v_papel,
    'pendente', v_status = 'pending',
    'nome', (select p.full_name from public.profiles p where p.user_id = v_user)
  );
end;
$$;

revoke execute on function public.convidar_parceiro_autonomo(uuid, text) from public, anon;
grant execute on function public.convidar_parceiro_autonomo(uuid, text) to authenticated;

-- ── 3. O pendente só vira ativo pelo link ──────────────────────────────────
-- `current_user` é quem executa o comando: pela API, `authenticated`; dentro
-- de uma função `security definer`, o dono dela; no servidor, `service_role`.
-- Por isso a função do gatilho não é `security definer`.
create or replace function public.vinculo_pendente_so_pelo_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status = 'active' and current_user in ('authenticated', 'anon') then
    raise exception 'O acesso pendente só vale depois que a pessoa define a senha pelo link do e-mail dela.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vinculo_pendente_so_pelo_email on public.organization_members;
create trigger trg_vinculo_pendente_so_pelo_email
  before update of status on public.organization_members
  for each row execute function public.vinculo_pendente_so_pelo_email();

-- Função de gatilho nasce com EXECUTE para o PUBLIC (20261215010000).
revoke execute on function public.vinculo_pendente_so_pelo_email() from public, anon, authenticated;
