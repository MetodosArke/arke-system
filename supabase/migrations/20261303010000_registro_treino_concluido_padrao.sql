-- `registro_treino.concluido` passa a nascer falso.
--
-- A tabela nasceu na Fase 4 como "treino executado": a linha só existia
-- quando o aluno registrava um treino feito, e o padrão `true` fazia sentido.
-- A tela de execução série a série (20261218010000) mudou isso: ela cria o
-- registro ao **abrir**, para ter onde pendurar as séries, e não informa
-- `concluido` — então só abrir o treino já o gravava como concluído. Com isso,
-- abrir e voltar contava como dia treinado no calendário, na constância
-- (`aluno_constancia`, que alimenta o avanço automático de fases), nos dias
-- sem sinal e no "treinar hoje" da Próxima Ação, e marcava a divisão aberta
-- como o último treino feito na sequência sugerida de Meu Treino.
--
-- Com o padrão falso, a linha criada na entrada nasce não concluída, e quem
-- conclui continua sendo o fim do treino (`AvaliacaoTreinoDialog`, só com
-- todas as séries feitas) ou a lista marcada inteira. O `on conflict` da
-- entrada não menciona `concluido`, então reabrir o treino depois de
-- concluí-lo não desfaz a conclusão.
--
-- Os outros caminhos que gravam na tabela informam `concluido` (a lista de
-- Meu Treino e as sementes da demonstração e do teste de volume); nenhuma
-- função do banco nem edge function insere nela.

alter table public.registro_treino alter column concluido set default false;

-- Corrige o que a entrada gravou errado: concluído sem nada feito — sem fim de
-- treino registrado (duração ou esforço), sem série concluída e sem exercício
-- marcado na lista. Na data desta migration não há nenhuma linha assim; a
-- correção fica para o intervalo até o deploy.
update public.registro_treino r
   set concluido = false
 where r.concluido
   and r.duracao_min is null
   and r.esforco_percebido is null
   and not exists (select 1 from public.registro_serie s where s.registro_treino_id = r.id and s.concluida)
   and not exists (
         select 1 from jsonb_array_elements(r.detalhes_execucao) d
          where (d->>'concluido')::boolean
       );
