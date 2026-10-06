-- Vínculo manual do número da catraca e remoção que nasce sempre (06/10/2026).
--
-- Dois buracos no ciclo da biometria, os dois no equipamento sem gestão
-- remota (Topdata Inner, Control iD sem credencial no config):
--
-- 1. **A digital cadastrada direto no equipamento escapava da autorização.**
--    A recepção cadastrava a digital no próprio equipamento e vinculava o
--    número na ficha, e o vínculo não conferia nada: a gravação ia direto em
--    `alunos.identificador_catraca`. Agora o vínculo manual passa por
--    `vincular_numero_catraca()`, que pede o que o número identifica. Digital
--    ou rosto exigem a autorização do aluno registrada (pelo app ou pelo termo
--    impresso anexado); sem ela, recusa com a explicação. Cartão não é dado
--    biométrico e segue sem depender disso. A gravação direta do número pela
--    API passa a ser recusada (`trg_numero_catraca_so_pela_ficha`), senão a
--    conferência seria só da tela.
--
-- 2. **A tarefa de apagar do equipamento podia não nascer.** Sem gestão
--    remota, a tarefa só nascia se houvesse consentimento biométrico
--    registrado — justamente o que faltava no caso 1 — e a academia sem
--    catraca cadastrada não gerava nem a tarefa, enquanto a tela dizia
--    "abrimos uma tarefa". Agora, saindo um número de aluno, a tarefa nasce
--    sempre que alguma catraca da academia não apaga sozinha, ou quando a
--    academia não tem catraca cadastrada (o número pode estar num equipamento
--    que o ARKE não conhece). Ela fecha com desfecho, como todas.

set lock_timeout = '5s';

-- ── Remoção ─────────────────────────────────────────────────────────────────

-- `_tinha_biometria` fica na assinatura (quatro chamadores a passam) e não
-- decide mais nada: sem gestão remota, o ARKE não sabe o que foi cadastrado
-- no equipamento.
create or replace function public.agendar_remocao_equipamento(
  _org uuid, _aluno_id uuid, _identificador text, _tinha_biometria boolean, _motivo text
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Alguma catraca não apaga sozinha, ou a academia não tem catraca
  -- cadastrada: a tarefa nasce sempre. Antes dependia de haver consentimento
  -- registrado, e a digital cadastrada direto no equipamento ficava lá.
  if v_sem > 0 or v_com = 0 then
    perform public.abrir_tarefa_remocao_equipamento(
      _org, _aluno_id, _identificador, 'equipamento-manual:' || v_lote::text, _motivo);
  end if;

  return v_com;
end;
$function$;

revoke execute on function public.agendar_remocao_equipamento(uuid, uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.agendar_remocao_equipamento(uuid, uuid, text, boolean, text) to service_role;

-- O texto da tarefa cobre o equipamento em que o aluno pode não ter nada
-- cadastrado (cartão no modo online fica só no ARKE): conferir e registrar.
create or replace function public.abrir_tarefa_remocao_equipamento(
  _org uuid, _aluno_id uuid, _identificador text, _origem text, _motivo text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if _identificador is null or btrim(_identificador) = '' then
    return;
  end if;
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo, dono, acao)
  values (
    _org,
    -- A tarefa some junto com o aluno excluído (cascade); por isso aluno
    -- excluído não é referenciado — o número do equipamento basta.
    case when exists (select 1 from public.alunos where id = _aluno_id) then _aluno_id end,
    'Apagar do equipamento da catraca o usuário ' || _identificador
      || coalesce(' — ' || nullif(_motivo, ''), ''),
    'alta',
    now() + interval '3 days',
    _origem,
    'equipamento',
    'academia',
    'Em cada catraca sem gestão remota pelo Gateway, procurar o usuário ' || _identificador
      || ' e excluí-lo com as digitais, o rosto e os cartões dele; se ele não estiver no equipamento, registrar isso no desfecho.'
      || ' A LGPD exige apagar o dado biométrico quando a autorização acaba ou o aluno sai.'
  )
  on conflict (organization_id, origem_evento) do nothing;
end;
$$;

revoke execute on function public.abrir_tarefa_remocao_equipamento(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.abrir_tarefa_remocao_equipamento(uuid, uuid, text, text, text) to service_role;

-- ── Vínculo manual ──────────────────────────────────────────────────────────

-- O caminho da ficha para o número do aluno no equipamento, quando o Gateway
-- não cadastra (ou não cadastra cartão). `_credencial` é o que o número
-- identifica: 'cartao' ou 'biometria' (digital ou rosto). Devolve o número
-- gravado.
create or replace function public.vincular_numero_catraca(_aluno_id uuid, _numero text, _credencial text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_aluno public.alunos;
  v_numero text := btrim(coalesce(_numero, ''));
begin
  select * into v_aluno from public.alunos where id = _aluno_id;
  if v_aluno.id is null then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;
  if not (public.has_org_role(v_uid, v_aluno.organization_id, 'gestor')
          or public.has_org_role(v_uid, v_aluno.organization_id, 'recepcao')
          or public.has_role(v_uid, 'superadmin')
          or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'Só a gestão ou a recepção da academia (ou a ArkeFit) vinculam o número da catraca.' using errcode = '42501';
  end if;
  if v_aluno.anonimizado_em is not null then
    raise exception 'Aluno anonimizado não recebe número de catraca.';
  end if;
  if _credencial is null or _credencial not in ('cartao', 'biometria') then
    raise exception 'Diga o que o número identifica: o cartão, ou a digital ou o rosto cadastrados no equipamento.';
  end if;
  if v_numero = '' then
    raise exception 'Informe o número do aluno no equipamento.';
  end if;
  if length(v_numero) > 32 or v_numero !~ '^[0-9A-Za-z]+$' then
    raise exception 'O número do equipamento tem só letras e algarismos, até 32.';
  end if;
  if _credencial = 'biometria' and not public.aluno_consentiu_biometria(_aluno_id) then
    raise exception 'O aluno ainda não autorizou o uso da digital e do rosto. Ele autoriza no app (Perfil → Privacidade) ou assinando o termo impresso, que a recepção anexa na ficha. A LGPD exige a autorização dele antes de vincular a digital ou o rosto cadastrados no equipamento.'
      using errcode = '42501';
  end if;
  -- Ex-aluno: o número não teria quem o tirasse do equipamento depois, porque
  -- a remoção nasce do cancelamento da matrícula, que já aconteceu.
  if public.matricula_encerrada(_aluno_id) then
    raise exception 'A matrícula deste aluno está encerrada. Vincule o número depois da matrícula nova.';
  end if;
  if exists (
    select 1 from public.alunos a
     where a.organization_id = v_aluno.organization_id and a.identificador_catraca = v_numero and a.id <> _aluno_id
  ) then
    raise exception 'O número % já pertence a outro aluno desta academia.', v_numero;
  end if;

  update public.alunos set identificador_catraca = v_numero where id = _aluno_id;
  return v_numero;
end;
$$;

revoke all on function public.vincular_numero_catraca(uuid, text, text) from public, anon;
grant execute on function public.vincular_numero_catraca(uuid, text, text) to authenticated, service_role;

-- O número não muda pela API: só pelas funções do banco (o vínculo da ficha,
-- o cadastro pelo Gateway, a retirada da autorização, a anonimização e o fim
-- da matrícula), que rodam como dono. Sem esta trava a conferência acima
-- seria só da tela. `current_user` aqui é o papel de quem fez a gravação,
-- porque a função de gatilho não é security definer.
create or replace function public.numero_catraca_so_pela_ficha()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.identificador_catraca is distinct from (case when tg_op = 'UPDATE' then old.identificador_catraca end) then
    raise exception 'O número da catraca muda pela ficha do aluno (Acesso pela catraca), que confere a autorização da digital.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_numero_catraca_so_pela_ficha on public.alunos;
create trigger trg_numero_catraca_so_pela_ficha
  before insert or update of identificador_catraca on public.alunos
  for each row execute function public.numero_catraca_so_pela_ficha();

-- Função de gatilho nasce com EXECUTE para o PUBLIC.
revoke execute on function public.numero_catraca_so_pela_ficha() from public, anon, authenticated;
