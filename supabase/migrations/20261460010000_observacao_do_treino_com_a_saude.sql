-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- A observação livre do fim do treino com a saúde (decidido em 10/11/2026).
-- "Ombro incomodou na terceira série" é saúde, como o esforço e a sensação, que o
-- #420 já levou para `registro_treino_bem_estar` (leitura de quem atende a saúde).
-- A observação ficou em `registro_treino`, que a recepção lê. Aqui ela ganha o
-- lugar novo e é copiada; o app novo grava só lá. A coluna antiga sai na migration
-- pós-deploy (20261461010000), depois de o app publicado parar de gravá-la.
alter table public.registro_treino_bem_estar add column if not exists observacao text
  check (observacao is null or length(observacao) <= 2000);

insert into public.registro_treino_bem_estar (registro_treino_id, organization_id, observacao)
select rt.id, rt.organization_id, rt.observacao
  from public.registro_treino rt
 where nullif(btrim(rt.observacao), '') is not null
on conflict (registro_treino_id) do update set observacao = excluded.observacao
 where public.registro_treino_bem_estar.observacao is null;

-- A ficha do mentor lê a observação do lugar novo. O resto é o mesmo de 20261452010000.
create or replace function public.get_ficha_mentor(_aluno_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_aluno public.alunos%rowtype;
  v jsonb;
  v_socio boolean;
begin
  if not public.equipe_metodo() then
    raise exception 'Apenas a ArkeFit abre a ficha do aluno do Método.' using errcode = '42501';
  end if;
  v_socio := public.acesso_arkefit('socio') or public.has_role(auth.uid(), 'admin_arke');

  select * into v_aluno from public.alunos where id = _aluno_id;
  if v_aluno.id is null then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;
  -- Aluno do Free é da academia: a ficha dele não abre aqui.
  if v_aluno.metodo_arke_status <> 'ativo' then
    raise exception 'Este aluno não está no Método ARKE.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'aluno', jsonb_build_object(
      'id', v_aluno.id,
      'nome', coalesce(p.full_name, 'Aluno'),
      'telefone', p.phone,
      'organization_id', v_aluno.organization_id,
      'organizacao_nome', o.nome,
      'plano', public.plano_do_aluno(v_aluno.metodo_arke_status, v_aluno.nivel_atacado),
      'fase', v_aluno.fase_jornada,
      'fase_desde', public.aluno_fase_desde(v_aluno.id),
      'metodo_desde', v_aluno.metodo_arke_ativado_em,
      'data_nascimento', v_aluno.data_nascimento,
      'situacao_academia', v_aluno.situacao_academia,
      'objetivo', v_aluno.objetivo,
      'meta_semanal_dias', v_aluno.meta_semanal_dias,
      'meta_agua_ml', v_aluno.meta_agua_ml,
      'mentor_id', v_aluno.mentor_id,
      'mentor_nome', coalesce(pm.full_name, um.email),
      'mentor_desde', v_aluno.mentor_desde,
      'progressao_bloqueada_em', pb.bloqueada_em,
      'progressao_bloqueada_motivo', pb.motivo,
      'dias_inativo', public.aluno_dias_inativo(v_aluno.id),
      'constancia', public.aluno_constancia(v_aluno.id, 4)
    ),
    'anamnese', (select to_jsonb(an) - 'organization_id' from public.anamnese_acolhimento an where an.aluno_id = v_aluno.id),
    'treino', (
      select jsonb_build_object('id', t.id, 'titulo', t.titulo, 'validade_inicio', t.validade_inicio,
                                'validade_fim', t.validade_fim, 'snapshot', t.snapshot_conteudo, 'dono', t.dono,
                                'prescritor_registro', t.prescritor_registro, 'publicado_em', t.created_at,
                                'publicado_por', coalesce(pt.full_name, 'equipe'))
        from public.treinos t left join public.profiles pt on pt.user_id = t.publicado_por
       where t.aluno_id = v_aluno.id and t.status = 'ativo'
       order by t.created_at desc limit 1
    ),
    'dieta', (
      select jsonb_build_object('id', d.id, 'titulo', d.titulo, 'snapshot', d.snapshot_conteudo,
                                'observacoes_gerais', d.observacoes_gerais, 'dono', d.dono,
                                'prescritor_registro', d.prescritor_registro, 'publicado_em', d.created_at,
                                'publicado_por', coalesce(pd.full_name, 'equipe'))
        from public.dietas d left join public.profiles pd on pd.user_id = d.publicado_por
       where d.aluno_id = v_aluno.id and d.status = 'ativo'
       order by d.created_at desc limit 1
    ),
    'checkins', coalesce((
      select jsonb_agg(c order by c.created_at desc)
        from (select ck.status, ck.comentario, ck.motivo_dificuldade, ck.data, ck.created_at
                from public.checkins ck where ck.aluno_id = v_aluno.id
               order by ck.created_at desc limit 12) c
    ), '[]'::jsonb),
    'treinos_registrados', coalesce((
      select jsonb_agg(r order by r.data desc)
        from (select rt.data, rt.divisao, rt.concluido, b.sensacao, b.esforco_percebido, rt.duracao_min, b.observacao
                from public.registro_treino rt
                left join public.registro_treino_bem_estar b on b.registro_treino_id = rt.id
               where rt.aluno_id = v_aluno.id and rt.data >= current_date - 28
               order by rt.data desc limit 40) r
    ), '[]'::jsonb),
    'adesao_dieta', coalesce((
      select jsonb_agg(x order by x.data desc)
        from (select da.data, da.adesao_percentual, da.agua_ml, da.consumiu_doce, da.consumiu_alcool, da.observacoes
                from public.dieta_adesao da
               where da.aluno_id = v_aluno.id and da.data >= current_date - 14
               order by da.data desc) x
    ), '[]'::jsonb),
    'avaliacoes', coalesce((
      select jsonb_agg(av order by av.data_avaliacao desc)
        from (select a2.data_avaliacao, a2.peso_kg, a2.altura_cm, a2.imc, a2.percentual_gordura,
                     a2.musculo_percentual, a2.perim_cintura, a2.perim_abdomen, a2.perim_quadril,
                     a2.dores_relatadas, a2.observacoes, a2.data_proxima_avaliacao
                from public.avaliacoes_fisicas a2 where a2.aluno_id = v_aluno.id
               order by a2.data_avaliacao desc limit 6) av
    ), '[]'::jsonb),
    'chamados', coalesce((
      select jsonb_agg(tk order by tk.sla_prazo)
        from (select tf.id, tf.tipo, tf.motivo, tf.prioridade, tf.status, tf.sla_prazo, tf.dono,
                     tf.sla_prazo < now() as atrasado
                from public.tarefas tf
               where tf.aluno_id = v_aluno.id and tf.status in ('aberta', 'em_andamento', 'aguardando')
                 and (v_socio or tf.dono = 'arkefit' or tf.tipo = 'instrucao_presencial')
               order by tf.sla_prazo limit 20) tk
    ), '[]'::jsonb)
  ) into v
  from public.organizations o
  left join public.profiles p on p.user_id = v_aluno.user_id
  left join public.profiles pm on pm.user_id = v_aluno.mentor_id
  left join auth.users um on um.id = v_aluno.mentor_id
  left join public.aluno_progressao_bloqueada pb on pb.aluno_id = v_aluno.id
  where o.id = v_aluno.organization_id;

  return v;
end;
$$;
