-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

create or replace function public.get_onboarding_organizacao(_organization_id uuid)
returns table (etapa text, concluida boolean, detalhe text)
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
begin
  if not (public.is_org_staff(auth.uid(), _organization_id)
          or public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à equipe da academia.' using errcode = '42501';
  end if;

  select * into o from public.organizations where id = _organization_id;
  if not found then
    return;
  end if;

  v_doc := regexp_replace(coalesce(o.cnpj_cpf, ''), '\D', '', 'g');
  if length(v_doc) not in (11, 14) then v_faltando := array_append(v_faltando, 'CNPJ'); end if;
  if length(v_doc) = 14 and coalesce(btrim(o.razao_social), '') = '' then v_faltando := array_append(v_faltando, 'razão social'); end if;
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
  concluida := v_n > 0 or o.onboarding_equipe_dispensada;
  detalhe := case when v_n > 0 then v_n || ' pessoa(s) na equipe'
                  when o.onboarding_equipe_dispensada then 'Sem equipe além do gestor'
                  else 'Nenhum membro cadastrado' end;
  return next;

  select count(*) into v_n from public.alunos where organization_id = _organization_id and anonimizado_em is null;
  etapa := 'alunos';
  concluida := v_n > 0;
  detalhe := case when v_n > 0 then v_n || ' aluno(s)' else 'Nenhum aluno cadastrado' end;
  return next;
end;
$$;
