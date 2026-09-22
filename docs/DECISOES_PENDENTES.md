# Decisões do responsável — estado final das rodadas

Lista preenchida durante as rodadas de ajustes do app original e respondida pelo responsável em 22/09/2026. As respostas originais ficam registradas abaixo de cada item.

## Resolvidas e no ar (rodada final)

| # | Assunto | Resposta | O que foi feito |
|---|---|---|---|
| 6 | Situação do aluno bloqueia o app | "5 dias corridos de tolerância" | Inadimplente usa o app por 5 dias a partir da marcação, com aviso; pausado sai na hora. |
| 7 | Ativação 48h no Free | "Confirmado" | Mantido: vale para matrícula e cadastro, não para a base importada. |
| 8 | Chat com a nutricionista no Free | "Sugestão de como tratar" | Liberado quando a academia tem nutricionista na equipe; sem ela, mostra o Método. |
| 11 | Funil, NFS-e, WhatsApp | "Kanban simples / Asaas ou prefeitura / fora" | Funil em `/admin/funil`; NFS-e e WhatsApp fora do produto. |
| 13 | Revisão jurídica | Revisão registrada | Documentos marcados como revisados, versão `2026-09-22.2`. |
| 14 | Dados da ArkeFit | METODOS ARKE LTDA, CNPJ, endereço, DPO, foro, IPCA, 30 dias, 7 dias | Preenchidos; contrato com reajuste IPCA, aviso de 30 dias e suspensão após 7 dias (aplicada no bloqueio B2B). |
| 16 | PAR-Q trava o treino? | "Sim sem atestado bloqueia o treino" | Registro de treino recusado até a equipe registrar o atestado. |

## Com o responsável (sem código)

- **1. Canal de suporte:** preencher em Visão Master → Configurações → Canal de suporte quando o número e o e-mail existirem. Até lá o botão não aparece.
- **2. Vídeos e GIFs dos exercícios:** material novo em preparação; a estrutura de envio já existe no acervo.
- **3. Cabeçalhos de exportação (EVO, Tecnofit, Next Fit, Pacto):** o responsável vai tentar providenciar uma planilha real para conferir o reconhecimento das colunas.
- **4. Preço do profissional autônomo:** pós-lançamento. Custom segue negociado caso a caso.
- **5. Planos modelo:** mantidos inativos; os valores são conferidos no onboarding de cada academia.
- **9. Venda do Método ARKE:** mantida desligada (`VITE_METODO_ARKE_VENDA`) até resolver a coleta de CPF.
- **17. Infraestrutura paga** (Supabase, Vercel Pro, Resend, Sentry) e, depois, o teste de carga.
- **18. Venda de produtos e estoque:** depois do lançamento.
- **12. Tietê Fitness:** organização só de testes; será excluída depois (decisão de 22/09/2026). **Antes de excluir:** mover a conta E2E (`e2e-jornada@arkefit.com.br`) para outra organização de homologação, senão o teste de ponta a ponta falha em todo deploy; e rodar `verificar_orfaos()` depois.

## Em andamento

- **15. Migração para o projeto `ArkeFit PROD BR` (sa-east-1, São Paulo):** projeto criado pelo responsável. Passo a passo da parte dele (ferramentas do Postgres, `C:\Users\andre\migracao.env`, segredos) entregue na conversa de 22/09/2026; depois disso, preparação do projeto novo e virada numa janela noturna. Os buckets `dietas` e `chat-videos` já são privados no projeto atual e serão copiados assim.
