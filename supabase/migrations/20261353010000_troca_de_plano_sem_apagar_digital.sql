-- Troca de plano sem apagar a digital (06/10/2026).
--
-- Decisão do responsável no workspace: a remoção da digital no fim da
-- matrícula espera 48 horas e é cancelada se uma matrícula nova entrar nesse
-- prazo. Trocar de plano é cancelar a matrícula e criar outra
-- (academia-criar-matricula recusa a segunda com a primeira viva), e a
-- migration 20261345 apagava a digital no cancelamento: a recepção teria de
-- cadastrar de novo a cada troca.
--
-- O que muda é só a remoção física e o número. A catraca continua barrando
-- desde o cancelamento (`matricula_encerrada`), e o aluno sai na hora do
-- cadastro do Gateway. As ordens de cadastro em aberto e a foto do rosto
-- pendente também saem na hora, como antes.

set lock_timeout = '5s';

-- ── A fila das remoções ─────────────────────────────────────────────────────
create table if not exists public.remocoes_fim_de_matricula (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  identificador text not null,
  agendada_para timestamptz not null,
  cancelada_em timestamptz,
  executada_em timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_remocoes_fim_de_matricula_pendentes
  on public.remocoes_fim_de_matricula (agendada_para)
  where cancelada_em is null and executada_em is null;
create index if not exists idx_remocoes_fim_de_matricula_aluno on public.remocoes_fim_de_matricula (aluno_id);
create index if not exists idx_remocoes_fim_de_matricula_org on public.remocoes_fim_de_matricula (organization_id);

alter table public.remocoes_fim_de_matricula enable row level security;
drop policy if exists "leitura" on public.remocoes_fim_de_matricula;
create policy "leitura" on public.remocoes_fim_de_matricula for select to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'));
revoke insert, update, delete on public.remocoes_fim_de_matricula from anon, authenticated;

-- ── O cancelamento agenda; não apaga ───────────────────────────────────────
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

  if v_aluno.identificador_catraca is not null
     and not exists (
       select 1 from public.remocoes_fim_de_matricula r
        where r.aluno_id = v_aluno.id and r.identificador = v_aluno.identificador_catraca
          and r.cancelada_em is null and r.executada_em is null
     ) then
    insert into public.remocoes_fim_de_matricula (organization_id, aluno_id, identificador, agendada_para)
    values (v_aluno.organization_id, v_aluno.id, v_aluno.identificador_catraca, now() + interval '48 hours');
  end if;
  return null;
end;
$$;

-- ── Matrícula nova no prazo: a remoção não acontece ─────────────────────────
create or replace function public.cancelar_remocao_com_matricula_nova()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('ativa', 'pausada') then
    update public.remocoes_fim_de_matricula
       set cancelada_em = now()
     where aluno_id = new.aluno_id and cancelada_em is null and executada_em is null;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_cancelar_remocao_com_matricula_nova on public.aluno_matriculas_academia;
create trigger trg_cancelar_remocao_com_matricula_nova
  after insert or update of status on public.aluno_matriculas_academia
  for each row execute function public.cancelar_remocao_com_matricula_nova();

-- ── A rotina: passadas as 48 horas, apaga ──────────────────────────────────
--
-- Confere o aluno antes de apagar: se ele voltou a ter matrícula, foi
-- anonimizado (a anonimização já agendou a remoção) ou trocou de número, a
-- remoção daqui não vale mais.
create or replace function public.executar_remocoes_fim_de_matricula()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_feitas integer := 0;
begin
  for r in
    select x.id, x.aluno_id, x.identificador, a.organization_id, a.identificador_catraca, a.anonimizado_em
      from public.remocoes_fim_de_matricula x
      join public.alunos a on a.id = x.aluno_id
     where x.cancelada_em is null and x.executada_em is null and x.agendada_para <= now()
     order by x.agendada_para
     for update of x skip locked
  loop
    if r.anonimizado_em is null
       and r.identificador_catraca = r.identificador
       and public.matricula_encerrada(r.aluno_id) then
      perform public.agendar_remocao_equipamento(
        r.organization_id, r.aluno_id, r.identificador,
        exists (select 1 from public.aluno_consentimento_biometrico c where c.aluno_id = r.aluno_id),
        'matrícula encerrada');
      update public.alunos set identificador_catraca = null where id = r.aluno_id;
      update public.remocoes_fim_de_matricula set executada_em = now() where id = r.id;
      v_feitas := v_feitas + 1;
    else
      update public.remocoes_fim_de_matricula set cancelada_em = now() where id = r.id;
    end if;
  end loop;
  return v_feitas;
end;
$$;

revoke all on function public.executar_remocoes_fim_de_matricula() from public, anon, authenticated;
grant execute on function public.executar_remocoes_fim_de_matricula() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'arke-remocoes-fim-de-matricula';
select cron.schedule('arke-remocoes-fim-de-matricula', '23 * * * *', 'select public.executar_remocoes_fim_de_matricula()');

-- Funções de gatilho nascem com EXECUTE para o PUBLIC.
revoke execute on function public.remover_do_equipamento_ao_encerrar_matricula() from public, anon, authenticated;
revoke execute on function public.cancelar_remocao_com_matricula_nova() from public, anon, authenticated;
