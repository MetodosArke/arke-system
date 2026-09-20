-- Diferenciais técnicos do nível Elite (P2/P3 do plano de finalização do
-- app aluno): fila prioritária de atendimento e acolhimento expandido
-- (encontro periódico automático). O relatório de evolução exclusivo
-- (P4) é só uma leitura diferente de dados que já existem — não precisa
-- de schema novo, fica só no frontend.

insert into public.sla_config (tipo, prioridade, prazo_horas, descricao) values
  ('acolhimento_elite', 'baixa', 168, 'Acolhimento expandido Elite — encontro periódico de acompanhamento')
on conflict (tipo) do update set
  prioridade = excluded.prioridade,
  prazo_horas = excluded.prazo_horas,
  descricao = excluded.descricao,
  updated_at = now();

-- 1. Fila prioritária: tarefa de aluno Elite sobe um degrau de prioridade
-- (baixa->média, média->alta) já na criação — nunca mexe em alta/crítica,
-- pra não banalizar o que já é urgente pra qualquer aluno.
create or replace function public.bump_prioridade_elite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _nivel public.nivel_atacado;
begin
  if new.aluno_id is not null then
    select nivel_atacado into _nivel from public.alunos where id = new.aluno_id;
    if _nivel = 'elite' then
      if new.prioridade = 'baixa' then
        new.prioridade := 'media';
      elsif new.prioridade = 'media' then
        new.prioridade := 'alta';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_tarefas_bump_prioridade_elite
  before insert on public.tarefas
  for each row execute function public.bump_prioridade_elite();

revoke execute on function public.bump_prioridade_elite() from public, anon, authenticated;

-- 2. Acolhimento expandido: encontro periódico automático a cada ~30 dias
-- para aluno Elite ativo — não depende do staff lembrar de agendar.
create or replace function public.gerar_tarefas_acolhimento_elite()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _cfg record;
  _aluno record;
begin
  select prioridade, prazo_horas into _cfg from public.sla_config where tipo = 'acolhimento_elite';

  for _aluno in
    select a.id as aluno_id, a.organization_id
    from public.alunos a
    where a.nivel_atacado = 'elite' and a.metodo_arke_status = 'ativo'
      and not exists (
        select 1 from public.tarefas t
        where t.aluno_id = a.id and t.tipo = 'acolhimento_elite'
          and t.created_at > now() - interval '30 days'
      )
  loop
    insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
    values (
      _aluno.organization_id,
      _aluno.aluno_id,
      'Acolhimento expandido Elite — agendar encontro periódico de acompanhamento',
      coalesce(_cfg.prioridade, 'baixa'),
      now() + make_interval(hours => coalesce(_cfg.prazo_horas, 168)),
      'acolhimento_elite:' || _aluno.aluno_id::text || ':' || to_char(current_date, 'IYYY-IW'),
      'acolhimento_elite'
    )
    on conflict (organization_id, origem_evento) do nothing;
  end loop;
end;
$$;

select cron.schedule(
  'arke-acolhimento-elite',
  '0 7 * * *',
  $$select public.gerar_tarefas_acolhimento_elite();$$
);

revoke execute on function public.gerar_tarefas_acolhimento_elite() from public, anon, authenticated;
