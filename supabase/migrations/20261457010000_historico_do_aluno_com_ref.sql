-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- O histórico do aluno com eventos clicáveis (reunião de 10/11/2026): cada evento
-- devolve o id da linha de origem (ref_id), para a ficha abrir o detalhe do chamado
-- (o que foi feito, quando, por quem, o tratamento e o encerramento). O resto é o
-- mesmo de 20261394010000: security invoker, cada parte pelo RLS da tabela, e a
-- saúde com atende_saude(). Mudar as colunas de saída pede drop antes do create.
drop function if exists public.get_historico_aluno(uuid, integer);

create or replace function public.get_historico_aluno(_aluno_id uuid, _limite integer default 100)
returns table (
  ocorrido_em timestamptz,
  tipo text,
  titulo text,
  detalhe text,
  autor text,
  ref_id uuid
)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
declare
  v_org uuid;
  v_metodo boolean;
  v_ve_saude boolean;
begin
  -- Pelo RLS de `alunos`: o aluno que quem chama não enxerga não existe aqui.
  select a.organization_id, coalesce(a.metodo_arke_status = 'ativo', false)
    into v_org, v_metodo
    from public.alunos a
   where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.';
  end if;
  if not (public.is_org_staff(auth.uid(), v_org) or (v_metodo and public.equipe_metodo())) then
    raise exception 'Acesso restrito à equipe da academia.' using errcode = '42501';
  end if;
  -- Quem atende a saúde: a gestão, o professor e a nutricionista; no aluno do
  -- Método, também a ArkeFit. A recepção, não.
  v_ve_saude := public.atende_saude(v_org) or (v_metodo and public.equipe_metodo());

  return query
  select * from (
    -- Atendimento aberto (motivo) ...
    select t.created_at, 'atendimento_aberto'::text, 'Pendência aberta: ' || t.motivo, t.acao,
           coalesce((select p.full_name from public.profiles p where p.user_id = t.responsavel_id),
                    case when t.responsavel_id is null then null
                         when t.dono = 'arkefit' then 'Equipe ArkeFit'
                         else 'Equipe da academia' end),
           t.id
      from public.tarefas t
     where t.aluno_id = _aluno_id
       and (v_ve_saude or t.tipo::text <> all (array['dor', 'anamnese']))
    union all
    -- ... e o desfecho, quando houve.
    select t.updated_at, 'atendimento_resolvido', 'Resolvida: ' || t.motivo, t.desfecho_acao,
           coalesce((select p.full_name from public.profiles p where p.user_id = t.responsavel_id),
                    case when t.responsavel_id is null then null
                         when t.dono = 'arkefit' then 'Equipe ArkeFit'
                         else 'Equipe da academia' end),
           t.id
      from public.tarefas t
     where t.aluno_id = _aluno_id and t.status in ('concluida', 'cancelada')
       and (v_ve_saude or t.tipo::text <> all (array['dor', 'anamnese']))
    union all
    select c.created_at, 'checkin',
           case c.status
             when 'funcionando_bem' then 'Check-in: funcionando bem'
             when 'preciso_ajuste' then 'Check-in: precisa de ajuste'
             when 'com_dificuldade' then 'Check-in: com dificuldade'
             else 'Check-in: quer falar com alguém'
           end
           || case when v_ve_saude then coalesce(' (' || replace(c.motivo_dificuldade::text, '_', ' ') || ')', '') else '' end,
           case when v_ve_saude then c.comentario end,
           null::text,
           c.id
      from public.checkins c where c.aluno_id = _aluno_id
    union all
    select h.created_at, 'fase', 'Fase da jornada: ' || coalesce(h.fase_anterior::text || ' → ', '') || h.fase_nova::text,
           -- A nota da mudança de fase: no Método, a jornada é do mentor, e a
           -- academia vê a fase, mas não a nota; no Free, quem atende a saúde.
           case when (case when v_metodo then public.equipe_metodo() else v_ve_saude end) then h.observacao end,
           coalesce((select p.full_name from public.profiles p where p.user_id = h.movido_por),
                    case when h.movido_por is null then h.movido_por_nome
                         -- Quem já foi da equipe: o nome guardado na linha é
                         -- justamente para isto (20261117010000).
                         when exists (select 1 from public.organization_members m
                                       where m.user_id = h.movido_por and m.organization_id = h.organization_id)
                           then h.movido_por_nome
                         else 'Equipe ArkeFit' end),
           h.id
      from public.aluno_fase_historico h where h.aluno_id = _aluno_id
    union all
    select g.created_at, 'agendamento', 'Agendamento (' || g.status::text || ') para ' || to_char(g.data, 'DD/MM/YYYY'), null, null, g.id
      from public.agendamentos g where g.aluno_id = _aluno_id
    union all
    -- Só a equipe da academia escreve observação.
    select o.created_at, 'observacao', 'Observação da equipe', o.texto,
           coalesce((select p.full_name from public.profiles p where p.user_id = o.autor_id),
                    case when o.autor_id is not null then 'Equipe da academia' end),
           o.id
      from public.aluno_observacoes o where o.aluno_id = _aluno_id
    union all
    select tr.created_at, 'treino_publicado', 'Treino publicado: ' || tr.titulo, null,
           coalesce((select p.full_name from public.profiles p where p.user_id = tr.publicado_por),
                    case when tr.publicado_por is null then null
                         when tr.dono = 'arkefit' then 'Equipe ArkeFit'
                         else 'Equipe da academia' end),
           tr.id
      from public.treinos tr where tr.aluno_id = _aluno_id
    union all
    select d.created_at, 'dieta_publicada', 'Dieta publicada: ' || d.titulo, null,
           coalesce((select p.full_name from public.profiles p where p.user_id = d.publicado_por),
                    case when d.publicado_por is null then null
                         when d.dono = 'arkefit' then 'Equipe ArkeFit'
                         else 'Equipe da academia' end),
           d.id
      from public.dietas d where d.aluno_id = _aluno_id
  ) h
  order by 1 desc
  limit least(greatest(coalesce(_limite, 100), 1), 500);
end;
$$;

comment on function public.get_historico_aluno(uuid, integer) is
  'Linha do tempo do aluno na ficha. Roda com a permissão de quem chama (security invoker): cada parte passa pelo RLS da tabela de origem, e a saúde fica com atende_saude().';

revoke execute on function public.get_historico_aluno(uuid, integer) from public, anon;
grant execute on function public.get_historico_aluno(uuid, integer) to authenticated;
