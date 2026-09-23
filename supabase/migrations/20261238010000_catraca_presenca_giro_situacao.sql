-- Catraca: presença, confirmação de giro e a mesma regra de acesso do app
-- (23/09/2026).
--
-- A investigação do emulador da Control iD encontrou três defeitos, e eles
-- não são independentes — corrigir um sem os outros criaria um quarto.
--
-- **1. Quem entra pela catraca não contava como presença.** O acesso ia para
-- `acessos_catraca_logs`, que só alimenta telas. Os sensores do Ecossistema
-- (`aluno_dias_inativo`, `aluno_constancia`, `aluno_ativo_em`) leem apenas
-- `presencas`, que só recebia o check-in por QR. Numa academia com catraca, o
-- aluno que vem todo dia e não abre o app aparecia inativo na retenção do
-- relatório do gestor, com constância baixa (travando o avanço de fase) e
-- podia gerar chamado falso de "risco de evasão" para o Mentor.
--
-- **2. "Liberado" não é "entrou".** A iDBlock confirma o giro pelo Monitor
-- (`catra_event`: TURN LEFT, TURN RIGHT ou GIVE UP), e o Gateway não o
-- ouvia. Enquanto o registro só alimentava telas, isso quase não importava;
-- ligando a catraca à presença (item 1), cada desistência viraria presença.
-- Por isso a presença nasce do **giro**, e não da decisão, quando o
-- equipamento sabe confirmar.
--
-- **3. A catraca barrava por uma regra diferente da do app.** Ela só olhava
-- mensalidade com status `atrasado`: bloqueava na hora, sem a tolerância de
-- 5 dias decidida para o aluno inadimplente, e deixava passar o aluno
-- **pausado**. O app e o check-in por QR usam `situacao_permite_app()`. Duas
-- regras para a mesma pergunta é como elas começam a divergir, e aqui já
-- tinham divergido.

-- ── Giro ────────────────────────────────────────────────────────────────
--
-- null            → equipamento/versão de gateway que não informa giro: o
--                   "liberado" é o melhor sinal disponível e conta presença.
-- pendente        → aguardando o catra_event; ainda não conta.
-- confirmado      → girou; conta.
-- desistencia     → foi liberado e não passou; NÃO conta.
-- sem_confirmacao → esperava o catra_event e ele não veio no prazo. Conta:
--                   desistência chega como evento próprio, então a ausência
--                   de evento é problema de Monitor, não do aluno — e
--                   perder a presença de quem entrou geraria justamente a
--                   inércia falsa que esta migration existe para evitar.
alter table public.acessos_catraca_logs add column if not exists giro text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'acessos_catraca_logs_giro_check') then
    alter table public.acessos_catraca_logs add constraint acessos_catraca_logs_giro_check
      check (giro is null or giro in ('pendente', 'confirmado', 'desistencia', 'sem_confirmacao'));
  end if;
end $$;

comment on column public.acessos_catraca_logs.giro is
  'Confirmacao fisica do giro. null = equipamento nao informa (conta presenca); pendente = aguardando catra_event; desistencia NAO conta presenca.';

alter table public.acessos_catraca_logs drop constraint if exists acessos_catraca_logs_resultado_check;
alter table public.acessos_catraca_logs add constraint acessos_catraca_logs_resultado_check
  check (resultado in (
    'liberado', 'negado_inadimplente', 'negado_pausado', 'negado_nao_encontrado',
    'negado_catraca_inativa', 'negado_sem_agendamento', 'negado_falha_verificacao_agendamento',
    'liberado_parceiro_externo'));

alter table public.presencas drop constraint if exists presencas_origem_check;
alter table public.presencas add constraint presencas_origem_check
  check (origem in ('qr', 'manual', 'catraca'));

-- ── Presença a partir da catraca ─────────────────────────────────────────
--
-- Gatilho, e não uma escrita em cada edge function: o registro da catraca
-- chega por três caminhos (validação online, confirmação de giro e
-- sincronização da contingência offline), e o que conta como presença
-- precisa ser a mesma regra nos três.
--
-- O dia é o do **acesso** (`created_at` no fuso de Brasília), não o da
-- gravação: um registro da contingência offline sincronizado amanhã é
-- presença de hoje.
create or replace function public.presenca_pela_catraca()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.resultado = 'liberado'
     and new.aluno_id is not null
     and (new.giro is null or new.giro in ('confirmado', 'sem_confirmacao')) then
    insert into public.presencas (organization_id, aluno_id, dia, registrada_em, origem)
    values (new.organization_id, new.aluno_id,
            (new.created_at at time zone 'America/Sao_Paulo')::date, new.created_at, 'catraca')
    on conflict (aluno_id, dia) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_presenca_pela_catraca on public.acessos_catraca_logs;
create trigger trg_presenca_pela_catraca
  after insert or update of giro on public.acessos_catraca_logs
  for each row execute function public.presenca_pela_catraca();

revoke execute on function public.presenca_pela_catraca() from public;

-- Histórico: os acessos liberados que já existem viram presença, pela mesma
-- regra. Idempotente pela chave (aluno, dia).
insert into public.presencas (organization_id, aluno_id, dia, registrada_em, origem)
select l.organization_id, l.aluno_id,
       (l.created_at at time zone 'America/Sao_Paulo')::date, min(l.created_at), 'catraca'
  from public.acessos_catraca_logs l
 where l.resultado = 'liberado' and l.aluno_id is not null
   and (l.giro is null or l.giro in ('confirmado', 'sem_confirmacao'))
 group by 1, 2, 3
on conflict (aluno_id, dia) do nothing;

-- ── Uma regra de acesso só ───────────────────────────────────────────────
--
-- Devolve o resultado de negação, ou null quando o aluno pode entrar. A
-- regra é `situacao_permite_app()`, a mesma do app e do check-in por QR: em
-- dia entra; inadimplente entra até 5 dias depois da marcação; pausado não
-- entra. A mensalidade vencida chega aqui por `sincronizar_situacao_por_
-- mensalidade()`, que marca a situação — então não há um segundo caminho
-- olhando a mensalidade direto.
create or replace function public.aluno_barrado_na_catraca(_aluno_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
           when public.situacao_permite_app(a.situacao_academia, a.situacao_academia_em) then null
           when a.situacao_academia = 'pausado' then 'negado_pausado'
           else 'negado_inadimplente'
         end
    from public.alunos a
   where a.id = _aluno_id;
$$;

-- A mesma pergunta em lote, para o cache da contingência offline.
create or replace function public.alunos_barrados_na_catraca(_organization_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id
    from public.alunos a
   where a.organization_id = _organization_id
     and not public.situacao_permite_app(a.situacao_academia, a.situacao_academia_em);
$$;

revoke execute on function public.aluno_barrado_na_catraca(uuid) from public;
revoke execute on function public.alunos_barrados_na_catraca(uuid) from public;
grant execute on function public.aluno_barrado_na_catraca(uuid) to service_role;
grant execute on function public.alunos_barrados_na_catraca(uuid) to service_role;
