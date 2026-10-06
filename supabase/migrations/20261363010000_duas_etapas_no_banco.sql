-- Auditoria de prontidão, rodada 3: as duas etapas da gestão valem no banco
-- (06/10/2026).
--
-- A gestão que liga "pedir o código na entrada do painel" (Meu perfil) via o
-- painel só depois do código, mas a regra morava na tela: com só a senha, a
-- API respondia tudo. Só três ações sensíveis conferiam a sessão no banco
-- (`sessao_verificada()`, 20261328).
--
-- Onde pôr a conferência, medido antes de escolher (Postgres 18 em WASM, com
-- EXPLAIN (ANALYZE, BUFFERS) sobre 5.000 linhas de uma academia; as páginas
-- lidas não variam de uma rodada para outra, o tempo em WASM varia demais):
--   * dentro das funções de papel (`is_org_staff` e as outras), a conferência
--     roda a cada linha: 6,02 páginas por linha contra 4,02 hoje (+50%), mais
--     a leitura do JWT a cada linha. É o caminho de toda tela da academia;
--   * numa regra restritiva por tabela, `(select ...)` vira um passo único da
--     consulta: 4,02 por linha, mais 3 páginas por consulta, qualquer que seja
--     o tamanho dela.
-- A escolha é a regra restritiva, nas tabelas com dado de pessoa: toda tabela
-- com `aluno_id`, o aluno, o perfil (menos o da própria pessoa), os
-- contatos do funil, a importação e o dinheiro da equipe e da academia. Ficam
-- de fora as tabelas que o app lê antes do código (papéis, vínculos,
-- organização, documentos legais, avisos do aparelho) e a configuração.
--
-- Uma regra restritiva soma por E às permissivas: não abre nada, só exige. A
-- regra "uma por tabela e operação" é sobre as permissivas (que somam por OU),
-- e a auditoria do banco (2.3) só conta as permissivas.
--
-- Fora daqui, e listado no registro como próximo passo: as funções do banco
-- que devolvem dado de aluno à equipe (security definer, sem passar pelo RLS)
-- e as edge functions que leem com a service role.

set lock_timeout = '5s';

-- Quem ligou as duas etapas (tem um aplicativo autenticador verificado) só
-- passa com a sessão verificada. Quem não ligou passa como antes. A sessão
-- simulada pela ArkeFit passa: ela nasce do lado do servidor, com as duas
-- etapas de quem simula, e não tem o celular da pessoa.
create or replace function public.sessao_cumpre_duas_etapas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
         where f.user_id = (select auth.uid()) and f.status = 'verified'
      )
      or public.sessao_simulada();
$$;

revoke execute on function public.sessao_cumpre_duas_etapas() from public, anon;
grant execute on function public.sessao_cumpre_duas_etapas() to authenticated, service_role;

-- A regra, tabela por tabela. Tabela que não existe é pulada com aviso, para
-- a migration não depender de uma tabela antiga que nunca rodou.
do $$
declare
  t text;
begin
  foreach t in array array[
    -- o aluno e quem é ligado a ele
    'alunos', 'responsavel_pedidos', 'responsavel_aceites', 'leads', 'importacoes_alunos_linhas',
    -- saúde
    'anamnese_acolhimento', 'sentinela_anamnese', 'sentinela_sugestoes', 'avaliacoes_fisicas', 'aluno_parq',
    'dietas', 'dieta_adesao', 'checkins', 'aluno_observacoes', 'mensagens_dieta', 'mensagens_treino',
    'mensagens_mentor', 'tarefas',
    -- treino, rotina e engajamento
    'treinos', 'treino_calendario', 'registro_treino', 'registro_serie', 'registro_habito', 'presencas',
    'agendamentos', 'aluno_fase_historico', 'aluno_objetivos', 'aluno_rotina_semanal', 'aluno_valores',
    'compromisso_semanal', 'desafio_participantes', 'desafio_progresso', 'competicao_participantes',
    'metricas_customizadas', 'metrica_valores',
    -- autorizações, documentos e catraca
    'aluno_consentimento_ia', 'aluno_consentimento_biometrico', 'aluno_assinaturas_contrato',
    'fotos_rosto_pendentes', 'acessos_catraca_logs', 'gateway_comandos', 'remocoes_fim_de_matricula',
    -- dinheiro
    'mensalidades', 'cobrancas_avulsas', 'pagamentos', 'aluno_matriculas_academia', 'aluno_assinaturas',
    'notas_fiscais', 'lancamentos_financeiros', 'staff_folha', 'staff_folha_pagamentos',
    'staff_comissoes_lancamentos'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'Tabela % não existe; sem a regra das duas etapas.', t;
      continue;
    end if;
    execute format('drop policy if exists "duas etapas" on public.%I', t);
    execute format(
      'create policy "duas etapas" on public.%I as restrictive for all to authenticated '
      'using ((select public.sessao_cumpre_duas_etapas())) '
      'with check ((select public.sessao_cumpre_duas_etapas()))',
      t
    );
  end loop;
end $$;

-- O perfil: o da própria pessoa passa sempre (o app lê o nome dela antes de
-- pedir o código); o dos outros, só com a sessão que cumpre as duas etapas.
drop policy if exists "duas etapas" on public.profiles;
create policy "duas etapas" on public.profiles as restrictive for all to authenticated
  using (user_id = (select auth.uid()) or (select public.sessao_cumpre_duas_etapas()))
  with check (user_id = (select auth.uid()) or (select public.sessao_cumpre_duas_etapas()));
