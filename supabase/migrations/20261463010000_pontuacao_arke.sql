-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- A Pontuação ARKE (gamificação, decidido em 10/11/2026): pontos pela constância
-- contra a meta do próprio aluno, pelo check-in e pelos desafios cumpridos. O
-- ranking da academia é só por pontos, nunca por corpo. Dor, pedido de ajuda e
-- falta justificada não tiram ponto: a conta só soma.
--
-- A conta, num período:
--   * constância: em cada semana (domingo a sábado) que toca o período, os dias
--     distintos com treino (o registro concluído no app ou a presença na catraca
--     e no QR), contra a meta semanal do aluno; a semana vale até 20 pontos, na
--     proporção da meta (quem treina 2 com meta de 2 pontua igual a quem treina 5
--     com meta de 5);
--   * check-in: 2 pontos por dia com o check-in respondido, seja qual for a
--     resposta (dizer que está com dificuldade não tira ponto);
--   * desafios: os pontos de cada desafio concluído no período.

-- ── 1. A conta (interna, sem EXECUTE para a API) ───────────────────────────
create or replace function public.pontos_arke_calcular(_aluno_id uuid, _de date, _ate date)
returns table (constancia integer, checkins integer, desafios integer, total integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with aluno as (
    select a.id, greatest(coalesce(a.meta_semanal_dias, 3), 1) as meta
      from public.alunos a where a.id = _aluno_id
  ),
  dias as (
    select rt.data as dia from public.registro_treino rt
     where rt.aluno_id = _aluno_id and rt.concluido and rt.data between _de and _ate
    union
    select p.dia from public.presencas p
     where p.aluno_id = _aluno_id and p.dia between _de and _ate
  ),
  -- O domingo de cada data: date_trunc('week') começa na segunda, e o dia 0 é domingo.
  semanas as (
    select (d.dia - extract(dow from d.dia)::integer) as domingo, count(*) as dias_de_treino
      from dias d group by 1
  ),
  c as (
    select coalesce(sum(round(20 * least(s.dias_de_treino::numeric / al.meta, 1))), 0)::integer as pontos
      from semanas s cross join aluno al
  ),
  k as (
    select (2 * count(distinct ck.data))::integer as pontos
      from public.checkins ck
     where ck.aluno_id = _aluno_id and ck.data between _de and _ate
  ),
  d as (
    select coalesce(sum(ds.pontos), 0)::integer as pontos
      from public.desafio_progresso dp
      join public.desafios ds on ds.id = dp.desafio_id
     where dp.aluno_id = _aluno_id and dp.concluido
       and coalesce(dp.concluido_em::date, ds.data_fim) between _de and _ate
  )
  select c.pontos, k.pontos, d.pontos, c.pontos + k.pontos + d.pontos
    from c, k, d
   where exists (select 1 from aluno);
$function$;
revoke execute on function public.pontos_arke_calcular(uuid, date, date) from public, anon, authenticated;

-- ── 2. Os pontos do próprio aluno, para o app ──────────────────────────────
-- O aluno lê os dele; a equipe da academia, os dos alunos dela. O período vai até
-- um ano, para ninguém varrer a base inteira.
create or replace function public.pontos_arke(_aluno_id uuid, _de date, _ate date)
returns table (constancia integer, checkins integer, desafios integer, total integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
  v_user uuid;
begin
  select a.organization_id, a.user_id into v_org, v_user from public.alunos a where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'no_data_found';
  end if;
  if not (v_user = auth.uid() or public.is_org_staff(auth.uid(), v_org)) then
    raise exception 'Sem acesso aos pontos deste aluno.' using errcode = '42501';
  end if;
  if _de is null or _ate is null or _ate < _de or _ate - _de > 366 then
    raise exception 'Período inválido (até um ano).' using errcode = '22023';
  end if;
  return query select * from public.pontos_arke_calcular(_aluno_id, _de, _ate);
end;
$function$;
revoke execute on function public.pontos_arke(uuid, date, date) from public, anon;
grant execute on function public.pontos_arke(uuid, date, date) to authenticated;

-- ── 3. A competição pela Pontuação ARKE ────────────────────────────────────
alter type public.competicao_metrica add value if not exists 'pontos_arke';

-- O ranking da competição ganha a métrica nova; o resto é o mesmo.
create or replace function public.obter_ranking_competicao(p_competicao_id uuid)
returns table(aluno_id uuid, nome text, valor numeric)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_comp public.competicoes%rowtype;
  v_tem_acesso boolean;
begin
  select * into v_comp from public.competicoes where id = p_competicao_id;
  if not found then
    return;
  end if;

  v_tem_acesso := public.is_org_staff(auth.uid(), v_comp.organization_id)
    or public.has_role(auth.uid(), 'admin_arke')
    or v_comp.para_todos
    or exists (
      select 1 from public.competicao_participantes cp
      join public.alunos a on a.id = cp.aluno_id
      where cp.competicao_id = p_competicao_id and a.user_id = auth.uid()
    );

  if not v_tem_acesso then
    return;
  end if;

  return query
  with participantes as (
    select a.id as aluno_id
    from public.alunos a
    where a.organization_id = v_comp.organization_id
      and (
        v_comp.para_todos
        or exists (select 1 from public.competicao_participantes cp where cp.competicao_id = p_competicao_id and cp.aluno_id = a.id)
      )
  )
  select
    p.aluno_id,
    coalesce(pr.full_name, '—') as nome,
    case v_comp.metrica::text
      when 'pontos_desafios' then coalesce((
        select sum(d.pontos)
        from public.desafio_progresso dpr
        join public.desafios d on d.id = dpr.desafio_id
        where dpr.aluno_id = p.aluno_id
          and dpr.concluido
          and d.data_fim between v_comp.data_inicio and v_comp.data_fim
      ), 0)
      when 'treinos_concluidos' then coalesce((
        select count(*)
        from public.registro_treino rt
        where rt.aluno_id = p.aluno_id
          and rt.concluido
          and rt.data between v_comp.data_inicio and v_comp.data_fim
      ), 0)
      when 'km_total' then coalesce((
        select sum(tc.distancia_km)
        from public.treino_calendario tc
        where tc.aluno_id = p.aluno_id
          and tc.data between v_comp.data_inicio and v_comp.data_fim
      ), 0)
      when 'dieta_adesao_media' then coalesce((
        select avg(da.adesao_percentual)
        from public.dieta_adesao da
        where da.aluno_id = p.aluno_id
          and da.data between v_comp.data_inicio and v_comp.data_fim
      ), 0)
      when 'pontos_arke' then coalesce((
        select pa.total from public.pontos_arke_calcular(p.aluno_id, v_comp.data_inicio, v_comp.data_fim) pa
      ), 0)
      else 0
    end as valor
  from participantes p
  join public.alunos al on al.id = p.aluno_id
  left join public.profiles pr on pr.user_id = al.user_id
  order by valor desc;
end;
$function$;
