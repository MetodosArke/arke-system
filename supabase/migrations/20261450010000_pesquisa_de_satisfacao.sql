set lock_timeout = '5s';

-- A pesquisa de satisfação (NPS) no app do aluno (16/10/2026).
--
-- Decisão do responsável (15/10/2026), depois de comparar com o concorrente,
-- que vende "Pesquisas e feedbacks" como módulo pago: a pergunta "De 0 a 10,
-- quanto você recomendaria a <academia> a um amigo?" num cartão da home do
-- aluno, abaixo da Próxima Ação, e a nota de 0 a 6 vira pendência na fila, no
-- ciclo que a fila já cobra (motivo, responsável, prazo, ação, desfecho).
--
-- Quando perguntar mora na tela (src/lib/pesquisaSatisfacao.ts, com o teste ao
-- lado): a primeira vez 30 dias depois da matrícula, depois a cada 90 dias, e o
-- "Agora não" adia 7. O banco confere de novo, ao gravar, quem pode responder e
-- a janela (uma resposta por janela), com os mesmos números; o teste da tela
-- cobra que os dois lados digam o mesmo.
--
--   1. a tabela: a resposta, e o "Agora não" (nota nula), uma linha cada;
--   2. quem lê: só a gestão da academia. O aluno lê e grava a dele pelas
--      funções, que conferem quem chama. A recepção e o professor não leem: o
--      comentário é texto livre, e pode falar de alguém da equipe;
--   3. a tarefa "Avaliação baixa do aluno" na fila é só da gestão, pela mesma
--      razão (a regra mora no RLS, como a da saúde em 20261398010000);
--   4. a tarefa é da academia mesmo com o aluno no Método: a nota é sobre ela;
--   5. as funções do aluno;
--   6. a saída do aluno apaga o comentário e deixa a nota no NPS.
--
-- Ordem: 20261448010000 (o tipo novo de tarefa) antes desta, e o app depois
-- das duas (a tela chama as funções daqui).

-- ── 1. A tabela ────────────────────────────────────────────────────────────
create table if not exists public.pesquisa_satisfacao (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  nota smallint check (nota between 0 and 10),
  comentario text check (char_length(comentario) <= 500),
  created_at timestamptz not null default now(),
  check (nota is not null or comentario is null)
);

comment on table public.pesquisa_satisfacao is
  'Pesquisa de satisfação (NPS) do app do aluno: a resposta de 0 a 10, ou o "Agora não" (nota nula). Grava só pelas funções do aluno; a gestão lê.';
comment on column public.pesquisa_satisfacao.nota is
  'De 0 a 10. Nula quando o aluno tocou em "Agora não", que adia a pergunta 7 dias.';
comment on column public.pesquisa_satisfacao.comentario is
  'Texto livre do aluno, opcional. A saída do aluno (anonimizar_dados_do_aluno) apaga; a nota fica no NPS.';

create index if not exists idx_pesquisa_satisfacao_aluno on public.pesquisa_satisfacao (aluno_id, created_at);
create index if not exists idx_pesquisa_satisfacao_org on public.pesquisa_satisfacao (organization_id, created_at)
  where nota is not null;

-- ── 2. Quem lê ─────────────────────────────────────────────────────────────
alter table public.pesquisa_satisfacao enable row level security;

-- Uma regra só, a de leitura, da gestão. Sem inclusão, alteração e exclusão
-- pela API: grava quem responde, pelas funções do bloco 5. Sem a permissão, o
-- pedido é recusado (42501), em vez de responder 200 com zero linhas.
create policy "leitura" on public.pesquisa_satisfacao for select to authenticated
  using (public.has_org_role((select auth.uid()), organization_id, 'gestor'::public.app_role));

revoke insert, update, delete, truncate on public.pesquisa_satisfacao from anon, authenticated;
revoke select on public.pesquisa_satisfacao from anon;

-- Dado de pessoa: as duas etapas da gestão valem aqui também (20261363010000).
drop policy if exists "duas etapas" on public.pesquisa_satisfacao;
create policy "duas etapas" on public.pesquisa_satisfacao as restrictive for all to authenticated
  using ((select public.sessao_cumpre_duas_etapas()))
  with check ((select public.sessao_cumpre_duas_etapas()));

-- ── 3. A tarefa da nota baixa é só da gestão ───────────────────────────────
--
-- A tarefa mostra a nota e o comentário do aluno. Fica com a gestão, e não
-- com a recepção nem com o professor: o comentário é texto livre e pode falar
-- de alguém da equipe. O termo da equipe da academia (leitura, as duas metades
-- da alteração e a exclusão) ganha a condição "não é da gestão, ou quem pede é
-- a gestão", ao lado da condição da saúde. A inclusão fica como está.
create or replace function public.tarefa_da_gestao(_tipo text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(_tipo = any (array['avaliacao_baixa']), false);
$$;

comment on function public.tarefa_da_gestao(text) is
  'Os tipos de tarefa que só a gestão da academia lê (a avaliação baixa da pesquisa de satisfação, com o comentário do aluno). Ver a regra de leitura de tarefas.';

revoke execute on function public.tarefa_da_gestao(text) from public, anon;
grant execute on function public.tarefa_da_gestao(text) to authenticated, service_role;

-- O texto de 20261423010000, mais a condição da gestão.
alter policy "leitura" on public.tarefas
  using (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia'
      and (not public.tarefa_de_saude(tipo::text) or public.atende_saude(organization_id))
      and (not public.tarefa_da_gestao(tipo::text) or public.has_org_role((select auth.uid()), organization_id, 'gestor'::public.app_role)))
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
    or ((select public.acesso_arkefit('mentoria')) and dono = 'arkefit' and aluno_id is not null and public.aluno_no_metodo(aluno_id))
  );

alter policy "alteração" on public.tarefas
  using (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia'
      and (not public.tarefa_de_saude(tipo::text) or public.atende_saude(organization_id))
      and (not public.tarefa_da_gestao(tipo::text) or public.has_org_role((select auth.uid()), organization_id, 'gestor'::public.app_role)))
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
    or ((select public.acesso_arkefit('mentoria')) and dono = 'arkefit' and aluno_id is not null and public.aluno_no_metodo(aluno_id))
  )
  with check (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia'
      and (not public.tarefa_de_saude(tipo::text) or public.atende_saude(organization_id))
      and (not public.tarefa_da_gestao(tipo::text) or public.has_org_role((select auth.uid()), organization_id, 'gestor'::public.app_role)))
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
    or ((select public.acesso_arkefit('mentoria')) and dono = 'arkefit' and aluno_id is not null and public.aluno_no_metodo(aluno_id))
  );

alter policy "exclusão" on public.tarefas
  using (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia'
      and (not public.tarefa_de_saude(tipo::text) or public.atende_saude(organization_id))
      and (not public.tarefa_da_gestao(tipo::text) or public.has_org_role((select auth.uid()), organization_id, 'gestor'::public.app_role)))
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
    or ((select public.acesso_arkefit('mentoria')) and dono = 'arkefit' and aluno_id is not null and public.aluno_no_metodo(aluno_id))
  );

-- ── 4. A nota é sobre a academia, mesmo no Método ──────────────────────────
--
-- O texto de 20261245010000, mais `avaliacao_baixa` entre os tipos que são
-- sempre da academia. Sem isso, a nota baixa de um aluno do Método iria para a
-- fila do mentor da ArkeFit (`trg_definir_dono_da_tarefa`).
create or replace function public.dono_da_tarefa(_aluno_id uuid, _tipo tarefa_tipo)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when _tipo in ('cobranca', 'atestado', 'instrucao_presencial', 'equipamento', 'avaliacao_baixa') then 'academia'
           when exists (
             select 1 from public.alunos a
              where a.id = _aluno_id and a.metodo_arke_status = 'ativo'
           ) then 'arkefit'
           else 'academia'
         end;
$$;

-- ── 5. As funções do aluno ─────────────────────────────────────────────────
--
-- O que a home precisa para decidir se pergunta. Só devolve linha para o
-- próprio aluno. "Liberado" é a situação que deixa usar o app
-- (`situacao_permite_app`: o pausado sai na hora, o inadimplente depois dos 5
-- dias de tolerância, que é o bloqueio) e a matrícula ativa; quem não tem
-- matrícula no ARKE (a academia que cobra por fora) não é barrado por isso,
-- como na catraca (`matricula_encerrada`). A data da matrícula é a da ativa
-- mais recente, ou o início do aluno.
create or replace function public.pesquisa_satisfacao_do_aluno(_aluno_id uuid)
returns table (liberado boolean, data_matricula date, ultima_resposta date, ultimo_adiamento date)
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.situacao_permite_app(a.situacao_academia, a.situacao_academia_em)
           and a.anonimizado_em is null
           and (exists (select 1 from public.aluno_matriculas_academia m where m.aluno_id = a.id and m.status = 'ativa')
                or not exists (select 1 from public.aluno_matriculas_academia m where m.aluno_id = a.id)),
         coalesce(
           (select max(m.data_inicio) from public.aluno_matriculas_academia m where m.aluno_id = a.id and m.status = 'ativa'),
           a.data_inicio,
           a.created_at::date),
         (select max(p.created_at)::date from public.pesquisa_satisfacao p where p.aluno_id = a.id and p.nota is not null),
         (select max(p.created_at)::date from public.pesquisa_satisfacao p where p.aluno_id = a.id and p.nota is null)
    from public.alunos a
   where a.id = _aluno_id
     and a.user_id = (select auth.uid());
$$;

comment on function public.pesquisa_satisfacao_do_aluno(uuid) is
  'A situação da pesquisa de satisfação do próprio aluno (liberado, matrícula, última resposta e último "Agora não"), para a home decidir se pergunta.';

-- A resposta. Confere quem chama, a nota, o comentário e a janela (a mesma
-- conta de `devePerguntar`), e a nota de 0 a 6 abre a tarefa da gestão. A
-- linha do aluno fica travada até o fim: duas respostas ao mesmo tempo viram
-- uma só. A opinião é do aluno: em perfil simulado, a ArkeFit não responde
-- por ele.
create or replace function public.responder_pesquisa_satisfacao(_aluno_id uuid, _nota integer, _comentario text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
  v_estado record;
  v_comentario text := nullif(btrim(_comentario), '');
  v_id uuid;
begin
  if public.sessao_simulada() then
    raise exception 'Em perfil simulado, a pesquisa fica para o próprio aluno.' using errcode = '42501';
  end if;

  select a.organization_id into v_org
    from public.alunos a
   where a.id = _aluno_id and a.user_id = (select auth.uid())
     for update;
  if v_org is null then
    raise exception 'Só o próprio aluno responde a pesquisa dele.' using errcode = '42501';
  end if;

  if _nota is null or _nota < 0 or _nota > 10 then
    raise exception 'A nota vai de 0 a 10.' using errcode = 'P0001';
  end if;
  if char_length(v_comentario) > 500 then
    raise exception 'O comentário vai até 500 caracteres.' using errcode = 'P0001';
  end if;

  select * into v_estado from public.pesquisa_satisfacao_do_aluno(_aluno_id);
  if not v_estado.liberado
     or current_date < coalesce(v_estado.ultima_resposta + 90, v_estado.data_matricula + 30) then
    raise exception 'A pesquisa não está aberta para você agora.' using errcode = 'P0001';
  end if;

  insert into public.pesquisa_satisfacao (organization_id, aluno_id, nota, comentario)
  values (v_org, _aluno_id, _nota, v_comentario)
  returning id into v_id;

  -- Detrator: a pendência da gestão, com 2 dias úteis de prazo (sábado e
  -- domingo não contam). O comentário não vai no motivo: a fila o lê da
  -- resposta, para a saída do aluno apagá-lo de um lugar só.
  -- ponytail: sem feriado; um calendário de feriados entra quando a academia
  -- pedir.
  if _nota <= 6 then
    insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo, dono)
    values (
      v_org,
      _aluno_id,
      'Nota ' || _nota || ' de 10 para a academia na pesquisa de satisfação',
      'alta',
      (select d
         from generate_series(now() + interval '1 day', now() + interval '7 days', interval '1 day') d
        where extract(isodow from d) < 6
        order by d
       offset 1 limit 1),
      'avaliacao_baixa:' || v_id::text,
      'avaliacao_baixa',
      'academia'
    );
  end if;
end;
$$;

comment on function public.responder_pesquisa_satisfacao(uuid, integer, text) is
  'O aluno responde a pesquisa de satisfação (0 a 10, comentário opcional). Uma resposta por janela; a nota de 0 a 6 abre a tarefa "Avaliação baixa do aluno" da gestão.';

-- "Agora não": guarda o dia, e a home conta os 7 dias dele. Um por dia basta.
create or replace function public.adiar_pesquisa_satisfacao(_aluno_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
begin
  if public.sessao_simulada() then
    raise exception 'Em perfil simulado, a pesquisa fica para o próprio aluno.' using errcode = '42501';
  end if;

  select a.organization_id into v_org
    from public.alunos a
   where a.id = _aluno_id and a.user_id = (select auth.uid())
     for update;
  if v_org is null then
    raise exception 'Só o próprio aluno adia a pesquisa dele.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.pesquisa_satisfacao p
     where p.aluno_id = _aluno_id and p.nota is null and p.created_at >= current_date
  ) then
    insert into public.pesquisa_satisfacao (organization_id, aluno_id) values (v_org, _aluno_id);
  end if;
end;
$$;

comment on function public.adiar_pesquisa_satisfacao(uuid) is
  'O "Agora não" da pesquisa de satisfação: guarda o dia (um por dia), e a home volta a perguntar 7 dias depois.';

revoke execute on function public.pesquisa_satisfacao_do_aluno(uuid) from public, anon;
revoke execute on function public.responder_pesquisa_satisfacao(uuid, integer, text) from public, anon;
revoke execute on function public.adiar_pesquisa_satisfacao(uuid) from public, anon;
grant execute on function public.pesquisa_satisfacao_do_aluno(uuid) to authenticated;
grant execute on function public.responder_pesquisa_satisfacao(uuid, integer, text) to authenticated;
grant execute on function public.adiar_pesquisa_satisfacao(uuid) to authenticated;

-- ── 6. A saída do aluno ────────────────────────────────────────────────────
--
-- O texto de 20261339010000, mais o comentário da pesquisa: ele sai, e a nota
-- fica no NPS da academia, sem nome. É a regra da sugestão ao mentor: o texto
-- sai, o número fica.
create or replace function public.anonimizar_dados_do_aluno(_aluno_id uuid, _ator uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a public.alunos%rowtype;
  v_org_nome text;
  v_cpf text;
  v_outros boolean;
  v_avatar text;
  v_imagens text[];
begin
  select * into a from public.alunos where id = _aluno_id for update;
  if a.id is null then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;
  if a.anonimizado_em is not null then
    raise exception 'Este aluno já foi anonimizado.' using errcode = 'P0001';
  end if;

  select o.nome into v_org_nome from public.organizations o where o.id = a.organization_id;
  select p.cpf, p.avatar_url into v_cpf, v_avatar from public.profiles p where p.user_id = a.user_id;
  v_outros := public.pessoa_tem_outro_vinculo(_aluno_id);

  -- 1. A marca primeiro: o gatilho tira a digital e o rosto dos equipamentos
  --    e limpa o número da catraca. Depois, o que identifica na ficha.
  update public.alunos
     set anonimizado_em = now(),
         objetivo = null,
         observacoes = null,
         data_nascimento = null,
         altura_cm = null,
         peso_kg = null,
         situacao_academia_motivo = null,
         progressao_bloqueada_motivo = null
   where id = _aluno_id;

  -- 2. Autorizações: revogadas. A revogação da IA apaga o que a IA gerou; o
  --    termo da digital fica como prova.
  update public.aluno_consentimento_ia
     set revogado_em = now(), revogado_por = _ator
   where aluno_id = _aluno_id and revogado_em is null;
  update public.aluno_consentimento_biometrico
     set revogado_em = now(), revogado_por = _ator
   where aluno_id = _aluno_id and revogado_em is null;

  -- 3. Saúde e acompanhamento: o conteúdo sai. Da anamnese fica só a prova
  --    do consentimento (quando e qual versão).
  update public.anamnese_acolhimento
     set rotina_diaria = null, objetivo_principal = null, experiencias_exercicio = null,
         dores_lesoes = null, medicamentos = null, tempo_disponivel = null, estilo_treino = null,
         alimentos_gosta = null, alimentos_nao_gosta = null, alimentacao_rotina = null,
         expectativas = null, qualidade_sono = null, nivel_estresse = null,
         frequencia_semanal_desejada = null
   where aluno_id = _aluno_id;
  delete from public.aluno_parq where aluno_id = _aluno_id;
  delete from public.avaliacoes_fisicas where aluno_id = _aluno_id;
  delete from public.aluno_objetivos where aluno_id = _aluno_id;
  delete from public.aluno_observacoes where aluno_id = _aluno_id;
  delete from public.aluno_valores where aluno_id = _aluno_id;
  delete from public.aluno_rotina_semanal where aluno_id = _aluno_id;
  delete from public.aluno_fase_historico where aluno_id = _aluno_id;
  delete from public.checkins where aluno_id = _aluno_id;
  delete from public.compromisso_semanal where aluno_id = _aluno_id;
  delete from public.metricas_customizadas where aluno_id = _aluno_id;
  delete from public.sentinela_anamnese where aluno_id = _aluno_id;
  -- A sugestão ao mentor perde o texto e fica: ela mede o trabalho do mentor,
  -- que é outra pessoa (a mesma regra da revogação, migration 20261231).
  update public.sentinela_sugestoes
     set sugestao = '[removido a pedido do aluno]'
   where aluno_id = _aluno_id and sugestao <> '[removido a pedido do aluno]';
  -- A nota da pesquisa de satisfação fica no NPS, sem o comentário (20261450010000).
  update public.pesquisa_satisfacao
     set comentario = null
   where aluno_id = _aluno_id and comentario is not null;
  delete from public.fotos_rosto_pendentes where aluno_id = _aluno_id;
  delete from public.registro_treino where aluno_id = _aluno_id;
  delete from public.registro_habito where aluno_id = _aluno_id;
  delete from public.treino_calendario where aluno_id = _aluno_id;
  delete from public.treinos where aluno_id = _aluno_id;
  delete from public.dieta_adesao where aluno_id = _aluno_id;
  delete from public.dietas where aluno_id = _aluno_id;
  delete from public.agendamentos where aluno_id = _aluno_id;
  delete from public.desafio_progresso where aluno_id = _aluno_id;
  delete from public.desafio_participantes where aluno_id = _aluno_id;
  delete from public.competicao_participantes where aluno_id = _aluno_id;

  -- 4. As conversas, dos dois lados.
  delete from public.mensagens_treino where aluno_id = _aluno_id;
  delete from public.mensagens_dieta where aluno_id = _aluno_id;
  delete from public.mensagens_mentor where aluno_id = _aluno_id;

  -- 5. O que identifica em registro que fica.
  update public.aluno_assinaturas_contrato
     set nome_digitado = 'Aluno anonimizado', user_agent = null
   where aluno_id = _aluno_id;
  update public.acessos_catraca_logs
     set cpf_consultado = null
   where aluno_id = _aluno_id and cpf_consultado is not null;
  if v_cpf is not null and length(regexp_replace(v_cpf, '\D', '', 'g')) = 11 then
    update public.importacoes_alunos_linhas
       set dados = jsonb_build_object('anonimizado', true), mensagem = null
     where organization_id = a.organization_id
       and (user_id_criado = a.user_id
            or regexp_replace(coalesce(dados ->> 'cpf', ''), '\D', '', 'g') = regexp_replace(v_cpf, '\D', '', 'g'));
  else
    update public.importacoes_alunos_linhas
       set dados = jsonb_build_object('anonimizado', true), mensagem = null
     where organization_id = a.organization_id and user_id_criado = a.user_id;
  end if;

  -- 6. O feed desta academia. As fotos ficam num bucket público: a edge
  --    function apaga os arquivos pela lista devolvida.
  select coalesce(array_agg(fp.image_url) filter (where fp.image_url is not null), '{}')
    into v_imagens
    from public.feed_posts fp
   where fp.user_id = a.user_id and fp.organization_id = a.organization_id;
  delete from public.feed_comments where user_id = a.user_id and organization_id = a.organization_id;
  delete from public.feed_likes where user_id = a.user_id and organization_id = a.organization_id;
  delete from public.feed_posts where user_id = a.user_id and organization_id = a.organization_id;

  -- 7. O vínculo desta academia. Com o vínculo inativo, a equipe daqui deixa
  --    de enxergar o perfil da pessoa (regra de leitura de `profiles`).
  update public.organization_members
     set status = 'inactive'
   where user_id = a.user_id and organization_id = a.organization_id and role = 'aluno';

  -- 8. O perfil é da pessoa. Só é anonimizado quando ela não tem vínculo vivo
  --    em outro lugar; senão, a outra academia perderia o cadastro dela.
  if not v_outros then
    update public.profiles
       set full_name = 'Pessoa anonimizada', cpf = null, phone = null, avatar_url = null,
           cep = null, logradouro = null, endereco_numero = null, complemento = null,
           bairro = null, cidade = null, uf = null, status = 'inactive'
     where user_id = a.user_id;
  end if;

  perform public.registrar_auditoria(
    _ator, 'aluno.anonimizado', 'aluno', _aluno_id, v_org_nome,
    jsonb_build_object('outros_vinculos', v_outros));

  return jsonb_build_object(
    'user_id', a.user_id,
    'organization_id', a.organization_id,
    'outros_vinculos', v_outros,
    'avatar_url', case when v_outros then null else v_avatar end,
    'imagens_feed', to_jsonb(v_imagens));
end;
$$;

revoke execute on function public.anonimizar_dados_do_aluno(uuid, uuid) from public, anon, authenticated;
grant execute on function public.anonimizar_dados_do_aluno(uuid, uuid) to service_role;
