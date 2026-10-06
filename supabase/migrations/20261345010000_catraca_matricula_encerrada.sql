-- O fim da matrícula apaga a digital e barra na catraca (06/10/2026).
--
-- A Política promete: "quando a matrícula termina, a digital e o rosto são
-- apagados dos equipamentos da Academia e o número que os identifica sai da
-- plataforma". Até aqui, a remoção dos equipamentos nascia só da retirada da
-- autorização, da exclusão, da anonimização, da troca do número e do término
-- da academia. Cancelar a matrícula não fazia nada disso, e a catraca olhava
-- só a situação (`situacao_academia`): o ex-aluno em dia continuava entrando,
-- com a digital no equipamento e no cadastro guardado no computador da
-- recepção.
--
-- Agora:
--   1. quando a última matrícula viva (ativa ou pausada) do aluno vira
--      `cancelada`, a remoção dos equipamentos da academia é agendada, o
--      número sai do aluno e as ordens de cadastro em aberto expiram;
--   2. a catraca barra quem teve matrícula e não tem mais nenhuma viva
--      (`negado_matricula_encerrada`), e esse aluno sai do cadastro do Gateway.
--
-- Quem nunca teve matrícula não é barrado por isso: há alunos sem linha de
-- matrícula (academia que cobra por fora do ARKE), e para eles nada muda. O
-- pausado continua saindo na hora pela situação (`situacao_permite_app()`),
-- regra que esta migration não toca.
--
-- Não é retroativo: quem já tinha a matrícula cancelada antes desta migration
-- passa a ser barrado na catraca, mas a remoção só nasce de um cancelamento
-- daqui em diante (ver docs/registro/catracas.md).
--
-- Ordem: publicar `catraca-validar-acesso` antes desta migration. A versão
-- anterior da função só reconhece pausado e inadimplente, e responderia
-- "liberado" a quem volta `negado_matricula_encerrada`.

set lock_timeout = '5s';

-- ── A pergunta, num lugar só ────────────────────────────────────────────────

-- Teve matrícula na academia e não tem mais nenhuma viva. Uma linha de
-- `alunos` é uma academia só, então "naquela academia" é o próprio aluno.
create or replace function public.matricula_encerrada(_aluno_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.aluno_matriculas_academia m where m.aluno_id = _aluno_id)
     and not exists (
       select 1 from public.aluno_matriculas_academia m
        where m.aluno_id = _aluno_id and m.status in ('ativa', 'pausada')
     );
$$;

comment on function public.matricula_encerrada(uuid) is
  'Teve matricula e nao tem mais nenhuma ativa ou pausada. Quem nunca teve matricula nao conta como encerrada.';

-- Só as funções da catraca (security definer, do dono) a chamam.
revoke all on function public.matricula_encerrada(uuid) from public, anon, authenticated;
grant execute on function public.matricula_encerrada(uuid) to service_role;

-- ── A catraca barra ─────────────────────────────────────────────────────────

alter table public.acessos_catraca_logs drop constraint if exists acessos_catraca_logs_resultado_check;
alter table public.acessos_catraca_logs add constraint acessos_catraca_logs_resultado_check
  check (resultado = any (array[
    'liberado', 'negado_inadimplente', 'negado_pausado', 'negado_matricula_encerrada', 'negado_nao_encontrado',
    'negado_catraca_inativa', 'negado_sem_agendamento', 'negado_falha_verificacao_agendamento',
    'liberado_parceiro_externo', 'liberado_remoto'
  ])) not valid;
alter table public.acessos_catraca_logs validate constraint acessos_catraca_logs_resultado_check;

-- A matrícula encerrada vem antes da situação: para quem saiu da academia,
-- "inadimplente" (a última mensalidade vencida) diria à recepção a coisa
-- errada.
create or replace function public.aluno_barrado_na_catraca(_aluno_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
           when public.matricula_encerrada(a.id) then 'negado_matricula_encerrada'
           when public.situacao_permite_app(a.situacao_academia, a.situacao_academia_em) then null
           when a.situacao_academia = 'pausado' then 'negado_pausado'
           else 'negado_inadimplente'
         end
    from public.alunos a
   where a.id = _aluno_id;
$$;

revoke execute on function public.aluno_barrado_na_catraca(uuid) from public, anon, authenticated;
grant execute on function public.aluno_barrado_na_catraca(uuid) to service_role;

-- ── O cadastro do Gateway só com os alunos atuais ──────────────────────────
--
-- Quem teve a matrícula encerrada sai da lista (e, na diferença, volta com
-- `remover`). O cadastro guarda CPF no computador da recepção: ex-aluno não
-- tem por que estar lá. O nome deixa de ir: o display não o mostra, e o
-- Gateway 1.9 não o guarda. A coluna continua, vazia, porque os Gateways
-- instalados a esperam.
create or replace function public.alunos_catraca(_organization_id uuid, _desde timestamptz default null)
returns table(
  aluno_id uuid,
  cpf text,
  identificador_catraca text,
  nome text,
  inadimplente boolean,
  remover boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id,
         coalesce(regexp_replace(p.cpf, '\D', '', 'g'), ''),
         a.identificador_catraca,
         ''::text,
         -- "inadimplente" é o nome do contrato com os gateways instalados; o
         -- sentido é "não entra" (pausado ou inadimplente fora da tolerância).
         not public.situacao_permite_app(a.situacao_academia, a.situacao_academia_em),
         not (public.aluno_elegivel_catraca(p.cpf, a.identificador_catraca, a.anonimizado_em)
              and not public.matricula_encerrada(a.id))
    from public.alunos a
    left join public.profiles p on p.user_id = a.user_id
   where a.organization_id = _organization_id
     and (
       -- Lista inteira: só os elegíveis.
       (_desde is null
        and public.aluno_elegivel_catraca(p.cpf, a.identificador_catraca, a.anonimizado_em)
        and not public.matricula_encerrada(a.id))
       or
       -- Diferença: mudou algo (no aluno, no perfil ou na matrícula), ou o
       -- veredito mudou pela passagem do tempo.
       (_desde is not null and (
          a.updated_at >= _desde
          or p.updated_at >= _desde
          or exists (select 1 from public.aluno_matriculas_academia m
                      where m.aluno_id = a.id and m.updated_at >= _desde)
          or public.situacao_permite_app_em(a.situacao_academia, a.situacao_academia_em, _desde)
             is distinct from public.situacao_permite_app_em(a.situacao_academia, a.situacao_academia_em, now())
       ))
     );
$$;

-- O hash do conjunto segue a mesma definição de elegível: se divergissem, o
-- hash nunca bateria e o Gateway pediria a lista inteira a cada rodada.
create or replace function public.alunos_catraca_hash(_organization_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select md5(coalesce(string_agg(a.id::text, ',' order by a.id), ''))
    from public.alunos a
    left join public.profiles p on p.user_id = a.user_id
   where a.organization_id = _organization_id
     and public.aluno_elegivel_catraca(p.cpf, a.identificador_catraca, a.anonimizado_em)
     and not public.matricula_encerrada(a.id);
$$;

revoke execute on function public.alunos_catraca(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.alunos_catraca_hash(uuid) from public, anon, authenticated;
grant execute on function public.alunos_catraca(uuid, timestamptz) to service_role;
grant execute on function public.alunos_catraca_hash(uuid) to service_role;

-- ── O equipamento esquece ───────────────────────────────────────────────────
--
-- A última matrícula viva virou `cancelada`: agenda a remoção em todo Gateway
-- da academia (ou a tarefa, onde não há gestão remota), tira o número do
-- aluno e expira as ordens de cadastro ainda abertas — sem isto, um cadastro
-- entregue antes do cancelamento devolveria o número ao aluno, e a foto do
-- rosto enviada pelo app seguiria para os leitores.
--
-- Trocar de plano é cancelar a matrícula e criar outra (academia-criar-
-- matricula recusa a segunda com a primeira viva). Nesse intervalo o aluno
-- fica sem matrícula, e a digital sai: com a matrícula nova, a recepção
-- cadastra de novo. A tela de cancelamento avisa.
create or replace function public.remover_do_equipamento_ao_encerrar_matricula()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aluno public.alunos;
begin
  if exists (
    select 1 from public.aluno_matriculas_academia m
     where m.aluno_id = new.aluno_id and m.status in ('ativa', 'pausada')
  ) then
    return null;
  end if;

  select * into v_aluno from public.alunos where id = new.aluno_id;
  if v_aluno.id is null then
    return null;
  end if;

  update public.gateway_comandos c
     set status = 'expirado', concluido_em = now(), erro = 'Matrícula encerrada antes da conclusão.'
   where c.aluno_id = v_aluno.id
     and c.status in ('pendente', 'entregue')
     and c.tipo in ('cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao', 'cadastrar_rosto', 'enviar_foto_rosto');
  delete from public.fotos_rosto_pendentes f where f.aluno_id = v_aluno.id;

  if v_aluno.identificador_catraca is not null then
    perform public.agendar_remocao_equipamento(
      v_aluno.organization_id, v_aluno.id, v_aluno.identificador_catraca,
      exists (select 1 from public.aluno_consentimento_biometrico c where c.aluno_id = v_aluno.id),
      'matrícula encerrada');
    update public.alunos set identificador_catraca = null where id = v_aluno.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_remover_do_equipamento_ao_encerrar_matricula on public.aluno_matriculas_academia;
create trigger trg_remover_do_equipamento_ao_encerrar_matricula
  after update of status on public.aluno_matriculas_academia
  for each row
  when (new.status = 'cancelada' and old.status is distinct from 'cancelada')
  execute function public.remover_do_equipamento_ao_encerrar_matricula();

-- Função de gatilho nasce com EXECUTE para o PUBLIC.
revoke execute on function public.remover_do_equipamento_ao_encerrar_matricula() from public, anon, authenticated;
