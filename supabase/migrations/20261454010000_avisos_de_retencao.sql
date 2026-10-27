-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- Os avisos automáticos de retenção ao aluno (26/10/2026).
--
-- Decisão do responsável: os casos da fila (ativação, faltas, atestado) só
-- avisavam a equipe, e o aluno não recebia nada até alguém falar com ele. Agora
-- a rotina `arke-aviso-retencao` (edge function `aviso-retencao-aluno`) avisa o
-- aluno sozinha, uma vez por dia, entre 8h e 20h de Brasília:
--
--   * matriculado há 48 h sem o primeiro acesso: o convite de novo, por e-mail;
--   * 3 dias sem treinar: o 1º aviso, construtivo, no celular (ou por e-mail,
--     sem aviso no celular ligado);
--   * 5 dias sem treinar: o 2º aviso, no celular e por e-mail;
--   * atestado vencendo em até 15 dias: o pedido do atestado novo, no celular
--     (texto genérico na tela bloqueada) e por e-mail.
--
-- Quem recebe o quê mora na função (regras.ts, com o teste ao lado); aqui
-- ficam quem pode receber, a reserva de cada aviso, a marca na tarefa e a
-- tarefa de faltas que fecha quando o aluno volta a treinar. O padrão é o da
-- recuperação da mensalidade (20261447010000).
--
--   1. a preferência do aluno: desligar os lembretes de treino no Perfil;
--   2. a marca na tarefa: o aviso automático saiu, e só a rotina grava;
--   3. a tabela dos avisos enviados: a reserva e a idempotência por aluno,
--      tipo e período; o servidor grava e a academia lê;
--   4. quem pode receber hoje;
--   5. a reserva de um aviso (e a marca nas tarefas abertas do caso);
--   6. a tarefa de faltas fecha quando o aluno volta a treinar depois do aviso;
--   7. a rotina.
--
-- Ordem: esta migration antes de publicar a função `aviso-retencao-aluno` e o
-- app (a tela do Perfil lê `profiles.lembretes_de_treino`, e a fila lê
-- `tarefas.aviso_automatico_em`).

-- ── 1. A preferência do aluno ──────────────────────────────────────────────
--
-- Em `profiles`, e não em `alunos`: é da pessoa, vale para todas as academias
-- dela, e a regra de alteração de `profiles` já é da própria pessoa. Desliga
-- só os dois lembretes de treino. O convite e o atestado são do serviço
-- (acesso e documento da matrícula), e não desligam.
alter table public.profiles
  add column if not exists lembretes_de_treino boolean not null default true;

comment on column public.profiles.lembretes_de_treino is
  'Desligado, a pessoa não recebe os lembretes automáticos de 3 e 5 dias sem treinar (aviso-retencao-aluno). O convite e o atestado seguem.';

-- ── 2. A marca na tarefa ───────────────────────────────────────────────────
alter table public.tarefas
  add column if not exists aviso_automatico_em timestamptz;

comment on column public.tarefas.aviso_automatico_em is
  'Quando o aviso automático ao aluno saiu para este caso (aviso-retencao-aluno). Só a rotina grava; a equipe vê na fila.';

-- A regra de alteração de `tarefas` é da equipe. Sem esta trava, quem tem
-- sessão gravaria a marca pela API: diria que o aluno foi avisado sem ter sido,
-- ou apagaria a marca. Só a service role, sem sessão, grava (o critério de
-- `aviso_de_cobranca_so_da_rotina`, 20261447010000).
create or replace function public.aviso_automatico_so_da_rotina()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.aviso_automatico_em is not null then
      raise exception 'Só a rotina do aviso automático grava quando o aviso saiu.' using errcode = '42501';
    end if;
  elsif new.aviso_automatico_em is distinct from old.aviso_automatico_em then
    raise exception 'Só a rotina do aviso automático grava quando o aviso saiu.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aviso_automatico_so_da_rotina on public.tarefas;
create trigger trg_aviso_automatico_so_da_rotina
  before insert or update of aviso_automatico_em on public.tarefas
  for each row execute function public.aviso_automatico_so_da_rotina();

revoke execute on function public.aviso_automatico_so_da_rotina() from public, anon, authenticated;

-- ── 3. Os avisos enviados ──────────────────────────────────────────────────
--
-- Uma linha por aviso reservado, e a linha é a reserva: o aviso só sai depois
-- de a linha entrar, e a mesma linha não entra duas vezes (aluno, tipo e
-- período). O período (`referencia`) é:
--   * convite: o dia da matrícula (um reenvio por matrícula);
--   * inatividade: o dia do último treino (ou do primeiro acesso), que muda
--     quando o aluno volta a treinar, e com ele a sequência recomeça;
--   * atestado: a validade do atestado (um pedido por atestado).
-- Uma tabela, e não colunas em `alunos`: a sequência se repete a cada período
-- parado, e a academia lê o histórico de quem foi avisado.
create table if not exists public.avisos_ao_aluno (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  tipo text not null check (tipo in ('convite', 'inatividade_1', 'inatividade_2', 'atestado')),
  referencia date not null,
  canais text[] not null check (cardinality(canais) > 0 and canais <@ array['push', 'email']),
  enviado_em timestamptz not null default now(),
  unique (aluno_id, tipo, referencia)
);

comment on table public.avisos_ao_aluno is
  'Avisos automáticos de retenção ao aluno (aviso-retencao-aluno): a reserva antes do envio e o histórico. Só o servidor grava; a equipe da academia lê.';

create index if not exists idx_avisos_ao_aluno_org on public.avisos_ao_aluno (organization_id, enviado_em);

alter table public.avisos_ao_aluno enable row level security;

-- Uma regra só, a de leitura, da equipe da academia. Sem inclusão, alteração
-- e exclusão pela API: grava a rotina, pela função do bloco 5.
create policy "leitura" on public.avisos_ao_aluno for select to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id));

revoke insert, update, delete, truncate on public.avisos_ao_aluno from anon, authenticated;
revoke select on public.avisos_ao_aluno from anon;

-- Dado de pessoa: as duas etapas da gestão valem aqui também (20261363010000).
drop policy if exists "duas etapas" on public.avisos_ao_aluno;
create policy "duas etapas" on public.avisos_ao_aluno as restrictive for all to authenticated
  using ((select public.sessao_cumpre_duas_etapas()))
  with check ((select public.sessao_cumpre_duas_etapas()));

-- ── 4. Quem pode receber hoje ──────────────────────────────────────────────
--
-- O aluno de verdade, com a matrícula ativa e o app liberado:
--   * não anonimizado, com o vínculo ativo na academia, numa academia viva;
--   * em dia: o pausado sai, e o inadimplente (mesmo dentro dos 5 dias de
--     tolerância) recebe só o aviso de cobrança, que já existe;
--   * com a matrícula ativa, ou sem matrícula nenhuma (academia que cobra por
--     fora do ARKE): a matrícula pausada ou cancelada sai.
-- E só quem pode precisar de um aviso hoje, para a rotina não ler a base
-- inteira: o convite (sem o primeiro acesso, matriculado há 48 h a 7 dias,
-- nunca entrou), 3 a 14 dias sem treinar, ou o atestado vencendo em 15 dias.
--
-- "Sem treinar" conta só o treino concluído no app e a passagem pela academia
-- (catraca ou QR, em `presencas`): abrir o app não é treinar. Quem nunca
-- treinou conta do primeiro acesso.
create or replace function public.alunos_para_avisos_de_retencao()
returns table(
  aluno_id uuid,
  user_id uuid,
  email text,
  nome text,
  academia text,
  ficticia boolean,
  primeiro_acesso boolean,
  convite_permitido boolean,
  matriculado_em date,
  parado_desde date,
  atestado_validade date,
  lembretes_de_treino boolean,
  tem_push boolean,
  avisos jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with elegiveis as (
    select al.id, al.user_id, al.organization_id, al.primeiro_acesso_em, al.created_at, al.metodo_arke_status,
           o.nome as academia, coalesce(o.ficticia, false) as ficticia
      from public.alunos al
      join public.organizations o on o.id = al.organization_id
     where al.anonimizado_em is null
       and al.situacao_academia = 'em_dia'
       and public.situacao_permite_app(al.situacao_academia, al.situacao_academia_em)
       and o.status in ('ativo', 'trial', 'inadimplente')
       and exists (select 1 from public.organization_members om
                    where om.organization_id = al.organization_id and om.user_id = al.user_id and om.status = 'active')
       and (not exists (select 1 from public.aluno_matriculas_academia m where m.aluno_id = al.id)
            or exists (select 1 from public.aluno_matriculas_academia m where m.aluno_id = al.id and m.status = 'ativa'))
  ),
  situacao as (
    select e.*,
           case when e.primeiro_acesso_em is not null then greatest(
             (e.primeiro_acesso_em at time zone 'America/Sao_Paulo')::date,
             (select max(p.dia) from public.presencas p where p.aluno_id = e.id),
             (select max(r.data) from public.registro_treino r where r.aluno_id = e.id and r.concluido)
           ) end as parado_desde,
           (select q.atestado_validade from public.aluno_parq q
             where q.aluno_id = e.id and q.algum_sim
               and q.atestado_validade >= current_date and q.atestado_validade < current_date + 15) as atestado_validade
      from elegiveis e
  )
  select s.id, s.user_id, u.email::text, coalesce(pf.full_name, ''), s.academia, s.ficticia,
         s.primeiro_acesso_em is not null,
         -- O mesmo recorte da tarefa de ativação (gerar_tarefas_ativacao_pendente):
         -- o importado fora do Método não recebeu convite, e a academia decide
         -- quando convidar. E só quem nunca entrou: para quem já entra, o link de
         -- criar a senha seria um susto.
         (u.last_sign_in_at is null
          and (s.metodo_arke_status = 'ativo'
               or not exists (select 1 from public.importacoes_alunos_linhas l
                               where l.organization_id = s.organization_id and l.user_id_criado = s.user_id))),
         (s.created_at at time zone 'America/Sao_Paulo')::date,
         s.parado_desde,
         s.atestado_validade,
         coalesce(pf.lembretes_de_treino, true),
         exists (select 1 from public.push_subscriptions ps where ps.user_id = s.user_id),
         coalesce((select jsonb_agg(jsonb_build_object('tipo', v.tipo, 'referencia', v.referencia, 'enviado_em', v.enviado_em))
                     from public.avisos_ao_aluno v
                    where v.aluno_id = s.id and v.enviado_em > now() - interval '60 days'), '[]'::jsonb)
    from situacao s
    join auth.users u on u.id = s.user_id
    left join public.profiles pf on pf.user_id = s.user_id
   where (s.primeiro_acesso_em is null
          and s.created_at < now() - interval '48 hours'
          and s.created_at >= now() - interval '7 days')
      or (s.parado_desde between current_date - 14 and current_date - 3)
      or s.atestado_validade is not null;
$$;

comment on function public.alunos_para_avisos_de_retencao() is
  'Os alunos que podem receber um aviso de retenção hoje (convite, inatividade, atestado), com o que a regra da função precisa. Só a rotina lê.';

revoke execute on function public.alunos_para_avisos_de_retencao() from public, anon, authenticated;
grant execute on function public.alunos_para_avisos_de_retencao() to service_role;

-- ── 5. A reserva de um aviso ───────────────────────────────────────────────
--
-- Devolve o id da reserva, ou nulo quando o aviso do período já existe (outra
-- rodada reservou antes). Junto, marca as tarefas abertas do mesmo caso, para
-- a equipe ver na fila que o aluno foi avisado: o convite na de ativação, a
-- inatividade nas de faltas (barreira de rotina e risco de evasão) e o
-- atestado na do atestado.
create or replace function public.reservar_aviso_ao_aluno(_aluno_id uuid, _tipo text, _referencia date, _canais text[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select organization_id into v_org from public.alunos where id = _aluno_id;
  if v_org is null then
    return null;
  end if;

  insert into public.avisos_ao_aluno (organization_id, aluno_id, tipo, referencia, canais)
  values (v_org, _aluno_id, _tipo, _referencia, _canais)
  on conflict (aluno_id, tipo, referencia) do nothing
  returning id into v_id;
  if v_id is null then
    return null;
  end if;

  update public.tarefas
     set aviso_automatico_em = now()
   where aluno_id = _aluno_id
     and status in ('aberta', 'em_andamento', 'aguardando')
     and aviso_automatico_em is null
     and tipo = any (case _tipo
                       when 'convite' then array['ativacao']
                       when 'atestado' then array['atestado']
                       else array['barreira', 'inercia']
                     end::public.tarefa_tipo[]);
  return v_id;
end;
$$;

comment on function public.reservar_aviso_ao_aluno(uuid, text, date, text[]) is
  'Reserva um aviso de retenção (uma vez por aluno, tipo e período) e marca as tarefas abertas do caso. Nulo: já reservado. Só a rotina chama.';

revoke execute on function public.reservar_aviso_ao_aluno(uuid, text, date, text[]) from public, anon, authenticated;
grant execute on function public.reservar_aviso_ao_aluno(uuid, text, date, text[]) to service_role;

-- ── 6. Voltou a treinar depois do aviso ────────────────────────────────────
--
-- A tarefa de faltas aberta (barreira de rotina ou risco de evasão) que tem o
-- aviso automático fecha quando o aluno treina: o treino concluído no app ou a
-- passagem pela academia. Sem o aviso, a tarefa fica para a equipe, como
-- antes: fechar sozinho o caso em que ninguém falou com o aluno tiraria da
-- fila uma conversa que a equipe ia ter.
create or replace function public.fechar_tarefa_de_faltas_ao_treinar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_table_name = 'registro_treino' then
    if not new.concluido then
      return null;
    end if;
    if tg_op = 'UPDATE' then
      if old.concluido then
        return null;
      end if;
    end if;
  end if;

  update public.tarefas
     set status = 'concluida',
         desfecho_acao = case tg_table_name
           when 'presencas' then 'Voltou a treinar depois do aviso automático (passagem na academia).'
           else 'Voltou a treinar depois do aviso automático (treino registrado no app).'
         end
   where aluno_id = new.aluno_id
     and tipo in ('barreira', 'inercia')
     and status in ('aberta', 'em_andamento', 'aguardando')
     and aviso_automatico_em is not null;
  return null;
end;
$$;

drop trigger if exists trg_fechar_tarefa_de_faltas_ao_treinar on public.registro_treino;
create trigger trg_fechar_tarefa_de_faltas_ao_treinar
  after insert or update of concluido on public.registro_treino
  for each row execute function public.fechar_tarefa_de_faltas_ao_treinar();

drop trigger if exists trg_fechar_tarefa_de_faltas_ao_treinar on public.presencas;
create trigger trg_fechar_tarefa_de_faltas_ao_treinar
  after insert on public.presencas
  for each row execute function public.fechar_tarefa_de_faltas_ao_treinar();

revoke execute on function public.fechar_tarefa_de_faltas_ao_treinar() from public, anon, authenticated;

-- ── 7. A rotina ────────────────────────────────────────────────────────────
--
-- O alerta de rotinas espera o desfecho da função (20261248010000).
insert into public.execucoes_agendadas (nome, ultima_ok) values ('aviso-retencao-aluno', now())
on conflict (nome) do nothing;

-- Todo dia às 13h30 em GMT, que é 10h30 em Brasília (UTC-3, sem horário de
-- verão desde 2019): dentro da janela das 8h às 20h, que a função confere de
-- novo, e meia hora depois do aviso de cobrança.
select cron.unschedule(jobid) from cron.job where jobname = 'arke-aviso-retencao';
select cron.schedule(
  'arke-aviso-retencao',
  '30 13 * * *',
  $cron$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/aviso-retencao-aluno',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token', (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$
);
