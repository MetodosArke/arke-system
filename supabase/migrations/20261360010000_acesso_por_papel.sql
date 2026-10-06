-- Auditoria de prontidão, rodada 3: quem vê o quê dentro da academia (06/10/2026).
--
-- Três achados médios da auditoria de 05/10, todos de regra de leitura:
--
-- 1. O dinheiro da academia era de toda a equipe. A regra de `mensalidades`,
--    `cobrancas_avulsas`, `pagamentos`, `aluno_matriculas_academia`,
--    `aluno_assinaturas` e `notas_fiscais` usava `is_org_staff`, que inclui o
--    professor e a nutricionista: digitando o endereço de Gestão 360°, o
--    professor via a receita. Agora fica com quem cobra: a gestão e a
--    recepção. As duas telas que somam receita (Gestão 360° e Financeiro) já
--    eram só da gestão no menu; a rota passa a conferir o papel também.
-- 2. A recepção via a saúde do aluno na ficha: anamnese, dores, avaliação
--    física, dieta e o resumo da IA. O artigo do app diz que a recepção trata
--    do cadastro e dos pagamentos. Agora a saúde fica com quem atende: a
--    gestão, o professor e a nutricionista. O PAR-Q e o atestado continuam com
--    a recepção (decisão abaixo, no bloco 3).
-- 3. A ArkeFit (`admin_arke`) lia pelo RLS a anamnese, a dieta e o resumo da IA
--    de todo aluno do plano Free, e os registros da catraca com CPF de todas
--    as academias. O termo de saúde e a Política dizem que a ArkeFit só acessa
--    no Método. Agora a ArkeFit lê a saúde só do aluno do Método
--    (`equipe_metodo()` e `aluno_no_metodo()`, como já era para ele); o suporte
--    a um aluno do Free passa pelo perfil simulado, que fica na auditoria.
--
-- Uma regra por tabela e operação: tudo aqui é `alter policy` sobre as regras
-- que já existem, com o `using` e o `with check` escritos juntos.

set lock_timeout = '5s';

-- ── As duas perguntas ──────────────────────────────────────────────────────
-- Respondem só sobre quem chama (auth.uid() aqui dentro), então não servem
-- para sondar o papel de outra pessoa. O preço é ler o JWT a cada linha, o
-- mesmo de `has_role` e de `pode_prescrever_dieta_metodo`, que as regras já
-- pagam.

-- Quem cuida do dinheiro da academia: a gestão e a recepção, que cobra.
create or replace function public.cuida_do_dinheiro(_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
     where user_id = auth.uid()
       and organization_id = _organization_id
       and role in ('gestor', 'recepcao')
       and status = 'active'
  );
$$;

-- Quem atende a saúde do aluno: a gestão, o professor e a nutricionista. A
-- recepção não.
create or replace function public.atende_saude(_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
     where user_id = auth.uid()
       and organization_id = _organization_id
       and role in ('gestor', 'professor', 'nutricionista')
       and status = 'active'
  );
$$;

revoke execute on function public.cuida_do_dinheiro(uuid) from public, anon;
revoke execute on function public.atende_saude(uuid) from public, anon;
grant execute on function public.cuida_do_dinheiro(uuid) to authenticated, service_role;
grant execute on function public.atende_saude(uuid) to authenticated, service_role;

-- ── 1. O dinheiro da academia ──────────────────────────────────────────────
-- O professor não usa nada disto: a ficha mostra o plano e as cobranças só a
-- quem cobra, e as telas de receita são da gestão. A recepção cobra: matricula,
-- emite a cobrança avulsa, cadastra o cartão e acompanha a mensalidade.

alter policy "leitura" on public.mensalidades
  using (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()))
    or public.cuida_do_dinheiro(organization_id)
  );
alter policy "inclusão" on public.mensalidades
  with check (public.cuida_do_dinheiro(organization_id));
alter policy "alteração" on public.mensalidades
  using (public.cuida_do_dinheiro(organization_id))
  with check (public.cuida_do_dinheiro(organization_id));
alter policy "exclusão" on public.mensalidades
  using (public.cuida_do_dinheiro(organization_id));

alter policy "leitura" on public.cobrancas_avulsas
  using (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()))
    or public.cuida_do_dinheiro(organization_id)
  );

-- As cobranças do Método: a academia recebe a parte dela no split.
alter policy "leitura" on public.pagamentos
  using (
    public.cuida_do_dinheiro(organization_id)
    or public.has_role((select auth.uid()), 'admin_arke')
  );

alter policy "leitura" on public.aluno_matriculas_academia
  using (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()))
    or public.cuida_do_dinheiro(organization_id)
  );
alter policy "inclusão" on public.aluno_matriculas_academia
  with check (public.cuida_do_dinheiro(organization_id));
alter policy "alteração" on public.aluno_matriculas_academia
  using (public.cuida_do_dinheiro(organization_id))
  with check (public.cuida_do_dinheiro(organization_id));
alter policy "exclusão" on public.aluno_matriculas_academia
  using (public.cuida_do_dinheiro(organization_id));

-- A assinatura do Método: o valor, a fatura e o cartão.
alter policy "leitura" on public.aluno_assinaturas
  using (
    exists (select 1 from public.alunos a where a.id = aluno_assinaturas.aluno_id and a.user_id = (select auth.uid()))
    or public.cuida_do_dinheiro(organization_id)
    or public.has_role((select auth.uid()), 'admin_arke')
  );
alter policy "inclusão" on public.aluno_assinaturas
  with check (public.cuida_do_dinheiro(organization_id) or public.has_role((select auth.uid()), 'admin_arke'));
alter policy "alteração" on public.aluno_assinaturas
  using (public.cuida_do_dinheiro(organization_id) or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.cuida_do_dinheiro(organization_id) or public.has_role((select auth.uid()), 'admin_arke'));
alter policy "exclusão" on public.aluno_assinaturas
  using (public.cuida_do_dinheiro(organization_id) or public.has_role((select auth.uid()), 'admin_arke'));

alter policy "leitura" on public.notas_fiscais
  using (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()))
    or public.cuida_do_dinheiro(organization_id)
    or public.has_role((select auth.uid()), 'superadmin')
  );

-- `lancamentos_financeiros`, `plano_contas` e a folha já eram só da gestão.

-- ── 2 e 3. A saúde do aluno ────────────────────────────────────────────────
-- Do aluno do Free, a academia que atende (sem a recepção). Do aluno do
-- Método, a anamnese e a dieta são da ArkeFit (20261292); a avaliação física
-- segue medida pela academia.

alter policy "leitura" on public.anamnese_acolhimento
  using (
    exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid()))
    or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id))
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );
alter policy "inclusão" on public.anamnese_acolhimento
  with check (
    exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid()))
    or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id))
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );
alter policy "alteração" on public.anamnese_acolhimento
  using (
    exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid()))
    or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id))
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  )
  with check (
    exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid()))
    or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id))
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );
alter policy "exclusão" on public.anamnese_acolhimento
  using (
    exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid()))
    or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id))
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

-- O resumo da IA acompanha a anamnese de onde sai.
alter policy "leitura" on public.sentinela_anamnese
  using (
    exists (select 1 from public.alunos a where a.id = sentinela_anamnese.aluno_id and a.user_id = (select auth.uid()))
    or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id))
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

alter policy "leitura" on public.avaliacoes_fisicas
  using (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()))
    or public.atende_saude(organization_id)
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );
alter policy "inclusão" on public.avaliacoes_fisicas
  with check (public.atende_saude(organization_id));
alter policy "alteração" on public.avaliacoes_fisicas
  using (public.atende_saude(organization_id))
  with check (public.atende_saude(organization_id));
alter policy "exclusão" on public.avaliacoes_fisicas
  using (public.atende_saude(organization_id));

alter policy "leitura" on public.dietas
  using (
    exists (select 1 from public.alunos a where a.id = dietas.aluno_id and a.user_id = (select auth.uid()))
    or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id))
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );
alter policy "inclusão" on public.dietas
  with check (
    (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id))
    or (public.aluno_no_metodo(aluno_id) and public.pode_prescrever_dieta_metodo())
  );
alter policy "alteração" on public.dietas
  using (
    (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id))
    or (public.aluno_no_metodo(aluno_id) and public.pode_prescrever_dieta_metodo())
  )
  with check (
    (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id))
    or (public.aluno_no_metodo(aluno_id) and public.pode_prescrever_dieta_metodo())
  );
alter policy "exclusão" on public.dietas
  using (
    (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id))
    or (public.aluno_no_metodo(aluno_id) and public.pode_prescrever_dieta_metodo())
  );

alter policy "leitura" on public.dieta_adesao
  using (
    exists (select 1 from public.alunos a where a.id = dieta_adesao.aluno_id and a.user_id = (select auth.uid()))
    or public.atende_saude(organization_id)
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  );

-- O PAR-Q e o atestado ficam com a recepção, de propósito. Eles são o
-- documento de aptidão que a academia guarda: o PAR-Q diz se é preciso
-- atestado, e o atestado diz até quando o aluno está liberado. Quem recebe o
-- atestado no balcão e registra a validade é, quase sempre, a recepção; sem
-- isso, o aluno com "sim" no PAR-Q fica sem registrar treino até alguém da
-- gestão aparecer. Na ficha, a recepção vê a situação e o atestado, sem a
-- lista de perguntas respondidas com "sim" (a tela esconde).

-- O registro da catraca traz o CPF de quem passou. A ArkeFit não precisa dele
-- de nenhuma academia: o Vigia lê pelo servidor, e a Visão Master
-- (`get_superadmin_acessos_catraca`) mostra uma referência no lugar do aluno,
-- sem o CPF.
alter policy "staff/admin_arke vê logs de acesso" on public.acessos_catraca_logs
  using (public.is_org_staff((select auth.uid()), organization_id));
