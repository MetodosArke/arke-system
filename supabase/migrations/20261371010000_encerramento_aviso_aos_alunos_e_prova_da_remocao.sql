-- Encerramento de academia: o aviso chega aos alunos, e a prova da remoção
-- das digitais sobrevive à eliminação (06/10/2026).
--
-- Auditoria de prontidão, achado médio, em duas partes:
--
-- 1. **O aviso não chegava aos alunos.** O e-mail do aviso ia à gestão e à
--    ArkeFit; o aluno — inclusive o do Método, de quem a ArkeFit é
--    controladora — só descobria no dia do término, com o app travado. Agora
--    cada aluno da academia (matrícula viva, ou Método ativo) recebe e-mail e
--    aviso no celular com o prazo e o que acontece com os dados dele. O envio
--    é reservado no banco antes de sair, em lotes de até 100: o lote que não
--    foi confirmado volta igual na rodada seguinte, com a mesma chave de
--    idempotência no Resend, e por isso não chega duas vezes. A reserva tem o
--    usuário e some com a organização na eliminação; o que fica é a contagem.
--
-- 2. **A remoção das digitais ficava sem prova.** No término, a remoção nasce
--    como ordem ao Gateway ou, na catraca sem gestão remota, como tarefa da
--    academia — que não tinha como fechá-la com o painel travado, e a
--    eliminação apagava ordens e tarefas em cascata. Agora o registro do
--    encerramento guarda, sem dado pessoal, o que foi agendado e o que foi
--    confirmado (ordens concluídas pelo Gateway e tarefas fechadas com
--    desfecho), conferido no término, a cada rodada e uma última vez antes
--    da eliminação. A tela travada da gestão passa a mostrar as tarefas de
--    remoção, para fechar com desfecho.

set lock_timeout = '5s';

-- ── O que o registro do encerramento passa a guardar ────────────────────────
alter table public.organizacao_encerramentos
  add column if not exists alunos_avisados integer not null default 0,
  add column if not exists alunos_avisados_push integer not null default 0,
  add column if not exists remocoes_alunos integer,
  add column if not exists remocoes_remotas_confirmadas integer,
  add column if not exists remocoes_manuais integer,
  add column if not exists remocoes_manuais_confirmadas integer,
  add column if not exists remocoes_conferidas_em timestamptz;

comment on column public.organizacao_encerramentos.alunos_avisados is
  'Alunos que receberam o e-mail do encerramento (com o prazo e o que acontece com os dados).';
comment on column public.organizacao_encerramentos.remocoes_alunos is
  'Alunos com número na catraca no término: de quem a digital, o rosto e o cartão tinham de sair.';
comment on column public.organizacao_encerramentos.remocoes_remotas_confirmadas is
  'Ordens de remoção que o Gateway confirmou (de remocoes_agendadas).';
comment on column public.organizacao_encerramentos.remocoes_manuais is
  'Tarefas de remoção à mão abertas para a academia (catraca sem gestão remota, ou ordem que falhou).';
comment on column public.organizacao_encerramentos.remocoes_manuais_confirmadas is
  'Tarefas de remoção fechadas com desfecho pela academia ou pela ArkeFit.';

-- ── Reserva do aviso a cada aluno ──────────────────────────────────────────
create table if not exists public.organizacao_encerramento_avisos (
  encerramento_id uuid not null references public.organizacao_encerramentos(id) on delete cascade,
  -- Some com a organização: a reserva diz quem foi avisado, e isso é dado
  -- pessoal. A contagem fica em organizacao_encerramentos.
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lote uuid not null,
  reservado_em timestamptz not null default now(),
  email_em timestamptz,
  push_em timestamptz,
  primary key (encerramento_id, user_id)
);
create index if not exists idx_encerramento_avisos_lote_aberto
  on public.organizacao_encerramento_avisos (encerramento_id, lote) where email_em is null;
create index if not exists idx_encerramento_avisos_org on public.organizacao_encerramento_avisos (organization_id);
create index if not exists idx_encerramento_avisos_user on public.organizacao_encerramento_avisos (user_id);

alter table public.organizacao_encerramento_avisos enable row level security;
-- Sem política: só a service_role, pelas funções abaixo.
revoke all on public.organizacao_encerramento_avisos from anon, authenticated;
grant all on public.organizacao_encerramento_avisos to service_role;

-- O lote a enviar: o que ficou sem confirmação numa rodada anterior volta
-- igual (mesma chave de idempotência); senão, um lote novo com quem ainda
-- não foi reservado. Quem recebe: aluno não anonimizado com matrícula viva
-- (ou que nunca teve matrícula), ou com o Método ativo.
create or replace function public.reservar_aviso_encerramento_alunos(_encerramento_id uuid, _limite integer default 100)
returns table (lote uuid, user_id uuid, email text, nome text, metodo boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
  v_lote uuid;
begin
  select e.id, e.organization_id into v_enc
    from public.organizacao_encerramentos e
   where e.id = _encerramento_id and e.etapa in ('aviso', 'encerrada') and e.organization_id is not null;
  if v_enc.id is null then
    return;
  end if;

  select a.lote into v_lote
    from public.organizacao_encerramento_avisos a
   where a.encerramento_id = _encerramento_id and a.email_em is null
   order by a.reservado_em
   limit 1;

  if v_lote is null then
    v_lote := gen_random_uuid();
    insert into public.organizacao_encerramento_avisos (encerramento_id, organization_id, user_id, lote)
    select _encerramento_id, v_enc.organization_id, x.user_id, v_lote
      from (
        select distinct al.user_id
          from public.alunos al
         where al.organization_id = v_enc.organization_id
           and al.anonimizado_em is null
           and (not public.matricula_encerrada(al.id) or al.metodo_arke_status = 'ativo')
           and not exists (select 1 from public.organizacao_encerramento_avisos r
                            where r.encerramento_id = _encerramento_id and r.user_id = al.user_id)
         order by al.user_id
         limit greatest(1, least(coalesce(_limite, 100), 100))
      ) x
    -- Duas rodadas ao mesmo tempo (o cron e o "executar agora"): a segunda
    -- não reserva de novo quem a primeira já pegou. Pelo nome da restrição,
    -- porque `user_id` aqui também é o nome de uma coluna da saída.
    on conflict on constraint organizacao_encerramento_avisos_pkey do nothing;
    if not found then
      return;
    end if;
  end if;

  return query
  select a.lote, a.user_id, u.email::text,
         coalesce(nullif(btrim(p.full_name), ''), 'aluno'),
         exists (select 1 from public.alunos m
                  where m.user_id = a.user_id and m.organization_id = v_enc.organization_id
                    and m.metodo_arke_status = 'ativo')
    from public.organizacao_encerramento_avisos a
    left join auth.users u on u.id = a.user_id and u.deleted_at is null
    left join public.profiles p on p.user_id = a.user_id
   where a.encerramento_id = _encerramento_id and a.lote = v_lote
   order by a.user_id;
end;
$$;

-- Confirma um canal de um lote e soma no registro do encerramento.
-- `email`: o lote inteiro saiu (quem não tinha endereço conta como tentado,
-- e não volta). `push`: só os usuários que receberam em algum aparelho.
create or replace function public.confirmar_aviso_encerramento_alunos(
  _encerramento_id uuid, _lote uuid, _canal text, _enviados integer default null, _user_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if _canal = 'email' then
    update public.organizacao_encerramento_avisos
       set email_em = now()
     where encerramento_id = _encerramento_id and lote = _lote and email_em is null;
    get diagnostics n = row_count;
    if n > 0 then
      update public.organizacao_encerramentos
         set alunos_avisados = alunos_avisados + least(n, greatest(coalesce(_enviados, n), 0))
       where id = _encerramento_id;
    end if;
  elsif _canal = 'push' then
    update public.organizacao_encerramento_avisos
       set push_em = now()
     where encerramento_id = _encerramento_id and lote = _lote and push_em is null
       and user_id = any (coalesce(_user_ids, '{}'));
    get diagnostics n = row_count;
    if n > 0 then
      update public.organizacao_encerramentos set alunos_avisados_push = alunos_avisados_push + n where id = _encerramento_id;
    end if;
  else
    raise exception 'Canal inválido: %', _canal using errcode = '22023';
  end if;
  return n;
end;
$$;

-- ── Prova da remoção ───────────────────────────────────────────────────────
-- Conta, sem dado pessoal, o que o término agendou para sair das catracas e
-- o que já foi confirmado. Tudo o que nasce depois do término numa academia
-- encerrada é deste encerramento: as ordens e as tarefas do término têm o
-- mesmo carimbo de `encerrada_em` (a mesma transação), e as tarefas de ordem
-- que falhou ou expirou nascem depois.
create or replace function public.conferir_remocoes_encerramento(_encerramento_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
begin
  select e.id, e.organization_id, e.encerrada_em into v_enc
    from public.organizacao_encerramentos e
   where e.id = _encerramento_id and e.etapa = 'encerrada' and e.organization_id is not null;
  if v_enc.id is null then
    return;
  end if;

  update public.organizacao_encerramentos e
     set remocoes_agendadas = c.agendadas,
         remocoes_remotas_confirmadas = c.confirmadas,
         remocoes_manuais = t.abertas,
         remocoes_manuais_confirmadas = t.confirmadas,
         remocoes_conferidas_em = now()
    from (
      select count(*)::integer as agendadas,
             (count(*) filter (where g.status = 'concluido'))::integer as confirmadas
        from public.gateway_comandos g
       where g.organization_id = v_enc.organization_id
         and g.tipo = 'apagar_usuario'
         and g.solicitado_em >= v_enc.encerrada_em
    ) c,
    (
      select count(*)::integer as abertas,
             (count(*) filter (where k.status = 'concluida'))::integer as confirmadas
        from public.tarefas k
       where k.organization_id = v_enc.organization_id
         and k.tipo = 'equipamento'
         and k.created_at >= v_enc.encerrada_em
    ) t
   where e.id = _encerramento_id;
end;
$$;

-- Todas as academias na janela de exportação, para a rodada de hora em hora.
create or replace function public.conferir_remocoes_encerramentos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.organizacao_encerramentos where etapa = 'encerrada' and organization_id is not null loop
    perform public.conferir_remocoes_encerramento(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Término: igual a 20261281010000, mais quantos alunos tinham número na
-- catraca e a primeira conferência da remoção.
create or replace function public.concluir_termino_organizacao(_encerramento_id uuid, _cobrancas_canceladas integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
  v_remocoes integer := 0;
  v_alunos integer := 0;
  r record;
begin
  select * into v_enc from public.organizacao_encerramentos where id = _encerramento_id and etapa = 'aviso';
  if v_enc.id is null then
    raise exception 'Encerramento não está em aviso.' using errcode = 'P0002';
  end if;

  update public.organizations set status = 'cancelado' where id = v_enc.organization_id;
  update public.organizacao_fiscal set emissao_ativa = false where organization_id = v_enc.organization_id;

  -- Matrícula que terminou leva a digital junto (Política §7): uma remoção
  -- por aluno com número na catraca, pelo mesmo caminho da revogação.
  for r in
    select a.id, a.identificador_catraca,
           exists (select 1 from public.aluno_consentimento_biometrico c
                    where c.aluno_id = a.id and c.revogado_em is null) as biometria
      from public.alunos a
     where a.organization_id = v_enc.organization_id
       and a.identificador_catraca is not null
  loop
    v_alunos := v_alunos + 1;
    v_remocoes := v_remocoes + public.agendar_remocao_equipamento(
      v_enc.organization_id, r.id, r.identificador_catraca, r.biometria, 'Encerramento da academia');
  end loop;

  update public.organizacao_encerramentos
     set etapa = 'encerrada', encerrada_em = now(), cobrancas_canceladas = _cobrancas_canceladas,
         remocoes_agendadas = v_remocoes, remocoes_alunos = v_alunos, erro = null
   where id = _encerramento_id;

  perform public.conferir_remocoes_encerramento(_encerramento_id);

  insert into public.auditoria_acoes_sensiveis (acao, entidade, entidade_id, organizacao_nome, detalhes)
  values ('organizacao.encerrada', 'organizacao_encerramentos', _encerramento_id, v_enc.organizacao_nome,
          jsonb_build_object('cobrancas_canceladas', _cobrancas_canceladas, 'remocoes_agendadas', v_remocoes,
                             'alunos_com_numero_na_catraca', v_alunos, 'eliminacao_em', v_enc.eliminacao_em));
  return v_remocoes;
end;
$$;

-- Eliminação, última parte: igual a 20261281010000, mais a última
-- conferência da remoção antes de a cascata levar ordens e tarefas — o
-- registro do encerramento e a Auditoria guardam o placar final.
create or replace function public.eliminar_organizacao(_encerramento_id uuid, _arquivos integer, _contas integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
begin
  select * into v_enc from public.organizacao_encerramentos where id = _encerramento_id and etapa = 'encerrada';
  if v_enc.id is null then
    raise exception 'Encerramento não está encerrado.' using errcode = 'P0002';
  end if;

  perform public.conferir_remocoes_encerramento(_encerramento_id);
  select * into v_enc from public.organizacao_encerramentos where id = _encerramento_id;

  delete from vault.secrets where name = 'asaas_subconta:' || v_enc.organization_id::text;
  delete from public.organizations where id = v_enc.organization_id;

  update public.organizacao_encerramentos
     set etapa = 'eliminada', eliminada_em = now(), arquivos_apagados = _arquivos, contas_apagadas = _contas, erro = null
   where id = _encerramento_id;

  insert into public.auditoria_acoes_sensiveis (acao, entidade, entidade_id, organizacao_nome, detalhes)
  values ('organizacao.eliminada', 'organizacao_encerramentos', _encerramento_id, v_enc.organizacao_nome,
          jsonb_build_object('arquivos_apagados', _arquivos, 'contas_apagadas', _contas,
                             'registros_fiscais', v_enc.registros_fiscais,
                             'alunos_avisados', v_enc.alunos_avisados,
                             'remocoes', jsonb_build_object(
                               'alunos', v_enc.remocoes_alunos,
                               'ordens_agendadas', v_enc.remocoes_agendadas,
                               'ordens_confirmadas', v_enc.remocoes_remotas_confirmadas,
                               'tarefas_abertas', v_enc.remocoes_manuais,
                               'tarefas_confirmadas', v_enc.remocoes_manuais_confirmadas)));
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.reservar_aviso_encerramento_alunos(uuid, integer)',
    'public.confirmar_aviso_encerramento_alunos(uuid, uuid, text, integer, uuid[])',
    'public.conferir_remocoes_encerramento(uuid)',
    'public.conferir_remocoes_encerramentos()',
    'public.concluir_termino_organizacao(uuid, integer)',
    'public.eliminar_organizacao(uuid, integer, integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
