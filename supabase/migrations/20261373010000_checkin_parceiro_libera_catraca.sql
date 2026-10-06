-- Check-in de parceiro (Wellhub, TotalPass) abre a catraca de verdade
-- (06/10/2026).
--
-- Auditoria de prontidão, achado médio. A tela dizia "Catraca liberada!", e
-- a função `catraca-checkin-parceiro-externo` só gravava o registro do
-- acesso: nenhuma ordem saía para o Gateway, e o visitante ficava parado na
-- catraca fechada.
--
-- Agora o check-in passa por `checkin_parceiro_externo()`:
--   1. confere quem pede (equipe da academia, ou a ArkeFit), a catraca e o
--      parceiro habilitado, e registra o check-in — é ele que conta na
--      conferência com o repasse do parceiro;
--   2. se a catraca aceita ordem remota (o Gateway declarou `liberar_catraca`
--      e está com sinal), e quem pede é da gestão ou da recepção (a mesma
--      regra da liberação remota), manda a ordem de liberar pelo mesmo canal
--      da liberação remota (`gateway_comandos`), e a tela acompanha até o
--      Gateway confirmar;
--   3. senão, diz o que fazer — liberar pelo botão da recepção ou no próprio
--      equipamento —, sem prometer que abriu.
-- A ordem concluída não grava um segundo registro de acesso ("liberado pela
-- recepção"): o check-in já está registrado.

set lock_timeout = '5s';

create or replace function public.checkin_parceiro_externo(_catraca_id uuid, _parceiro text, _nome_visitante text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cat public.organizacao_catracas;
  v_tel public.gateway_telemetria;
  v_arkefit boolean;
  v_log uuid;
  v_cmd uuid;
  v_rotulo text;
  v_motivo text;
begin
  select * into v_cat from public.organizacao_catracas where id = _catraca_id;
  if v_cat.id is null then
    raise exception 'Catraca não encontrada.' using errcode = 'P0002';
  end if;

  v_arkefit := public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke');
  if not (v_arkefit or public.is_org_staff(v_uid, v_cat.organization_id)) then
    raise exception 'Você não tem permissão para liberar acessos nesta academia.' using errcode = '42501';
  end if;
  -- A função grava no registro de acessos e na fila do Gateway por cima do
  -- RLS; a regra "duas etapas" das duas tabelas (20261363010000) vale aqui
  -- também.
  if not public.sessao_cumpre_duas_etapas() then
    raise exception 'Entre de novo com o código do aplicativo autenticador: a sua conta usa a verificação em duas etapas.'
      using errcode = '42501';
  end if;

  if _parceiro is null or _parceiro not in ('wellhub', 'totalpass') then
    raise exception 'Parceiro inválido. Use wellhub ou totalpass.' using errcode = '22023';
  end if;
  v_rotulo := case _parceiro when 'wellhub' then 'Wellhub' else 'TotalPass' end;

  if v_cat.status is distinct from 'ativo' then
    return jsonb_build_object('registrado', false, 'liberacao', 'nenhuma', 'motivo', 'Dispositivo inativo.');
  end if;
  if not exists (select 1 from public.organizacao_credenciais_parceiro p
                  where p.organization_id = v_cat.organization_id and p.parceiro = _parceiro and p.ativo) then
    return jsonb_build_object('registrado', false, 'liberacao', 'nenhuma',
                              'motivo', 'Este parceiro não está habilitado para esta academia.');
  end if;

  insert into public.acessos_catraca_logs (organization_id, catraca_id, resultado, parceiro_externo, nome_visitante_externo, confirmado_por)
  values (v_cat.organization_id, v_cat.id, 'liberado_parceiro_externo', _parceiro,
          left(nullif(btrim(coalesce(_nome_visitante, '')), ''), 120), v_uid)
  returning id into v_log;

  select * into v_tel from public.gateway_telemetria where catraca_id = _catraca_id;
  if not (v_arkefit
          or public.has_org_role(v_uid, v_cat.organization_id, 'gestor')
          or public.has_org_role(v_uid, v_cat.organization_id, 'recepcao')) then
    v_motivo := 'Check-in registrado. Abrir a catraca pelo ARKE é da recepção ou da gestão: peça a quem está na recepção para liberar o visitante.';
  elsif v_tel.catraca_id is null or not ('liberar_catraca' = any (v_tel.capacidades)) then
    v_motivo := 'Check-in registrado. Esta catraca não abre pelo ARKE: libere o visitante pelo botão da recepção ou no próprio equipamento.';
  elsif v_tel.reportado_em < now() - interval '3 minutes' then
    v_motivo := 'Check-in registrado, mas o computador da catraca está sem sinal agora: libere o visitante pelo botão da recepção ou no próprio equipamento.';
  else
    insert into public.gateway_comandos (organization_id, catraca_id, tipo, parametros, motivo, solicitado_por, expira_em)
    values (v_cat.organization_id, v_cat.id, 'liberar_catraca',
            jsonb_build_object('sentido', 'entrada', 'equipamento', null, 'checkin', _parceiro),
            'Check-in ' || v_rotulo, v_uid, now() + interval '2 minutes')
    returning id into v_cmd;

    insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
    select v_uid, u.email, 'catraca.liberacao_remota', 'organizacao_catracas', v_cat.id, o.nome,
           jsonb_build_object('comando_id', v_cmd, 'motivo', 'Check-in ' || v_rotulo, 'sentido', 'entrada', 'catraca', v_cat.nome)
      from public.organizations o
      left join auth.users u on u.id = v_uid
     where o.id = v_cat.organization_id;

    return jsonb_build_object('registrado', true, 'log_id', v_log, 'liberacao', 'enviada', 'comando_id', v_cmd,
                              'motivo', 'Check-in registrado. A catraca abre assim que o Gateway receber a ordem.');
  end if;

  return jsonb_build_object('registrado', true, 'log_id', v_log, 'liberacao', 'manual', 'comando_id', null, 'motivo', v_motivo);
end;
$$;

revoke execute on function public.checkin_parceiro_externo(uuid, text, text) from public, anon;
grant execute on function public.checkin_parceiro_externo(uuid, text, text) to authenticated, service_role;

-- A liberação de um check-in concluída não grava "liberado pela recepção":
-- o acesso já está registrado como check-in do parceiro. O resto é igual a
-- 20261310010000.
create or replace function public.concluir_comando_gateway(_catraca_id uuid, _comando_id uuid, _sucesso boolean, _resultado jsonb, _erro text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.gateway_comandos;
begin
  update public.gateway_comandos
     set status = case when _sucesso then 'concluido' else 'falhou' end,
         concluido_em = now(),
         resultado = _resultado,
         erro = case when _sucesso then null else left(coalesce(nullif(_erro, ''), 'Falhou sem detalhe.'), 500) end
   where id = _comando_id and catraca_id = _catraca_id and status = 'entregue'
  returning * into c;
  if c.id is null then
    -- Resultado de comando que não é deste Gateway, ou que já foi fechado
    -- (expirado, ou resultado repetido): ignorado em silêncio de propósito.
    return;
  end if;

  if c.tipo = 'cadastrar_usuario' and _sucesso and c.aluno_id is not null then
    begin
      update public.alunos
         set identificador_catraca = c.parametros->>'user_id'
       where id = c.aluno_id and organization_id = c.organization_id;
    exception when unique_violation then
      update public.gateway_comandos
         set status = 'falhou',
             erro = 'O número ' || (c.parametros->>'user_id') || ' já pertence a outro aluno desta academia.'
       where id = c.id;
    end;
  elsif c.tipo = 'enviar_foto_rosto' then
    -- A foto já cumpriu o papel (ou não vai cumprir): sai do banco quando
    -- nenhuma ordem aberta a usa mais.
    perform public.limpar_fotos_rosto_sem_uso();
  elsif c.tipo = 'liberar_catraca' and _sucesso and not (c.parametros ? 'checkin') then
    insert into public.acessos_catraca_logs (organization_id, catraca_id, aluno_id, cpf_consultado, resultado, confirmado_por)
    values (c.organization_id, c.catraca_id, null, 'remoto', 'liberado_remoto', c.solicitado_por);
  elsif c.tipo = 'apagar_usuario' then
    if _sucesso then
      perform public.verificar_remocao_concluida(c.lote);
    else
      perform public.abrir_tarefa_remocao_equipamento(
        c.organization_id, c.aluno_id, c.parametros->>'user_id', 'equipamento:' || coalesce(c.lote, c.id)::text, c.motivo);
    end if;
  end if;
end;
$function$;

revoke execute on function public.concluir_comando_gateway(uuid, uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.concluir_comando_gateway(uuid, uuid, boolean, jsonb, text) to service_role;
