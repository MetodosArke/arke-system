-- Retenção de 13 meses para acessos_catraca_logs (23/09/2026).
--
-- É a tabela que mais cresce na plataforma: uma linha por passagem na
-- catraca, ~277 bytes com índices, medido. Uma academia com 500 alunos
-- ativos gera algo como 12 mil linhas/mês; sem limite, o log de giro seria a
-- maior parte do banco em poucos anos — e um log que ninguém lê.
--
-- Por que 13 meses, e não menos:
--   * a frequência que importa já não mora aqui. Desde 20261238010000, cada
--     entrada vira `presencas` (uma linha por aluno por dia), e é presença
--     que os sensores, o calendário e o Gestão 360 leem. Apagar o log não
--     apaga a presença;
--   * quem lê o log hoje olha no máximo 7 dias (obter_frequencia_catraca_
--     organizacao usa current_date - 6; get_superadmin_gateways, 24 h; a tela
--     de catracas, as últimas linhas);
--   * o check-in de parceiro (Wellhub, TotalPass) mora nesta mesma tabela, e
--     é por ele que a academia confere o repasse do parceiro. Um ciclo anual
--     inteiro mais um mês de folga cobre a conferência e a contestação;
--   * LGPD, necessidade (art. 6º, III): guardar indefinidamente o horário de
--     cada entrada de cada pessoa é exatamente o dado que não se justifica
--     depois de cumprida a finalidade. A Política (§7) promete guardar
--     "enquanto houver vínculo" — apagar antes disso é mais restritivo, não
--     precisa de nova versão nem de novo aceite.

create or replace function public.limpar_acessos_catraca_antigos(_lote int default 5000)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  _corte timestamptz := now() - interval '13 months';
  _apagadas bigint := 0;
  _n int;
begin
  -- Em lotes pelo índice de created_at: a rodada diária normalmente apaga um
  -- dia de log, mas a primeira depois de um tempo parada pode pegar meses, e
  -- um DELETE único dessa tabela seguraria memória e WAL de uma vez.
  loop
    delete from public.acessos_catraca_logs
     where id in (
       select id from public.acessos_catraca_logs
        where created_at < _corte
        limit _lote
     );
    get diagnostics _n = row_count;
    _apagadas := _apagadas + _n;
    exit when _n < _lote;
  end loop;
  return _apagadas;
end;
$$;

comment on function public.limpar_acessos_catraca_antigos(int) is
  'Apaga acessos_catraca_logs com mais de 13 meses, em lotes. A presença derivada (presencas) fica. Rotina arke-retencao-logs-catraca.';

revoke execute on function public.limpar_acessos_catraca_antigos(int) from public, anon, authenticated;
grant execute on function public.limpar_acessos_catraca_antigos(int) to service_role;

-- 00:40 de Brasília: fora do movimento de qualquer academia, e no formato
-- diário que avaliar_rotinas() reconhece — se parar, a Visão Master acusa.
select cron.unschedule(jobid) from cron.job where jobname = 'arke-retencao-logs-catraca';
select cron.schedule('arke-retencao-logs-catraca', '40 3 * * *', $$select public.limpar_acessos_catraca_antigos()$$);

-- Sem uso desde a sincronização incremental (20261240010000): a regra de quem
-- a catraca barra passou para alunos_catraca(), que decide por aluno e por
-- momento. Mantê-la seria uma segunda versão da mesma regra esperando para
-- divergir.
drop function if exists public.alunos_barrados_na_catraca(uuid);
