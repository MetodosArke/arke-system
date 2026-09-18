-- Auditoria de Resiliência: a trigger verificar_capacidade_turma conta as
-- linhas ativas e compara com a capacidade, mas SELECT count(*) não trava
-- nada — sob concorrência real (duas requisições quase simultâneas
-- agendando a mesma turma/data), ambas as transações podem ler a mesma
-- contagem "9 de 10" antes de qualquer uma commitar, e as duas passam,
-- resultando em overbooking (a própria falha que a trigger deveria
-- impedir).
--
-- Fix: pg_advisory_xact_lock — serializa apenas transações que disputam a
-- MESMA turma+data (lock liberado automaticamente no fim da transação,
-- sem risco de lock pendurado) e não bloqueia turmas/datas diferentes.
create or replace function public.verificar_capacidade_turma()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_capacidade  integer;
  v_ocupados    integer;
begin
  if new.status not in ('agendado', 'presente') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.turma_id::text || new.data::text));

  select capacidade_maxima into v_capacidade from public.turmas where id = new.turma_id;

  select count(*) into v_ocupados
    from public.agendamentos
    where turma_id = new.turma_id
      and data = new.data
      and status in ('agendado', 'presente')
      and id is distinct from new.id;

  if v_ocupados >= v_capacidade then
    raise exception 'Turma lotada para esta data. Use a lista de espera.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- Auditoria de Resiliência: dados de avaliação física sem nenhuma guarda
-- contra valores negativos/absurdos no banco (só o client-side impedia,
-- e nem isso). Defesa em profundidade — validação real deve sobreviver a
-- um client bugado ou uma chamada direta à API.
alter table public.avaliacoes_fisicas
  add constraint avaliacoes_fisicas_peso_positivo check (peso_kg is null or peso_kg > 0),
  add constraint avaliacoes_fisicas_altura_positiva check (altura_cm is null or altura_cm > 0),
  add constraint avaliacoes_fisicas_gordura_percentual check (percentual_gordura is null or (percentual_gordura >= 0 and percentual_gordura <= 100)),
  add constraint avaliacoes_fisicas_dobras_nao_negativas check (
    (dc_triceps is null or dc_triceps >= 0) and
    (dc_subescapular is null or dc_subescapular >= 0) and
    (dc_suprailiaca is null or dc_suprailiaca >= 0) and
    (dc_abdominal is null or dc_abdominal >= 0) and
    (dc_coxa is null or dc_coxa >= 0) and
    (dc_peitoral is null or dc_peitoral >= 0) and
    (dc_axilar_media is null or dc_axilar_media >= 0)
  ),
  add constraint avaliacoes_fisicas_perimetria_nao_negativa check (
    (perim_braco is null or perim_braco >= 0) and
    (perim_antebraco is null or perim_antebraco >= 0) and
    (perim_cintura is null or perim_cintura >= 0) and
    (perim_abdomen is null or perim_abdomen >= 0) and
    (perim_quadril is null or perim_quadril >= 0) and
    (perim_coxa is null or perim_coxa >= 0) and
    (perim_panturrilha is null or perim_panturrilha >= 0)
  );
