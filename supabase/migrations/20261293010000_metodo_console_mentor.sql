-- Método ARKE, fase 3: o console do mentor (28/09/2026).
--
-- A fase 1 deu ao mentor a posse de treino, dieta, anamnese, metas e jornada
-- do aluno do Método. Esta dá a ele onde trabalhar: a carteira, a ficha do
-- aluno, a biblioteca de modelos do Método e as metas.
--
-- E muda uma coisa da fase 1, por decisão do responsável: o CREF e o CRN
-- continuam sendo cadastrados, mas por enquanto não são exigidos para
-- publicar. A exigência volta quando o console estiver pronto e testado, pelo
-- interruptor `exigir_registro_metodo` em plataforma_config — sem migration.

-- ---------------------------------------------------------------------------
-- 1. O interruptor do registro profissional
-- ---------------------------------------------------------------------------

insert into public.plataforma_config (chave, valor, descricao)
values (
  'exigir_registro_metodo',
  0,
  'Método ARKE: 1 exige CREF para publicar treino e CRN para publicar dieta; 0 aceita qualquer pessoa da equipe da ArkeFit (fase de desenvolvimento).'
)
on conflict (chave) do nothing;

create or replace function public.registro_metodo_exigido()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select valor = 1 from public.plataforma_config where chave = 'exigir_registro_metodo'), true);
$$;

-- Sem a linha, a exigência vale: esquecer a configuração não pode abrir a porta.
comment on function public.registro_metodo_exigido() is
  'Se o CREF/CRN é exigido para prescrever no Método. Sem a configuração, exige.';

create or replace function public.pode_prescrever_treino_metodo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.equipe_metodo() and (
    not public.registro_metodo_exigido()
    or exists (
      select 1 from public.equipe_arkefit e
       where e.user_id = auth.uid() and e.ativo and nullif(btrim(e.cref), '') is not null
    )
  );
$$;

create or replace function public.pode_prescrever_dieta_metodo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.equipe_metodo() and (
    not public.registro_metodo_exigido()
    or exists (
      select 1 from public.equipe_arkefit e
       where e.user_id = auth.uid() and e.ativo and nullif(btrim(e.crn), '') is not null
    )
  );
$$;

create or replace function public.definir_dono_da_prescricao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_metodo boolean;
  v_registro text;
begin
  select a.organization_id, a.metodo_arke_status = 'ativo'
    into v_org, v_metodo
    from public.alunos a
   where a.id = new.aluno_id;

  if v_org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'no_data_found';
  end if;
  if new.organization_id is distinct from v_org then
    raise exception 'A prescrição tem de ser da organização do aluno.' using errcode = '22023';
  end if;

  if not v_metodo then
    new.dono := 'academia';
    new.prescritor_registro := null;
    return new;
  end if;

  -- O registro é gravado sempre que existe, mesmo com a exigência desligada:
  -- a prescrição é imutável e deve dizer quem assinou.
  select case when tg_table_name = 'treinos' then nullif(btrim(e.cref), '') else nullif(btrim(e.crn), '') end
    into v_registro
    from public.equipe_arkefit e
   where e.user_id = auth.uid() and e.ativo;

  if auth.uid() is null
     or not public.equipe_metodo()
     or (public.registro_metodo_exigido() and v_registro is null) then
    raise exception using
      errcode = '42501',
      message = case when tg_table_name = 'treinos'
        then 'Este aluno está no Método ARKE: o treino é prescrito pela equipe da ArkeFit, por um profissional com CREF.'
        else 'Este aluno está no Método ARKE: a dieta é prescrita pela equipe da ArkeFit, por um profissional com CRN.'
      end;
  end if;

  new.dono := 'arkefit';
  new.prescritor_registro := v_registro;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A biblioteca do Método
-- ---------------------------------------------------------------------------
--
-- Modelos que só a ArkeFit vê: é a metodologia dela. Moram nas mesmas tabelas
-- dos modelos da academia, para `publicar_treino` e `publicar_dieta` servirem
-- aos dois sem uma segunda cópia do snapshot. O modelo do Método não tem
-- organização (é da plataforma, como o exercício global do acervo), e a
-- restrição garante que as duas coisas andam juntas.
alter table public.modelos_treino
  add column biblioteca text not null default 'academia',
  alter column organization_id drop not null,
  add constraint modelos_treino_biblioteca_valida check (
    (biblioteca = 'academia' and organization_id is not null)
    or (biblioteca = 'metodo' and organization_id is null)
  );

alter table public.modelos_dieta
  add column biblioteca text not null default 'academia',
  alter column organization_id drop not null,
  add constraint modelos_dieta_biblioteca_valida check (
    (biblioteca = 'academia' and organization_id is not null)
    or (biblioteca = 'metodo' and organization_id is null)
  );

create index modelos_treino_metodo_idx on public.modelos_treino (titulo) where biblioteca = 'metodo';
create index modelos_dieta_metodo_idx on public.modelos_dieta (titulo) where biblioteca = 'metodo';

-- Cada tabela já tinha uma regra só (FOR ALL); a condição do Método entra
-- nela, e não numa regra a mais.
alter policy "staff da org gerencia modelos de treino" on public.modelos_treino
  using (
    is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke')
    or (biblioteca = 'metodo' and public.equipe_metodo())
  )
  with check (
    is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke')
    or (biblioteca = 'metodo' and public.equipe_metodo())
  );

alter policy "staff da org gerencia exercícios de modelos de treino" on public.modelo_treino_exercicios
  using (exists (
    select 1 from public.modelos_treino m
     where m.id = modelo_treino_exercicios.modelo_id
       and (is_org_staff((select auth.uid()), m.organization_id)
            or has_role((select auth.uid()), 'admin_arke')
            or (m.biblioteca = 'metodo' and public.equipe_metodo()))
  ))
  with check (exists (
    select 1 from public.modelos_treino m
     where m.id = modelo_treino_exercicios.modelo_id
       and (is_org_staff((select auth.uid()), m.organization_id)
            or has_role((select auth.uid()), 'admin_arke')
            or (m.biblioteca = 'metodo' and public.equipe_metodo()))
  ));

alter policy "staff da org gerencia modelos de dieta" on public.modelos_dieta
  using (
    is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke')
    or (biblioteca = 'metodo' and public.equipe_metodo())
  )
  with check (
    is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke')
    or (biblioteca = 'metodo' and public.equipe_metodo())
  );

alter policy "staff da org gerencia refeições de modelos de dieta" on public.modelo_dieta_refeicoes
  using (exists (
    select 1 from public.modelos_dieta m
     where m.id = modelo_dieta_refeicoes.modelo_id
       and (is_org_staff((select auth.uid()), m.organization_id)
            or has_role((select auth.uid()), 'admin_arke')
            or (m.biblioteca = 'metodo' and public.equipe_metodo()))
  ))
  with check (exists (
    select 1 from public.modelos_dieta m
     where m.id = modelo_dieta_refeicoes.modelo_id
       and (is_org_staff((select auth.uid()), m.organization_id)
            or has_role((select auth.uid()), 'admin_arke')
            or (m.biblioteca = 'metodo' and public.equipe_metodo()))
  ));

-- ---------------------------------------------------------------------------
-- 3. A carteira: cada aluno do Método tem um mentor responsável
-- ---------------------------------------------------------------------------
alter table public.alunos
  add column mentor_id uuid references auth.users(id) on delete set null,
  add column mentor_desde timestamptz;

create index alunos_mentor_idx on public.alunos (mentor_id) where mentor_id is not null;

-- A academia tem regra de alteração em `alunos`; o mentor responsável não é
-- dela. Só a ArkeFit troca, e só pela função abaixo.
create or replace function public.proteger_mentor_do_aluno()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.mentor_id is distinct from old.mentor_id or new.mentor_desde is distinct from old.mentor_desde)
     and auth.uid() is not null
     and not public.equipe_metodo() then
    raise exception 'O mentor responsável é definido pela ArkeFit.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_proteger_mentor_do_aluno
  before update of mentor_id, mentor_desde on public.alunos
  for each row execute function public.proteger_mentor_do_aluno();

revoke execute on function public.proteger_mentor_do_aluno() from public, anon, authenticated;

create or replace function public.atribuir_mentor_aluno(_aluno_id uuid, _mentor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.equipe_metodo() then
    raise exception 'Só a equipe da ArkeFit define o mentor.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.alunos a where a.id = _aluno_id and a.metodo_arke_status = 'ativo') then
    raise exception 'O aluno não está no Método ARKE.' using errcode = '22023';
  end if;
  if _mentor_id is not null and not exists (
    select 1 from public.user_roles r where r.user_id = _mentor_id and r.role in ('superadmin', 'admin_arke')
  ) then
    raise exception 'Essa conta não é da equipe da ArkeFit.' using errcode = '22023';
  end if;
  if _mentor_id is not null and exists (
    select 1 from public.equipe_arkefit e where e.user_id = _mentor_id and not e.ativo
  ) then
    raise exception 'Essa pessoa está inativa na equipe.' using errcode = '22023';
  end if;

  update public.alunos
     set mentor_id = _mentor_id,
         mentor_desde = case when _mentor_id is null then null else now() end
   where id = _aluno_id
     and mentor_id is distinct from _mentor_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Metas pelo mentor
-- ---------------------------------------------------------------------------
--
-- A ArkeFit não tem regra de alteração em `alunos` (e não deve ter: a tabela
-- é o cadastro da academia). As metas do aluno do Método passam por aqui.
create or replace function public.definir_metas_aluno_metodo(
  _aluno_id uuid,
  _objetivo text,
  _meta_semanal_dias integer,
  _meta_agua_ml integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.equipe_metodo() then
    raise exception 'Só a equipe da ArkeFit define as metas do aluno do Método.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.alunos a where a.id = _aluno_id and a.metodo_arke_status = 'ativo') then
    raise exception 'O aluno não está no Método ARKE.' using errcode = '22023';
  end if;
  if _meta_semanal_dias is null or _meta_semanal_dias not between 1 and 7 then
    raise exception 'A meta de treino deve ficar entre 1 e 7 dias.' using errcode = '22023';
  end if;
  if _meta_agua_ml is null or _meta_agua_ml not between 500 and 8000 then
    raise exception 'A meta de água deve ficar entre 500 e 8000 ml.' using errcode = '22023';
  end if;

  update public.alunos
     set objetivo = nullif(btrim(_objetivo), ''),
         meta_semanal_dias = _meta_semanal_dias,
         meta_agua_ml = _meta_agua_ml
   where id = _aluno_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A carteira na tela: o que pede atenção vem primeiro
-- ---------------------------------------------------------------------------
create or replace function public.get_carteira_mentor(_limite integer default 500)
returns table (
  aluno_id uuid,
  aluno_nome text,
  organization_id uuid,
  organizacao_nome text,
  plano text,
  fase public.fase_jornada,
  mentor_id uuid,
  mentor_nome text,
  situacao_academia text,
  dias_inativo integer,
  constancia numeric,
  anamnese_concluida boolean,
  treino_ativo boolean,
  treino_validade_fim date,
  dieta_ativa boolean,
  progressao_bloqueada boolean,
  chamados_abertos bigint,
  chamados_atrasados bigint,
  nao_lidas bigint,
  atencao text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.equipe_metodo() then
    raise exception 'Apenas a ArkeFit acessa a carteira do Método.' using errcode = '42501';
  end if;

  return query
  with base as (
    select a.id, a.organization_id, a.user_id, a.metodo_arke_status, a.nivel_atacado, a.fase_jornada,
           a.mentor_id, a.situacao_academia::text as situacao, a.progressao_bloqueada_em
      from public.alunos a
     where a.metodo_arke_status = 'ativo' and a.anonimizado_em is null
  ),
  sinais as (
    select b.*,
           exists (select 1 from public.anamnese_acolhimento an where an.aluno_id = b.id and an.concluida_em is not null) as tem_anamnese,
           t.id is not null as tem_treino,
           t.validade_fim,
           exists (select 1 from public.dietas d where d.aluno_id = b.id and d.status = 'ativo') as tem_dieta,
           (select count(*) from public.tarefas tf
             where tf.aluno_id = b.id and tf.dono = 'arkefit' and tf.status in ('aberta', 'em_andamento')) as abertos,
           (select count(*) from public.tarefas tf
             where tf.aluno_id = b.id and tf.dono = 'arkefit' and tf.status in ('aberta', 'em_andamento')
               and tf.sla_prazo < now()) as atrasados,
           (select count(*) from public.mensagens_mentor m
             where m.aluno_id = b.id and m.remetente_tipo = 'aluno' and not m.lida) as pendentes
      from base b
      left join lateral (
        select tr.id, tr.validade_fim from public.treinos tr
         where tr.aluno_id = b.id and tr.status = 'ativo'
         order by tr.created_at desc limit 1
      ) t on true
  ),
  marcados as (
    select s.*,
           array_remove(array[
             case when not s.tem_anamnese then 'anamnese' end,
             case when s.tem_anamnese and not s.tem_treino then 'sem_treino' end,
             case when s.tem_anamnese and not s.tem_dieta then 'sem_dieta' end,
             case when s.progressao_bloqueada_em is not null then 'dor' end,
             case when s.atrasados > 0 then 'chamado_atrasado' end,
             case when s.pendentes > 0 then 'mensagem' end,
             case when s.validade_fim is not null and s.validade_fim <= current_date + 7 then 'treino_vencendo' end,
             case when s.mentor_id is null then 'sem_mentor' end
           ], null) as flags
      from sinais s
  ),
  ordenados as (
    select m.*
      from marcados m
     order by
       -- O que trava o aluno vem antes do que só pede atenção.
       (not m.tem_anamnese or not m.tem_treino or m.progressao_bloqueada_em is not null or m.atrasados > 0) desc,
       cardinality(m.flags) desc,
       m.pendentes desc
     limit greatest(coalesce(_limite, 500), 1)
  )
  select o.id,
         coalesce(p.full_name, 'Aluno'),
         o.organization_id,
         org.nome,
         public.plano_do_aluno(o.metodo_arke_status, o.nivel_atacado),
         o.fase_jornada,
         o.mentor_id,
         coalesce(pm.full_name, um.email)::text,
         o.situacao,
         public.aluno_dias_inativo(o.id),
         public.aluno_constancia(o.id, 4),
         o.tem_anamnese,
         o.tem_treino,
         o.validade_fim,
         o.tem_dieta,
         o.progressao_bloqueada_em is not null,
         o.abertos,
         o.atrasados,
         o.pendentes,
         o.flags
    from ordenados o
    join public.organizations org on org.id = o.organization_id
    left join public.profiles p on p.user_id = o.user_id
    left join public.profiles pm on pm.user_id = o.mentor_id
    left join auth.users um on um.id = o.mentor_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. A ficha do aluno para o mentor, numa chamada só
-- ---------------------------------------------------------------------------
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
begin
  if not public.equipe_metodo() then
    raise exception 'Apenas a ArkeFit abre a ficha do aluno do Método.' using errcode = '42501';
  end if;

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
      'progressao_bloqueada_em', v_aluno.progressao_bloqueada_em,
      'progressao_bloqueada_motivo', v_aluno.progressao_bloqueada_motivo,
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
        from (select rt.data, rt.divisao, rt.concluido, rt.sensacao, rt.esforco_percebido, rt.duracao_min, rt.observacao
                from public.registro_treino rt
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
               order by tf.sla_prazo limit 20) tk
    ), '[]'::jsonb)
  ) into v
  from public.organizations o
  left join public.profiles p on p.user_id = v_aluno.user_id
  left join public.profiles pm on pm.user_id = v_aluno.mentor_id
  left join auth.users um on um.id = v_aluno.mentor_id
  where o.id = v_aluno.organization_id;

  return v;
end;
$$;

revoke execute on function public.registro_metodo_exigido() from public, anon;
revoke execute on function public.atribuir_mentor_aluno(uuid, uuid) from public, anon;
revoke execute on function public.definir_metas_aluno_metodo(uuid, text, integer, integer) from public, anon;
revoke execute on function public.get_carteira_mentor(integer) from public, anon;
revoke execute on function public.get_ficha_mentor(uuid) from public, anon;
grant execute on function public.registro_metodo_exigido() to authenticated, service_role;
grant execute on function public.atribuir_mentor_aluno(uuid, uuid) to authenticated;
grant execute on function public.definir_metas_aluno_metodo(uuid, text, integer, integer) to authenticated;
grant execute on function public.get_carteira_mentor(integer) to authenticated;
grant execute on function public.get_ficha_mentor(uuid) to authenticated;
