# ARKE — Diretrizes de Desenvolvimento e Contexto do Projeto

## Visão Geral do Sistema
O ARKE é uma plataforma SaaS B2B/B2C para academias, studios e personal trainers que combina software de acompanhamento com uma metodologia ativa de atendimento, treino e nutrição (M.A.P.A.®, R.O.T.A.®, APEX® e LEGADO®) para reduzir o churn evitável e incrementar a receita das academias parceiras[span_51](start_span)[span_51](end_span)[span_52](start_span)[span_52](end_span).

## Arquitetura e Stack
- **Frontend:** React + TypeScript, Vite, TailwindCSS, Shadcn/UI, Lucide React[span_53](start_span)[span_53](end_span).
- **Backend & Banco de Dados:** Supabase (Auth, PostgreSQL, Row Level Security - RLS, Storage, Edge Functions)[span_54](start_span)[span_54](end_span).
- **Hospedagem:** Vercel[span_55](start_span)[span_55](end_span).

## Princípios de Engenharia e Regras Estritas
1. **Multitenancy em Primeiro Lugar:** Toda e qualquer tabela do banco (alunos, treinos, dietas, agendamentos, tarefas) deve conter a coluna `organization_id` (ou `academia_id`) e ter políticas de RLS ativas desde o primeiro script SQL[span_56](start_span)[span_56](end_span).
2. **Construção em Camadas:** Não introduzir integrações de hardware (catracas) ou agregadores (Gympass) antes que o núcleo de Auth, RLS e a Metodologia ARKE estejam 100% validados[span_57](start_span)[span_57](end_span).
3. **Sem Dados Mockados em Produção:** O sistema deve consumir estritamente dados em tempo real do Supabase ou exibir empty states claros.
4. **Ciclo Completo de Atendimento:** Uma pendência só é encerrada quando há um desfecho registrado (*Motivo → Responsável → Prazo → Ação → Desfecho → Próxima Checagem*)[span_58](start_span)[span_58](end_span).

## UX do Aluno & Diretrizes de Retenção Humanizada
- **Home Focada em Ação:** Prioridade para *Próxima Ação*, *Progresso Semanal*, *Próximo Evento de Acompanhamento* e *Botão de Ajuda*[span_59](start_span)[span_59](end_span). Dicas e gráficos ficam em segundo plano[span_60](start_span)[span_60](end_span).
- **Perguntas Construtivas:** Substituição de "Como está sua dedicação?" por "Como está sendo seguir seu plano?" (opções: Funcionando bem / Preciso de ajuste / Com dificuldade / Quero falar com alguém)[span_61](start_span)[span_61](end_span).
- **Gamificação Positiva (Fim da Punição):** Registros de dor, pedidos de ajuda ou faltas justificadas (viagem/trabalho) NÃO tiram pontos do aluno[span_62](start_span)[span_62](end_span). Rankings corporais (gordura/músculo) são proibidos nos painéis gerais, restritos apenas à evolução individual e privada do aluno[span_63](start_span)[span_63](end_span).
- **Constância vs. Adesão:** Aluno com meta de 2 treinos/semana que cumpre ambos tem 100% de constância; não deve ser penalizado em relação a quem treina 6 vezes[span_64](start_span)[span_64](end_span).

## Estrutura Comercial & Modelo de Atacado (Wholesale)

### 1. Planos B2B (Assinatura de Plataforma para Academias)
Valor mensal fixo pago pela academia para acesso à infraestrutura, isolamento por tenant, aplicativo com marca da academia e painel "Minha Fila" para a equipe local.

- **Starter (Até 150 alunos ativos):** R$ 390,00/mês — Gestão operacional da metodologia, fila de atendimento básica, aplicativo da academia e treinamento da equipe local.
- **Growth (Até 500 alunos ativos):** R$ 790,00/mês — Módulo completo de retenção (R.O.T.A.®), versionamento de fichas, acompanhamento de adesão e suporte prioritário.
- **Enterprise (Até 1.000 alunos ativos):** R$ 1.290,00/mês — Gestão multiunidade, relatórios avançados de churn e SLAs dedicados.
- **Custom (Redes/Multiunidades):** Sob consulta — Estruturas com personalização avançada de branding, suporte presencial dedicado e integrações sob demanda.

> Implementação: `organizations.plano_b2b` (enum) guarda o plano contratado; ainda não há tabela de preços B2B no banco (só documental aqui).

### 2. Licenças de Atacado (Wholesale) vs. Sugestão de Varejo (por aluno/mês)
A academia compra pelo custo de Atacado da ARKE e define o preço de Varejo (markup) cobrado do aluno. O Split Automático de Pagamento liquida os valores no checkout (Asaas).

| Nível | Custo Atacado ARKE | Sugestão de Varejo | Margem Sugerida da Academia |
|---|---|---|---|
| **Essencial** (Treino ARKE) | R$ 15,00 | R$ 39,90 | R$ 24,90 |
| **Integrado** (Treino + Nutrição) | R$ 45,00 | R$ 119,00 | R$ 74,00 |
| **Elite** (Acompanhamento 360°) | R$ 85,00 | R$ 199,00 | R$ 114,00 |

- **Essencial:** Onboarding M.A.P.A.®, prescrição de treino individualizada com snapshot imutável, aplicativo de treino/diário e suporte a dificuldades.
- **Integrado:** Tudo do Essencial + plano alimentar individualizado, acompanhamento por Nutricionista ARKE, check-ins semanais (R.O.T.A.®) e revisão integrada.
- **Elite:** Tudo do Integrado + acolhimento expandido, encontros periódicos de acompanhamento, relatórios de evolução corporal (A.P.E.X.®/L.E.G.A.D.O.®) e fila prioritária.

> Implementação: `planos_atacado` (custo de atacado + `valor_sugerido_varejo`) e `organization_planos_precificacao` (valor de varejo e markup definidos por organização — pré-preenchido com a sugestão ARKE via trigger ao criar a organização, editável livremente depois pela academia).

### 3. Matriz de Repasse Financeiro no Gateway (Split no Asaas)
No momento da cobrança da assinatura do aluno:
1. `valor_repasse_arke` = `planos_atacado.custo_mensal` (R$ 15/45/85) → direto para a conta da ARKE.
2. `valor_liquido_academia` = `valor_total_cobrado - valor_repasse_arke` → direto para a conta/wallet da academia (`organizations.asaas_wallet_id`).

> Implementação: `aluno_assinaturas` (assinatura recorrente) + `pagamentos` (registro de cada cobrança com o split já calculado) + `asaas_webhook_events` (log/auditoria idempotente dos eventos do gateway). Edge Functions `asaas-create-subscription` e `asaas-webhook`.

## Configuração do Gateway de Pagamento (Asaas) — CONCLUÍDA

**A integração com o Asaas está configurada e funcionando. Não tratar como pendência e não perguntar sobre isso.**

- `ASAAS_API_KEY` e `ASAAS_WEBHOOK_SECRET` estão gravados nos secrets do projeto Supabase.
- `CRON_SECRET` também está gravado (ver pendência (2) abaixo sobre a função que ele protege).
- O webhook do Asaas está apontado para a Edge Function `asaas-webhook`, que valida o header `asaas-access-token` contra o secret.

Confirmado pelo responsável pelo projeto em 20/09/2026. As sessões do Claude Code não têm saída de rede para `*.supabase.co`, então isto não é verificável de dentro do agente — vale como configuração declarada, e o lugar para checar o funcionamento real é o painel **Visão Master → Webhooks** (`/superadmin/webhooks`), que mostra cada evento recebido e o que ele efetivamente fez no banco.

## Trial e Bloqueio por Pagamento

### Trial não é oferta comercial
O status `trial` de `organizations` existe **apenas como ferramenta de homologação do Super Admin**. Não há período de testes comercial para ninguém — nem B2B, nem planos ARKE do aluno. Organização em `trial` nunca é bloqueada por pendência financeira, justamente por não ser cliente. `public.arke_trial_dias()` (15) segue definindo o prazo dessas organizações de teste.

### Gatilho do bloqueio: emitida e vencida
O acesso é cortado quando existe cobrança **emitida cujo vencimento passou sem confirmação de pagamento** — não por "nunca pagou". Cliente que ainda não foi cobrado continua acessando: bloquear quem nunca recebeu cobrança seria defeito, não política.

A regra B2B mora em `public.organizacao_inadimplente_b2b()` e é servida ao frontend por `public.get_bloqueio_organizacao()`. Ela considera atrasada a cobrança com `status = 'atrasado'` (webhook `PAYMENT_OVERDUE` do Asaas) **ou** com `vencimento < current_date` e sem confirmação — a segunda condição é a rede de segurança para webhook perdido, que de outro modo viraria acesso liberado indefinidamente.

### Quem é bloqueado
- **B2B (`OrganizacaoBillingGate`, rotas `/admin`):** apenas a **equipe** da academia — gestor, professor, nutricionista. Os alunos dela **seguem treinando**: o contrato B2B é com a academia, e o aluno que pagou a mensalidade não deu causa ao atraso.
- **B2C (`AlunoBillingGate`, rotas `/app`):** o aluno cuja assinatura do Método ARKE está `atrasada`.
- **Nunca bloqueados:** Super Admin e Admin ARKE (são eles que resolvem a cobrança; trancá-los tornaria o problema insolúvel pelo produto) e organizações em `trial`.

> Os dois gates são de experiência, não fronteiras de segurança — o que protege os dados continua sendo o RLS de cada tabela.

## Motor de Automações e Regras Operacionais
- **Prevenção de Falha Humana:** Eventos da jornada viram tarefas automáticas com responsável, prazo (SLA) e prioridade[span_81](start_span)[span_81](end_span).
- **Sinais de Atenção Automáticos:**
  * Aluno sem 1º acesso após 48h → Tarefa de ativação[span_82](start_span)[span_82](end_span).
  * 2 treinos previstos sem registro → Tarefa de verificação de barreira[span_83](start_span)[span_83](end_span).
  * Relato de dor no treino → Alerta de revisão profissional antes do próximo treino[span_84](start_span)[span_84](end_span).
  * Resposta de atendimento atrasada → Escalonamento automático para o gestor da unidade[span_85](start_span)[span_85](end_span).
- **Proteção Anti-Duplicação e Idempotência:** Eventos repetidos não geram tarefas duplicadas. Pausas e cancelamentos encerram automações ativas imediatamente[span_86](start_span)[span_86](end_span).

## Arquitetura de Proteção e Resiliência Operacional
- **Versionamento Imutável:** Prescrições publicadas possuem snapshot travado (`versao_id`). Alterar modelos na biblioteca global não altera planos em uso por alunos[span_87](start_span)[span_87](end_span).
- **Sanitização de Dados:** Módulo de ingestão de arquivos CSV com validação rígida de e-mails, telefones e CPFs[span_88](start_span)[span_88](end_span).
- **Privacidade e LGPD:** Dados sensíveis (anamnese, fotos de avaliação corporal) possuem RLS estrito e acesso restrito ao profissional vinculado ao atendimento[span_89](start_span)[span_89](end_span).

## Sequência de Desenvolvimento (Phases)
- **Fase 1 ✅:** Reset do repositório, Setup SQL Unificado com Multitenant estrito, Auth e RLS por Tenant.
- **Fase 2 ✅:** Onboarding M.A.P.A.® simplificado, UX de ajuda rápida e Anamnese de Acolhimento.
- **Fase 3 ✅:** Prescrição e Versionamento Imutável de Treinos/Dietas.
- **Fase 4 ✅:** Central de Atendimento "Minha Fila" (com registro obrigatório de desfecho), Check-ins R.O.T.A.® e Automações de SLA.
- **Fase 5 ✅:** Módulo de Margens/Markup por Academia, Split de Pagamento (Asaas) e Dashboards de Retenção Comercial.

> As 5 fases do plano inicial estão implementadas e **não há pendências abertas** do plano original. As duas que existiam foram encerradas em 20/09/2026:
>
> - **Telas do protótipo em `src/_legacy` — encerrada por reconstrução.** O diretório não existe mais: os 60 arquivos (21.904 linhas) foram removidos no PR #81, e as cinco áreas citadas foram refeitas sobre o schema multitenant, todas com `organization_id` e RLS: gamificação/desafios (`desafios` + `/app/desafios`), competições (`competicoes` + `/app/competicoes`), feed social (`feed_posts` + `/app/feed`), catracas (`organizacao_catracas` + `acessos_catraca_logs` + `/admin/catracas` + Gateway Local) e chat (`mensagens_treino`/`mensagens_dieta` + `ChatPanel`). Nada do protótipo ficou esperando porte.
> - **Edge Function `check-notifications` — encerrada por remoção.** Era resquício pré-reset e não sobrevivia ao schema atual (referenciava 4 tabelas inexistentes e consultava outras 3 com `profiles.user_id` onde a chave é `alunos.id`), não tinha filtro por organização e usava cópia punitiva que a metodologia abandonou. Estava fail-closed por `CRON_SECRET`, sem nenhum `cron.schedule` e sem nenhum chamador. Foi removida em vez de portada, seguindo o mesmo critério do `_legacy`; o histórico do git preserva o código (PR #171). A Edge Function publicada também foi excluída do projeto Supabase em 20/09/2026 — não resta nada dela no ambiente. A infraestrutura de push continua de pé (`send-chat-push`, `vapid-public-key`, `push_subscriptions`) — o que saiu foi só a varredura diária de lembretes. Se a funcionalidade voltar, volta desenhada para o multitenant, com preferências por aluno e linguagem alinhada à gamificação positiva.
