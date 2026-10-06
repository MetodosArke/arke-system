-- Auditoria de prontidão, rodada 1: os prazos que a Política promete (06/10/2026).
--
-- A Política de Privacidade promete três prazos que o banco não cumpria:
--
-- 1. "A foto do rosto enviada pelo aplicativo fica na plataforma só até chegar
--    aos equipamentos, e no máximo 24 horas." A foto vencia em 24 h, mas a
--    limpeza só rodava quando outra função a chamava: sem movimento na
--    academia, a foto ficava além do prazo.
-- 2. "O endereço IP usado para limitar tentativas de cadastro é guardado
--    apenas em forma cifrada (hash) por até 24 horas." A faxina era
--    oportunista: só rodava quando chegava uma tentativa nova.
-- 3. "O resumo e os rascunhos gerados por inteligência artificial ficam
--    enquanto durar a sua matrícula." Nada os apagava quando a matrícula
--    terminava; só a revogação da autorização.

set lock_timeout = '5s';

-- ── 1 e 2. Uma rotina de hora em hora para o dado de passagem ─────────────
--
-- A foto vence em 23 h: com a limpeza de hora em hora, nenhuma passa de 24 h.
-- Para chegar ao equipamento, 23 h sobram (o Gateway busca ordens o tempo
-- todo).
alter table public.fotos_rosto_pendentes alter column expira_em set default now() + interval '23 hours';

create or replace function public.limpar_dados_de_passagem()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.limpar_fotos_rosto_sem_uso();
  delete from public.matricula_publica_tentativas where created_at < now() - interval '24 hours';
end;
$$;

revoke all on function public.limpar_dados_de_passagem() from public, anon, authenticated;
grant execute on function public.limpar_dados_de_passagem() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'arke-dados-de-passagem';
select cron.schedule('arke-dados-de-passagem', '17 * * * *', 'select public.limpar_dados_de_passagem()');

-- ── 3. O fim da matrícula apaga o que a IA gerou ───────────────────────────
--
-- Quando a última matrícula ativa ou pausada do aluno termina, o resumo da
-- anamnese sai e as sugestões ao mentor perdem o texto (a linha fica, como na
-- revogação: ela mede o trabalho do mentor, que é outra pessoa).
create or replace function public.apagar_ia_ao_fim_da_matricula()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'cancelada' and old.status is distinct from 'cancelada'
     and not exists (
       select 1 from public.aluno_matriculas_academia m
        where m.aluno_id = new.aluno_id and m.id <> new.id and m.status in ('ativa', 'pausada')
     ) then
    delete from public.sentinela_anamnese where aluno_id = new.aluno_id;
    update public.sentinela_sugestoes
       set sugestao = '[removido no fim da matrícula]'
     where aluno_id = new.aluno_id
       and sugestao not in ('[removido a pedido do aluno]', '[removido no fim da matrícula]');
  end if;
  return null;
end;
$$;

drop trigger if exists trg_fim_da_matricula_apaga_ia on public.aluno_matriculas_academia;
create trigger trg_fim_da_matricula_apaga_ia
  after update of status on public.aluno_matriculas_academia
  for each row execute function public.apagar_ia_ao_fim_da_matricula();

revoke execute on function public.apagar_ia_ao_fim_da_matricula() from public, anon, authenticated;
