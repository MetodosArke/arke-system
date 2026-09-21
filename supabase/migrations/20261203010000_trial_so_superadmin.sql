-- Trial é ferramenta de teste, atribuída só pelo Super Admin; matrícula e
-- plano B2B valem desde o primeiro dia (decisão da ArkeFit, 21/09/2026).
--
-- Até aqui o trial vazava para a operação comercial por três caminhos:
--   1. Toda organização nascia `trial` (default da coluna), e o convite de
--      profissional autônomo gravava `trial` fixo.
--   2. A política de UPDATE de organizations deixa o gestor alterar qualquer
--      coluna da própria organização — inclusive `status`. Um gestor podia pôr
--      a academia em `trial` e, com isso, sair do bloqueio por inadimplência
--      (organização em trial nunca é bloqueada).
--   3. iniciar_trial_metodo_arke aceitava a equipe da academia.
-- (O quarto — a assinatura paga do Método com a primeira cobrança 15 dias à
-- frente — é corrigido em asaas-create-subscription.)

-- 1) Organização nova nasce ativa.
alter table public.organizations alter column status set default 'ativo';

-- 2) Status da organização: trial só pelo Super Admin; demais mudanças, só a
-- ArkeFit. Contexto sem usuário (service_role das edge functions, cron,
-- migrations) passa: as funções que chegam aqui já conferem o papel de quem
-- chamou.
create or replace function public.proteger_status_organizacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return new;
  end if;

  -- Atribuir trial, ou mexer no prazo de um trial, é do Super Admin.
  if new.status = 'trial'
     and (tg_op = 'INSERT'
          or old.status is distinct from 'trial'
          or new.trial_vencimento is distinct from old.trial_vencimento)
     and not public.has_role(v_uid, 'superadmin') then
    raise exception 'Apenas o Super Admin ArkeFit pode atribuir ou alterar o período de trial.';
  end if;

  -- Qualquer outra mudança de status é da ArkeFit, nunca do gestor.
  if tg_op = 'UPDATE'
     and new.status is distinct from old.status
     and not (public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'O status da organização só pode ser alterado pela ArkeFit.';
  end if;

  return new;
end;
$$;

revoke execute on function public.proteger_status_organizacao() from public, anon, authenticated;

drop trigger if exists trg_proteger_status_organizacao on public.organizations;
create trigger trg_proteger_status_organizacao
  before insert or update of status, trial_vencimento on public.organizations
  for each row execute function public.proteger_status_organizacao();

-- 3) Trial do Método: só o Super Admin inicia ou encerra.
create or replace function public.iniciar_trial_metodo_arke(_aluno_id uuid, _nivel nivel_atacado)
returns aluno_assinaturas
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
  v_assinatura public.aluno_assinaturas;
begin
  select a.organization_id into v_org from public.alunos a where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.';
  end if;

  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Apenas o Super Admin ArkeFit pode iniciar um trial.';
  end if;

  update public.alunos
     set metodo_arke_status = 'ativo',
         nivel_atacado = _nivel
   where id = _aluno_id;

  insert into public.aluno_assinaturas
    (organization_id, aluno_id, nivel_atacado, valor_cobrado, status, trial_fim)
  values
    (v_org, _aluno_id, _nivel, 0, 'trial', current_date + public.arke_trial_dias())
  on conflict (aluno_id) do update
    set nivel_atacado = excluded.nivel_atacado,
        valor_cobrado = 0,
        status = 'trial',
        trial_fim = excluded.trial_fim,
        fatura_pendente_url = null,
        asaas_subscription_id = null,
        proxima_cobranca = null
  returning * into v_assinatura;

  return v_assinatura;
end;
$function$;

create or replace function public.encerrar_trial_metodo_arke(_aluno_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
begin
  select a.organization_id into v_org from public.alunos a where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.';
  end if;

  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Apenas o Super Admin ArkeFit pode encerrar um trial.';
  end if;

  update public.aluno_assinaturas
     set status = 'cancelada'
   where aluno_id = _aluno_id and status = 'trial';

  update public.alunos
     set metodo_arke_status = 'sem_adesao'
   where id = _aluno_id;
end;
$function$;

-- A mesma trava na tabela, para nenhum outro caminho de escrita (RLS da
-- equipe, por exemplo) criar trial por fora da função.
create or replace function public.proteger_trial_assinatura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and new.status = 'trial'
     and (tg_op = 'INSERT' or old.status is distinct from 'trial')
     and not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Apenas o Super Admin ArkeFit pode atribuir trial do Método ARKE.';
  end if;
  return new;
end;
$$;

revoke execute on function public.proteger_trial_assinatura() from public, anon, authenticated;

drop trigger if exists trg_proteger_trial_assinatura on public.aluno_assinaturas;
create trigger trg_proteger_trial_assinatura
  before insert or update of status on public.aluno_assinaturas
  for each row execute function public.proteger_trial_assinatura();

-- Assinatura paga não carrega prazo de trial: o default só servia para isso.
alter table public.aluno_assinaturas alter column trial_fim drop default;

-- 4) Matrícula de plano próprio vale do dia em que é feita: a primeira
-- mensalidade vence no ato e as seguintes no mesmo dia do mês — que pode ser
-- 29, 30 ou 31 (o Asaas ajusta nos meses mais curtos).
alter table public.aluno_matriculas_academia
  drop constraint if exists aluno_matriculas_academia_dia_vencimento_check,
  add constraint aluno_matriculas_academia_dia_vencimento_check check (dia_vencimento between 1 and 31);

-- 5) Por onde o Super Admin atribui o trial: a ficha da organização na Visão
-- Master lista os alunos dela. O Super Admin não lê `alunos` pelo RLS (que é
-- da equipe da academia e do admin_arke), então a lista vem daqui — só nome e
-- situação no Método, nada de contato ou documento.
create or replace function public.get_superadmin_alunos_trial(_organization_id uuid)
returns table(aluno_id uuid, nome text, metodo_arke_status text, nivel_atacado nivel_atacado,
              assinatura_status text, trial_fim date)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.';
  end if;

  return query
  select a.id,
         coalesce(p.full_name, 'Aluno sem nome'),
         a.metodo_arke_status::text,
         a.nivel_atacado,
         s.status::text,
         s.trial_fim
    from public.alunos a
    left join public.profiles p on p.user_id = a.user_id
    left join public.aluno_assinaturas s on s.aluno_id = a.id
   where a.organization_id = _organization_id
   order by (s.status = 'trial') desc nulls last, p.full_name nulls last;
end;
$$;

revoke execute on function public.get_superadmin_alunos_trial(uuid) from public, anon;
grant execute on function public.get_superadmin_alunos_trial(uuid) to authenticated;
