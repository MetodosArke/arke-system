-- Método ARKE, fase 7: o painel do personal e da nutricionista autônomos (28/09/2026).
--
-- O profissional autônomo usa o ArkeFit como negócio próprio: é o gestor de
-- uma organização de uma pessoa só (`tipo = profissional_autonomo`), com a
-- especialidade em `especialidade_profissional`. O painel passa a ser o de uma
-- academia pequena — vendas, financeiro, planos e cobrança —, e esta migration
-- faz a parte do banco:
--
--   1. abrir a conta Asaas com CPF, que exige a data de nascimento;
--   2. a configuração inicial sem a etapa de equipe (a parceria é opcional);
--   3. cada um prescreve a sua parte: o personal, treino; a nutricionista, dieta;
--   4. a parceria por convite (decisão 6): o personal chama uma nutricionista
--      para a carteira dele, ou o contrário, e os dois veem a ficha completa.

-- ---------------------------------------------------------------------------
-- 1. Data de nascimento para a conta Asaas com CPF
-- ---------------------------------------------------------------------------
alter table public.organizations add column responsavel_nascimento date;

comment on column public.organizations.responsavel_nascimento is
  'Data de nascimento de quem responde pelo CPF da organização. O Asaas exige para abrir conta de pessoa física (profissional autônomo sem CNPJ).';

-- ---------------------------------------------------------------------------
-- 2. A configuração inicial do autônomo
-- ---------------------------------------------------------------------------
--
-- Mesma função da academia, com duas diferenças: com CPF, o nome completo
-- (guardado em razao_social) é obrigatório, porque é o nome da conta Asaas; e
-- o autônomo não tem etapa de equipe — trabalha sozinho, e a parceria é
-- opcional.
create or replace function public.onboarding_etapas_interno(_organization_id uuid)
returns table(etapa text, concluida boolean, detalhe text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  o public.organizations%rowtype;
  v_doc text;
  v_faltando text[] := '{}';
  v_n int;
  v_autonomo boolean;
begin
  select * into o from public.organizations where id = _organization_id;
  if not found then
    return;
  end if;
  v_autonomo := o.tipo = 'profissional_autonomo';

  v_doc := regexp_replace(coalesce(o.cnpj_cpf, ''), '\D', '', 'g');
  if length(v_doc) not in (11, 14) then
    v_faltando := array_append(v_faltando, case when v_autonomo then 'CPF ou CNPJ' else 'CNPJ' end);
  end if;
  if length(v_doc) = 14 and coalesce(btrim(o.razao_social), '') = '' then v_faltando := array_append(v_faltando, 'razão social'); end if;
  if length(v_doc) = 11 and coalesce(btrim(o.razao_social), '') = '' then v_faltando := array_append(v_faltando, 'nome completo'); end if;
  if coalesce(btrim(o.email_contato), '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then v_faltando := array_append(v_faltando, 'e-mail'); end if;
  if length(regexp_replace(coalesce(o.telefone, ''), '\D', '', 'g')) < 10 then v_faltando := array_append(v_faltando, 'celular'); end if;
  if length(regexp_replace(coalesce(o.cep, ''), '\D', '', 'g')) <> 8 then v_faltando := array_append(v_faltando, 'CEP'); end if;
  if coalesce(btrim(o.logradouro), '') = '' or coalesce(btrim(o.numero), '') = '' or coalesce(btrim(o.bairro), '') = ''
     or coalesce(btrim(o.cidade), '') = '' or o.uf is null then
    v_faltando := array_append(v_faltando, 'endereço');
  end if;
  etapa := 'dados';
  concluida := cardinality(v_faltando) = 0;
  detalhe := case when concluida then null else 'Falta: ' || array_to_string(v_faltando, ', ') end;
  return next;

  etapa := 'recebimentos';
  concluida := o.asaas_wallet_id is not null;
  detalhe := case
    when o.asaas_wallet_id is null then 'Conta Asaas ainda não configurada'
    when o.asaas_conta_origem = 'criada' and coalesce(o.asaas_conta_status, '') <> 'APPROVED'
      then 'Conta criada — aprovação do Asaas: ' || coalesce(o.asaas_conta_status, 'aguardando')
    else null
  end;
  return next;

  select count(*) into v_n from public.planos_academia where organization_id = _organization_id and ativo;
  etapa := 'planos';
  concluida := v_n > 0;
  detalhe := case when v_n > 0 then v_n || ' plano(s) ativo(s)' else 'Nenhum plano ativo' end;
  return next;

  select count(*) into v_n from public.organization_members
   where organization_id = _organization_id and status = 'active' and role in ('professor', 'nutricionista', 'recepcao');
  etapa := 'equipe';
  if v_autonomo then
    concluida := true;
    detalhe := case when v_n > 0 then v_n || ' parceria(s)' else 'Parceria é opcional' end;
  else
    concluida := v_n > 0 or o.onboarding_equipe_dispensada;
    detalhe := case when v_n > 0 then v_n || ' pessoa(s) na equipe'
                    when o.onboarding_equipe_dispensada then 'Sem equipe além do gestor'
                    else 'Nenhum membro cadastrado' end;
  end if;
  return next;

  select count(*) into v_n from public.alunos where organization_id = _organization_id and anonimizado_em is null;
  etapa := 'alunos';
  concluida := v_n > 0;
  detalhe := case when v_n > 0 then v_n || ' aluno(s)' else 'Nenhum aluno cadastrado' end;
  return next;

  etapa := 'contrato';
  concluida := exists (select 1 from public.aceites_documentos a
                        where a.organization_id = _organization_id
                          and a.documento_id = public.documento_legal_vigente('contrato_academia'));
  detalhe := case when concluida then 'Aceito' else 'Contrato ainda não aceito' end;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. No painel do autônomo, cada um prescreve a sua parte
-- ---------------------------------------------------------------------------
--
-- Quem pode prescrever o quê numa organização de profissional autônomo: o
-- dono (gestor) prescreve o que a especialidade dele permite; o parceiro
-- convidado, o que o papel dele permite. Na academia nada muda.
create or replace function public.papel_prescreve_no_autonomo(_organization_id uuid, _user_id uuid, _o_que text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
     where m.organization_id = _organization_id
       and m.user_id = _user_id
       and m.status = 'active'
       and (case when m.role = 'gestor' then o.especialidade_profissional::text else m.role::text end)
           = case when _o_que = 'treino' then 'professor' else 'nutricionista' end
  );
$$;

revoke execute on function public.papel_prescreve_no_autonomo(uuid, uuid, text) from public, anon, authenticated;

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
  v_tipo_org public.organization_tipo;
begin
  select a.organization_id, a.metodo_arke_status = 'ativo', o.tipo
    into v_org, v_metodo, v_tipo_org
    from public.alunos a
    join public.organizations o on o.id = a.organization_id
   where a.id = new.aluno_id;

  if v_org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'no_data_found';
  end if;
  if new.organization_id is distinct from v_org then
    raise exception 'A prescrição tem de ser da organização do aluno.' using errcode = '22023';
  end if;

  if not v_metodo then
    -- No painel do autônomo, treino é do personal e dieta da nutricionista.
    -- Sem pessoa (rotina automática), segue como antes.
    if v_tipo_org = 'profissional_autonomo'
       and auth.uid() is not null
       and not public.equipe_metodo()
       and not public.papel_prescreve_no_autonomo(v_org, auth.uid(), case when tg_table_name = 'treinos' then 'treino' else 'dieta' end) then
      raise exception using
        errcode = '42501',
        message = case when tg_table_name = 'treinos'
          then 'Neste painel, o treino é prescrito pelo personal.'
          else 'Neste painel, a dieta é prescrita pela nutricionista.'
        end;
    end if;
    new.dono := 'academia';
    new.prescritor_registro := null;
    return new;
  end if;

  -- O registro é gravado sempre que existe, mesmo com a exigência desligada:
  -- a prescrição é imutável e deve dizer quem assinou.
  select case when tg_table_name = 'treinos' then nullif(btrim(e.cref), '') else nullif(btrim(e.crn), '') end
    into v_registro
    from public.equipe_arkefit e
   where e.user_id = auth.uid() and e.ativo;

  if auth.uid() is null
     or not public.equipe_metodo()
     or (public.registro_metodo_exigido() and v_registro is null) then
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

-- ---------------------------------------------------------------------------
-- 4. Parceria entre personal e nutricionista autônomos (decisão 6)
-- ---------------------------------------------------------------------------
--
-- O dono do painel convida quem faz a outra metade: o personal chama uma
-- nutricionista, a nutricionista chama um personal. O parceiro entra como
-- membro da organização com o papel dele, e o painel dele ganha a unidade no
-- seletor do cabeçalho (o mesmo da multiunidade). O aluno continua num
-- cadastro só, e cada um prescreve a sua parte.
--
-- Só convida quem já tem conta no ArkeFit: pessoa nova é cadastrada pelo
-- caminho de sempre (`cadastrar-membro-equipe`), com senha temporária.
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
    raise exception 'Não há conta no ArkeFit com esse e-mail. Cadastre a pessoa pelo convite com senha temporária.'
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

  insert into public.organization_members (organization_id, user_id, role, status)
  values (_organization_id, v_user, v_papel, 'active')
  on conflict (organization_id, user_id) do update set role = excluded.role, status = 'active';

  return jsonb_build_object(
    'user_id', v_user,
    'papel', v_papel,
    'nome', (select p.full_name from public.profiles p where p.user_id = v_user)
  );
end;
$$;

create or replace function public.encerrar_parceria_autonomo(_organization_id uuid, _user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.organization_members m
      join public.organizations o on o.id = m.organization_id
     where m.organization_id = _organization_id and m.user_id = auth.uid() and m.role = 'gestor'
       and m.status = 'active' and o.tipo = 'profissional_autonomo'
  ) then
    raise exception 'Só o dono do painel encerra parcerias.' using errcode = '42501';
  end if;

  -- O que o parceiro já prescreveu continua valendo: a prescrição é imutável.
  update public.organization_members
     set status = 'inactive'
   where organization_id = _organization_id
     and user_id = _user_id
     and role in ('professor', 'nutricionista');
end;
$$;

create or replace function public.get_parceiros_autonomo(_organization_id uuid)
returns table (user_id uuid, nome text, email text, papel text, status text, desde timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_staff(auth.uid(), _organization_id) then
    raise exception 'Acesso restrito ao painel.' using errcode = '42501';
  end if;
  return query
  select m.user_id, coalesce(p.full_name, u.email)::text, u.email::text, m.role::text, m.status::text, m.created_at
    from public.organization_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
   where m.organization_id = _organization_id
     and m.role in ('professor', 'nutricionista')
   order by m.status, m.created_at;
end;
$$;

revoke execute on function public.convidar_parceiro_autonomo(uuid, text) from public, anon;
revoke execute on function public.encerrar_parceria_autonomo(uuid, uuid) from public, anon;
revoke execute on function public.get_parceiros_autonomo(uuid) from public, anon;
grant execute on function public.convidar_parceiro_autonomo(uuid, text) to authenticated;
grant execute on function public.encerrar_parceria_autonomo(uuid, uuid) to authenticated;
grant execute on function public.get_parceiros_autonomo(uuid) to authenticated;
