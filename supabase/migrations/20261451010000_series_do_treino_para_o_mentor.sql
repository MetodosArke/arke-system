-- As séries do treino do aluno do Método para o mentor (16/10/2026).
--
-- A sugestão de progressão da carga (`src/lib/sugestaoProgressao.ts`) lê as
-- séries feitas (`registro_serie`: carga, repetições, concluída) do aluno. No
-- Método ARKE o treino é do mentor da ArkeFit, e é ele quem vê a sugestão, na
-- ficha do aluno do Método.
--
-- O Mentor contratado (o nível `mentor`, sem o papel `admin_arke`) já lê o
-- treino feito (`registro_treino`), o sono e a energia
-- (`registro_treino_bem_estar`) e o treino publicado do aluno do Método, pelo
-- `equipe_metodo()` com o `aluno_no_metodo()`. As séries ficaram de fora: a
-- regra de leitura de `registro_serie` é de 23/09 (`20261218010000`), de antes
-- do Método, e só tem o aluno, a equipe da academia e o Admin ARKE. Sem isto,
-- a sugestão diria ao mentor "ainda sem dados" para quem treina e anota as
-- séries todo dia: um vazio que não é verdade.
--
-- A regra ganha o termo do Método, igual ao de `registro_treino_bem_estar`:
-- a equipe do Método só alcança a série do treino de um aluno no Método, com
-- o `equipe_metodo()` uma vez por consulta (`(select ...)`). O resto da regra
-- fica como está. Uma regra só de leitura, sem mudar inclusão, alteração nem
-- exclusão (quem registra o que levantou é quem levantou).

set lock_timeout = '5s';

alter policy "leitura" on public.registro_serie
  using (
    exists (select 1 from public.alunos a
             join public.registro_treino r on r.aluno_id = a.id
            where r.id = registro_serie.registro_treino_id
              and a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke')
    or ((select public.equipe_metodo())
        and exists (select 1 from public.registro_treino r
                     where r.id = registro_serie.registro_treino_id
                       and public.aluno_no_metodo(r.aluno_id)))
  );
