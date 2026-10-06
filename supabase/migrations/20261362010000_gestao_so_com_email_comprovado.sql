-- Auditoria de prontidão, rodada 3: a gestão só é ligada a quem provou o
-- e-mail (06/10/2026).
--
-- A matrícula pública cria a conta com o e-mail já confirmado, sem prova de que
-- quem se matricula é o dono do e-mail. Criar a academia na Visão Master e
-- convidar um profissional autônomo ligavam uma conta existente como gestora
-- só pelo e-mail. Quem se matriculasse antes com o e-mail do futuro dono de uma
-- academia, com uma senha que só ele sabe, viraria gestor do painel novo.
--
-- A escolha: conta que já existia entra na gestão **pendente**, e só vira
-- gestão quando a pessoa entra pelo link que vai para o e-mail dela e define
-- a senha ali. Não dá para saber, olhando a conta, se o e-mail foi provado:
-- a matrícula pública, o cadastro pela equipe e o convite deixam a conta igual.
-- Então a regra vale para toda conta existente, inclusive a de um gestor de
-- verdade que ganha uma segunda academia: ele recebe o link e define a senha de
-- novo, uma vez. Na tela de definir a senha, o app encerra as outras sessões da
-- conta antes de ativar, e com isso a senha e as sessões de quem criou a conta
-- antes deixam de valer.

set lock_timeout = '5s';

-- ── A ativação ─────────────────────────────────────────────────────────────
-- Só numa sessão aberta por link do e-mail (o `amr` do JWT) e nunca em perfil
-- simulado, que também nasce de um link, mas aberto pela ArkeFit no servidor.
-- Responde só sobre quem chama.
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
     where m.user_id = v_uid and m.role = 'gestor' and m.status = 'pending'
    returning m.organization_id
  loop
    v_total := v_total + 1;
    perform public.registrar_auditoria(
      v_uid, 'gestao.ativada_pelo_email', 'organizations', v_vinculo.organization_id,
      (select o.nome from public.organizations o where o.id = v_vinculo.organization_id), '{}'::jsonb
    );
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.ativar_gestao_pendente() from public, anon;
grant execute on function public.ativar_gestao_pendente() to authenticated;

-- ── O último gestor ────────────────────────────────────────────────────────
-- A gestão pendente conta como a próxima: trocar o responsável de um painel
-- (o que nunca entrou, com e-mail errado no convite) por uma conta que já
-- existia deixa só a pendente. Sem isto, o anterior ficava ativo para sempre,
-- e quem tivesse aquele e-mail errado entraria como gestor.
create or replace function public.prevent_remover_ultimo_gestor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_outros_gestores integer;
begin
  v_org_id := coalesce(old.organization_id, new.organization_id);

  if old.role = 'gestor' and old.status = 'active'
     and (tg_op = 'DELETE' or (tg_op = 'UPDATE' and (new.status <> 'active' or new.role <> 'gestor')))
     and exists (select 1 from public.organizations where id = v_org_id) then

    select count(*) into v_outros_gestores
      from public.organization_members
      where organization_id = v_org_id
        and role = 'gestor'
        and status in ('active', 'pending')
        and user_id <> old.user_id;

    if v_outros_gestores = 0 then
      raise exception 'Não é possível remover ou inativar o único gestor ativo da organização.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ── A lista da Visão Master ────────────────────────────────────────────────
-- O responsável pendente aparece como responsável, marcado como pendente: sem
-- isso o painel apareceria "sem responsável", e a conta que já existia (com
-- último acesso de outro painel) apareceria como "entra no painel".
drop function if exists public.get_superadmin_profissionais_autonomos();
create function public.get_superadmin_profissionais_autonomos()
returns table (
  organization_id uuid,
  nome text,
  slug text,
  especialidade public.app_role,
  status public.org_status,
  gestor_user_id uuid,
  gestor_nome text,
  email text,
  telefone text,
  ultimo_acesso timestamptz,
  alunos_total bigint,
  parceiros jsonb,
  created_at timestamptz,
  sem_gestor boolean,
  onboarding_completed boolean,
  etapa_implantacao text,
  pode_excluir boolean,
  gestor_pendente boolean
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.' using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.nome,
    o.slug,
    o.especialidade_profissional,
    o.status,
    g.user_id,
    p.full_name,
    u.email::text,
    p.phone,
    u.last_sign_in_at,
    (select count(*) from public.alunos a where a.organization_id = o.id),
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nome', pp.full_name, 'email', uu.email, 'papel', m.role)
                       order by m.created_at)
        from public.organization_members m
        left join public.profiles pp on pp.user_id = m.user_id
        left join auth.users uu on uu.id = m.user_id
       where m.organization_id = o.id and m.status = 'active' and m.role in ('professor', 'nutricionista')
    ), '[]'::jsonb),
    o.created_at,
    g.user_id is null,
    o.onboarding_completed,
    i.etapa_atual,
    o.status = 'trial' or public.organizacao_nunca_usada(o.id),
    coalesce(g.status = 'pending', false)
  from public.organizations o
  left join lateral (
    select m.user_id, m.status from public.organization_members m
     where m.organization_id = o.id and m.role = 'gestor' and m.status in ('active', 'pending')
     order by m.status = 'active' desc, m.created_at
     limit 1
  ) g on true
  left join auth.users u on u.id = g.user_id
  left join public.profiles p on p.user_id = g.user_id
  left join public.implantacao i on i.organization_id = o.id
  where o.tipo = 'profissional_autonomo'
  order by o.created_at desc;
end;
$$;
revoke execute on function public.get_superadmin_profissionais_autonomos() from public, anon;
grant execute on function public.get_superadmin_profissionais_autonomos() to authenticated;

-- ── Higiene: função de gatilho não é alcançável pela API ────────────────────
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
