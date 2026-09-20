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

  > Implementação: `src/lib/proximaAcao.ts` (`definirProximaAcao`) decide o único bloco de topo da home do aluno, na ordem *ficha ainda não publicada* → *treinar hoje* → *check-in do dia* → *hidratação* → *em dia*. É função pura justamente para a regra ficar testável sem subir Supabase. "Em dia" é desfecho legítimo: sem ele a tela inventaria pendência só para ter o que mostrar, e quando a ficha ainda não saiu o card não oferece botão — a bola está com a academia, e mandar o aluno procurar algo que não existe seria pior do que dizer a verdade. Abaixo dela vêm Progresso Semanal, Próximo Evento, o check-in (`#check-in-do-dia`) e o registro de alerta; atalhos de navegação, água (`#diario-agua`) e pontuação de engajamento ficam no segundo plano, como manda a diretriz.
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
O `trial` existe **apenas como ferramenta de homologação**, nunca como oferta. Não há período de testes comercial para ninguém. `public.arke_trial_dias()` (15) define o prazo dos dois lados.

- **B2B** — `organizations.status = 'trial'`: o tenant usa a plataforma inteira, tem `trial_vencimento` e nunca é bloqueado por pendência financeira, justamente por não ser cliente.
- **B2C** — `aluno_assinaturas.status = 'trial'`: o espelho, por aluno e **por nível** (essencial, integrado, elite), já que cada nível entrega coisas diferentes e a jornada muda. Iniciado por `iniciar_trial_metodo_arke(_aluno_id, _nivel)` e desfeito por `encerrar_trial_metodo_arke(_aluno_id)`, ambos restritos à equipe da academia ou à ArkeFit. Não cria customer nem subscription no Asaas, e grava `valor_cobrado = 0` para a linha não ser confundida com assinatura real. Disponível na ficha do aluno, bloco **Método ARKE**.

O trial B2C ativa `metodo_arke_status`, e é isso que põe o aluno no onboarding M.A.P.A.® — é o ponto de homologar a jornada de verdade. Consequência a ter em conta: o aluno em trial conta como aderente nas métricas de adoção da metodologia. Isso é correto (ele está de fato usando o Método) e não contamina receita, que exige pagamento liquidado.

### Gatilho do bloqueio: emitida e vencida
O acesso é cortado quando existe cobrança **emitida cujo vencimento passou sem confirmação de pagamento** — não por "nunca pagou". Cliente que ainda não foi cobrado continua acessando: bloquear quem nunca recebeu cobrança seria defeito, não política.

A regra B2B mora em `public.organizacao_inadimplente_b2b()` e é servida ao frontend por `public.get_bloqueio_organizacao()`. Ela considera atrasada a cobrança com `status = 'atrasado'` (webhook `PAYMENT_OVERDUE` do Asaas) **ou** com `vencimento < current_date` e sem confirmação — a segunda condição é a rede de segurança para webhook perdido, que de outro modo viraria acesso liberado indefinidamente.

### Quem é bloqueado
- **B2B (`OrganizacaoBillingGate`, rotas `/admin`):** apenas a **equipe** da academia — gestor, professor, nutricionista. Os alunos dela **seguem treinando**: o contrato B2B é com a academia, e o aluno que pagou a mensalidade não deu causa ao atraso.
- **B2C (`AlunoBillingGate`, rotas `/app`):** o aluno cuja assinatura do Método ARKE está `atrasada`.
- **Nunca bloqueados:** Super Admin e Admin ARKE (são eles que resolvem a cobrança; trancá-los tornaria o problema insolúvel pelo produto) e organizações em `trial`.

> Os dois gates são de experiência, não fronteiras de segurança — o que protege os dados continua sendo o RLS de cada tabela.

### Assinatura exige adesão ao Método
Criar assinatura do Método para aluno sem adesão ativa é recusado em dois pontos: na Edge Function `asaas-create-subscription`, **antes** de qualquer chamada ao gateway (senão a assinatura nasceria no Asaas e só depois seria rejeitada, deixando órfão), e no banco pelo trigger `trg_assinatura_exige_adesao`, que cobre qualquer caminho de escrita — inclusive `service_role`, que ignora RLS. `nivel_atacado` fica preenchido mesmo em aluno `sem_adesao`, então ele sozinho nunca autoriza cobrança.

### Primeiro acesso do aluno
`alunos.primeiro_acesso_em` é gravado por `registrar_primeiro_acesso_aluno()` (RPC, `security definer`, idempotente), nunca por UPDATE direto do cliente: o aluno tem apenas SELECT na policy de `alunos`, e o update silenciosamente descartado pelo RLS deixava o campo nulo para todo mundo — fazendo a automação de "48h sem 1º acesso" abrir tarefa para quem já tinha entrado.

## Vínculo do Usuário com a Organização

Uma pessoa pode ter vínculo ativo em mais de uma organização — gestor de uma academia e aluno de outra, professor em duas unidades da mesma rede. O `AuthContext` lia esse vínculo com `.maybeSingle()`, então o caso legítimo virava erro e a pessoa entrava **sem organização nenhuma**, fora do painel que ela própria administra.

`escolherVinculo()` (`src/lib/vinculos.ts`) resolve a escolha por hierarquia — gestor → professor → nutricionista → aluno — e desempata pelo vínculo mais antigo. O critério é o do dano: quem administra precisa do painel, e entrar como aluno tranca. Papel desconhecido vai para o fim da fila em vez de derrubar a escolha. Trocar de organização na sessão ainda não existe; quando existir, é aqui que entra.

## Limpeza do Ambiente de Homologação (20/09/2026)

Os dados de teste acumulados na homologação foram removidos do projeto Supabase. Ficou **uma** organização real — Tietê Fitness — e nenhuma linha apontando para organização ou usuário inexistente. Cada exclusão tem registro em `auditoria_acoes_sensiveis` (visível em **Visão Master → Auditoria**) com motivo e inventário do que caiu por cascata, porque `organizations` só dispara auditoria em UPDATE: sem a linha gravada à mão, a exclusão sumiria sem rastro.

- **Org `Teste Jean`** (1 membro, 0 alunos) — criada por engano durante os testes e responsável pelo vínculo duplo do usuário `ramos.jean1417@gmail.com`, que era gestor dela e aluno de Tietê ao mesmo tempo. Removida; ele voltou a ter um vínculo só. Nenhum email foi alterado: trocar o endereço não separaria nada, já que era **um usuário com dois vínculos**, e o endereço novo levaria os dois junto.
- **Org `teste`** e as duas contas dela (`jean.ramos@blips.com.br`, `metodosvitae@gmail.com`) — continha a única jornada completa do banco (anamnese → 2 treinos → dieta → check-in → registro, Método ativo). Excluída a pedido, com a jornada junto; homologar de novo exige refazê-la.
- **18 linhas órfãs** de um tenant que não existia mais (1 aluno, 2 vínculos, 5 modelos de treino, 5 de dieta, 3 de precificação, 2 profiles), resíduo do bootstrap de QA de 19/09 20:59. Os deletes usaram o predicado de orfandade (`not exists … organizations`), não o id fixo — assim a limpeza é auto-limitada e pega qualquer resíduo do mesmo tipo.
- **Edge Function `qa-bootstrap-temp`** — já estava neutralizada (stub `410 disabled`) e nunca teve código no repositório. Excluída do painel em 20/09/2026; não resta nada dela no ambiente.

Duas pontas ficaram em aberto e não são fechadas por essa limpeza:

1. **O mecanismo da orfandade não foi explicado.** `alunos_organization_id_fkey`, `organization_members_user_id_fkey` e `profiles_user_id_fkey` são `ON DELETE CASCADE` e estão validadas, e ainda assim aquelas linhas sobreviveram à exclusão dos pais. A hipótese é limpeza rodada com `session_replication_role = 'replica'`, que desliga os triggers de FK — mas não foi confirmada. Enquanto não for, apagar tenant por fora do produto pode deixar o mesmo rastro. O sintoma foi tratado; a causa, não.
2. **`create-user`, `delete-user` e `update-user`** existem em `supabase/functions/` mas **não estão publicadas**. Ou são resquício para remover, ou falta deploy — a divergência entre repositório e ambiente segue por decidir.

## Progressão da Jornada do Aluno

As cinco fases — M.A.P.A.® → B.A.S.E.® → R.O.T.A.® → A.P.E.X.® → L.E.G.A.D.O.® — **são movidas pela equipe**, manualmente, no bloco *Fase da Jornada* da ficha do aluno. A decisão foi não automatizar: quem convive com o aluno é quem sabe se ele mudou de fase, e um gatilho erraria justamente nos casos que mais importam.

`mover_fase_jornada(_aluno_id, _fase, _observacao)` faz o movimento e registra autor, data e motivo em `aluno_fase_historico` — a fase orienta o atendimento, então uma mudança sem autor não se explica depois. Restrita à equipe da academia ou à ArkeFit; o próprio aluno não move a sua fase. Mover para a fase em que o aluno já está é aceito mas não gera linha no histórico.

A única transição automática que permanece é M.A.P.A.® → B.A.S.E.®, ao publicar a primeira prescrição, e ela passou a exigir **anamnese concluída**. Antes avançava sem olhar o acolhimento, o que produzia aluno marcado como tendo passado pelo M.A.P.A.® sem ter passado. As demais fases esperam a equipe.

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
