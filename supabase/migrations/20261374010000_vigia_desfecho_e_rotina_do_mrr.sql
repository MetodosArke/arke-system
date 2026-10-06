-- Vigia: ação aprovada nunca fica sem desfecho; e a rotina do MRR passa a
-- nascer de migration (06/10/2026).
--
-- 1. **Ação presa em "executando".** A aprovação reserva a decisão
--    (`vigia_preparar_aprovacao`) e só depois executa; o desfecho chega por
--    `vigia_concluir_acao`. A edge function `vigia-aprovar` agora registra o
--    desfecho em toda saída, inclusive na exceção do `fetch` que estoura o
--    prazo. O que ela não cobre é a função morta no meio (limite de tempo do
--    runtime): a ação ficaria "executando" para sempre, e uma nova aprovação
--    recusada como "já decidida". A cada passada do Vigia, a ação que passou
--    de 15 minutos sem desfecho é fechada como erro, com a Auditoria de
--    sempre. Quinze minutos é bem mais que o tempo máximo de uma edge
--    function.
--
-- 2. **`snapshot-mrr-diario` sem migration.** A rotina existe no banco de
--    produção porque o roteiro de migração de projeto a criou à mão; a
--    migration que rodou (`supabase/historico/20260920055417`) não a agenda.
--    Com a lista das rotinas lida das migrations
--    (`scripts/migracao/rotinas.mjs`), ela sumiria numa reconstrução. Aqui
--    ela é agendada de novo, igual à de produção.

set lock_timeout = '5s';

create or replace function public.vigia_fechar_acoes_sem_desfecho()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from public.vigia_acoes
     where resultado = 'executando' and criada_em < now() - interval '15 minutes'
     order by id
     for update skip locked
  loop
    perform public.vigia_concluir_acao(
      r.id, 'erro',
      'Sem desfecho: a execução foi interrompida antes de registrar o resultado. Confira antes de agir de novo.',
      null);
    n := n + 1;
  end loop;
  return n;
exception when others then
  -- Nunca derruba a passada do Vigia, que vem logo depois no mesmo comando.
  raise warning 'vigia_fechar_acoes_sem_desfecho: %', sqlstate;
  return 0;
end;
$$;

revoke execute on function public.vigia_fechar_acoes_sem_desfecho() from public, anon, authenticated;
grant execute on function public.vigia_fechar_acoes_sem_desfecho() to service_role;

-- A passada do Vigia fecha antes as ações presas, e depois varre.
select cron.unschedule(jobid) from cron.job where jobname = 'arke-vigia';
select cron.schedule('arke-vigia', '*/5 * * * *', $cmd$select public.vigia_fechar_acoes_sem_desfecho(); select public.vigia_varrer()$cmd$);

-- 03:05 UTC = 00:05 em Brasília, como a de produção.
select cron.unschedule(jobid) from cron.job where jobname = 'snapshot-mrr-diario';
select cron.schedule('snapshot-mrr-diario', '5 3 * * *', 'select public.capturar_snapshot_mrr();');
