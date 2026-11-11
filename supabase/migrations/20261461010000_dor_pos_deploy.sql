-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- Pós-deploy da observação do fim do treino e da correção do Sentinela (11/11/2026).
-- O app publicado grava a observação só em `registro_treino_bem_estar`, e o
-- Sentinela lê a progressão suspensa de `aluno_progressao_bloqueada`. Copia o que o
-- app antigo gravou entre a migration de antes e o deploy, e apaga as duas colunas
-- antigas: com elas fora, dado de saúde que o aluno informa não tem mais onde morar
-- no registro do treino nem no cadastro do aluno.
insert into public.registro_treino_bem_estar (registro_treino_id, organization_id, observacao)
select rt.id, rt.organization_id, rt.observacao
  from public.registro_treino rt
 where nullif(btrim(rt.observacao), '') is not null
on conflict (registro_treino_id) do update set observacao = excluded.observacao
 where public.registro_treino_bem_estar.observacao is null;

alter table public.registro_treino drop column if exists observacao;
alter table public.alunos drop column if exists progressao_bloqueada_motivo;
