-- A recepção não lê as tarefas de saúde (auditoria de prontidão, 06/10/2026).
--
-- O que estava errado: a regra da plataforma é que a recepção não vê saúde
-- (`atende_saude()`, 20261360010000: a gestão, o professor e a
-- nutricionista). A ficha já escondia da recepção as pendências de dor e de
-- anamnese, e o histórico do aluno também (20261394010000), mas pela tela.
-- O RLS de `tarefas` seguia dando à recepção toda tarefa `dono = 'academia'`,
-- e pela API ela lia a tarefa de tipo `dor` ("Relatou dor no joelho"), com o
-- desfecho que o professor escreveu. A prova foi feita em produção.
--
-- A escolha: a regra mora no RLS, como a do dono (20261393010000). Na
-- leitura, na alteração (as duas metades) e na exclusão, o termo da equipe
-- da academia ganha uma condição: a tarefa não é de saúde, ou quem pede
-- atende a saúde. A inclusão fica como está: abrir uma tarefa não mostra
-- nenhuma outra, e a de saúde que a recepção abrisse pela API iria para quem
-- atende, sem voltar para ela.
--
-- Os tipos de saúde moram numa função só, `tarefa_de_saude()`, com a mesma
-- lista da ficha (`TAREFAS_DE_SAUDE`, em src/lib/acessoPainel.ts): a
-- pendência de dor e a de anamnese. `tarefasPorDono.guarda.test.ts` falha se
-- as duas divergirem. Ficam de fora, de propósito:
--   * `atestado`: é o documento de aptidão que a recepção recebe no balcão
--     (a decisão do bloco 3 de 20261360010000);
--   * `ajuste` e `barreira`: dizem que o plano precisa de ajuste ou que a
--     rotina travou, sem o relato de saúde (o check-in com dor abre `dor`).
--
-- A tarefa de dor continua chegando a quem atende: a Fila de atendimento lê
-- pelo RLS, e o professor, a nutricionista e a gestão seguem vendo todas as
-- da academia. A pendência de saúde aberta que uma recepcionista já tinha
-- assumido sumiria da fila dela e ficaria fora da "Minha Fila" dos outros;
-- ela volta para a fila comum (sem responsável), e a próxima pessoa que
-- atende assume.
--
-- O histórico do aluno (`get_historico_aluno`) continua com o filtro dele,
-- agora redundante: ele lê pelo RLS, e a lista dele é conferida contra a
-- mesma `TAREFAS_DE_SAUDE` por `historicoDoAluno.guarda.test.ts`.

set lock_timeout = '5s';

create or replace function public.tarefa_de_saude(_tipo text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(_tipo = any (array['dor', 'anamnese']), false);
$$;

comment on function public.tarefa_de_saude(text) is
  'Os tipos de tarefa que falam da saúde do aluno (a mesma lista de TAREFAS_DE_SAUDE na ficha). A recepção não os lê: ver a regra de leitura de tarefas.';

revoke execute on function public.tarefa_de_saude(text) from public, anon;
grant execute on function public.tarefa_de_saude(text) to authenticated, service_role;

alter policy "leitura" on public.tarefas
  using (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia'
      and (not public.tarefa_de_saude(tipo::text) or public.atende_saude(organization_id)))
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
  );

alter policy "alteração" on public.tarefas
  using (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia'
      and (not public.tarefa_de_saude(tipo::text) or public.atende_saude(organization_id)))
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
  )
  with check (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia'
      and (not public.tarefa_de_saude(tipo::text) or public.atende_saude(organization_id)))
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
  );

alter policy "exclusão" on public.tarefas
  using (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia'
      and (not public.tarefa_de_saude(tipo::text) or public.atende_saude(organization_id)))
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
  );

-- A pendência de saúde aberta que estava com a recepção volta para a fila
-- comum. `organization_members` tem um papel por pessoa e academia.
update public.tarefas t
   set responsavel_id = null
 where public.tarefa_de_saude(t.tipo::text)
   and t.dono = 'academia'
   and t.status in ('aberta', 'em_andamento', 'aguardando')
   and exists (
     select 1 from public.organization_members m
      where m.user_id = t.responsavel_id
        and m.organization_id = t.organization_id
        and m.role = 'recepcao'
        and m.status = 'active'
   );
