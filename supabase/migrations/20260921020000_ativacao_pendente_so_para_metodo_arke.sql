-- gerar_tarefas_ativacao_pendente() roda de hora em hora (pg_cron) e cria
-- tarefa "Aluno sem 1º acesso após 48h" pra qualquer aluno sem
-- primeiro_acesso_em. Isso fazia sentido quando todo aluno virava
-- automaticamente cliente do Método ARKE — agora que a adesão é opcional
-- (metodo_arke_status), um aluno só matriculado na academia (sem_adesao)
-- nunca vai logar no app por conta própria, e ficava gerando alerta falso
-- pro staff toda hora, indefinidamente.
create or replace function public.gerar_tarefas_ativacao_pendente()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
  select
    a.organization_id,
    a.id,
    'Aluno sem 1º acesso após 48h',
    'alta',
    now() + interval '24 hours',
    'ativacao_pendente:' || a.id::text,
    'ativacao'
  from public.alunos a
  where a.primeiro_acesso_em is null
    and a.created_at < now() - interval '48 hours'
    and a.metodo_arke_status = 'ativo'
  on conflict (organization_id, origem_evento) do nothing;
end;
$$;
