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

| Nível | Custo Atacado ARKE | Taxa de processamento* | Sugestão de Varejo | Margem Sugerida da Academia |
|---|---|---|---|---|
| **Essencial** (Treino ARKE) | R$ 15,00 | R$ 1,68 | R$ 39,90 | R$ 23,22 |
| **Integrado** (Treino + Nutrição) | R$ 45,00 | R$ 4,05 | R$ 119,00 | R$ 69,95 |
| **Elite** (Acompanhamento 360°) | R$ 85,00 | R$ 6,44 | R$ 199,00 | R$ 107,56 |

* Taxa do Asaas, somada ao atacado (decisão de 21/09/2026): 2,99% + R$ 0,49 sobre o valor cobrado, configurável em Visão Master → Configurações. Os valores acima são no preço sugerido; com outro varejo, a taxa acompanha.

- **Essencial:** Onboarding M.A.P.A.®, prescrição de treino individualizada com snapshot imutável, aplicativo de treino/diário e suporte a dificuldades.
- **Integrado:** Tudo do Essencial + plano alimentar individualizado, acompanhamento por Nutricionista ARKE, check-ins semanais (R.O.T.A.®) e revisão integrada.
- **Elite:** Tudo do Integrado + acolhimento expandido, encontros periódicos de acompanhamento, relatórios de evolução corporal (A.P.E.X.®/L.E.G.A.D.O.®) e fila prioritária.

> Implementação: `planos_atacado` (custo de atacado + `valor_sugerido_varejo`) e `organization_planos_precificacao` (valor de varejo e markup definidos por organização — pré-preenchido com a sugestão ARKE via trigger ao criar a organização, editável livremente depois pela academia).

### 3. Matriz de Repasse Financeiro no Gateway (Split no Asaas)
No momento da cobrança da assinatura do aluno:
1. `valor_repasse_arke` = `planos_atacado.custo_mensal` + `arke_taxa_processamento(valor_total_cobrado)` → direto para a conta da ARKE, que é de onde o Asaas desconta a taxa. Travado em `aluno_assinaturas.valor_repasse_arke` na criação.
2. `valor_liquido_academia` = `valor_total_cobrado - valor_repasse_arke` → direto para a conta/wallet da academia (`organizations.asaas_wallet_id`).

> Implementação: `aluno_assinaturas` (assinatura recorrente) + `pagamentos` (registro de cada cobrança com o split já calculado) + `asaas_webhook_events` (log/auditoria idempotente dos eventos do gateway). Edge Functions `asaas-create-subscription` e `asaas-webhook`.

## Configuração do Gateway de Pagamento (Asaas) — CONCLUÍDA

**A integração com o Asaas está configurada e funcionando. Não tratar como pendência e não perguntar sobre isso.**

- `ASAAS_API_KEY` e `ASAAS_WEBHOOK_SECRET` estão gravados nos secrets do projeto Supabase.
- `CRON_SECRET` também está gravado (ver pendência (2) abaixo sobre a função que ele protege).
- O webhook do Asaas está apontado para a Edge Function `asaas-webhook`, que valida o header `asaas-access-token` contra o secret.

Confirmado pelo responsável pelo projeto em 20/09/2026. O funcionamento real se confere no painel **Visão Master → Webhooks** (`/superadmin/webhooks`), que mostra cada evento recebido e o que ele efetivamente fez no banco. Registro anterior dizia que as sessões do Claude Code não tinham rede para `*.supabase.co`; isso depende do ambiente — numa sessão local em 21/09/2026 as edge functions publicadas responderam normalmente a chamadas diretas.

### Criação de assinatura: idempotente, e com CPF

"Configurada e funcionando" vale para a **ligação** — secrets, webhook apontado, token validado; os eventos chegam e ficam no painel. Mas até 21/09/2026 **nenhuma assinatura de aluno tinha sido criada** pelo ARKE: `aluno_assinaturas` tinha uma única linha, em `trial`, sem id no Asaas. `asaas-create-subscription` e `academia-criar-matricula` criavam customer sem `cpfCnpj`. O sandbox mostrou onde o Asaas cobra isso: o customer nasce sem CPF, mas a **assinatura** é recusada ("Para criar esta cobrança é necessário preencher o CPF ou CNPJ do cliente") — em produção a criação falharia antes de qualquer cobrança nascer. A B2B (`asaas-emitir-cobranca-b2b`) já fazia certo.

Corrigido junto, o defeito mais caro: nada impedia **duas assinaturas para o mesmo aluno**. Criou no Asaas, falhou ao gravar no banco, a tela seguia oferecendo "Tentar cobrar" — e a primeira assinatura ficava órfã, cobrando o aluno todo mês sem ninguém ver. A de plano próprio era ainda mais direta: conferia a matrícula ativa **depois** de criar a assinatura, então o 409 deixava a recém-criada lá. Hoje as duas:

- conferem o banco **antes** de tocar no gateway (assinatura ativa → 409);
- exigem CPF com mensagem que diz à equipe onde resolver;
- reaproveitam o customer (por `externalReference` do aluno, depois por CPF — a mesma pessoa em duas academias é um cliente só);
- usam `externalReference` com prefixo na assinatura — `metodo:<aluno>` e `plano:<aluno>`, na mesma convenção dos `org:`/`b2b:` da B2B — e consultam o Asaas por ele antes de criar. No Método, assinatura ativa encontrada lá é **adotada** (é o caso de ter criado e falhado ao gravar); no plano próprio é **recusada** com o id, porque pode ser de outro plano ou valor e adotá-la esconderia o problema.

**Conferido no sandbox do Asaas em 21/09/2026**, com os mesmos payloads das funções: reaproveitamento de customer por `externalReference` e por CPF, busca de assinatura ativa por `externalReference` (a base da idempotência), `GET /payments?subscription=` e `GET /payments/{id}` usados pela reconciliação, e a varredura de órfãs. Um achado para quem for configurar academia: **split para a própria carteira é recusado** ("Não é permitido split para sua própria carteira") — a `asaas_wallet_id` da academia tem que ser de outra conta Asaas, nunca a da ArkeFit. A `asaas_wallet_id` da Tietê Fitness (`00000000…`) é **placeholder de homologação, de propósito**: a conta Asaas real da academia depende do envio de documentos e dados jurídicos dela, e o split de produção é configurado quando a unidade oficial for integrada. Até lá, criar assinatura do Método para aluno da Tietê é recusado pelo Asaas — comportamento esperado, não defeito. Ao integrar: gravar a wallet real e rodar a criação de uma assinatura de ponta a ponta.

**Split conferido no sandbox com subconta (21/09/2026).** Uma subconta criada por `POST /accounts` fez o papel da academia. A assinatura saiu com o payload de `asaas-create-subscription` (Integrado: R$ 119, `fixedValue` 74 para a academia), e o split ficou registrado na assinatura e em cada cobrança. A academia enxerga os R$ 74 do lado dela. Uma cobrança no cartão com o mesmo split foi `CONFIRMED`, e o split passou a `AWAITING_CREDIT`: no cartão, a academia recebe no prazo de liquidação do cartão, não no ato. O Asaas também recusa split maior que o **valor líquido** ("excede o valor líquido da assinatura"); a função já barra antes, com o valor bruto.

**A taxa do Asaas sai da parte da ArkeFit.** Com `fixedValue` para a academia, o Asaas desconta a taxa do que sobra. Dos R$ 119, o líquido foi R$ 116,15 (taxa de R$ 2,85 no sandbox): a academia recebe os R$ 74 inteiros e a ArkeFit fica com **R$ 42,15, não R$ 45**. **Decisão (21/09/2026): a taxa entra no preço de atacado.** O repasse do Método passou a ser **custo do nível + taxa de processamento sobre o valor cobrado** — a mesma taxa configurável (`plataforma_config`, Visão Master → Configurações, hoje 2,99% + R$ 0,49) que a mensalidade de plano próprio já usava, calculada por `public.arke_taxa_processamento()`. Sobre o valor cobrado, e não somada a um custo fixo na tabela, porque a academia define o varejo livremente e a parte percentual acompanha: um custo fixo só acertaria no preço sugerido. No Integrado a R$ 119: ArkeFit R$ 49,05 (45 + 4,05), academia R$ 69,95. O repasse fica **travado em `aluno_assinaturas.valor_repasse_arke`** na criação, porque o split fica fixo no Asaas — o webhook usa esse valor, não o custo ou a taxa do dia. A tela de precificação mostra a divisão já com a taxa (`src/lib/repasse.ts`, testado contra a função do banco) e recusa varejo que não cubra o repasse.

**E a receita passou a ser líquida.** Cada cobrança guarda a taxa que o Asaas de fato descontou (`taxa_gateway` = `value - netValue` do evento, em `pagamentos`, `mensalidades` e `cobrancas_b2b`); a estimativa configurada serve só para montar o split. Na Visão Master, *Repasse ARKE líquido no mês* e o *Take Rate* descontam essa taxa, inclusive da B2B, que antes entrava bruta. *MRR Global* continua sendo o volume cobrado na plataforma (academias + ArkeFit), não a receita da ArkeFit. No Gestão 360 da academia, o repasse do DRE e do MRR líquido passou a incluir a taxa — e o que a ArkeFit retém das mensalidades de plano próprio, que antes era ignorado e inflava o resultado da academia. A taxa configurada (2,99%) é a de tabela; no sandbox a conta está com 1,99% promocional até 08/12/2026, então por ora a ArkeFit fica com um pouco mais que o atacado (R$ 46,20 no Integrado). Se a taxa contratada em produção for outra, basta ajustar em Configurações — vale só para assinaturas novas.

### Cobrança automática no cartão (desligada até validar em sandbox)

A assinatura do Método nascia com `billingType: UNDEFINED`: todo mês o aluno recebia a fatura e tinha que lembrar de pagar — a porta de entrada da evasão involuntária. `asaas-cartao-assinatura` põe o cartão direto na assinatura (`PUT /v3/subscriptions/{id}/creditCard`) e liga `CREDIT_CARD`; o Asaas cobra os meses seguintes sozinho. **Tokenização não é necessária** para isso — ela serve para reusar um cartão em cobranças diferentes, e o ARKE tem uma assinatura por aluno —, então o caminho não depende da habilitação de tokenização em produção.

**O cartão é só de passagem, e isso é o desenho, não um detalhe.** A API do Asaas exige a chave secreta, então o número atravessa a edge function — o ARKE entra no escopo do PCI DSS. Por isso: o corpo da requisição nunca vai para log (nem em erro; os logs trazem só status HTTP e códigos de erro do Asaas, porque a descrição pode ecoar dado do cartão); o banco guarda só `cartao_final` (4 dígitos, com `check` que recusa o número inteiro) e `cartao_bandeira`; o token do Asaas também não é guardado; o componente `CartaoAssinatura` mantém o cartão só no estado do diálogo, fora do `useRascunho`, e apaga ao fechar ou salvar; e o Sentry remove qualquer objeto sob as chaves `cartao`/`titular`.

**Ordem das chamadas: tipo de cobrança primeiro, cartão depois — e o sandbox é que decidiu.** A primeira versão fazia o contrário, raciocinando que assim toda falha seria segura; no sandbox o Asaas recusou o cartão em 100% dos casos com "Esta assinatura não é do tipo cartão de crédito". Mandar os dois juntos no `PUT /subscriptions/{id}` é pior: responde 200, troca o tipo e **ignora o cartão em silêncio**. A ordem que funciona deixa uma janela — tipo trocado, cartão recusado —, então a recusa **desfaz a troca de tipo, mas só quando fomos nós que trocamos**: numa troca de cartão a assinatura já era `CREDIT_CARD` e o Asaas mantém o cartão antigo quando recusa o novo; reverter ali desligaria a cobrança automática de quem já pagava no cartão. Enquanto uma troca de cartão aguarda a próxima cobrança, o Asaas recusa outra ("atualização de cartão em andamento"), e a função devolve 409 dizendo que o cartão atual continua valendo. As chamadas ficam em `asaas-cartao-assinatura/fluxo.ts`, sem Deno nem Supabase, justamente para `npm run sandbox:cartao` (`scripts/asaas-sandbox-cartao.mjs`, só aceita chave `$aact_hmlg_`) exercitar o código real, não uma cópia: 11 verificações — cartão aprovado, recusado (tipo volta para fatura, cobrança pendente também) e troca bloqueada (cartão anterior mantido).

Quem cadastra: o próprio aluno (Perfil → Pagamento) ou gestor/recepção (ficha do aluno → Método ARKE); o papel é conferido com a organização fixada. **Recusa na cobrança recorrente** (`PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`) não corta acesso — a cobrança ainda não venceu, e quem corta por vencimento é `aluno_inadimplente_b2c` —, mas marca `cartao_recusado_em`, guarda o link da fatura e abre tarefa `cobranca` de prioridade alta (`abrir_tarefa_cartao_recusado`, idempotente por pagamento). Pagamento confirmado limpa a marca.

**Dois interruptores, os dois desligados:** o secret `CARTAO_RECORRENTE_ATIVO` na edge function (sem ele responde 503 sem tocar no Asaas — verificado contra a função publicada) e `VITE_CARTAO_RECORRENTE` no frontend (sem ele a tela mostra a forma de pagamento e não oferece cadastro). O Asaas confirmou a captura de cartão pela API habilitada na conta de produção, e o fluxo passou no sandbox. **O que o sandbox não alcança:** a cobrança mensal efetivamente capturada no cartão (o sandbox não avança o relógio até o vencimento, e com cobrança vencendo no mesmo dia a troca de tipo responde 500) e o webhook `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` de verdade. Os dois só aparecem na primeira virada de mês com cartão real — conferir em **Visão Master → Webhooks** nesse dia.

## Trial e Bloqueio por Pagamento

### Trial não é oferta comercial
O `trial` existe **apenas como ferramenta de homologação**, nunca como oferta. Não há período de testes comercial para ninguém. `public.arke_trial_dias()` (15) define o prazo dos dois lados.

- **B2B** — `organizations.status = 'trial'`: o tenant usa a plataforma inteira, tem `trial_vencimento` e nunca é bloqueado por pendência financeira, justamente por não ser cliente.
- **B2C** — `aluno_assinaturas.status = 'trial'`: o espelho, por aluno e **por nível** (essencial, integrado, elite), já que cada nível entrega coisas diferentes e a jornada muda. Iniciado por `iniciar_trial_metodo_arke(_aluno_id, _nivel)` e desfeito por `encerrar_trial_metodo_arke(_aluno_id)`, ambos restritos à equipe da academia ou à ArkeFit. Não cria customer nem subscription no Asaas, e grava `valor_cobrado = 0` para a linha não ser confundida com assinatura real. Disponível na ficha do aluno, bloco **Método ARKE**.

O trial B2C ativa `metodo_arke_status`, e é isso que põe o aluno no onboarding M.A.P.A.® — é o ponto de homologar a jornada de verdade. Consequência a ter em conta: o aluno em trial conta como aderente nas métricas de adoção da metodologia. Isso é correto (ele está de fato usando o Método) e não contamina receita, que exige pagamento liquidado.

### Gatilho do bloqueio: emitida e vencida
O acesso é cortado quando existe cobrança **emitida cujo vencimento passou sem confirmação de pagamento** — não por "nunca pagou". Cliente que ainda não foi cobrado continua acessando: bloquear quem nunca recebeu cobrança seria defeito, não política.

A regra B2B mora em `public.organizacao_inadimplente_b2b()` e é servida ao frontend por `public.get_bloqueio_organizacao()`. Ela considera atrasada a cobrança com `status = 'atrasado'` (webhook `PAYMENT_OVERDUE` do Asaas) **ou** com `vencimento < current_date` e sem confirmação — a segunda condição é a rede de segurança para webhook perdido, que de outro modo viraria acesso liberado indefinidamente.

O lado B2C tem o espelho disso desde 21/09/2026, em `public.aluno_inadimplente_b2c()` e `public.get_bloqueio_aluno(_aluno_id)`. Até então não tinha: o `AlunoBillingGate` lia `aluno_assinaturas.status` direto, e esse campo só muda quando um webhook chega — um `PAYMENT_OVERDUE` perdido deixava a assinatura `ativa` para sempre e o aluno treinando de graça, em silêncio. Com 10 alunos é ruído; com 2.000 é o negócio.

Fechar isso exigiu duas coisas além da função. `pagamentos` não tinha coluna de **vencimento**, sem a qual não há como perguntar se a cobrança venceu; e o webhook **ignorava `PAYMENT_CREATED`**, então a linha em `pagamentos` só nascia no primeiro evento que mudasse status — ou seja, o `PAYMENT_OVERDUE` perdido não deixava linha nenhuma, e uma rede que olhasse só para `pagamentos` não teria o que pescar. Hoje a emissão é registrada como `pendente` com o `dueDate` do Asaas, e toda cobrança esperada tem registro.

Duas armadilhas ficaram documentadas no código porque não são óbvias:

- **Evento fora de ordem não pode rebaixar cobrança paga.** O Asaas não garante ordem de entrega, e um `PAYMENT_UPDATED` chegando depois da confirmação devolveria a cobrança a `pendente` — que, com vencimento no passado, bloquearia justamente quem pagou. O guard `soEmissao` faz a emissão atualizar vencimento e fatura, nunca o status.
- **`proxima_cobranca` não serve como gatilho.** É gravada uma vez, na criação da assinatura, e nunca avançada por ninguém. Usá-la bloquearia todo aluno um mês depois da matrícula, inclusive quem paga em dia.

A emissão ficou restrita ao Método ARKE de propósito. Mensalidade de plano próprio da academia (`mensalidades`) tem `status` `NOT NULL`, então criar a linha na emissão quebraria o upsert; estender a rede para lá é trabalho à parte, com status explícito.

`get_bloqueio_aluno` recebe o `_aluno_id` que o `AuthContext` já resolveu em vez de redescobri-lo por `user_id`. Quem é aluno de duas academias tem duas linhas legítimas, e escolher uma no escuro seria reencenar a armadilha do vínculo duplo; o `user_id` entra só para autorizar, senão qualquer pessoa autenticada leria a situação financeira de qualquer outra.

### Reconciliação Asaas ↔ banco: o lado oposto da rede de segurança

A rede de segurança acima fecha o `PAYMENT_OVERDUE` perdido, mas abre o lado oposto: se o que se perde é o `PAYMENT_CONFIRMED`, a cobrança fica "vencida e não confirmada" no banco e **quem pagou é bloqueado**. Vale para B2C e B2B. Só perguntar ao Asaas resolve.

`asaas-reconciliar` confere cada cobrança em aberto com o Asaas e, quando diverge, **reenvia o evento ao próprio `asaas-webhook`** (id `reconciliacao:<pagamento>:<status>`). O efeito no banco sai do mesmo código dos webhooks de verdade — não há uma segunda implementação de "o que fazer quando confirma" para divergir da primeira —, a correção aparece no painel de webhooks com origem clara, e a mesma divergência reenviada duas vezes não repete efeito. Dois modos:

- **Varredura diária** (`arke-reconciliacao-asaas`, 04:30 UTC, antes das rotinas que abrem tarefa pela manhã): Método, plano próprio e B2B, mais a lista de **assinaturas órfãs** — ativas no Asaas com `externalReference` `metodo:`/`plano:` que o banco não conhece, ou seja, alguém sendo cobrado sem registro. Órfã não se corrige sozinha (pode ser de outro plano ou valor); vai para `reconciliacoes_asaas` e para a faixa vermelha da Visão Master. O cron autentica com um token gerado pelo próprio banco e guardado no **Vault** (`reconciliacao_asaas_token`) — nenhum segredo novo para configurar, e ele não aparece escrito no comando do cron.
- **Sob demanda, pelo aluno**: o botão "Já paguei, verificar novamente" da tela de bloqueio antes só relia o banco — o que, com o `PAYMENT_CONFIRMED` perdido, não mudava nada. Agora pergunta ao Asaas antes. Freio de 30 s por aluno.

**Falha de consulta nunca vira "nada a corrigir".** A primeira versão devolvia nulo quando o Asaas não respondia, e uma chave inválida resultaria em "0 divergências, 0 órfãs, sem erro". Hoje consulta que falha vai para o campo `erro` da varredura (e para a faixa vermelha), e no modo aluno a resposta é 502 com mensagem, nunca um falso "tudo certo". A varredura rodada contra produção em 21/09/2026 terminou sem erro — o que, com essa regra, também confirma que a `ASAAS_API_KEY` dos secrets é válida.

Tabelas com `bigserial` precisam de `grant usage` na sequência para a `service_role`: os privilégios padrão do projeto cobrem tabela, não sequência, e todas as tabelas antigas usam uuid. Foi assim que a primeira varredura respondeu 200 sem gravar o registro (403 no insert).

### Quem é bloqueado
- **B2B (`OrganizacaoBillingGate`, rotas `/admin`):** apenas a **equipe** da academia — gestor, professor, nutricionista. Os alunos dela **seguem treinando**: o contrato B2B é com a academia, e o aluno que pagou a mensalidade não deu causa ao atraso.
- **B2C (`AlunoBillingGate`, rotas `/app`):** o aluno cuja assinatura do Método ARKE está `atrasada` **ou** que tem cobrança emitida e vencida sem confirmação. Assinatura em `trial` ou `cancelada` nunca bloqueia.
- **Nunca bloqueados:** Super Admin e Admin ARKE (são eles que resolvem a cobrança; trancá-los tornaria o problema insolúvel pelo produto) e organizações em `trial`.

> Os dois gates são de experiência, não fronteiras de segurança — o que protege os dados continua sendo o RLS de cada tabela.

### Assinatura exige adesão ao Método
Criar assinatura do Método para aluno sem adesão ativa é recusado em dois pontos: na Edge Function `asaas-create-subscription`, **antes** de qualquer chamada ao gateway (senão a assinatura nasceria no Asaas e só depois seria rejeitada, deixando órfão), e no banco pelo trigger `trg_assinatura_exige_adesao`, que cobre qualquer caminho de escrita — inclusive `service_role`, que ignora RLS. `nivel_atacado` fica preenchido mesmo em aluno `sem_adesao`, então ele sozinho nunca autoriza cobrança.

### Primeiro acesso do aluno
`alunos.primeiro_acesso_em` é gravado por `registrar_primeiro_acesso_aluno()` (RPC, `security definer`, idempotente), nunca por UPDATE direto do cliente: o aluno tem apenas SELECT na policy de `alunos`, e o update silenciosamente descartado pelo RLS deixava o campo nulo para todo mundo — fazendo a automação de "48h sem 1º acesso" abrir tarefa para quem já tinha entrado.

## Senha Vazada: substituta do recurso pago do Supabase

O Supabase bloqueia senha vazada a partir do plano pago. Enquanto o projeto está no free, a checagem é nossa, contra a API **Pwned Passwords** do HaveIBeenPwned — pública, gratuita e sem chave, diferente da API de vazamento de contas do mesmo serviço.

A senha não sai do navegador. O protocolo é k-anonimato: calcula-se o SHA-1 localmente, envia-se só os **5 primeiros caracteres** do hash, a API devolve as algumas centenas de sufixos daquela faixa com a contagem de cada um, e a comparação acontece aqui. O serviço recebe um prefixo compartilhado por milhares de senhas e não sabe qual foi consultada. O cabeçalho `Add-Padding` completa isso enchendo a resposta com registros falsos, para que o tamanho dela também não entregue a faixa — e esses registros vêm com **contagem zero** e precisam ser ignorados, senão o próprio mecanismo de privacidade recusaria senha limpa. SHA-1 aqui é só o índice do corpus do HIBP; não tem relação com como a senha é guardada (bcrypt, no Auth).

**Nenhum Auth Hook resolve isto.** O *Password Verification Hook* dispara na tentativa de login, para limitar tentativa e erro. O *Before User Created* recebe o registro de `auth.users` **sem a senha em claro** — e o que está lá é bcrypt, incompatível com o índice SHA-1 do HIBP —, além de só disparar na criação, nunca na troca de senha. Por isso a verificação mora em dois lugares:

- **`src/lib/senhaVazada.ts`**, no cliente, ligado em `Register`, `DefinirSenha` e `ResetPassword` — as três telas falam direto com o GoTrue, e ali não existe ponto de servidor nosso para interceptar.
- **`matricula-publica`**, no servidor, com a mesma lógica duplicada em Deno pelo motivo de sempre (edge function não importa do bundle do app). É a única entrada de senha que passa por código nosso, e por isso a única **autoritativa**: não dá para contornar chamando a função na mão, porque a função é o caminho.

**Falha aberta, de propósito.** HIBP fora do ar não pode impedir ninguém de criar conta ou recuperar senha. Isto é trava de qualidade de senha, não fronteira de segurança — transformar indisponibilidade de terceiro em cadastro bloqueado troca um risco pequeno por uma falha certa. Daí `verificou` no resultado: `senhaDeveSerRecusada()` só recusa quando a consulta de fato aconteceu.

A mensagem evita dizer "sua senha vazou": ela não vazou daqui, e sugerir isso assusta sem informar. O que houve é que a combinação já aparece em bases públicas de outros sites, o que a torna alvo de ataque automatizado.
## Matrícula Pública: limite de taxa e o erro que não chegava ao usuário

`matricula-publica` é endpoint público (`verify_jwt = false`) que cria usuário no Auth e linhas em `profiles`, `organization_members` e `alunos`. O único freio era não saberem o slug; no dia em que a academia divulgar o link, um script cria mil contas na conta dela — e cada uma conta contra o `limite_alunos` do plano, então o ataque também tranca a matrícula de quem é aluno de verdade.

O limite mora em `matricula_publica_tentativas` e em três funções que só a `service_role` alcança (`registrar_tentativa_matricula`, `matricula_publica_org_permitida`, `concluir_tentativa_matricula`). **Os números são folgados por IP de propósito:** alunos se matriculando no Wi-Fi da academia saem todos pelo mesmo IP, e o dia de lançamento — recepção cheia, QR code na parede — é exatamente quando um limite apertado bloquearia gente de verdade. Então: por IP, **30 tentativas em 15 min** e **20 matrículas concluídas por hora**; por organização, **60 concluídas por hora**, que é o teto que independe de quantos IPs o atacante tiver. A contagem por IP acontece antes de qualquer validação, para conter também o script que martela o endpoint com lixo; tentativa barrada não gera linha, então o ataque contido não faz a tabela crescer.

IP é dado pessoal: o banco guarda só **SHA-256 do IP com pimenta** (a service role key, que já está no ambiente da função e nunca vai ao cliente — sem pimenta, o hash de um IPv4 se reverte por força bruta em segundos). Linhas com mais de 24 h são apagadas na própria chamada, sem cron. Falha do limitador **libera** em vez de travar: com o banco fora, a matrícula falharia adiante de qualquer jeito, e travar ali só trocaria uma mensagem honesta por uma falsa de "muitas tentativas".

Verificado contra a função publicada em 21/09/2026: 30 requisições com payload inválido passaram (400), a 31ª em diante voltou **429** com a mensagem em português, e o banco guardou um único hash SHA-256 e nenhum valor com cara de IP.

**O erro que não chegava ao usuário.** Com status não-2xx, `supabase.functions.invoke` devolve `data: null` e um `FunctionsHttpError` cuja mensagem é sempre "Edge Function returned a non-2xx status code" — o texto que a função escreveu fica no corpo da resposta, em `error.context`. O padrão do app era `data?.error ?? error.message`, que parece cobrir o caso mas não cobre, porque é justamente `data` que vem nulo. Toda validação feita no servidor — e-mail repetido, CPF inválido, senha vazada, excesso de tentativas — chegava ao usuário como essa frase em inglês. `mensagemDeErroEdge()` (`src/lib/erroEdge.ts`) lê o corpo, e hoje as 22 chamadas de `functions.invoke` do app passam por ela — menos duas que não mostram erro a ninguém por desenho (`sendChatPush`, disparo em segundo plano; e o treino de boas-vindas do `Onboarding`, que só registra no console). O caso mais caro era a **importação de alunos**: cada linha com falha guardava a frase genérica como motivo, então "tentar de novo só as que falharam" listava o mesmo texto inútil em todas e escondia justamente o que a importação retomável existe para mostrar.

Como o vínculo duplo, este é um padrão que parece certo e por isso volta a cada tela nova. Em vez de confiar em lembrar, `src/lib/erroEdge.guarda.test.ts` lê o código-fonte: para cada `functions.invoke`, identifica a variável de erro que **aquela** chamada devolveu e falha se o resto do bloco a relançar crua ou ler `.message` direto. O escopo é o bloco, não uma janela de caracteres, porque o `onError` do `useMutation` logo abaixo usa `error.message` corretamente — ali `error` já é o Error montado com a mensagem real.

## Vínculo do Usuário com a Organização

Uma pessoa pode ter vínculo ativo em mais de uma organização — gestor de uma academia e aluno de outra, professor em duas unidades da mesma rede. O `AuthContext` lia esse vínculo com `.maybeSingle()`, então o caso legítimo virava erro e a pessoa entrava **sem organização nenhuma**, fora do painel que ela própria administra.

Navegar **não cria vínculo**. Até 20/09/2026, `AdminLayout` chamava `provisionar_organizacao_padrao()` sozinho para todo `admin_arke` sem organização: a pessoa ia a `/admin` e o layout criava a academia "Academia Piloto" e a vinculava como gestora dela. Um tenant nascia sem ninguém pedir — com seed de 5 modelos de treino, 5 de dieta e 3 linhas de precificação, linha no funil de conversão como `trial`, e um vínculo novo que passava a decidir o contexto da pessoa no app. Também havia dois atalhos que levavam a esse caminho por engano: *Sair do modo Super Admin* (que só fazia `navigate("/app")`, sem modo nenhum para sair) e *Visão do Aluno*, ambos abrindo o app do aluno vazio para quem não tem registro de aluno. Os três foram removidos, e a função foi derrubada do banco: o painel Super Admin já cria organização pelo caminho próprio (*+ Nova Organização* → `criar-organizacao-superadmin`), com nome, slug e plano escolhidos. Quem chega a `/admin` sem organização agora vê um empty state dizendo isso, e o *Painel de Gestão* no app do aluno só aparece quando existe organização. Para ver o produto pelos olhos de outro papel existe a simulação de perfil (`impersonar-perfil` + `ImpersonationBanner`), que troca a sessão de verdade, sinaliza com faixa permanente e devolve cada um à sua rota real ao sair.

`escolherVinculo()` (`src/lib/vinculos.ts`) resolve a escolha por hierarquia — gestor → professor → nutricionista → aluno — e desempata pelo vínculo mais antigo. O critério é o do dano: quem administra precisa do painel, e entrar como aluno tranca. Papel desconhecido vai para o fim da fila em vez de derrubar a escolha. Trocar de organização na sessão ainda não existe; quando existir, é aqui que entra.

## O Defeito do Vínculo Duplo (`.maybeSingle()` sobre `organization_members`)

Esta classe de defeito reapareceu quatro vezes em arquivos diferentes, o que já a qualifica como armadilha estrutural e não descuido pontual. O padrão é sempre o mesmo: consultar `organization_members` filtrando por `user_id` sem fixar a organização, e fechar com `.maybeSingle()`. Quem tem vínculo ativo em duas academias faz a consulta devolver duas linhas, `.maybeSingle()` rejeita, e a pessoa leva 403 — muitas vezes na própria academia que administra.

Uma varredura dedicada em 21/09/2026 encontrou mais cinco ocorrências, corrigidas com três receitas diferentes conforme o que a função sabe:

- **A organização do alvo já é conhecida** (`anonimizar-aluno`, `excluir-aluno`): perguntar direto se o chamador é gestor DAQUELA organização. Elimina a ambiguidade em vez de desempatá-la, e é a correção preferida sempre que possível.
- **A organização sai do vínculo do chamador** (`cadastrar-membro-equipe`): a escolha é genuinamente ambígua, então vale a regra de desempate de `escolherVinculo()` — vínculo de gestor mais antigo.
- **Os dois lados podem ter vários vínculos** (`gerar-link-ativacao`, `send-chat-push`): buscar listas e cruzar. Aqui a correção deixa a função mais correta, não só menos quebrada: em `send-chat-push` a pergunta real passa a ser "qual academia os dois têm em comum", e em `gerar-link-ativacao` fecha um buraco sutil — a versão anterior comparava o papel do alvo num vínculo possivelmente de outra academia.

`.eq("organization_id", ...)` junto de `.eq("user_id", ...)` é seguro: `organization_members` tem `unique(organization_id, user_id)`. `.order(...).limit(1)` antes do `.maybeSingle()` também é — foi por não ver o `.limit(1)` que a auditoria inicial reportou dois falsos positivos (`asaas-emitir-cobranca-b2b` e `superadmin-suporte-tenant` já estavam corretos).

## Higiene de Superfície no PostgREST

Toda função `returns trigger` herda EXECUTE do PUBLIC e aparece em `/rest/v1/rpc/<nome>`. Chamá-la fora do contexto de trigger só produz erro, mas não há razão para deixá-la alcançável: a migration `20261124010000` revoga EXECUTE de todas elas em bloco, e segue pegando as próximas automaticamente. As RPCs `get_superadmin_*` deixaram de aceitar chamada anônima pelo mesmo motivo — todas checam o papel por dentro, então não havia vazamento, mas 9 das 13 aceitavam sondagem sem login e 4 não, defesa em profundidade desigual sem motivo.

Revogar EXECUTE **não** afeta o disparo de triggers — o PostgreSQL não checa esse privilégio ao dispará-los. Foi verificado contra o banco real, em transação revertida, com `exigir_limite_alunos` e `set_updated_at`.

## Limpeza do Ambiente de Homologação (20/09/2026)

Os dados de teste acumulados na homologação foram removidos do projeto Supabase. Ficou **uma** organização real — Tietê Fitness — e nenhuma linha apontando para organização ou usuário inexistente. Cada exclusão tem registro em `auditoria_acoes_sensiveis` (visível em **Visão Master → Auditoria**) com motivo e inventário do que caiu por cascata, porque `organizations` só dispara auditoria em UPDATE: sem a linha gravada à mão, a exclusão sumiria sem rastro.

- **Org `Teste Jean`** (1 membro, 0 alunos) — criada por engano durante os testes e responsável pelo vínculo duplo do usuário `ramos.jean1417@gmail.com`, que era gestor dela e aluno de Tietê ao mesmo tempo. Removida; ele voltou a ter um vínculo só. Nenhum email foi alterado: trocar o endereço não separaria nada, já que era **um usuário com dois vínculos**, e o endereço novo levaria os dois junto.
- **Org `teste`** e as duas contas dela (`jean.ramos@blips.com.br`, `metodosvitae@gmail.com`) — continha a única jornada completa do banco (anamnese → 2 treinos → dieta → check-in → registro, Método ativo). Excluída a pedido, com a jornada junto; homologar de novo exige refazê-la.
- **18 linhas órfãs** de um tenant que não existia mais (1 aluno, 2 vínculos, 5 modelos de treino, 5 de dieta, 3 de precificação, 2 profiles), resíduo do bootstrap de QA de 19/09 20:59. Os deletes usaram o predicado de orfandade (`not exists … organizations`), não o id fixo — assim a limpeza é auto-limitada e pega qualquer resíduo do mesmo tipo.
- **Edge Functions `create-user`, `delete-user` e `update-user` — encerradas por remoção.** Entraram no commit do reset (`29f7b66`) e nunca foram tocadas: nunca publicadas, nunca chamadas por nenhuma tela, nunca editadas. Não é "falta deploy" — publicá-las seria pôr no ar código que não roda e que, se rodasse, apagaria dados atravessando organizações. O portão do chamador exigia `role in ('admin','super_admin')`, valores que não existem no enum `app_role` (`admin_arke, gestor, professor, nutricionista, aluno, superadmin, recepcao`), então respondiam 403 até para o Super Admin; `create-user` gravava `role: 'admin'`, inválido no mesmo enum; `delete-user` referenciava 30 tabelas, das quais **10 não existem** no schema atual, e filtrava `aluno_id = user_id` — o mesmo defeito de chave da `check-notifications`. Nenhuma das três tinha `organization_id`, contra a regra 1 do projeto. O produto já cobre o que elas prometiam, com tenant: `cadastrar-membro-equipe`, `convidar-membro` e `convidar-profissional-autonomo` (criação), `editar-membro-equipe` (edição), `excluir-aluno` e `anonimizar-aluno` (exclusão e LGPD). O histórico do git preserva o código.
- **Edge Function `qa-bootstrap-temp`** — já estava neutralizada (stub `410 disabled`) e nunca teve código no repositório. Excluída do painel em 20/09/2026; não resta nada dela no ambiente.

Com isso **repositório e ambiente passaram a bater exatamente**: 26 edge functions em `supabase/functions/`, as mesmas 26 publicadas, sem sobra de nenhum lado. Vale manter assim — função publicada sem código versionado não sobrevive a um `supabase functions deploy`, e código sem deploy vira exatamente a armadilha que estas três eram.

A ponta que ficava em aberto foi **fechada em 21/09/2026**:

**O mecanismo da orfandade é `session_replication_role = 'replica'`.** A hipótese foi testada em transação revertida e confirmada: a mesma exclusão de organização gera **0 órfãos** com os triggers de FK ligados e **linhas órfãs em 5 tabelas** com eles desligados — `modelos_treino=5, modelos_dieta=5, precificacao=3, alunos=1, status_historico=1`, que é exatamente o seed de uma organização nova e bate com o inventário de setembro. O cascade nunca esteve quebrado; o que quebra é excluir tenant por fora do produto com os triggers desligados, e isso não deixa erro, só rastro.

Como a causa é operacional e não estrutural, a defesa também é. Impedir não dá — quem tem privilégio para trocar o modo tem privilégio para tudo —, então a resposta é tornar barato conferir: `public.verificar_orfaos()` varre todas as FKs que apontam para `organizations` e conta o que ficou apontando para o vazio, sem lista de tabelas mantida à mão (tabela nova entra na varredura sozinha). Restrita à ArkeFit. **Rodar depois de qualquer exclusão de tenant feita fora do produto.**

## Progressão da Jornada do Aluno

As cinco fases — M.A.P.A.® → B.A.S.E.® → R.O.T.A.® → A.P.E.X.® → L.E.G.A.D.O.® — **são movidas pela equipe**, manualmente, no bloco *Fase da Jornada* da ficha do aluno. A decisão foi não automatizar: quem convive com o aluno é quem sabe se ele mudou de fase, e um gatilho erraria justamente nos casos que mais importam.

`mover_fase_jornada(_aluno_id, _fase, _observacao)` faz o movimento e registra autor, data e motivo em `aluno_fase_historico` — a fase orienta o atendimento, então uma mudança sem autor não se explica depois. Restrita à equipe da academia ou à ArkeFit; o próprio aluno não move a sua fase. Mover para a fase em que o aluno já está é aceito mas não gera linha no histórico.

A única transição automática que permanece é M.A.P.A.® → B.A.S.E.®, ao publicar a primeira prescrição, e ela passou a exigir **anamnese concluída**. Antes avançava sem olhar o acolhimento, o que produzia aluno marcado como tendo passado pelo M.A.P.A.® sem ter passado. As demais fases esperam a equipe.

## Catraca: quem disca é o equipamento

O desenho original do Gateway Local assumia que **nós** discaríamos para a catraca por socket TCP de saída (`TcpDriverBase`), e os quatro drivers de fabricante eram stubs que lançavam erro. A documentação dos fabricantes mostrou que a premissa estava invertida: **o equipamento é o cliente e o gateway é o servidor**. Control iD fala HTTP/JSON; Topdata abre socket na porta 3570 com o protocolo proprietário "Inner" — em ambos, quem inicia a conexão é a catraca.

Por isso a abstração correta não é "driver que disca", é **gateway que escuta**. `GatewayService`, cache offline, fila de logs e o fail-closed continuam valendo inteiros; o que mudou foi por onde a leitura entra. `ReceptorDriver` é o objeto nulo para fabricantes desse tipo: sem conexão a abrir e sem comando a enviar depois, porque a liberação viaja na resposta da mesma requisição. O `ControlIdDriver` antigo foi removido em vez de mantido como stub — era o modelo errado, não um modelo incompleto.

**Control iD (modo Pro), implementado e testado:** o equipamento compara a digital internamente (1:N local, milissegundos) e faz `POST /new_user_identified.fcgi` com o número do usuário dele; respondemos `event: 7` mais a ação `catra` para liberar, ou `event: 6` sem ação para manter travado. `POST /device_is_alive.fcgi` é o heartbeat que tira o aparelho da contingência — responder é o que o traz de volta. Cartão e QR Code são negados com log: chegam com o valor bruto lido e ainda não há mapeamento para aluno, e adivinhar a quem o número pertence seria pior que negar.

**Nenhum dado biométrico trafega para decidir acesso.** O que atravessa a rede é identidade (`alunos.identificador_catraca`, único por organização) mais autorização. Não é só privacidade: mandar template pela rede a cada giro não fecha no tempo de uma catraca em horário de pico.

**Consentimento biométrico é separado do da anamnese.** Digital é dado pessoal sensível (LGPD art. 5º, II) e a base legal em academia é o consentimento específico e destacado (art. 11, I) — o termo de saúde da anamnese não cobre. `aluno_consentimento_biometrico` registra data, finalidade e retenção; `revogar_consentimento_biometrico()` marca a revogação e limpa o identificador, devolvendo o que precisa ser apagado no equipamento. Revogar sem apagar lá é descumprimento, não conformidade. A tela só libera o vínculo da digital depois do consentimento registrado.

**Topdata: documentação obtida, e ela decide a arquitetura.** O manual oficial do SDK Inner Acesso fechou a questão do protocolo — e a resposta é que **não existe protocolo de fio**: a integração sancionada é a `EasyInner.dll`, que é Windows 32 bits, exige .NET Framework 3.5, é **bloqueante** e **não thread-safe**. Nenhuma das três combina com Node: uma chamada bloqueante via FFI congelaria o event loop e, com ele, o receptor da Control iD, o diagnóstico e os timers — o gateway pararia a cada leitura de cartão. A saída é a que o próprio manual indica (§1.2.1): um processo-ponte em .NET (`ArkeInnerBridge`) que possui a DLL numa thread só e conversa com o gateway por HTTP local. Especificação em `docs/PONTE_TOPDATA.md`. O lado do ARKE já está implementado e testado em `receptores/topdata.ts` — a ponte não conhece regra de negócio, quem decide acesso continua sendo o gateway. O `TopdataDriver` stub foi removido pelo mesmo critério do `ControlIdDriver`: era modelo errado, não incompleto.

**O que os testes cobrem e o que não cobrem.** Como o protocolo da Control iD é HTTP documentado, os 10 testes de `receptorControlId.test.ts` simulam o equipamento com os payloads literais da documentação — é verificação real, e é o que separa isto dos stubs anteriores. O que só bancada com hardware resolve: semântica e timing da confirmação de giro, sentido de liberação (depende de como a catraca foi montada), ergonomia do cadastro remoto de digital com fila na recepção, variação de firmware, e qualidade de leitura em dedo de academia. Para a Topdata há ainda o que só a ponte confirma: comportamento real da DLL, tempo de acionamento e qual leitor é a entrada. **Henry e Dimep seguem sem documentação de integração** — Henry publica só manual de serviço, e o web server embarcado da Topdata, que chegou a parecer um caminho, é interface de configuração que fica **indisponível justamente no modo online**. Para essas marcas a conexão vira parte do processo comercial na implantação, não pré-requisito de produto.

## Rastreamento de Erro (Sentry): a configuração é a política de privacidade

Sem rastreamento, um erro de JavaScript numa tela deixa o aluno travado e ninguém fica sabendo — o defeito só aparece quando alguém liga para a academia. Com várias academias em produção isso deixa de ser sustentável, então o Sentry entrou em `src/lib/monitoramento.ts`, ligado em três pontos: a subida do app (`main.tsx`), o `ErrorBoundary` (que antes só fazia `console.error`, inútil para quem não tem DevTools aberto) e o `AuthContext`, que carimba os eventos.

**O módulo é, na maior parte, uma lista do que não enviar, e isso é deliberado.** O ARKE carrega dado pessoal sensível pela LGPD (art. 5º, II) — anamnese, dobras, dores relatadas, histórico clínico. Um SDK de monitoramento no padrão manda muito mais do que se imagina para um terceiro, e a diferença entre ferramenta de operação e vazamento contínuo mora inteira na configuração:

- **Session Replay fica desligado.** É o item mais perigoso: numa tela de avaliação física o replay gravaria peso, dobras e queixas do aluno e mandaria para fora. Nenhuma máscara compensa; o recurso não entra.
- **Breadcrumb de console sai**, porque o app registra objeto de erro do Supabase no console e esses objetos carregam trecho da consulta que falhou.
- **Query string é cortada** de URLs e breadcrumbs — é onde vazam ids e o que a pessoa digitou em busca. **Corpo, cookies e cabeçalhos de requisição nunca são anexados.**
- **`sendDefaultPii: false` é explícito**, mesmo sendo o padrão: é o tipo de coisa que não pode mudar por descuido numa atualização de SDK.
- Uma limpeza em profundidade troca por `[removido]` o valor de qualquer chave que pareça sensível, **mantendo a chave** — saber que havia um campo `cpf` ajuda a entender o erro; saber qual CPF não ajuda e é o problema.

**O que é enviado de identificação:** `organization_id` e `user_id`, ambos UUID. São pseudônimos, e sem eles não dá para responder "esse erro atinge uma academia ou todas", que é a pergunta que justifica ter monitoramento. Nome, e-mail e CPF não vão nunca.

Sem `VITE_SENTRY_DSN` o monitoramento simplesmente não sobe — é assim que se roda em desenvolvimento e é assim que se desliga em produção sem deploy de código. A variável está configurada na Vercel só para `production`, apontando para a org `arkefit`, projeto `javascript-react`.

## Trabalho em Andamento: Rascunho e Retomada

Dois mecanismos diferentes, para dois problemas diferentes. Confundi-los produz ou perda de trabalho, ou dado sensível esquecido em máquina compartilhada.

**Lote com efeito no servidor → banco.** A importação de alunos grava `importacoes_alunos` e `importacoes_alunos_linhas` antes de qualquer chamada. Cada linha é marcada assim que termina, então fechar a aba na linha 250 de 400 deixa o que entrou registrado e o resto pendente. A tela detecta o lote inacabado ao abrir e oferece retomar, sem precisar do `.xlsx` original — por isso o que se guarda é o registro já mapeado pelo de-para, não a linha crua. Há também "tentar de novo só as que falharam": reimportar a planilha inteira devolveria centenas de "já existe usuário com esse e-mail" e esconderia os erros de verdade.

**Digitação em andamento → `sessionStorage`, via `useRascunho`.** Conteúdo que custa caro reproduzir mas ainda não é do domínio: avaliação física com o aluno na frente, ficha montada exercício por exercício, dieta revisada depois de uma extração de PDF. Não vai para o banco porque criaria linha incompleta sob RLS, visível para a equipe, que alguém teria que limpar depois.

O escopo é **sessão, não disco**, e a razão principal não é ergonomia: o rascunho de uma avaliação física carrega peso, dobras, dores relatadas e histórico clínico — dado de saúde pela LGPD (art. 5º, II). Num PC de recepção compartilhado, `localStorage` faria a medição de um aluno esperar o próximo turno no disco. Com `sessionStorage`, o rascunho sobrevive a refresh e a navegar pelo app, e morre quando a aba fecha e o terminal é desligado no fim do expediente. O custo assumido é fechar a aba sem querer; num equipamento compartilhado ele vale menos que o risco. `escopo: "persistente"` existe para o caso oposto — dado da própria pessoa, no dispositivo dela — e deve ser escolhido explicitamente.

**Rascunho não é para todo formulário.** Ressuscitar dados de ontem num "novo aluno" que alguém abandonou de propósito é pior que campo limpo: a pessoa não pediu aquilo de volta e descobre o engano depois de salvar. A regra é persistir onde perder o trabalho dói mais do que reencontrá-lo surpreende. Pela mesma razão o hook **não restaura sozinho** — devolve o que encontrou e a tela oferece; e rascunho com mais de 48h é descartado em vez de oferecido, porque provavelmente é de outra intenção.

## Motor de Automações e Regras Operacionais
- **Prevenção de Falha Humana:** Eventos da jornada viram tarefas automáticas com responsável, prazo (SLA) e prioridade[span_81](start_span)[span_81](end_span).
- **Sinais de Atenção Automáticos:**
  * Aluno sem 1º acesso após 48h → Tarefa de ativação[span_82](start_span)[span_82](end_span).
  * 2 treinos previstos sem registro → Tarefa de verificação de barreira[span_83](start_span)[span_83](end_span).
  * Relato de dor no treino → Alerta de revisão profissional antes do próximo treino[span_84](start_span)[span_84](end_span).
  * Resposta de atendimento atrasada → Escalonamento automático para o gestor da unidade[span_85](start_span)[span_85](end_span).
- **Proteção Anti-Duplicação e Idempotência:** Eventos repetidos não geram tarefas duplicadas. Pausas e cancelamentos encerram automações ativas imediatamente[span_86](start_span)[span_86](end_span).

### Rotinas agendadas não falham em silêncio

As tarefas automáticas acima nascem de 8 rotinas do `pg_cron` (ativação de hora em hora, escalonamento de SLA, barreira de rotina, acolhimento Elite, engajamento baixo, lançamentos financeiros, snapshot de MRR). Até 21/09/2026, se uma quebrasse, nada avisava: `cron.job_run_details` só é lido por quem vai procurar, e a consequência aparecia dias depois como "a fila parou de receber tarefa".

`get_superadmin_rotinas()` (restrita à ArkeFit) classifica cada uma em **ok**, **falhou**, **parou de rodar**, **nunca rodou** ou **desativada**. "Parou de rodar" é a traiçoeira: não gera erro, só silêncio. É detectada comparando a última execução com o intervalo que o próprio agendamento promete (`m * * * *` horária, `m h * * *` diária, `m h * * d` semanal) — acusa quando passou do dobro, com folga de 15 min. Agendamento fora desses formatos acusa falha, mas não atraso. Qualquer rotina fora do ok vira **faixa vermelha no topo da Visão Master**, a tela que se abre todo dia; o detalhe (último erro, falhas na semana) fica em **Visão Master → Webhooks**.

## Arquitetura de Proteção e Resiliência Operacional
- **Versionamento Imutável:** Prescrições publicadas possuem snapshot travado (`versao_id`). Alterar modelos na biblioteca global não altera planos em uso por alunos[span_87](start_span)[span_87](end_span).
- **Sanitização de Dados:** Módulo de ingestão de arquivos CSV com validação rígida de e-mails, telefones e CPFs[span_88](start_span)[span_88](end_span).
- **Privacidade e LGPD:** Dados sensíveis (anamnese, fotos de avaliação corporal) possuem RLS estrito e acesso restrito ao profissional vinculado ao atendimento[span_89](start_span)[span_89](end_span).

## Testes de Ponta a Ponta (Playwright, contra produção)

`e2e/` roda contra o app publicado — o projeto não tem homologação separada, e o que se quer pegar é o que só aparece com o app de verdade no ar: página que não baixa o próprio arquivo (code splitting), rota protegida que deixa de redirecionar, tela pública que quebra. O workflow (`docs/workflows/e2e.yml`, **fora de `.github/workflows/` porque o token que publica a branch não tem o escopo `workflow`** — mover para lá o liga) dispara sozinho quando a Vercel avisa o GitHub que um deploy de **produção** terminou; não bloqueia merge (o código já está no ar), mas avisa antes de um aluno descobrir. Usa o Chrome já instalado (`channel: "chrome"`), sem baixar navegador.

- **`fumaca.spec.ts`** só lê telas: login, cadastro, navegação login → cadastro, as três áreas protegidas mandando para o login, matrícula pública de academia inexistente e da academia de homologação (`tiete-fitness`). Falha também se a página emitir erro de carregamento de módulo ou cair no ErrorBoundary.
- **`jornada-aluno.spec.ts`** faz login e percorre home, treinos e perfil — **só roda com os secrets `E2E_EMAIL` e `E2E_SENHA`** (conta de aluno de teste permanente, que mora em produção na academia de homologação). Sem eles aparece como *skipped*, não como aprovado. Também só lê: registrar treino ou responder check-in viraria ruído nas métricas da academia.

Os campos de login e cadastro não têm `<label>` associado — o nome acessível vem do placeholder —, por isso os testes usam `getByRole("textbox", { name })` ali, e `getByLabel` só onde há `<Label htmlFor>` (matrícula pública). O `expect` espera 20 s: a latência até o Supabase já mostrou pico de 6 s entre o preflight e a chamada, e o teste deve pegar lentidão sistemática, não a cauda de um pico isolado.

O primeiro E2E achou um defeito real: numa falha transitória de rede a matrícula pública dizia **"Academia não encontrada"** a quem tinha o link certo. Hoje falha de carregamento e academia inexistente são telas diferentes, e a primeira oferece tentar de novo.

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
