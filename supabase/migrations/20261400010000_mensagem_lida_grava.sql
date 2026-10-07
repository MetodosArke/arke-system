-- A mensagem lida passa a gravar (achado da prova de 20261399010000,
-- 06/10/2026).
--
-- O que estava errado: o chat de treino e o de nutrição têm uma regra só,
-- `for all`, e o `with check` dela exige que a linha seja de quem grava
-- (`remetente_id = auth.uid()` e o tipo do próprio lado). Isso vale para a
-- inclusão, que é o que ele queria, mas vale também para a alteração: marcar
-- como lida a mensagem do OUTRO lado (o que o chat faz ao abrir) era recusado
-- com 42501. O app engolia o erro, e a contagem de não lidas da caixa de
-- mensagens e do menu nunca baixava. A prova no banco local mostrou a recusa
-- para o professor, a recepção e o aluno.
--
-- A escolha: uma regra por operação, como o resto do banco, com o mesmo
-- quem-lê de hoje (o do treino como estava; o da nutrição como 20261399010000
-- deixou):
--   * leitura: o aluno, e quem atende aquele canal;
--   * inclusão: o `with check` de hoje, sem mudança (cada um escreve só como
--     ele mesmo, do próprio lado);
--   * alteração: quem lê, e só a coluna `lida`. A permissão de alterar a
--     tabela sai, e volta só para `lida`: o texto, o remetente e a data de uma
--     mensagem não mudam por esta regra;
--   * exclusão: como estava (quem lê). Nenhuma tela exclui mensagem; a saída
--     do aluno apaga pelo servidor.
-- A regra restritiva das duas etapas (20261363010000) segue valendo por cima.

set lock_timeout = '5s';

-- ── Treino ─────────────────────────────────────────────────────────────────
drop policy if exists "aluno/staff usa chat de treino" on public.mensagens_treino;
drop policy if exists "leitura" on public.mensagens_treino;
drop policy if exists "inclusão" on public.mensagens_treino;
drop policy if exists "alteração" on public.mensagens_treino;
drop policy if exists "exclusão" on public.mensagens_treino;

create policy "leitura" on public.mensagens_treino for select to authenticated
  using (
    (exists (select 1 from public.alunos a where a.id = mensagens_treino.aluno_id and a.user_id = (select auth.uid())))
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke'::public.app_role)
  );

create policy "inclusão" on public.mensagens_treino for insert to authenticated
  with check (
    (
      (exists (select 1 from public.alunos a where a.id = mensagens_treino.aluno_id and a.user_id = (select auth.uid())))
      and remetente_id = (select auth.uid())
      and remetente_tipo = 'aluno'::public.remetente_tipo_treino
    )
    or (
      (public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'::public.app_role))
      and remetente_id = (select auth.uid())
      and remetente_tipo = 'treinador'::public.remetente_tipo_treino
    )
  );

create policy "alteração" on public.mensagens_treino for update to authenticated
  using (
    (exists (select 1 from public.alunos a where a.id = mensagens_treino.aluno_id and a.user_id = (select auth.uid())))
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke'::public.app_role)
  )
  with check (
    (exists (select 1 from public.alunos a where a.id = mensagens_treino.aluno_id and a.user_id = (select auth.uid())))
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke'::public.app_role)
  );

create policy "exclusão" on public.mensagens_treino for delete to authenticated
  using (
    (exists (select 1 from public.alunos a where a.id = mensagens_treino.aluno_id and a.user_id = (select auth.uid())))
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke'::public.app_role)
  );

-- ── Nutrição ───────────────────────────────────────────────────────────────
drop policy if exists "aluno/staff usa chat de nutrição" on public.mensagens_dieta;
drop policy if exists "leitura" on public.mensagens_dieta;
drop policy if exists "inclusão" on public.mensagens_dieta;
drop policy if exists "alteração" on public.mensagens_dieta;
drop policy if exists "exclusão" on public.mensagens_dieta;

create policy "leitura" on public.mensagens_dieta for select to authenticated
  using (
    (exists (select 1 from public.alunos a where a.id = mensagens_dieta.aluno_id and a.user_id = (select auth.uid())))
    or public.atende_saude(organization_id)
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

create policy "inclusão" on public.mensagens_dieta for insert to authenticated
  with check (
    (
      (exists (select 1 from public.alunos a where a.id = mensagens_dieta.aluno_id and a.user_id = (select auth.uid())))
      and remetente_id = (select auth.uid())
      and remetente_tipo = 'aluno'::public.remetente_tipo_dieta
    )
    or (
      (public.atende_saude(organization_id) or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id)))
      and remetente_id = (select auth.uid())
      and remetente_tipo = 'nutricionista'::public.remetente_tipo_dieta
    )
  );

create policy "alteração" on public.mensagens_dieta for update to authenticated
  using (
    (exists (select 1 from public.alunos a where a.id = mensagens_dieta.aluno_id and a.user_id = (select auth.uid())))
    or public.atende_saude(organization_id)
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  )
  with check (
    (exists (select 1 from public.alunos a where a.id = mensagens_dieta.aluno_id and a.user_id = (select auth.uid())))
    or public.atende_saude(organization_id)
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

create policy "exclusão" on public.mensagens_dieta for delete to authenticated
  using (
    (exists (select 1 from public.alunos a where a.id = mensagens_dieta.aluno_id and a.user_id = (select auth.uid())))
    or public.atende_saude(organization_id)
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

-- ── Só a coluna `lida` se altera pela API ──────────────────────────────────
revoke update on public.mensagens_treino, public.mensagens_dieta from anon, authenticated;
grant update (lida) on public.mensagens_treino, public.mensagens_dieta to authenticated;
