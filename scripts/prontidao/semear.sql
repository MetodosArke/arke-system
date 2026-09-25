  -- ===== Semente: 50 academias × 400 alunos, um mês de uso. Tudo some no rollback. =====
  -- CPF válido pelo mesmo cálculo do banco (módulo 11), a partir de um número de 9 dígitos.
  execute $f$create function pg_temp.cpf_sim(n bigint) returns text language plpgsql as $b$
    declare c text := lpad(n::text, 9, '0'); s int := 0; d1 int; d2 int; i int;
    begin
      for i in 1..9 loop s := s + substr(c, i, 1)::int * (11 - i); end loop;
      d1 := (s * 10) % 11; if d1 >= 10 then d1 := 0; end if;
      c := c || d1; s := 0;
      for i in 1..10 loop s := s + substr(c, i, 1)::int * (12 - i); end loop;
      d2 := (s * 10) % 11; if d2 >= 10 then d2 := 0; end if;
      return c || d2;
    end $b$$f$;

  create temp table sim_orgs on commit drop as
    select gen_random_uuid() as id, g as i, gen_random_uuid() as plano, gen_random_uuid() as catraca, gen_random_uuid() as gestor
      from generate_series(1, {ORGS}) g;
  insert into public.organizations (id, nome, slug, plano_b2b, status, limite_alunos, tipo, onboarding_completed, repasse_tipo, repasse_valor)
    select id, 'Carga ' || i, 'carga-sim-' || i || '-' || substr(md5(random()::text), 1, 6), 'enterprise', 'ativo', 2000, 'academia', true, 'fixo', 45 from sim_orgs;
  insert into public.planos_academia (id, organization_id, nome, periodicidade, valor, ativo)
    select plano, id, 'Mensal', 'mensal', 129.90, true from sim_orgs;
  insert into public.organizacao_catracas (id, organization_id, nome, status, ultimo_heartbeat_em)
    select catraca, id, 'Entrada', 'ativo', now() from sim_orgs;

  -- gestores e um Super Admin
  insert into auth.users (id, email, aud, role, created_at, updated_at, instance_id, raw_user_meta_data)
    select gestor, 'carga.gestor.' || i || '@sim.invalid', 'authenticated', 'authenticated', now(), now(), '00000000-0000-0000-0000-000000000000',
           jsonb_build_object('full_name', 'Gestor ' || i) from sim_orgs;
  insert into public.organization_members (organization_id, user_id, role) select id, gestor, 'gestor' from sim_orgs;
  v_sa := gen_random_uuid();
  insert into auth.users (id, email, aud, role, created_at, updated_at, instance_id)
    values (v_sa, 'carga.sa@sim.invalid', 'authenticated', 'authenticated', now(), now(), '00000000-0000-0000-0000-000000000000');
  insert into public.user_roles (user_id, role) values (v_sa, 'superadmin');

  -- alunos: perfil 0-0,7 treina, 0,7-0,9 está sumindo, 0,9-1 parou
  create temp table sim_alunos on commit drop as
    select gen_random_uuid() as uid, gen_random_uuid() as aid, o.id as org, o.i as oi, g as j, o.plano, o.catraca,
           random() as p, 5 + floor(random() * 15)::int as sumiu, gen_random_uuid() as mat
      from sim_orgs o cross join generate_series(1, {ALUNOS}) g;
  insert into auth.users (id, email, aud, role, created_at, updated_at, instance_id, raw_user_meta_data)
    select uid, 'carga.' || oi || '.' || j || '@sim.invalid', 'authenticated', 'authenticated', now(), now(), '00000000-0000-0000-0000-000000000000',
           jsonb_build_object('full_name', 'Aluno ' || oi || '-' || j) from sim_alunos;
  update public.profiles p set cpf = pg_temp.cpf_sim(100000000 + a.oi * 1000 + a.j), phone = '119' || lpad((a.oi * 10000 + a.j)::text, 8, '0')
    from sim_alunos a where p.user_id = a.uid;
  insert into public.organization_members (organization_id, user_id, role) select org, uid, 'aluno' from sim_alunos;
  insert into public.alunos (id, organization_id, user_id, meta_semanal_dias, fase_jornada, primeiro_acesso_em, metodo_arke_status, nivel_atacado,
                             situacao_academia, situacao_academia_em, ultima_atividade_em, data_inicio, identificador_catraca)
    select aid, org, uid, 3,
           (array['mapa','base','rota','apex','legado'])[1 + (j % 5)]::public.fase_jornada,
           case when p < 0.95 then now() - ((30 + (j % 150)) || ' days')::interval end,
           case when j % 5 = 0 then 'ativo' else 'sem_adesao' end::public.metodo_arke_status,
           case when j % 10 = 0 then 'elite' else 'integrado' end::public.nivel_atacado,
           case when p > 0.97 then 'pausado' when p > 0.94 then 'inadimplente' else 'em_dia' end::public.situacao_aluno_academia,
           now() - interval '20 days',
           case when p < 0.7 then now() - interval '1 day' when p < 0.9 then now() - (sumiu || ' days')::interval end,
           current_date - (30 + (j % 150)),
           (oi * 10000 + j)::text
      from sim_alunos;

  -- um mês de presença, treino e check-in
  insert into public.acessos_catraca_logs (organization_id, catraca_id, aluno_id, resultado, created_at, giro)
    select a.org, a.catraca, a.aid, 'liberado', (current_date - d) + time '18:00', 'confirmado'
      from sim_alunos a cross join generate_series(0, 13) d
     where (a.p < 0.7 and random() < 0.4) or (a.p >= 0.7 and a.p < 0.9 and d > a.sumiu and random() < 0.4);
  insert into public.presencas (organization_id, aluno_id, dia, registrada_em, origem)
    select a.org, a.aid, current_date - d, (current_date - d) + time '18:00', 'catraca'
      from sim_alunos a cross join generate_series(14, 29) d
     where (a.p < 0.7 and random() < 0.4) or (a.p >= 0.7 and a.p < 0.9 and d > a.sumiu and random() < 0.4);
  insert into public.registro_treino (organization_id, aluno_id, data, concluido, divisao, sensacao, duracao_min)
    select organization_id, aluno_id, dia, true, 'A', case when random() < 0.01 then 'dor' else 'bom' end, 55
      from public.presencas pr where pr.organization_id in (select id from sim_orgs) and random() < 0.7;
  insert into public.checkins (organization_id, aluno_id, status, data)
    select organization_id, aluno_id, (array['funcionando_bem','funcionando_bem','preciso_ajuste','com_dificuldade'])[1 + floor(random() * 4)]::public.checkin_status, dia
      from public.presencas pr where pr.organization_id in (select id from sim_orgs) and random() < 0.2;

  -- matrícula e duas mensalidades por aluno
  insert into public.aluno_matriculas_academia (id, organization_id, aluno_id, plano_id, valor_cobrado, data_inicio, dia_vencimento, status)
    select mat, org, aid, plano, 129.90, current_date - 60, 10, 'ativa' from sim_alunos where p <= 0.97;
  insert into public.mensalidades (organization_id, matricula_id, aluno_id, competencia, valor, vencimento, status, data_pagamento)
    select org, mat, aid, date_trunc('month', current_date - interval '1 month')::date, 129.90, date_trunc('month', current_date - interval '1 month')::date + 9, 'confirmado',
           date_trunc('month', current_date - interval '1 month')::date + 9
      from sim_alunos where p <= 0.97;
  insert into public.mensalidades (organization_id, matricula_id, aluno_id, competencia, valor, vencimento, status, data_pagamento)
    select org, mat, aid, date_trunc('month', current_date)::date, 129.90, date_trunc('month', current_date)::date + 9,
           case when p > 0.94 then 'atrasado' else 'confirmado' end::public.status_mensalidade,
           case when p <= 0.94 then date_trunc('month', current_date)::date + 9 end
      from sim_alunos where p <= 0.97;

  -- fila: tarefas abertas dos que sumiram, e histórico fechado
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, status, sla_prazo, origem_evento, tipo, dono, created_at)
    select org, aid, 'Sumiu', 'alta', 'aberta', now() + interval '4 hours', 'sim:' || aid, 'inercia', case when j % 5 = 0 then 'arkefit' else 'academia' end, now() - interval '2 hours'
      from sim_alunos where p >= 0.7 and p < 0.9;
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, status, sla_prazo, origem_evento, tipo, dono, created_at, concluida_em, desfecho_acao)
    select a.org, a.aid, 'Histórico', 'media', 'concluida', now() - (k || ' days')::interval, 'sim:h:' || a.aid || ':' || k, 'barreira',
           case when a.j % 5 = 0 then 'arkefit' else 'academia' end, now() - (k || ' days')::interval - interval '5 hours', now() - (k || ' days')::interval, 'Resolvido'
      from sim_alunos a cross join generate_series(1, 2) k where a.j % 4 = 0;

  analyze public.organizations; analyze public.alunos; analyze public.profiles; analyze public.organization_members; analyze auth.users;
  analyze public.presencas; analyze public.registro_treino; analyze public.checkins; analyze public.acessos_catraca_logs;
  analyze public.aluno_matriculas_academia; analyze public.mensalidades; analyze public.tarefas;
