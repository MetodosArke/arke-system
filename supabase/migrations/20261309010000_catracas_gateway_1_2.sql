-- Gateway 1.2.0: placa Toletus LiteNet3 e leitores faciais da Topdata.
--
-- 1) Excluir uma academia não agenda remoção nos equipamentos dela.
--
--    Achado na corrente real do Gateway 1.2.0: apagar a organização apaga
--    os alunos em cascata, e o gatilho de cada aluno agendava a remoção no
--    Gateway (agendar_remocao_equipamento). Com um Gateway que remove
--    sozinho (Control iD, e agora os leitores faciais da Topdata), a ordem
--    nascia apontando para a academia que já tinha saído, e a chave
--    estrangeira derrubava a exclusão inteira. A eliminação do ciclo de
--    encerramento é o mesmo DELETE, então ela também falharia.
--
--    A academia que está sendo apagada leva junto os Gateways e as ordens:
--    não há para quem mandar a remoção. A remoção que importa acontece no
--    término do encerramento, com a academia ainda de pé.
--
-- 2) Os textos da nuvem deixam de dizer que a gestão remota é só da
--    Control iD.

CREATE OR REPLACE FUNCTION public.agendar_remocao_equipamento(_org uuid, _aluno_id uuid, _identificador text, _tinha_biometria boolean, _motivo text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lote uuid := gen_random_uuid();
  v_com integer := 0;
  v_sem integer := 0;
  r record;
begin
  if _identificador is null or btrim(_identificador) = '' then
    return 0;
  end if;

  -- Academia sendo apagada (exclusão de homologação ou a eliminação do
  -- encerramento): os Gateways e as ordens dela saem junto, e uma ordem
  -- nova apontaria para a organização que já não existe.
  if not exists (select 1 from public.organizations where id = _org) then
    return 0;
  end if;

  for r in
    select c.id, ('apagar_usuario' = any (coalesce(t.capacidades, '{}'))) as remoto
      from public.organizacao_catracas c
      left join public.gateway_telemetria t on t.catraca_id = c.id
     where c.organization_id = _org
  loop
    if r.remoto then
      insert into public.gateway_comandos (organization_id, catraca_id, tipo, parametros, aluno_id, lote, motivo, expira_em)
      values (_org, r.id, 'apagar_usuario', jsonb_build_object('user_id', _identificador),
              case when exists (select 1 from public.alunos where id = _aluno_id) then _aluno_id end,
              v_lote, _motivo, now() + interval '24 hours');
      v_com := v_com + 1;
    else
      v_sem := v_sem + 1;
    end if;
  end loop;

  -- Equipamento sem gestão remota (Topdata, Control iD sem credencial
  -- configurada) só guarda dado do aluno se ele tinha digital cadastrada;
  -- cartão, no modo online, fica só no ARKE. Por isso a tarefa manual só
  -- nasce quando havia biometria.
  if v_sem > 0 and _tinha_biometria then
    perform public.abrir_tarefa_remocao_equipamento(
      _org, _aluno_id, _identificador, 'equipamento-manual:' || v_lote::text, _motivo);
  end if;

  return v_com;
end;
$function$;

CREATE OR REPLACE FUNCTION public.solicitar_comando_gateway(_catraca_id uuid, _tipo text, _parametros jsonb DEFAULT '{}'::jsonb, _aluno_id uuid DEFAULT NULL::uuid, _motivo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_cat public.organizacao_catracas;
  v_tel public.gateway_telemetria;
  v_aluno public.alunos;
  v_params jsonb := '{}'::jsonb;
  v_user_id text;
  v_expira interval;
  v_id uuid;
  v_arkefit boolean;
begin
  select * into v_cat from public.organizacao_catracas where id = _catraca_id;
  if v_cat.id is null then
    raise exception 'Catraca não encontrada.';
  end if;

  v_arkefit := public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke');
  if not (v_arkefit
          or public.has_org_role(v_uid, v_cat.organization_id, 'gestor')
          or public.has_org_role(v_uid, v_cat.organization_id, 'recepcao')) then
    raise exception 'Só a gestão ou a recepção da academia (ou a ArkeFit) enviam ordens ao Gateway.' using errcode = '42501';
  end if;

  if _tipo not in ('sincronizar_completo', 'enviar_logs', 'diagnostico', 'liberar_catraca',
                   'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao') then
    -- apagar_usuario só nasce da revogação, da exclusão ou da anonimização,
    -- que conferem o motivo; não é botão.
    raise exception 'Ordem desconhecida: %', _tipo;
  end if;

  if v_cat.status is distinct from 'ativo' then
    raise exception 'Esta catraca está desativada no ARKE.';
  end if;

  select * into v_tel from public.gateway_telemetria where catraca_id = _catraca_id;
  if v_tel.catraca_id is null or not (_tipo = any (v_tel.capacidades)) then
    raise exception '%', case
      when v_tel.catraca_id is null then
        'Este Gateway ainda não reportou à nuvem. Atualize o Gateway Local para a versão 1.0.'
      when _tipo in ('liberar_catraca', 'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao') then
        'Este Gateway não tem a gestão remota do equipamento configurada (disponível para Control iD, leitores faciais Topdata e, para liberar, Toletus).'
      else 'Este Gateway não aceita esta ordem.'
    end;
  end if;

  if _tipo in ('liberar_catraca', 'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao')
     and v_tel.reportado_em < now() - interval '3 minutes' then
    raise exception 'O Gateway está sem sinal agora. Esta ordem precisa de resposta na hora — confira o computador da catraca.';
  end if;

  if _tipo in ('cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao') then
    select * into v_aluno from public.alunos where id = _aluno_id;
    if v_aluno.id is null or v_aluno.organization_id <> v_cat.organization_id then
      raise exception 'Aluno não encontrado nesta academia.';
    end if;
    if v_aluno.anonimizado_em is not null then
      raise exception 'Aluno anonimizado não é cadastrado no equipamento.';
    end if;
  end if;

  case _tipo
    when 'liberar_catraca' then
      if length(btrim(coalesce(_motivo, ''))) < 3 then
        raise exception 'Informe o motivo da liberação — fica registrado.';
      end if;
      v_params := jsonb_build_object(
        'sentido', case when _parametros->>'sentido' in ('entrada', 'saida', 'ambos') then _parametros->>'sentido' else 'entrada' end,
        'equipamento', nullif(_parametros->>'equipamento', ''));
      v_expira := interval '2 minutes';

    when 'cadastrar_usuario' then
      v_user_id := v_aluno.identificador_catraca;
      if v_user_id is null then
        -- Próximo número livre desta academia. Corrida entre dois cadastros
        -- simultâneos cai no índice único na conclusão, que devolve erro
        -- claro em vez de dois alunos com o mesmo número.
        select (coalesce(max(identificador_catraca::bigint), 0) + 1)::text into v_user_id
          from public.alunos
         where organization_id = v_cat.organization_id and identificador_catraca ~ '^\d{1,15}$';
      end if;
      if v_user_id !~ '^\d{1,15}$' then
        raise exception 'O identificador atual deste aluno (%) não é numérico; os equipamentos só aceitam número.', v_user_id;
      end if;
      v_params := jsonb_build_object('user_id', v_user_id, 'nome', 'Aluno',
                                     'matricula', left(v_aluno.id::text, 8));
      v_expira := interval '10 minutes';

    when 'cadastrar_digital' then
      if v_aluno.identificador_catraca is null then
        raise exception 'Cadastre o aluno no equipamento antes da digital.';
      end if;
      if not public.aluno_consentiu_biometria(v_aluno.id) then
        raise exception 'O aluno ainda não autorizou o uso da digital — no app (Perfil → Privacidade) ou pelo termo impresso assinado. A LGPD exige o consentimento dele antes do cadastro.';
      end if;
      v_params := jsonb_build_object('user_id', v_aluno.identificador_catraca,
                                     'equipamento', nullif(_parametros->>'equipamento', ''));
      v_expira := interval '5 minutes';

    when 'cadastrar_cartao' then
      if v_aluno.identificador_catraca is null then
        raise exception 'Cadastre o aluno no equipamento antes do cartão.';
      end if;
      v_params := jsonb_build_object('user_id', v_aluno.identificador_catraca,
                                     'equipamento', nullif(_parametros->>'equipamento', ''));
      v_expira := interval '5 minutes';

    else
      v_expira := interval '10 minutes';
  end case;

  insert into public.gateway_comandos (organization_id, catraca_id, tipo, parametros, aluno_id, motivo, solicitado_por, expira_em)
  values (v_cat.organization_id, _catraca_id, _tipo, v_params, _aluno_id, nullif(btrim(coalesce(_motivo, '')), ''), v_uid, now() + v_expira)
  returning id into v_id;

  if _tipo = 'liberar_catraca' then
    insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
    select v_uid, u.email, 'catraca.liberacao_remota', 'organizacao_catracas', _catraca_id, o.nome,
           jsonb_build_object('comando_id', v_id, 'motivo', _motivo, 'sentido', v_params->>'sentido', 'catraca', v_cat.nome)
      from public.organizations o
      left join auth.users u on u.id = v_uid
     where o.id = v_cat.organization_id;
  end if;

  return v_id;
end;
$function$;
