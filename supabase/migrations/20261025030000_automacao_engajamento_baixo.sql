-- Etapa N (auditoria de integração) — nenhuma automação reagia a
-- engajamento caindo: só quem abrisse Retenção/Gestão 360° manualmente
-- percebia. Cria uma tarefa automática (semanal, idempotente por
-- competência/mês) quando a pontuação de engajamento do aluno fica
-- abaixo de 30/100, surfada na fila do staff junto de dor/barreira.
insert into public.sla_config (tipo, prioridade, prazo_horas, descricao) values
  ('engajamento_baixo', 'media', 72, 'Pontuação de engajamento do mês abaixo de 30 — considerar contato proativo')
on conflict (tipo) do update set
  prioridade = excluded.prioridade,
  prazo_horas = excluded.prazo_horas,
  descricao = excluded.descricao,
  updated_at = now();

create or replace function public.gerar_tarefas_engajamento_baixo()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _cfg record;
  _org record;
  _pontuacao record;
  _competencia text := to_char(current_date, 'YYYY-MM');
begin
  select prioridade, prazo_horas into _cfg from public.sla_config where tipo = 'engajamento_baixo';

  for _org in select id from public.organizations loop
    for _pontuacao in
      select pc.aluno_id, pc.pontuacao
      from public.calcular_pontuacoes_engajamento_mes(_org.id) pc
      join public.alunos a on a.id = pc.aluno_id
      where a.metodo_arke_status = 'ativo' and pc.pontuacao < 30
    loop
      insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
      values (
        _org.id,
        _pontuacao.aluno_id,
        'Engajamento baixo neste mês (treino, check-in, dieta e água) — considerar contato proativo',
        coalesce(_cfg.prioridade, 'media'),
        now() + make_interval(hours => coalesce(_cfg.prazo_horas, 72)),
        'engajamento_baixo:' || _pontuacao.aluno_id::text || ':' || _competencia,
        'engajamento_baixo'
      )
      on conflict (organization_id, origem_evento) do nothing;
    end loop;
  end loop;
end;
$$;

select cron.schedule(
  'arke-engajamento-baixo',
  '0 8 * * 1',
  $$select public.gerar_tarefas_engajamento_baixo();$$
);

revoke execute on function public.gerar_tarefas_engajamento_baixo() from public, anon, authenticated;
