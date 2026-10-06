-- Auditoria de prontidão, rodada 1: a saída do aluno (06/10/2026).
--
-- Decisão do responsável (D1, a recomendada): excluir de vez só em academia
-- em teste; para um aluno real, a saída encerra só o vínculo daquela
-- academia, e a conta da pessoa só sai quando não restar vínculo nenhum.
--
-- O que estava errado (auditoria de 05/10):
-- - `excluir-aluno` apagava a CONTA (auth.users). A cascata levava as
--   matrículas, mensalidades, presenças, treinos e a anamnese da pessoa em
--   TODAS as academias, e os pagamentos do Método, que são receita da ArkeFit.
--   O botão aparecia para todo gestor em produção.
-- - `anonimizar-aluno` trocava o e-mail de login e o perfil, que são da
--   pessoa, e cortava o acesso dela em todas as academias. E anonimizava
--   pouco: nome, CPF e telefone. Ficavam endereço, nascimento, peso,
--   observações, anamnese, avaliações, mensagens, o nome na assinatura do
--   contrato, o CPF nos registros da catraca e nas linhas da importação, as
--   fotos do feed e o resumo da IA.
--
-- As duas funções abaixo fazem o trabalho do banco numa transação só. A
-- edge function cuida do que mora fora do banco: o Asaas antes, e o login e
-- os arquivos depois. Nenhuma das duas é chamável por usuário logado.

set lock_timeout = '5s';

-- A pessoa tem outro vínculo vivo fora deste aluno? Outra matrícula não
-- anonimizada, ou um vínculo ativo que não seja o de aluno desta academia
-- (a mesma pessoa pode ser professora aqui e aluna na academia ao lado).
create or replace function public.pessoa_tem_outro_vinculo(_aluno_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
           select 1 from public.alunos x, public.alunos a
            where a.id = _aluno_id and x.user_id = a.user_id and x.id <> a.id and x.anonimizado_em is null
         )
      or exists (
           select 1 from public.organization_members m, public.alunos a
            where a.id = _aluno_id and m.user_id = a.user_id and m.status = 'active'
              and not (m.organization_id = a.organization_id and m.role = 'aluno')
         );
$$;

-- ── Anonimizar: o direito de eliminação, dentro desta academia ─────────────
--
-- Fica o que a lei manda guardar, sem identificar a pessoa: mensalidades,
-- cobranças, assinaturas, pagamentos, notas, comissões e presenças (que, com o
-- aluno anonimizado, viram contagem). Fica a prova das autorizações: o termo
-- da digital (a Política promete guardá-lo pelo prazo legal) e a data e a
-- versão do consentimento de saúde. O resto do que é da pessoa sai.
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

-- ── Excluir de vez: só academia em teste ───────────────────────────────────
create or replace function public.excluir_aluno_da_academia(_aluno_id uuid, _ator uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a public.alunos%rowtype;
  v_org_nome text;
  v_org_status text;
  v_conta_fica boolean;
  v_imagens text[];
begin
  select * into a from public.alunos where id = _aluno_id;
  if a.id is null then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;
  select o.nome, o.status::text into v_org_nome, v_org_status from public.organizations o where o.id = a.organization_id;
  if v_org_status is distinct from 'trial' then
    raise exception 'Excluir de vez é só para academia em teste. Para um aluno real, use a anonimização: ela apaga os dados pessoais e guarda o que a lei exige.'
      using errcode = '42501';
  end if;

  -- A conta só sai quando não sobra vínculo nenhum, nem inativo: em outra
  -- academia, até o histórico de um ex-aluno é registro daquela academia.
  v_conta_fica := exists (select 1 from public.alunos x where x.user_id = a.user_id and x.id <> a.id)
               or exists (select 1 from public.organization_members m
                           where m.user_id = a.user_id
                             and not (m.organization_id = a.organization_id and m.role = 'aluno'))
               or exists (select 1 from public.user_roles r where r.user_id = a.user_id);

  select coalesce(array_agg(fp.image_url) filter (where fp.image_url is not null), '{}')
    into v_imagens
    from public.feed_posts fp
   where fp.user_id = a.user_id and fp.organization_id = a.organization_id;
  delete from public.feed_comments where user_id = a.user_id and organization_id = a.organization_id;
  delete from public.feed_likes where user_id = a.user_id and organization_id = a.organization_id;
  delete from public.feed_posts where user_id = a.user_id and organization_id = a.organization_id;

  -- A cascata leva o que é do aluno nesta academia; o gatilho tira do
  -- equipamento, e o outro gatilho recusa se ainda houver cobrança viva.
  delete from public.alunos where id = _aluno_id;
  delete from public.organization_members
   where user_id = a.user_id and organization_id = a.organization_id and role = 'aluno';

  perform public.registrar_auditoria(
    _ator, 'aluno.excluido', 'aluno', _aluno_id, v_org_nome,
    jsonb_build_object('conta_apagada', not v_conta_fica));

  return jsonb_build_object(
    'user_id', a.user_id,
    'organization_id', a.organization_id,
    'apagar_conta', not v_conta_fica,
    'imagens_feed', to_jsonb(v_imagens));
end;
$$;

revoke execute on function public.pessoa_tem_outro_vinculo(uuid) from public, anon, authenticated;
revoke execute on function public.anonimizar_dados_do_aluno(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.excluir_aluno_da_academia(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pessoa_tem_outro_vinculo(uuid) to service_role;
grant execute on function public.anonimizar_dados_do_aluno(uuid, uuid) to service_role;
grant execute on function public.excluir_aluno_da_academia(uuid, uuid) to service_role;
