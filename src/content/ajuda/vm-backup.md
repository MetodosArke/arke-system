O banco do ARKE tem backup diário no plano Pro do Supabase. Este artigo diz quando restaurar, o que se perde e como fazer.

## Quando restaurar

Só quando os dados de produção foram corrompidos ou apagados de um jeito que não se conserta pelo próprio sistema: uma exclusão em massa por engano, uma migração que estragou dados. Para um registro errado, corrija o registro; restaurar volta **a plataforma inteira** ao horário do backup.

## O que se perde

Tudo o que foi gravado entre o horário do backup e a restauração: pagamentos confirmados, treinos registrados, check-ins, mensagens. Pagamentos voltam pela conferência diária com o Asaas, que reenvia os eventos; o resto se perde.

## O ensaio antes do primeiro cliente

Backup que nunca foi restaurado é hipótese. Logo depois de contratar o Pro, faça o ensaio:

1. **Painel do Supabase → Database → Backups**: anote a data do backup mais recente.
2. **Restaure num projeto novo** (*Restore to a new project*), nunca no de produção.
3. **Anote o tempo** até o projeto novo responder: é o tempo real de volta.
4. **Compare** com `scripts/migracao/comparar.mjs` (origem produção, destino o projeto restaurado): tabelas, colunas, funções, regras de acesso, gatilhos e rotinas.
5. **Confira três contagens**: organizações, alunos e cobranças do último mês.
6. **Apague o projeto restaurado**: ele tem os dados de todas as academias.

Registre data, tempo e resultado em `docs/RESTAURACAO_BACKUP.md`.

## O que o backup do banco não cobre

- **Arquivos** (atestados, vídeos, termos, mídia do acervo): ficam no storage do projeto, que sobrevive a uma restauração no mesmo projeto, mas não vão para um projeto novo.
- **Segredos** do Vault e das funções: um projeto novo precisa dos tokens refeitos.

> Restaurar produção é decisão dos sócios, não de uma pessoa só. Avise as academias antes, com o horário para o qual os dados vão voltar.
