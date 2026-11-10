-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- A avaliação física do aluno do Método também pela mentoria (reunião de 10/11/2026).
-- Quando o aluno compra o Método, a avaliação acompanha: o mentor da ArkeFit lança e
-- corrige, sem depender da academia. A academia continua lançando e vendo, porque o
-- aluno treina nela; a exclusão segue só com ela. A leitura da equipe do Método já
-- existia. A linha do mentor vai sempre na academia do próprio aluno: a regra confere
-- o organization_id contra o do aluno, para ninguém gravar avaliação noutra academia.
alter policy "inclusão" on public.avaliacoes_fisicas
  with check (
    public.atende_saude(organization_id)
    or (
      (select public.equipe_metodo())
      and public.aluno_no_metodo(aluno_id)
      and organization_id = (select a.organization_id from public.alunos a where a.id = aluno_id)
    )
  );

alter policy "alteração" on public.avaliacoes_fisicas
  using (
    public.atende_saude(organization_id)
    or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id))
  )
  with check (
    public.atende_saude(organization_id)
    or (
      (select public.equipe_metodo())
      and public.aluno_no_metodo(aluno_id)
      and organization_id = (select a.organization_id from public.alunos a where a.id = aluno_id)
    )
  );
