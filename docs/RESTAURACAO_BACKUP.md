# Ensaio de restauração do backup

Backup que nunca foi restaurado é hipótese. Este ensaio prova que a volta funciona e mede quanto tempo ela leva, antes de o primeiro cliente depender disso.

**Quando:** logo depois de contratar o Supabase Pro, antes do primeiro cliente pagante implantado. No plano gratuito não há backup para restaurar; por isso o ensaio espera o upgrade (decisão dos sócios de 24/09/2026: fica o backup diário do Pro, sem o adicional de volta a qualquer momento do dia).

## Passos

1. **Painel do Supabase → Database → Backups.** Anotar a data do backup mais recente.
2. **Restaurar num projeto novo**, nunca no de produção (opção *Restore to a new project*). O ensaio não pode derrubar o que está no ar.
3. **Anotar o tempo** do pedido até o projeto novo responder. É o tempo real de volta, e entra aqui embaixo.
4. **Conferir o conteúdo** com `scripts/migracao/comparar.mjs`, apontando origem para produção e destino para o projeto restaurado: tabelas, colunas, funções (com o corpo), regras de acesso, gatilhos, índices e rotinas. Diferença esperada: só os dados gravados depois do horário do backup.
5. **Conferir três contagens** que dizem se o dado de negócio voltou inteiro: organizações, alunos e cobranças do último mês.
6. **Apagar o projeto restaurado.** Ele carrega os dados de todas as academias; não pode ficar esquecido.

## O que o ensaio não cobre

- **Storage (atestados, vídeos, termos, mídia do acervo):** o backup do banco não inclui os arquivos. Eles ficam no storage do projeto, que sobrevive a uma restauração do banco no mesmo projeto, mas não vão para um projeto novo.
- **Segredos do Vault e das edge functions:** a chave do Vault é do projeto. Um projeto restaurado precisa dos tokens refeitos (ver `docs/MIGRACAO_SUPABASE.md`, que passou por isso na migração para São Paulo).

## Registro

| Data | Backup de | Tempo de volta | Conferência | Quem |
|---|---|---|---|---|
| — | — | — | — | — |
