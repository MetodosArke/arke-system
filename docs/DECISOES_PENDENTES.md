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

- **1. Canal de suporte:** dívida assumida pelo responsável **para antes do primeiro cliente pagante** (22/09/2026). Preencher em Visão Master → Configurações → Canal de suporte. Até lá o botão "falar com o suporte" não aparece em nenhuma etapa do onboarding, e um gestor que travar não tem para onde ligar de dentro do produto.
- **2. GIFs dos exercícios:** dívida assumida pelo responsável **para antes do primeiro cliente pagante** (22/09/2026). Os GIFs vêm do banco do app original; a estrutura de envio já existe e está testada. **Vídeo é recurso a mais, não linha de base** — a ficha se explica com GIF.
- **3. Cabeçalhos de exportação (EVO, Tecnofit, Next Fit, Pacto):** o responsável vai tentar providenciar uma planilha real para conferir o reconhecimento das colunas.
- **4. Preço do profissional autônomo:** pós-lançamento. Custom segue negociado caso a caso.
- **5. Planos modelo:** mantidos inativos; os valores são conferidos no onboarding de cada academia.
- **9. Venda do Método ARKE:** mantida desligada (`VITE_METODO_ARKE_VENDA`) até resolver a coleta de CPF.
- **17. Infraestrutura paga** (Supabase, Vercel Pro, Resend, Sentry) e, depois, o teste de carga.
- **18. Venda de produtos e estoque:** depois do lançamento.
## Resolvidas pela migração

- **12. Tietê Fitness:** resolvida sem exclusão. A organização **não atravessou** para o projeto novo — só os dados globais da ArkeFit foram migrados —, então não há o que excluir nem órfão a varrer. A ressalva que travava o item (mover a conta E2E antes) virou outra coisa: a conta `e2e-jornada@arkefit.com.br` precisa ser **recriada** no projeto novo, numa organização de homologação nova, senão `jornada-aluno.spec.ts` falha em todo deploy.

## Em andamento

- **15. Migração para o projeto `ArkeFit PROD BR` (sa-east-1, São Paulo):** **o projeto novo está pronto e conferido** (22/09/2026) — schema idêntico em 14 categorias de comparação, 33 edge functions, 12 rotinas, 8 buckets, Auth espelhado com o hook de e-mail ligado, segredos gravados e os dois Super Admins criados. A produção ainda aponta para o projeto antigo. Faltam três passos manuais, detalhados em `docs/MIGRACAO_SUPABASE.md`: copiar `ASAAS_WEBHOOK_SECRET` e `TURNSTILE_SECRET_KEY` do projeto antigo, trocar o ref em `vercel.json` e `supabase/config.toml`, e virar as variáveis da Vercel mais a URL do webhook no Asaas.
