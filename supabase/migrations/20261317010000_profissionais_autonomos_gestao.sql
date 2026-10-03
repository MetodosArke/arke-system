-- Profissionais autônomos: o convite de quem já tem conta e a gestão pela
-- Visão Master (03/10/2026).
--
-- O convite de um profissional cujo e-mail já tinha conta no ArkeFit falhava:
-- o Auth recusa convidar quem existe, e o desfazer quebrava no meio, deixando
-- a organização criada e vazia. Agora a edge function liga a conta existente ao
-- painel, e para isso precisa achar a conta pelo e-mail (conta_por_email).
--
-- A Visão Master só listava os profissionais. Agora edita o painel e o
-- responsável, troca o responsável que nunca entrou, reenvia o acesso e
-- exclui o painel que nunca foi usado.

-- A conta pelo e-mail, para a edge function decidir entre ligar e convidar.
-- Só a service role: para qualquer outra pessoa, isto descobriria quem tem conta.
create or replace function public.conta_por_email(_email text)
returns table (user_id uuid, ultimo_acesso timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id, u.last_sign_in_at
    from auth.users u
   where lower(u.email) = lower(btrim(_email))
   order by u.created_at
   limit 1;
$$;
revoke execute on function public.conta_por_email(text) from public, anon, authenticated;
grant execute on function public.conta_por_email(text) to service_role;

-- Painel que nunca virou cliente: sem contrato aceito, sem aluno, sem cobrança
-- da ArkeFit e sem conta de recebimento. É o que a ArkeFit pode excluir direto;
-- o resto sai pelo encerramento (aviso de 30 dias, cobranças canceladas,
-- exportação). Uma regra só, usada pela lista e pela exclusão.
create or replace function public.organizacao_nunca_usada(_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organizations o
     where o.id = _organization_id
       and not o.onboarding_completed
       and o.asaas_subscription_id_b2b is null
       and o.asaas_wallet_id is null
       and not exists (select 1 from public.alunos a where a.organization_id = o.id)
       and not exists (select 1 from public.cobrancas_b2b c where c.organization_id = o.id)
       and not exists (
         select 1 from public.aceites_documentos ad
           join public.documentos_legais d on d.id = ad.documento_id
          where ad.organization_id = o.id and d.tipo = 'contrato_academia'
       )
  );
$$;
revoke execute on function public.organizacao_nunca_usada(uuid) from public, anon, authenticated;
grant execute on function public.organizacao_nunca_usada(uuid) to service_role;

-- A lista da Visão Master, com o que a ficha precisa. O "convite pendente"
-- passa a vir do último acesso: o perfil nascia "active" no próprio convite, e
-- a lista dizia "ativou a conta" de quem nunca entrou.
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
  pode_excluir boolean
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
    o.status = 'trial' or public.organizacao_nunca_usada(o.id)
  from public.organizations o
  left join lateral (
    select m.user_id from public.organization_members m
     where m.organization_id = o.id and m.role = 'gestor' and m.status = 'active'
     order by m.created_at
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

-- Editar o painel e o responsável. O perfil é da pessoa, não do painel: o nome
-- corrigido aqui vale onde ela estiver. A especialidade não muda com parceria
-- ativa, porque o parceiro foi convidado para a outra parte, e trocar o dono
-- deixaria os dois prescrevendo a mesma coisa e ninguém a outra.
create or replace function public.atualizar_profissional_autonomo(
  _organization_id uuid,
  _nome text,
  _especialidade public.app_role,
  _responsavel_nome text default null,
  _responsavel_telefone text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations%rowtype;
  v_gestor uuid;
  v_nome text := nullif(btrim(coalesce(_nome, '')), '');
  v_resp text := nullif(btrim(coalesce(_responsavel_nome, '')), '');
  v_tel text := nullif(btrim(coalesce(_responsavel_telefone, '')), '');
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.' using errcode = '42501';
  end if;
  select * into v_org from public.organizations where id = _organization_id for update;
  if v_org.id is null or v_org.tipo <> 'profissional_autonomo' then
    raise exception 'Painel de profissional não encontrado.' using errcode = 'P0002';
  end if;
  if v_nome is null then
    raise exception 'Informe o nome do painel.' using errcode = '22023';
  end if;
  if length(v_nome) > 120 then
    raise exception 'O nome do painel tem no máximo 120 caracteres.' using errcode = '22023';
  end if;
  if _especialidade is null or _especialidade not in ('professor', 'nutricionista') then
    raise exception 'A especialidade é Personal Trainer ou Nutricionista.' using errcode = '22023';
  end if;
  if _especialidade is distinct from v_org.especialidade_profissional and exists (
    select 1 from public.organization_members m
     where m.organization_id = _organization_id and m.status = 'active' and m.role in ('professor', 'nutricionista')
  ) then
    raise exception 'Encerre a parceria antes de trocar a especialidade: o parceiro foi convidado para a outra parte.'
      using errcode = '22023';
  end if;
  if v_tel is not null and length(regexp_replace(v_tel, '\D', '', 'g')) not between 10 and 13 then
    raise exception 'Telefone inválido: use o DDD e o número.' using errcode = '22023';
  end if;

  update public.organizations
     set nome = v_nome, especialidade_profissional = _especialidade
   where id = _organization_id;

  select m.user_id into v_gestor from public.organization_members m
   where m.organization_id = _organization_id and m.role = 'gestor' and m.status = 'active'
   order by m.created_at
   limit 1;
  if v_gestor is not null then
    update public.profiles
       set full_name = coalesce(v_resp, full_name),
           phone = v_tel
     where user_id = v_gestor;
  end if;

  perform public.registrar_auditoria(
    auth.uid(), 'profissional.editado', 'organizations', _organization_id, v_nome,
    jsonb_build_object(
      'nome_anterior', v_org.nome,
      'especialidade', _especialidade,
      'especialidade_anterior', v_org.especialidade_profissional,
      'responsavel_editado', v_gestor is not null
    )
  );
end;
$$;
revoke execute on function public.atualizar_profissional_autonomo(uuid, text, public.app_role, text, text) from public, anon;
grant execute on function public.atualizar_profissional_autonomo(uuid, text, public.app_role, text, text) to authenticated;
