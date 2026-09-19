-- Ranking de uma competição precisa agregar dados de VÁRIOS alunos
-- (treinos, km, adesão à dieta) — RLS normal só deixa cada aluno ver os
-- próprios registros. RPC estreita: valida que quem chama é staff da
-- organização OU um aluno com acesso à competição (para_todos ou
-- cadastrado), e só então devolve os valores agregados por aluno (nunca
-- os registros brutos).
create or replace function public.obter_ranking_competicao(p_competicao_id uuid)
returns table (aluno_id uuid, nome text, valor numeric)
language plpgsql
security definer
set search_path = public
stable
as $$
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
    case v_comp.metrica
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
      else 0
    end as valor
  from participantes p
  join public.alunos al on al.id = p.aluno_id
  left join public.profiles pr on pr.user_id = al.user_id
  order by valor desc;
end;
$$;

revoke execute on function public.obter_ranking_competicao(uuid) from public;
grant execute on function public.obter_ranking_competicao(uuid) to authenticated;
