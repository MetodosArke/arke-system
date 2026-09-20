-- Etapa K (simplificada, conforme combinado): pontuação mensal de
-- engajamento/performance com comparação à média da organização +
-- Programador de Rotina Semanal. Não é o motor completo de gamificação do
-- protótipo legado (200 pontos / 30 regras) — uma versão enxuta a partir
-- de sinais que já existem (treino, check-in, adesão à dieta, água).

-- =====================================================================
-- 1. Programador de Rotina Semanal — o que o aluno planeja treinar em
--    cada dia da semana (modelo recorrente, separado do registro real
--    no calendário/execução).
-- =====================================================================
create table public.aluno_rotina_semanal (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  dia_semana      smallint not null check (dia_semana between 0 and 6),
  modalidade      text,
  updated_at      timestamptz not null default now(),
  unique (aluno_id, dia_semana)
);

create index idx_aluno_rotina_semanal_org on public.aluno_rotina_semanal(organization_id);

create trigger trg_aluno_rotina_semanal_updated_at
  before update on public.aluno_rotina_semanal
  for each row execute function public.set_updated_at();

alter table public.aluno_rotina_semanal enable row level security;

create policy "aluno gerencia a própria rotina semanal"
  on public.aluno_rotina_semanal for all to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

create policy "staff da org vê/gerencia rotina semanal dos alunos"
  on public.aluno_rotina_semanal for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

-- =====================================================================
-- 2. Pontuação mensal de engajamento — composta de sinais que já
--    existem: treinos concluídos, check-ins de acompanhamento, adesão à
--    dieta e dias com meta de água batida. Cada componente vale até 40
--    (treino) ou 20 pontos (os outros três), somando até 100.
--    Retorna a pontuação do próprio aluno e a média da organização —
--    nunca uma lista individualizada de outros alunos (sem ranking
--    corporal/individual exposto, conforme diretriz de gamificação
--    positiva do produto).
-- =====================================================================
create or replace function public.obter_pontuacao_engajamento_mensal()
returns table (
  pontuacao_propria numeric,
  media_organizacao numeric,
  treinos_concluidos integer,
  checkins_registrados integer,
  adesao_dieta_media numeric,
  dias_meta_agua_batida integer,
  dias_no_mes integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  _aluno_id uuid;
  _org_id uuid;
  _inicio date := date_trunc('month', current_date)::date;
  _fim date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  _dias_no_mes integer := extract(day from _fim)::integer;
begin
  select id, organization_id into _aluno_id, _org_id from public.alunos where user_id = auth.uid();
  if _aluno_id is null then
    raise exception 'Cadastro de aluno não encontrado.';
  end if;

  return query
  with pontuacoes as (
    select
      a.id as aluno_id,
      coalesce(rt.treinos_concluidos, 0) as treinos_concluidos,
      coalesce(ck.checkins_registrados, 0) as checkins_registrados,
      da.adesao_dieta_media,
      coalesce(rh.dias_meta_agua, 0) as dias_meta_agua_batida,
      least(1.0, coalesce(rt.treinos_concluidos, 0)::numeric / greatest(1, a.meta_semanal_dias * 4)) * 40
        + least(1.0, coalesce(ck.checkins_registrados, 0)::numeric / 20) * 20
        + coalesce(da.adesao_dieta_media, 0) / 100 * 20
        + least(1.0, coalesce(rh.dias_meta_agua, 0)::numeric / greatest(1, _dias_no_mes)) * 20
        as pontuacao
    from public.alunos a
    left join (
      select rt2.aluno_id, count(*) as treinos_concluidos
      from public.registro_treino rt2
      where rt2.concluido = true and rt2.data between _inicio and _fim
      group by rt2.aluno_id
    ) rt on rt.aluno_id = a.id
    left join (
      select c.aluno_id, count(*) as checkins_registrados
      from public.checkins c
      where c.data between _inicio and _fim
      group by c.aluno_id
    ) ck on ck.aluno_id = a.id
    left join (
      select d.aluno_id, avg(d.adesao_percentual) as adesao_dieta_media
      from public.dieta_adesao d
      where d.data between _inicio and _fim
      group by d.aluno_id
    ) da on da.aluno_id = a.id
    left join (
      select rh2.aluno_id, count(*) as dias_meta_agua
      from public.registro_habito rh2
      join public.alunos a2 on a2.id = rh2.aluno_id
      where rh2.data between _inicio and _fim and rh2.agua_ml >= a2.meta_agua_ml
      group by rh2.aluno_id
    ) rh on rh.aluno_id = a.id
    where a.organization_id = _org_id
  )
  select
    (select p.pontuacao from pontuacoes p where p.aluno_id = _aluno_id),
    (select round(avg(p.pontuacao), 1) from pontuacoes p),
    (select p.treinos_concluidos from pontuacoes p where p.aluno_id = _aluno_id),
    (select p.checkins_registrados from pontuacoes p where p.aluno_id = _aluno_id),
    (select round(p.adesao_dieta_media, 1) from pontuacoes p where p.aluno_id = _aluno_id),
    (select p.dias_meta_agua_batida from pontuacoes p where p.aluno_id = _aluno_id),
    _dias_no_mes;
end;
$$;

revoke execute on function public.obter_pontuacao_engajamento_mensal() from public;
grant execute on function public.obter_pontuacao_engajamento_mensal() to authenticated;
