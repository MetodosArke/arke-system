-- tarefas não tem (nem deveria ter) policy de SELECT pra aluno: motivo,
-- acao e desfecho_acao são anotações internas do staff, não pra expor
-- direto pro aluno via RLS. Mas o aluno precisa ver a data do próprio
-- acolhimento M.A.P.A.® quando o staff agenda (data_agendada) — daí uma
-- RPC security definer bem estreita, só com os 3 campos seguros de
-- mostrar, escopada à própria tarefa de acolhimento (tipo=anamnese) do
-- chamador.
create or replace function public.obter_proximo_evento_aluno()
returns table (motivo text, data_agendada timestamptz, sla_prazo timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select t.motivo, t.data_agendada, t.sla_prazo
  from public.tarefas t
  join public.alunos a on a.id = t.aluno_id
  where a.user_id = auth.uid()
    and t.tipo = 'anamnese'
    and t.status in ('aberta', 'em_andamento', 'aguardando')
  order by t.created_at desc
  limit 1;
$$;

revoke execute on function public.obter_proximo_evento_aluno() from public;
grant execute on function public.obter_proximo_evento_aluno() to authenticated;
