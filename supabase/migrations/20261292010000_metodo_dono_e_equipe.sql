-- Método ARKE: o mentor assume o aluno — fases 1 e 2 do plano de 28/09/2026.
--
-- Até aqui o aluno do Método era, para o banco, igual a qualquer outro: a
-- equipe da academia publicava treino e dieta para ele, lia a anamnese e
-- mexia nas metas e na fase da jornada. O modelo de negócio é outro: quando
-- o aluno compra o Método, treino, dieta, anamnese, metas e jornada passam a
-- ser da ArkeFit, e a academia fica com cadastro, biometria, mensalidade,
-- situação e atestado. Decisões do responsável que entram aqui:
--   1. a academia continua vendo o treino (é ela quem orienta no salão), mas
--      não a dieta nem a anamnese;
--   2. a avaliação física continua sendo medida e registrada pela academia,
--      e o mentor passa a ler;
--   3. atestado e PAR-Q continuam com a academia (nada muda aqui).
--
-- A regra mora no banco, e não nas telas, porque vale para qualquer caminho:
-- tela, função publicada ou importação. Hoje não há aluno de verdade no
-- Método, só os da homologação, então nada precisa ser migrado.

-- ---------------------------------------------------------------------------
-- 1. A equipe da ArkeFit com registro profissional
-- ---------------------------------------------------------------------------
--
-- Tabela da plataforma, como plataforma_config, e por isso sem organization_id:
-- a equipe da ArkeFit atende alunos de todas as academias. Quem publica treino
-- de aluno do Método precisa de CREF, e quem publica dieta, de CRN. A mesma
-- pessoa pode ter os dois. Quem não tem registro acompanha, conversa e
-- encaminha, mas não prescreve.
create table public.equipe_arkefit (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mentor boolean not null default true,
  cref text,
  crn text,
  ativo boolean not null default true,
  atualizado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint equipe_arkefit_cref_valido check (cref is null or length(btrim(cref)) between 4 and 30),
  constraint equipe_arkefit_crn_valido check (crn is null or length(btrim(crn)) between 3 and 30)
);

comment on table public.equipe_arkefit is
  'Equipe da ArkeFit que atende o Método ARKE, com o registro profissional de cada um (CREF para treino, CRN para dieta). Tabela da plataforma, sem organization_id.';

alter table public.equipe_arkefit enable row level security;

create trigger trg_equipe_arkefit_updated_at
  before update on public.equipe_arkefit
  for each row execute function public.set_updated_at();

-- Quem faz parte da ArkeFit (Super Admin ou Admin ARKE). has_role já exige a
-- sessão verificada em duas etapas para esses papéis.
create or replace function public.equipe_metodo()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke');
$$;

-- Sem parâmetro de propósito: responde só sobre quem está chamando, então não
-- serve para sondar quem da equipe tem registro.
create or replace function public.pode_prescrever_treino_metodo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.equipe_metodo() and exists (
    select 1 from public.equipe_arkefit e
     where e.user_id = auth.uid() and e.ativo and nullif(btrim(e.cref), '') is not null
  );
$$;

create or replace function public.pode_prescrever_dieta_metodo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.equipe_metodo() and exists (
    select 1 from public.equipe_arkefit e
     where e.user_id = auth.uid() and e.ativo and nullif(btrim(e.crn), '') is not null
  );
$$;

-- Aluno com o Método ativo. Roda com a permissão de quem pergunta (não é
-- SECURITY DEFINER): quem não enxerga o aluno recebe "não", e por isso ela não
-- serve para descobrir quem está no Método em outra academia.
create or replace function public.aluno_no_metodo(_aluno_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.alunos a where a.id = _aluno_id and a.metodo_arke_status = 'ativo');
$$;

revoke execute on function public.equipe_metodo() from public, anon;
revoke execute on function public.pode_prescrever_treino_metodo() from public, anon;
revoke execute on function public.pode_prescrever_dieta_metodo() from public, anon;
revoke execute on function public.aluno_no_metodo(uuid) from public, anon;
grant execute on function public.equipe_metodo() to authenticated, service_role;
grant execute on function public.pode_prescrever_treino_metodo() to authenticated, service_role;
grant execute on function public.pode_prescrever_dieta_metodo() to authenticated, service_role;
grant execute on function public.aluno_no_metodo(uuid) to authenticated, service_role;

-- A equipe se enxerga (o nome e o registro de quem prescreveu aparecem para os
-- colegas); escrever, só pela função abaixo, que é do Super Admin.
create policy "leitura" on public.equipe_arkefit for select to authenticated
  using (public.equipe_metodo());

create or replace function public.get_superadmin_equipe_arkefit()
returns table (
  user_id uuid,
  nome text,
  email text,
  papeis text[],
  mentor boolean,
  cref text,
  crn text,
  ativo boolean,
  cadastrado boolean
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
         e.user_id is not null
    from public.user_roles r
    join auth.users u on u.id = r.user_id
    left join public.profiles p on p.user_id = u.id
    left join public.equipe_arkefit e on e.user_id = u.id
   where r.role in ('superadmin', 'admin_arke')
   group by u.id, p.full_name, u.email, e.mentor, e.cref, e.crn, e.ativo, e.user_id
   order by 2;
end;
$$;

create or replace function public.salvar_equipe_arkefit(
  _user_id uuid,
  _mentor boolean,
  _cref text,
  _crn text,
  _ativo boolean
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
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Só o Super Admin cadastra a equipe da ArkeFit.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.user_roles r
     where r.user_id = _user_id and r.role in ('superadmin', 'admin_arke')
  ) then
    raise exception 'Essa conta não é da equipe da ArkeFit.' using errcode = '22023';
  end if;

  select to_jsonb(e) - 'updated_at' - 'created_at' into v_antes
    from public.equipe_arkefit e where e.user_id = _user_id;

  insert into public.equipe_arkefit (user_id, mentor, cref, crn, ativo, atualizado_por)
  values (_user_id, coalesce(_mentor, true), v_cref, v_crn, coalesce(_ativo, true), auth.uid())
  on conflict (user_id) do update
     set mentor = excluded.mentor,
         cref = excluded.cref,
         crn = excluded.crn,
         ativo = excluded.ativo,
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
      'depois', jsonb_build_object('mentor', coalesce(_mentor, true), 'cref', v_cref, 'crn', v_crn, 'ativo', coalesce(_ativo, true))
    )
  );
end;
$$;

revoke execute on function public.get_superadmin_equipe_arkefit() from public, anon;
revoke execute on function public.salvar_equipe_arkefit(uuid, boolean, text, text, boolean) from public, anon;
grant execute on function public.get_superadmin_equipe_arkefit() to authenticated;
grant execute on function public.salvar_equipe_arkefit(uuid, boolean, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Quem prescreveu, e de que lado
-- ---------------------------------------------------------------------------
--
-- "dono" com os mesmos valores de tarefas.dono. O registro profissional é
-- guardado na própria prescrição, porque ela é imutável: se o profissional
-- sair da equipe, o aluno continua sabendo quem assinou o treino dele.
alter table public.treinos
  add column dono text not null default 'academia',
  add column prescritor_registro text,
  add constraint treinos_dono_valido check (dono in ('academia', 'arkefit'));

alter table public.dietas
  add column dono text not null default 'academia',
  add column prescritor_registro text,
  add constraint dietas_dono_valido check (dono in ('academia', 'arkefit'));

-- A regra que vale para qualquer caminho, inclusive a chave de serviço, que
-- ignora o RLS: aluno do Método só recebe prescrição de alguém da ArkeFit com
-- o registro da profissão. Sem pessoa (auth.uid() nulo), recusa: nenhuma
-- rotina automática deveria prescrever para o aluno do Método.
create or replace function public.definir_dono_da_prescricao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_metodo boolean;
  v_registro text;
begin
  select a.organization_id, a.metodo_arke_status = 'ativo'
    into v_org, v_metodo
    from public.alunos a
   where a.id = new.aluno_id;

  if v_org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'no_data_found';
  end if;
  if new.organization_id is distinct from v_org then
    raise exception 'A prescrição tem de ser da organização do aluno.' using errcode = '22023';
  end if;

  if not v_metodo then
    new.dono := 'academia';
    new.prescritor_registro := null;
    return new;
  end if;

  select case when tg_table_name = 'treinos' then nullif(btrim(e.cref), '') else nullif(btrim(e.crn), '') end
    into v_registro
    from public.equipe_arkefit e
   where e.user_id = auth.uid() and e.ativo;

  if auth.uid() is null or v_registro is null or not public.equipe_metodo() then
    raise exception using
      errcode = '42501',
      message = case when tg_table_name = 'treinos'
        then 'Este aluno está no Método ARKE: o treino é prescrito pela equipe da ArkeFit, por um profissional com CREF.'
        else 'Este aluno está no Método ARKE: a dieta é prescrita pela equipe da ArkeFit, por um profissional com CRN.'
      end;
  end if;

  new.dono := 'arkefit';
  new.prescritor_registro := v_registro;
  return new;
end;
$$;

create trigger trg_treinos_definir_dono
  before insert on public.treinos
  for each row execute function public.definir_dono_da_prescricao();

create trigger trg_dietas_definir_dono
  before insert on public.dietas
  for each row execute function public.definir_dono_da_prescricao();

-- ---------------------------------------------------------------------------
-- 3. Regras de acesso: uma por operação, com a condição nova dentro delas
-- ---------------------------------------------------------------------------

-- Treino. A academia continua lendo (decisão 1); escrever, só a ArkeFit com
-- CREF quando o aluno está no Método, e só a academia quando não está.
alter policy "leitura" on public.treinos
  using (
    exists (select 1 from public.alunos a where a.id = treinos.aluno_id and a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke')
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

alter policy "inclusão" on public.treinos
  with check (
    ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.aluno_no_metodo(aluno_id) and public.pode_prescrever_treino_metodo())
  );

alter policy "alteração" on public.treinos
  using (
    ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.aluno_no_metodo(aluno_id) and public.pode_prescrever_treino_metodo())
  )
  with check (
    ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.aluno_no_metodo(aluno_id) and public.pode_prescrever_treino_metodo())
  );

alter policy "exclusão" on public.treinos
  using (
    ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.aluno_no_metodo(aluno_id) and public.pode_prescrever_treino_metodo())
  );

-- Dieta. A academia deixa de ler a do aluno do Método (decisão 1).
alter policy "leitura" on public.dietas
  using (
    exists (select 1 from public.alunos a where a.id = dietas.aluno_id and a.user_id = (select auth.uid()))
    or ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

alter policy "inclusão" on public.dietas
  with check (
    ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.aluno_no_metodo(aluno_id) and public.pode_prescrever_dieta_metodo())
  );

alter policy "alteração" on public.dietas
  using (
    ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.aluno_no_metodo(aluno_id) and public.pode_prescrever_dieta_metodo())
  )
  with check (
    ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.aluno_no_metodo(aluno_id) and public.pode_prescrever_dieta_metodo())
  );

alter policy "exclusão" on public.dietas
  using (
    ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.aluno_no_metodo(aluno_id) and public.pode_prescrever_dieta_metodo())
  );

-- Anamnese. A regra antiga era uma só, para todas as operações; vira uma por
-- operação, como o resto do projeto, já com a condição do Método. O próprio
-- aluno segue podendo tudo sobre a dele, como antes.
drop policy "aluno/staff gerencia anamnese" on public.anamnese_acolhimento;

create policy "leitura" on public.anamnese_acolhimento for select to authenticated
  using (
    exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid()))
    or ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

create policy "inclusão" on public.anamnese_acolhimento for insert to authenticated
  with check (
    exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid()))
    or ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

create policy "alteração" on public.anamnese_acolhimento for update to authenticated
  using (
    exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid()))
    or ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  )
  with check (
    exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid()))
    or ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

create policy "exclusão" on public.anamnese_acolhimento for delete to authenticated
  using (
    exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid()))
    or ((public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
      and not public.aluno_no_metodo(aluno_id))
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

-- O resumo da anamnese acompanha a anamnese: se a academia não lê a anamnese
-- do aluno do Método, também não lê o resumo dela. Só a leitura muda; o
-- Sentinela em si fica como está.
alter policy "leitura" on public.sentinela_anamnese
  using (
    exists (select 1 from public.alunos a where a.id = sentinela_anamnese.aluno_id and a.user_id = (select auth.uid()))
    or (public.is_org_staff((select auth.uid()), organization_id) and not public.aluno_no_metodo(aluno_id))
    or public.has_role((select auth.uid()), 'admin_arke')
    or public.has_role((select auth.uid()), 'superadmin')
  );

-- A ArkeFit passa a ler o que precisa para acompanhar o aluno do Método. A
-- academia continua lendo o que já lia: check-in e frequência servem aos
-- dois (Contrato 6.2), e a avaliação física é medida por ela (decisão 2).
alter policy "leitura" on public.alunos
  using (
    user_id = (select auth.uid())
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke')
    or (metodo_arke_status = 'ativo' and public.equipe_metodo())
  );

alter policy "leitura" on public.checkins
  using (
    exists (select 1 from public.alunos a where a.id = checkins.aluno_id and a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke')
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

alter policy "leitura" on public.avaliacoes_fisicas
  using (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

alter policy "leitura" on public.registro_treino
  using (
    exists (select 1 from public.alunos a where a.id = registro_treino.aluno_id and a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke')
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

alter policy "leitura" on public.dieta_adesao
  using (
    exists (select 1 from public.alunos a where a.id = dieta_adesao.aluno_id and a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke')
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

alter policy "leitura" on public.treino_calendario
  using (
    exists (select 1 from public.alunos a where a.id = treino_calendario.aluno_id and a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke')
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

-- ---------------------------------------------------------------------------
-- 4. Metas, fase da jornada e progressão
-- ---------------------------------------------------------------------------

-- A política de alteração de alunos vale para toda a equipe da academia, então
-- a trava é por coluna, no mesmo desenho da trava da situação. O próprio aluno
-- e as rotinas sem usuário passam: a meta de água já tem trava própria na
-- função que o aluno usa, e o resto das metas o aluno não edita.
create or replace function public.proteger_metas_do_metodo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.metodo_arke_status = 'ativo'
     and auth.uid() is not null
     and not public.equipe_metodo()
     and public.is_org_staff(auth.uid(), old.organization_id)
     and (new.objetivo is distinct from old.objetivo
          or new.meta_semanal_dias is distinct from old.meta_semanal_dias
          or new.meta_agua_ml is distinct from old.meta_agua_ml) then
    raise exception 'Este aluno está no Método ARKE: objetivo e metas são definidos pelo mentor da ArkeFit.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_proteger_metas_do_metodo
  before update of objetivo, meta_semanal_dias, meta_agua_ml on public.alunos
  for each row execute function public.proteger_metas_do_metodo();

-- A fase da jornada é do Método: no aluno do Método, só a ArkeFit move.
create or replace function public.mover_fase_jornada(_aluno_id uuid, _fase fase_jornada, _observacao text default null::text)
returns fase_jornada
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
  v_atual public.fase_jornada;
  v_metodo boolean;
  v_nome text;
begin
  select a.organization_id, a.fase_jornada, a.metodo_arke_status = 'ativo'
    into v_org, v_atual, v_metodo
    from public.alunos a
   where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.';
  end if;
  if not (public.equipe_metodo() or (public.is_org_staff(auth.uid(), v_org) and not v_metodo)) then
    if v_metodo then
      raise exception 'Este aluno está no Método ARKE: a fase da jornada é conduzida pelo mentor da ArkeFit.' using errcode = '42501';
    end if;
    raise exception 'Apenas a equipe da academia ou a ArkeFit podem mover a fase da jornada.';
  end if;
  if v_atual = _fase then
    return v_atual;
  end if;
  select p.full_name into v_nome from public.profiles p where p.user_id = auth.uid();
  update public.alunos set fase_jornada = _fase where id = _aluno_id;
  insert into public.aluno_fase_historico (organization_id, aluno_id, fase_anterior, fase_nova, movido_por, movido_por_nome, observacao)
  values (v_org, _aluno_id, v_atual, _fase, auth.uid(), v_nome, nullif(btrim(_observacao), ''));
  return _fase;
end;
$function$;

create or replace function public.liberar_progressao_aluno(_aluno_id uuid, _observacao text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _org uuid;
  _metodo boolean;
begin
  select organization_id, metodo_arke_status = 'ativo' into _org, _metodo from public.alunos where id = _aluno_id;
  if _org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'no_data_found';
  end if;
  if auth.uid() is not null and not (public.equipe_metodo() or (public.is_org_staff(auth.uid(), _org) and not _metodo)) then
    if _metodo then
      raise exception 'Este aluno está no Método ARKE: quem libera a progressão é o mentor da ArkeFit.' using errcode = '42501';
    end if;
    raise exception 'Só a equipe da academia ou a ArkeFit liberam a progressão.' using errcode = '42501';
  end if;
  update public.alunos set progressao_bloqueada_em = null, progressao_bloqueada_motivo = null where id = _aluno_id;
  insert into public.aluno_observacoes (organization_id, aluno_id, autor_id, texto)
  values (_org, _aluno_id, auth.uid(), coalesce(nullif(trim(_observacao), ''), 'Progressão liberada após avaliação do relato de dor.'));
end;
$function$;

-- A passagem de M.A.P.A.® para B.A.S.E.® na primeira prescrição rodava com a
-- permissão de quem publica. A ArkeFit não tem regra de alteração em alunos,
-- então, com o mentor publicando, a passagem não aconteceria, e sem erro
-- nenhum: o update só atingiria zero linhas. É uma transição do sistema, e
-- passa a rodar como tal.
alter function public.avancar_fase_apos_publicacao() security definer;

-- Funções de gatilho não ficam alcançáveis pela API (Higiene de Superfície).
revoke execute on function public.definir_dono_da_prescricao() from public, anon, authenticated;
revoke execute on function public.proteger_metas_do_metodo() from public, anon, authenticated;
revoke execute on function public.avancar_fase_apos_publicacao() from public, anon, authenticated;
