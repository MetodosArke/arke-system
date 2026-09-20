-- O Acervo de Exercícios (biblioteca usada nas fichas de treino) estava
-- liberado para qualquer staff da organização (is_org_staff: inclui
-- recepção e nutricionista) editar/excluir. A pedido do usuário, restringe
-- a gestão da biblioteca a gestor e professor (o mesmo grupo que já pode
-- prescrever treino) + admin_arke — mesma lógica de permissão de
-- alunos/usuários. A leitura continua liberada para qualquer membro da
-- organização (já era assim, mantido).
drop policy "staff gerencia a biblioteca da própria organização" on public.exercicios_biblioteca;

create policy "gestor/professor gerencia a biblioteca da própria organização"
  on public.exercicios_biblioteca for all
  to authenticated
  using (
    organization_id is not null
    and (
      public.has_org_role(auth.uid(), organization_id, 'gestor')
      or public.has_org_role(auth.uid(), organization_id, 'professor')
      or public.has_role(auth.uid(), 'admin_arke')
    )
  )
  with check (
    organization_id is not null
    and (
      public.has_org_role(auth.uid(), organization_id, 'gestor')
      or public.has_org_role(auth.uid(), organization_id, 'professor')
      or public.has_role(auth.uid(), 'admin_arke')
    )
  );
