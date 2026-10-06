-- O admin da ArkeFit só nas tarefas da ArkeFit (auditoria de prontidão,
-- 06/10/2026).
--
-- A fila do Mentor Centralizado é a mesma `tarefas`, com `dono`
-- (20261227010000), e a separação mora no RLS: a academia não lê o que é da
-- ArkeFit. O lado inverso ficou aberto. As regras de leitura, alteração e
-- exclusão davam ao `admin_arke` toda tarefa de toda academia: cobrança,
-- atestado e a fila inteira do aluno do Free, que não tem mentor. Em
-- produção há 2 contas `admin_arke`.
--
-- A regra passa a ser a do produto: o `admin_arke` lê, altera e exclui só o
-- que tem `dono = 'arkefit'`; o Super Admin continua vendo tudo; a equipe da
-- academia, só `dono = 'academia'` (como já era).
--
-- O `with check`:
--   * alteração: cada lado só deixa a tarefa com o próprio dono. Antes a
--     equipe podia mudar o `dono` de uma tarefa dela, e o `admin_arke`, o de
--     qualquer uma. Nenhuma tela muda o dono; a instrução presencial que o
--     mentor manda à academia nasce pela função `criar_instrucao_presencial`,
--     que roda com a permissão dela e não passa por aqui;
--   * inclusão: a equipe segue podendo abrir tarefa de qualquer aluno da
--     academia. O gatilho `trg_definir_dono_da_tarefa` decide o dono antes do
--     `with check`, e o "relato de dor" de um aluno do Método vira tarefa do
--     mentor: barrar a equipe ali quebraria a ficha. O `admin_arke` só abre
--     tarefa que fica com a ArkeFit.
--
-- Conferido antes de cortar: a fila do Mentor (`get_fila_mentor`), a
-- operação (`get_operacao_mentor`, `get_carga_mentores`), a ficha do aluno
-- no Método (`get_ficha_mentor`), a instrução presencial e a liberação da
-- progressão leem e gravam por funções `security definer`, que já conferem o
-- papel. A única gravação direta da ArkeFit é encerrar o chamado da fila, que
-- é sempre `dono = 'arkefit'`.
--
-- Uma regra por operação, com `using` e `with check` escritos juntos.

set lock_timeout = '5s';

alter policy "leitura" on public.tarefas
  using (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia')
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
  );

alter policy "alteração" on public.tarefas
  using (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia')
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
  )
  with check (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia')
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
  );

alter policy "exclusão" on public.tarefas
  using (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia')
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
  );

alter policy "inclusão" on public.tarefas
  with check (
    (
      aluno_id is not null
      and exists (
        select 1 from public.alunos a
         where a.id = tarefas.aluno_id
           and a.user_id = (select auth.uid())
           and a.organization_id = tarefas.organization_id
      )
    )
    or public.is_org_staff((select auth.uid()), organization_id)
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
  );
