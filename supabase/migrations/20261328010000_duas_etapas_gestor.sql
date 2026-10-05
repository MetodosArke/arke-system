-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- Duas etapas para a gestão nas ações que entregam a academia inteira
-- (decisão de 04/10/2026): exportar todos os dados, avisar o encerramento e
-- trocar o e-mail de login de alguém (este, em `editar-membro-equipe`).
--
-- A senha sozinha dava tudo isso a quem a tivesse: a planilha com e-mail,
-- telefone e endereço de todos os alunos, o fim do contrato e a conta de um
-- membro da equipe. Agora a gestão confirma com o código do aplicativo
-- autenticador, e quem ainda não ativou ativa na hora. A tela pede antes; o
-- banco confere de novo, porque a tela não é fronteira.

-- A sessão de quem chama passou pelo código do aplicativo autenticador.
create or replace function public.sessao_verificada()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

revoke execute on function public.sessao_verificada() from public, anon;
grant execute on function public.sessao_verificada() to authenticated;

create or replace function public.emails_alunos_organizacao(_organization_id uuid)
returns table(aluno_id uuid, email text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_org_role(auth.uid(), _organization_id, 'gestor') then
    raise exception 'Só a gestão da academia exporta os dados dela.' using errcode = '42501';
  end if;
  if not public.sessao_verificada() then
    raise exception 'Exportar todos os dados pede a verificação em duas etapas.' using errcode = '42501';
  end if;
  return query
  select a.id, u.email::text
    from public.alunos a
    join auth.users u on u.id = a.user_id
   where a.organization_id = _organization_id
   order by a.id;
end;
$function$;

create or replace function public.avisar_encerramento_organizacao(_organization_id uuid, _motivo text, _iniciativa text, _imediato boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_arke boolean := public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke');
  v_org record;
  v_termino date;
  v_id uuid;
begin
  if _iniciativa not in ('academia', 'arkefit') then
    raise exception 'Iniciativa inválida.' using errcode = '22023';
  end if;
  if not v_arke then
    if not public.has_org_role(v_uid, _organization_id, 'gestor') then
      raise exception 'Só a gestão da academia ou a ArkeFit avisam o encerramento.' using errcode = '42501';
    end if;
    if _iniciativa <> 'academia' or _imediato then
      raise exception 'A academia só avisa o encerramento por iniciativa própria, com 30 dias.' using errcode = '42501';
    end if;
    -- A ArkeFit já chega aqui verificada: `has_role` só aceita o papel dela
    -- numa sessão com as duas etapas.
    if not public.sessao_verificada() then
      raise exception 'Encerrar o contrato pede a verificação em duas etapas.' using errcode = '42501';
    end if;
  end if;
  if _imediato and _iniciativa <> 'arkefit' then
    raise exception 'Encerramento imediato é só da ArkeFit, por violação grave dos Termos.' using errcode = '22023';
  end if;

  select id, nome, cnpj_cpf, status into v_org from public.organizations where id = _organization_id;
  if v_org.id is null then
    raise exception 'Academia não encontrada.' using errcode = 'P0002';
  end if;
  if v_org.status = 'trial' then
    -- Homologação não tem contrato nem cobrança: sai pela exclusão simples.
    raise exception 'Academia em homologação sai pela exclusão, não pelo encerramento.' using errcode = '22023';
  end if;
  if exists (select 1 from public.organizacao_encerramentos
              where organization_id = _organization_id and etapa in ('aviso', 'encerrada')) then
    raise exception 'Esta academia já tem um encerramento em curso.' using errcode = '23505';
  end if;

  v_termino := case when _imediato then current_date else current_date + 30 end;
  insert into public.organizacao_encerramentos (
    organization_id, organizacao_nome, organizacao_documento, iniciativa, motivo, solicitado_por, termino_em, eliminacao_em)
  values (_organization_id, v_org.nome, v_org.cnpj_cpf, _iniciativa, btrim(_motivo), v_uid, v_termino, v_termino + 30)
  returning id into v_id;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
  select v_uid, u.email, 'organizacao.encerramento_avisado', 'organizacao_encerramentos', v_id, v_org.nome,
         jsonb_build_object('iniciativa', _iniciativa, 'motivo', btrim(_motivo), 'termino_em', v_termino, 'imediato', _imediato)
    from (select 1) um left join auth.users u on u.id = v_uid;
  return v_id;
end;
$function$;
