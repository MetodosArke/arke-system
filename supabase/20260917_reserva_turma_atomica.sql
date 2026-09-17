-- Corrige condição de corrida na reserva de vaga de turma (achado de
-- revisão de código): server/supabaseAdmin.ts fazia um check-then-insert
-- comum (contar reservas confirmadas, só depois inserir), sem transação
-- nem lock — com 1 vaga restante, duas reservas concorrentes podiam
-- passar na checagem ao mesmo tempo e as duas serem confirmadas,
-- estourando limite_vagas. O único índice único existente
-- (turma_reservas_unica_por_aluno) só evita reserva duplicada do mesmo
-- aluno, não excesso de lotação.
--
-- reservar_vaga_turma faz a checagem e o insert numa única transação,
-- travando a linha de `turmas` (select ... for update) para serializar
-- reservas concorrentes da mesma turma.

create or replace function public.reservar_vaga_turma(
  p_turma_id uuid,
  p_aluno_id uuid,
  p_organization_id uuid,
  p_data date
)
returns public.turma_reservas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turma record;
  v_dia_semana integer;
  v_tem_horario boolean;
  v_ocupadas integer;
  v_reserva public.turma_reservas;
begin
  select * into v_turma from public.turmas where id = p_turma_id for update;
  if v_turma.id is null or v_turma.status <> 'ativa' or v_turma.organization_id <> p_organization_id then
    raise exception 'Turma não encontrada ou inativa.';
  end if;

  v_dia_semana := extract(dow from p_data);
  select exists (select 1 from public.turma_horarios where turma_id = p_turma_id and dia_semana = v_dia_semana) into v_tem_horario;
  if not v_tem_horario then
    raise exception 'Esta turma não tem horário nesse dia da semana.';
  end if;

  if exists (select 1 from public.turma_reservas where turma_id = p_turma_id and data = p_data and aluno_id = p_aluno_id and status = 'confirmada') then
    raise exception 'Você já reservou vaga nesta sessão.';
  end if;

  select count(*) into v_ocupadas from public.turma_reservas where turma_id = p_turma_id and data = p_data and status = 'confirmada';
  if v_ocupadas >= v_turma.limite_vagas then
    raise exception 'Não há vagas disponíveis para esta sessão.';
  end if;

  insert into public.turma_reservas (turma_id, aluno_id, organization_id, data)
  values (p_turma_id, p_aluno_id, p_organization_id, p_data)
  returning * into v_reserva;

  return v_reserva;
end;
$$;

-- p_aluno_id/p_organization_id vêm do backend já validados — chamada
-- direta via /rest/v1/rpc/... poderia forjar esses parâmetros, mesmo
-- motivo do lock-down em 20260914_lock_down_rpc_execute_grants.sql.
revoke execute on function public.reservar_vaga_turma(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.reservar_vaga_turma(uuid, uuid, uuid, date) to service_role;
