-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- A aula avulsa do visitante (decidido em 10/11/2026): sistema simples. A recepção
-- lança a aula avulsa e libera a catraca à mão, sem cadastrar aluno: cria um acesso
-- simples, o visitante entra e sai, e fica só o registro do acesso. É o caminho do
-- check-in de parceiro (20261373010000), com o valor recebido no balcão, que vai ao
-- financeiro. Sem valor (aula experimental de cortesia), só o acesso.

-- ── 1. O resultado do acesso ───────────────────────────────────────────────
alter table public.acessos_catraca_logs drop constraint if exists acessos_catraca_logs_resultado_check;
alter table public.acessos_catraca_logs add constraint acessos_catraca_logs_resultado_check
  check (resultado = any (array[
    'liberado', 'negado_inadimplente', 'negado_pausado', 'negado_matricula_encerrada', 'negado_nao_encontrado',
    'negado_catraca_inativa', 'negado_sem_agendamento', 'negado_falha_verificacao_agendamento',
    'liberado_parceiro_externo', 'liberado_remoto', 'liberado_avulso'
  ])) not valid;
alter table public.acessos_catraca_logs validate constraint acessos_catraca_logs_resultado_check;

-- ── 2. Registrar o visitante avulso ────────────────────────────────────────
-- Confere quem pede (a gestão e a recepção, que cuidam do dinheiro e liberam a
-- catraca; ou a ArkeFit), com as duas etapas, e a catraca ativa. Grava o acesso
-- com o nome do visitante; com valor, lança a receita paga em "Aulas avulsas
-- (automático)". Se a catraca aceita ordem remota e o Gateway tem sinal, manda a
-- ordem de liberar, como no check-in de parceiro; senão, diz como liberar.
create or replace function public.registrar_visitante_avulso(
  _catraca_id uuid,
  _nome text,
  _aula text default null,
  _valor numeric default null,
  _forma text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_cat public.organizacao_catracas;
  v_tel public.gateway_telemetria;
  v_arkefit boolean;
  v_nome text := left(nullif(btrim(coalesce(_nome, '')), ''), 120);
  v_aula text := left(coalesce(nullif(btrim(coalesce(_aula, '')), ''), 'Aula avulsa'), 120);
  v_log uuid;
  v_cmd uuid;
  v_categoria uuid;
begin
  select * into v_cat from public.organizacao_catracas where id = _catraca_id;
  if v_cat.id is null then
    raise exception 'Catraca não encontrada.' using errcode = 'P0002';
  end if;
  v_arkefit := public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke');
  if not (v_arkefit or public.cuida_do_dinheiro(v_cat.organization_id)) then
    raise exception 'Só a recepção e a gestão da academia registram o visitante avulso.' using errcode = '42501';
  end if;
  if not public.sessao_cumpre_duas_etapas() then
    raise exception 'Entre de novo com o código do aplicativo autenticador: a sua conta usa a verificação em duas etapas.'
      using errcode = '42501';
  end if;
  if v_nome is null then
    raise exception 'Informe o nome do visitante.' using errcode = '22023';
  end if;
  if _valor is not null and (_valor < 0 or _valor > 10000) then
    raise exception 'Valor inválido.' using errcode = '22023';
  end if;
  if coalesce(_valor, 0) > 0 and coalesce(_forma, '') not in ('dinheiro', 'pix', 'cartao') then
    raise exception 'Escolha como o visitante pagou: dinheiro, PIX ou cartão.' using errcode = '22023';
  end if;
  if v_cat.status is distinct from 'ativo' then
    return jsonb_build_object('registrado', false, 'liberacao', 'nenhuma', 'motivo', 'Dispositivo inativo.');
  end if;

  insert into public.acessos_catraca_logs (organization_id, catraca_id, resultado, nome_visitante_externo, confirmado_por)
  values (v_cat.organization_id, v_cat.id, 'liberado_avulso', v_nome, v_uid)
  returning id into v_log;

  -- O dinheiro do balcão já entrou: vai ao financeiro, como a venda da loja.
  if coalesce(_valor, 0) > 0 then
    select id into v_categoria from public.plano_contas
     where organization_id = v_cat.organization_id and tipo = 'receita' and nome = 'Aulas avulsas (automático)';
    if v_categoria is null then
      insert into public.plano_contas (organization_id, tipo, nome)
        values (v_cat.organization_id, 'receita', 'Aulas avulsas (automático)')
        returning id into v_categoria;
    end if;
    insert into public.lancamentos_financeiros
      (organization_id, tipo, categoria_id, categoria, descricao, valor, data, status, data_pagamento,
       forma_pagamento, registrado_por, origem_automatica)
    values
      (v_cat.organization_id, 'receita', v_categoria, 'Aulas avulsas (automático)',
       v_aula || ' — ' || v_nome, round(_valor, 2), current_date, 'pago', current_date,
       case _forma when 'dinheiro' then 'Dinheiro' when 'pix' then 'PIX' else 'Cartão' end,
       v_uid, 'avulso:' || v_log::text)
    on conflict (organization_id, origem_automatica) where origem_automatica is not null do nothing;
  end if;

  select * into v_tel from public.gateway_telemetria where catraca_id = _catraca_id;
  if v_tel.catraca_id is null or not ('liberar_catraca' = any (v_tel.capacidades)) then
    return jsonb_build_object('registrado', true, 'log_id', v_log, 'liberacao', 'manual', 'comando_id', null,
      'motivo', 'Visitante registrado. Esta catraca não abre pelo ARKE: libere pelo botão da recepção ou no próprio equipamento.');
  end if;
  if v_tel.reportado_em < now() - interval '3 minutes' then
    return jsonb_build_object('registrado', true, 'log_id', v_log, 'liberacao', 'manual', 'comando_id', null,
      'motivo', 'Visitante registrado, mas o computador da catraca está sem sinal agora: libere pelo botão da recepção ou no próprio equipamento.');
  end if;

  insert into public.gateway_comandos (organization_id, catraca_id, tipo, parametros, motivo, solicitado_por, expira_em)
  values (v_cat.organization_id, v_cat.id, 'liberar_catraca',
          jsonb_build_object('sentido', 'entrada', 'equipamento', null, 'checkin', 'avulso'),
          'Visitante avulso', v_uid, now() + interval '2 minutes')
  returning id into v_cmd;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
  select v_uid, u.email, 'catraca.liberacao_remota', 'organizacao_catracas', v_cat.id, o.nome,
         jsonb_build_object('comando_id', v_cmd, 'motivo', 'Visitante avulso', 'sentido', 'entrada', 'catraca', v_cat.nome)
    from public.organizations o
    left join auth.users u on u.id = v_uid
   where o.id = v_cat.organization_id;

  return jsonb_build_object('registrado', true, 'log_id', v_log, 'liberacao', 'enviada', 'comando_id', v_cmd,
    'motivo', 'Visitante registrado. A catraca abre assim que o Gateway receber a ordem.');
end;
$function$;
revoke execute on function public.registrar_visitante_avulso(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.registrar_visitante_avulso(uuid, text, text, numeric, text) to authenticated;
