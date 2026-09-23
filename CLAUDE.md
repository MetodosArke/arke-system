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
| **Free** (app da academia) | — | — | — | incluso no plano B2B |
| **Integrado** (Treino + Nutrição) | R$ 45,00 | R$ 4,05 | R$ 119,00 | R$ 69,95 |
| **Elite** (Acompanhamento 360°) | R$ 85,00 | R$ 6,44 | R$ 199,00 | R$ 107,56 |

* Taxa do Asaas, somada ao atacado (decisão de 21/09/2026): 2,99% + R$ 0,49 sobre o valor cobrado, configurável em Visão Master → Configurações. Os valores acima são no preço sugerido; com outro varejo, a taxa acompanha.

- **Free** (substitui o Essencial desde 22/09/2026): todo aluno matriculado e em dia com a academia — treinos com snapshot imutável, calendário, rotina, diário de água e dieta (a dieta vem da nutricionista **da academia**) e chat com os professores da academia. Sem custo de atacado: a academia paga só o plano B2B.
- **Integrado:** Tudo do Free + acolhimento M.A.P.A.®, fases da jornada, plano alimentar individualizado, acompanhamento por Nutricionista ARKE, check-ins semanais (R.O.T.A.®) e revisão integrada.
- **Elite:** Tudo do Integrado + acolhimento expandido, encontros periódicos de acompanhamento, relatórios de evolução corporal (A.P.E.X.®/L.E.G.A.D.O.®) e fila prioritária.

> Implementação: `planos_atacado` (custo de atacado + `valor_sugerido_varejo`) e `organization_planos_precificacao` (valor de varejo e markup definidos por organização — pré-preenchido com a sugestão ARKE via trigger ao criar a organização, editável livremente depois pela academia).

### 3. Matriz de Repasse Financeiro no Gateway (Split no Asaas)
No momento da cobrança da assinatura do aluno:
1. `valor_repasse_arke` = `planos_atacado.custo_mensal` + `arke_taxa_processamento(valor_total_cobrado)` → direto para a conta da ARKE, que é de onde o Asaas desconta a taxa. Travado em `aluno_assinaturas.valor_repasse_arke` na criação.
2. `valor_liquido_academia` = `valor_total_cobrado - valor_repasse_arke` → direto para a conta/wallet da academia (`organizations.asaas_wallet_id`).

> Implementação: `aluno_assinaturas` (assinatura recorrente) + `pagamentos` (registro de cada cobrança com o split já calculado) + `asaas_webhook_events` (log/auditoria idempotente dos eventos do gateway). Edge Functions `asaas-create-subscription` e `asaas-webhook`.

## Configuração do Gateway de Pagamento (Asaas) — CONCLUÍDA

**A integração com o Asaas está configurada e funcionando. Não tratar como pendência e não perguntar sobre isso.**

- `ASAAS_API_KEY` e `ASAAS_WEBHOOK_SECRET` estão gravados nos secrets do projeto Supabase. O `ASAAS_WEBHOOK_SECRET` é o token gerado no painel do Asaas (Integrações → Webhooks) e **o Asaas não o mostra de novo depois de gerado** — como o Supabase também só devolve o SHA-256 dos secrets, um valor perdido não se recupera de lugar nenhum: gerar outro é o único caminho, e gerar troca o token que o Asaas passa a enviar. Por isso a rotação anda junto com qualquer mudança de URL do webhook, senão o projeto que ainda estiver recebendo passa a recusar todo evento.
- `CRON_SECRET` também está gravado (ver pendência (2) abaixo sobre a função que ele protege).
- O webhook do Asaas está apontado para a Edge Function `asaas-webhook`, que valida o header `asaas-access-token` contra o secret.

Confirmado pelo responsável pelo projeto em 20/09/2026. O funcionamento real se confere no painel **Visão Master → Webhooks** (`/superadmin/webhooks`), que mostra cada evento recebido e o que ele efetivamente fez no banco. Registro anterior dizia que as sessões do Claude Code não tinham rede para `*.supabase.co`; isso depende do ambiente — numa sessão local em 21/09/2026 as edge functions publicadas responderam normalmente a chamadas diretas.

### Criação de assinatura: idempotente, e com CPF

"Configurada e funcionando" vale para a **ligação** — secrets, webhook apontado, token validado; os eventos chegam e ficam no painel. Mas até 21/09/2026 **nenhuma assinatura de aluno tinha sido criada** pelo ARKE: `aluno_assinaturas` tinha uma única linha, em `trial`, sem id no Asaas. `asaas-create-subscription` e `academia-criar-matricula` criavam customer sem `cpfCnpj`. O sandbox mostrou onde o Asaas cobra isso: o customer nasce sem CPF, mas a **assinatura** é recusada ("Para criar esta cobrança é necessário preencher o CPF ou CNPJ do cliente") — em produção a criação falharia antes de qualquer cobrança nascer. A B2B (`asaas-emitir-cobranca-b2b`) já fazia certo.

Corrigido junto, o defeito mais caro: nada impedia **duas assinaturas para o mesmo aluno**. Criou no Asaas, falhou ao gravar no banco, a tela seguia oferecendo "Tentar cobrar" — e a primeira assinatura ficava órfã, cobrando o aluno todo mês sem ninguém ver. A de plano próprio era ainda mais direta: conferia a matrícula ativa **depois** de criar a assinatura, então o 409 deixava a recém-criada lá. Hoje as duas:

- conferem o banco **antes** de tocar no gateway (assinatura ativa → 409);
- exigem CPF com mensagem que diz à equipe onde resolver. **Correção de 22/09/2026:** o registro anterior dizia que "os CPFs dos alunos não estão sendo coletados por decisão" — leitura errada de uma limitação de dado de teste. **O CPF é obrigatório em toda matrícula**, porque matrícula gera cobrança e o gateway não emite cobrança sem CPF; ver a seção *CPF obrigatório na matrícula*. A matrícula pública ativava o Método sem gerar cobrança; desde 22/09/2026 ela matricula no plano Free;
- reaproveitam o customer (por `externalReference` do aluno, depois por CPF — a mesma pessoa em duas academias é um cliente só);
- usam `externalReference` com prefixo na assinatura — `metodo:<aluno>` e `plano:<aluno>`, na mesma convenção dos `org:`/`b2b:` da B2B — e consultam o Asaas por ele antes de criar. No Método, assinatura ativa encontrada lá é **adotada** (é o caso de ter criado e falhado ao gravar); no plano próprio é **recusada** com o id, porque pode ser de outro plano ou valor e adotá-la esconderia o problema.

**Conferido no sandbox do Asaas em 21/09/2026**, com os mesmos payloads das funções: reaproveitamento de customer por `externalReference` e por CPF, busca de assinatura ativa por `externalReference` (a base da idempotência), `GET /payments?subscription=` e `GET /payments/{id}` usados pela reconciliação, e a varredura de órfãs. Um achado para quem for configurar academia: **split para a própria carteira é recusado** ("Não é permitido split para sua própria carteira") — a `asaas_wallet_id` da academia tem que ser de outra conta Asaas, nunca a da ArkeFit. A **emissão B2B** (`asaas-emitir-cobranca-b2b`) também foi conferida: customer por CNPJ reaproveitado, cobrança PIX com QR Code e copia-e-cola, taxa do PIX de R$ 0,99 (promocional). A cobrança B2B de R$ 790 da Tietê que nunca chegou ao Asaas foi excluída em 21/09/2026, com registro em `auditoria_acoes_sensiveis`. A `asaas_wallet_id` da Tietê Fitness (`00000000…`) é **placeholder de homologação, de propósito**: a conta Asaas real da academia depende do envio de documentos e dados jurídicos dela, e o split de produção é configurado quando a unidade oficial for integrada. Até lá, criar assinatura do Método para aluno da Tietê é recusado pelo Asaas — comportamento esperado, não defeito. Ao integrar: gravar a wallet real e rodar a criação de uma assinatura de ponta a ponta.

**Split conferido no sandbox com subconta (21/09/2026).** Uma subconta criada por `POST /accounts` fez o papel da academia. A assinatura saiu com o payload de `asaas-create-subscription` (Integrado: R$ 119, `fixedValue` 74 para a academia), e o split ficou registrado na assinatura e em cada cobrança. A academia enxerga os R$ 74 do lado dela. Uma cobrança no cartão com o mesmo split foi `CONFIRMED`, e o split passou a `AWAITING_CREDIT`: no cartão, a academia recebe no prazo de liquidação do cartão, não no ato. O Asaas também recusa split maior que o **valor líquido** ("excede o valor líquido da assinatura"); a função já barra antes, com o valor bruto.

**A taxa do Asaas sai da parte da ArkeFit.** Com `fixedValue` para a academia, o Asaas desconta a taxa do que sobra. Dos R$ 119, o líquido foi R$ 116,15 (taxa de R$ 2,85 no sandbox): a academia recebe os R$ 74 inteiros e a ArkeFit fica com **R$ 42,15, não R$ 45**. **Decisão (21/09/2026): a taxa entra no preço de atacado.** O repasse do Método passou a ser **custo do nível + taxa de processamento sobre o valor cobrado** — a mesma taxa configurável (`plataforma_config`, Visão Master → Configurações, hoje 2,99% + R$ 0,49) que a mensalidade de plano próprio já usava, calculada por `public.arke_taxa_processamento()`. Sobre o valor cobrado, e não somada a um custo fixo na tabela, porque a academia define o varejo livremente e a parte percentual acompanha: um custo fixo só acertaria no preço sugerido. No Integrado a R$ 119: ArkeFit R$ 49,05 (45 + 4,05), academia R$ 69,95. O repasse fica **travado em `aluno_assinaturas.valor_repasse_arke`** na criação, porque o split fica fixo no Asaas — o webhook usa esse valor, não o custo ou a taxa do dia. A tela de precificação mostra a divisão já com a taxa (`src/lib/repasse.ts`, testado contra a função do banco) e recusa varejo que não cubra o repasse.

**E a receita passou a ser líquida.** Cada cobrança guarda a taxa que o Asaas de fato descontou (`taxa_gateway` = `value - netValue` do evento, em `pagamentos`, `mensalidades` e `cobrancas_b2b`); a estimativa configurada serve só para montar o split. Na Visão Master, *Repasse ARKE líquido no mês* e o *Take Rate* descontam essa taxa, inclusive da B2B, que antes entrava bruta. *MRR Global* continua sendo o volume cobrado na plataforma (academias + ArkeFit), não a receita da ArkeFit. No Gestão 360 da academia, o repasse do DRE e do MRR líquido passou a incluir a taxa — e o que a ArkeFit retém das mensalidades de plano próprio, que antes era ignorado e inflava o resultado da academia. A taxa configurada (2,99%) é a de tabela; no sandbox a conta está com 1,99% promocional até 08/12/2026, então por ora a ArkeFit fica com um pouco mais que o atacado (R$ 46,20 no Integrado). Se a taxa contratada em produção for outra, basta ajustar em Configurações — vale só para assinaturas novas.

### Cobrança automática no cartão (desligada até validar em sandbox)

A assinatura do Método nascia com `billingType: UNDEFINED`: todo mês o aluno recebia a fatura e tinha que lembrar de pagar — a porta de entrada da evasão involuntária. `asaas-cartao-assinatura` põe o cartão direto na assinatura (`PUT /v3/subscriptions/{id}/creditCard`) e liga `CREDIT_CARD`; o Asaas cobra os meses seguintes sozinho. **Tokenização não é necessária** para isso — ela serve para reusar um cartão em cobranças diferentes, e o ARKE tem uma assinatura por aluno —, então o caminho não depende da habilitação de tokenização em produção.

**O cartão é só de passagem, e isso é o desenho, não um detalhe.** A API do Asaas exige a chave secreta, então o número atravessa a edge function — o ARKE entra no escopo do PCI DSS. Por isso: o corpo da requisição nunca vai para log (nem em erro; os logs trazem só status HTTP e códigos de erro do Asaas, porque a descrição pode ecoar dado do cartão); o banco guarda só `cartao_final` (4 dígitos, com `check` que recusa o número inteiro) e `cartao_bandeira`; o token do Asaas também não é guardado; o componente `CartaoAssinatura` mantém o cartão só no estado do diálogo, fora do `useRascunho`, e apaga ao fechar ou salvar; e o Sentry remove qualquer objeto sob as chaves `cartao`/`titular`.

**Ordem das chamadas: tipo de cobrança primeiro, cartão depois — e o sandbox é que decidiu.** A primeira versão fazia o contrário, raciocinando que assim toda falha seria segura; no sandbox o Asaas recusou o cartão em 100% dos casos com "Esta assinatura não é do tipo cartão de crédito". Mandar os dois juntos no `PUT /subscriptions/{id}` é pior: responde 200, troca o tipo e **ignora o cartão em silêncio**. A ordem que funciona deixa uma janela — tipo trocado, cartão recusado —, então a recusa **desfaz a troca de tipo, mas só quando fomos nós que trocamos**: numa troca de cartão a assinatura já era `CREDIT_CARD` e o Asaas mantém o cartão antigo quando recusa o novo; reverter ali desligaria a cobrança automática de quem já pagava no cartão. Enquanto uma troca de cartão aguarda a próxima cobrança, o Asaas recusa outra ("atualização de cartão em andamento"), e a função devolve 409 dizendo que o cartão atual continua valendo. As chamadas ficam em `asaas-cartao-assinatura/fluxo.ts`, sem Deno nem Supabase, justamente para `npm run sandbox:cartao` (`scripts/asaas-sandbox-cartao.mjs`, só aceita chave `$aact_hmlg_`) exercitar o código real, não uma cópia: 11 verificações — cartão aprovado, recusado (tipo volta para fatura, cobrança pendente também) e troca bloqueada (cartão anterior mantido).

Quem cadastra: o próprio aluno (Perfil → Pagamento) ou gestor/recepção (ficha do aluno → Método ARKE); o papel é conferido com a organização fixada. **Recusa na cobrança recorrente** (`PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`) não corta acesso — a cobrança ainda não venceu, e quem corta por vencimento é `aluno_inadimplente_b2c` —, mas marca `cartao_recusado_em`, guarda o link da fatura e abre tarefa `cobranca` de prioridade alta (`abrir_tarefa_cartao_recusado`, idempotente por pagamento). Pagamento confirmado limpa a marca.

**Dois interruptores, os dois desligados:** o secret `CARTAO_RECORRENTE_ATIVO` na edge function (sem ele responde 503 sem tocar no Asaas — verificado contra a função publicada) e `VITE_CARTAO_RECORRENTE` no frontend (sem ele a tela mostra a forma de pagamento e não oferece cadastro). O Asaas confirmou a captura de cartão pela API habilitada na conta de produção, e o fluxo passou no sandbox. **O que o sandbox não alcança:** a cobrança mensal efetivamente capturada no cartão (o sandbox não avança o relógio até o vencimento, e com cobrança vencendo no mesmo dia a troca de tipo responde 500) e o webhook `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` de verdade. Os dois só aparecem na primeira virada de mês com cartão real — conferir em **Visão Master → Webhooks** nesse dia. **Consequência da cobrança no dia da matrícula:** a primeira cobrança do Método vence no próprio dia, e com cobrança vencendo no dia o Asaas recusa a troca para cartão (500 no sandbox). Então, no dia da matrícula, o aluno paga a primeira pela fatura e o cartão só entra a partir do dia seguinte — a função responde com "tente de novo mais tarde", sem alterar nada. Vale conferir se em produção o Asaas se comporta igual.

### Sandbox por organização: a corrente inteira sem dinheiro real (23/09/2026)

Até aqui a URL e a chave do Asaas eram globais. Cada `fluxo.ts` já era exercitável em sandbox — o que cobre a **conversa com o gateway**, não a **corrente**: aluno → edge function → gateway → webhook → banco → gate de bloqueio. Testar a corrente exigiria cobrança de verdade, na conta de verdade, com um CPF sintético que pode ser de alguém.

`supabase/functions/_shared/asaas.ts` (`ambienteAsaas`) resolve isso pelo **status da organização**, e não por um secret separado, porque é o status que já significa homologação: `trial` existe *apenas* como ferramenta de homologação, só o Super Admin atribui, e `trg_proteger_status_organizacao` recusa qualquer outro caminho. Assim é impossível uma academia pagante cair no sandbox por engano. Sem `ASAAS_SANDBOX_KEY` configurada, organização em trial **não** cai em produção por omissão: a chamada é recusada — erro explícito vale mais que cobrança real inesperada. Chave de produção no slot do sandbox também é recusada pelo prefixo `$aact_hmlg_`.

As seis funções que chamam o gateway passam por ele (`asaas-create-subscription`, `academia-criar-matricula`, `asaas-assinatura-b2b`, `asaas-cartao-assinatura`, `asaas-conta-academia`, `asaas-emitir-cobranca-b2b`). `asaas-reconciliar` é a exceção documentada: **exclui** a homologação da varredura (`foraDeHomologacao()`), porque a varredura diária é uma consulta só sobre todas as organizações e perguntar à produção por cobrança que só existe no sandbox devolveria divergência falsa. `src/lib/ambienteAsaas.guarda.test.ts` lê o código-fonte e trava os dois invariantes — função que fala com o gateway passa por `ambienteAsaas`; ninguém além do roteador lê `ASAAS_API_KEY`. O defeito que ele previne **não dá erro**: função nova que leia a chave direto funciona em todo teste e cobra dinheiro real quando alguém exercita a homologação — aparece só no extrato.

**Webhook do sandbox: segredo próprio, e trava de ambiente.** O Asaas devolve apenas `hasAuthToken`, nunca o valor — então o sandbox não tem como reusar o token de produção, e não deveria. `asaas-webhook` aceita `ASAAS_WEBHOOK_SECRET` **ou** `ASAAS_SANDBOX_WEBHOOK_SECRET`, e **qual dos dois validou decide o que o evento pode tocar**: evento do sandbox só age sobre organização em `trial`, evento de produção só sobre organização real. Não é defesa contra colisão de id (o espaço do Asaas torna isso irreal) — é contenção de raio: segredo de sandbox é credencial de teste e vive mais exposta; sem a trava, quem o obtivesse forjaria um `PAYMENT_CONFIRMED` para a assinatura de um aluno pagante e lhe daria acesso de graça. Evento que não resolve organização nenhuma segue e termina como "sem correspondência", que é o desfecho honesto.

Dois achados de passagem ao apontar o webhook: os webhooks do sandbox apontavam para `https://arkefit.com.br/api/webhooks/asaas` e `.../arke-system.vercel.app/...`, **rotas que não existem no repositório** — resquício; foram removidos. O de produção estava correto, na edge function do projeto novo.

**Conferido de ponta a ponta em 23/09/2026**, com `scripts/homologacao-cobranca.mjs`: subconta da homologação criada no sandbox para receber o split; 3 alunos com CPF sintético (módulo 11) e adesão ao Método; 3 assinaturas emitidas **pela edge function publicada**, autenticadas como gestor de verdade — não pela service role, que ignoraria o RLS e deixaria de provar justamente o portão de quem pode cobrar quem; segunda chamada no mesmo aluno recusada com 409. No Asaas: split de R$ 69,95 `ACTIVE` na assinatura e `PENDING` na cobrança, `valor_repasse_arke` travado em R$ 49,05 (45 + 4,05), primeira cobrança vencendo no dia e a seguinte em 30. Pagamento confirmado no sandbox → evento chegou, `asaas_webhook_events` marcou `pagamento_arke_criado` e `pagamentos` gravou `confirmado`; token inventado leva 401.

**Defeito que só a corrente revelaria (`ReferenceError` em três funções).** Ao mover a chave para dentro do `try`, três `index.ts` ficaram com a checagem antiga `if (!… || !asaasApiKey)` fora daquele bloco — referência a constante que não existe mais ali. O `supabase functions deploy` empacota com esbuild, que **não faz análise de escopo**, então o deploy aceitou e as três quebrariam na primeira chamada autenticada. Lição de método: deploy bem-sucedido de edge function não é prova de que ela roda; sem Deno local, a prova é chamada autenticada de verdade.

## Fuso do Banco: o defeito que a corrente de cobrança revelou (23/09/2026)

Exercitando a cobrança na homologação, um aluno com cobrança vencendo **hoje** apareceu como inadimplente. A causa não estava na cobrança: **o banco está em UTC**, então entre 21h e meia-noite de Brasília `current_date` já é o dia seguinte, e tudo que decide por data decide três horas adiantado.

O alcance é muito maior que a cobrança — **26 funções** do schema `public` comparam com `current_date` e **nove colunas `date`** têm `CURRENT_DATE` como default. O pior não é o financeiro:

- `registro_treino.data`, `checkins.data`, `registro_habito.data` — **quem treina às 22h tem o treino gravado como sendo de amanhã**, todo dia, no horário de pico da academia. Desalinha o calendário, a meta semanal, o "treinar hoje" da Próxima Ação e a automação de "2 treinos previstos sem registro";
- `aluno_inadimplente_b2c` / `organizacao_inadimplente_b2b` — cortam o acesso de quem tem cobrança vencendo hoje, três horas antes da hora, e encurtam as tolerâncias de 5 e 7 dias;
- `exigir_atestado_para_treinar` — trava o treino no próprio dia da validade;
- receita e lançamentos — na virada do mês, a noite do dia 1º conta no mês seguinte, e `marcar_lancamentos_atrasados` atrasa quem está em dia.

**O remédio é a raiz, não as 26 funções**, porque o defeito não está em nenhuma delas: está na premissa de que `current_date` é a data do negócio. `alter database postgres set timezone = 'America/Sao_Paulo'` acerta as 26, os nove defaults e toda função futura — que de outro modo nasceria errada de novo. Foi exatamente assim que `presencas.dia` acabou sendo o **único** lugar do schema com `America/Sao_Paulo` escrito à mão: alguém tropeçou nisto antes e remendou um ponto só.

Conferido antes de propor, porque as três dúvidas naturais têm resposta objetiva:

- **`pg_cron` não se move.** Ele agenda pelo GUC próprio `cron.timezone`, que está em `GMT` e é independente de `ALTER DATABASE`. As 12 rotinas seguem nos mesmos horários UTC documentados.
- **Nada muda de sentido no armazenamento.** `timestamptz` guarda em UTC e o fuso da sessão muda só a leitura; o schema **não tem nenhuma coluna `timestamp without time zone`**, que é o tipo que mudaria.
- **O ajuste alcança quem importa.** Nenhum papel (`authenticator`, `authenticated`, `anon`, `postgres`…) sobrescreve `TimeZone` em `pg_db_role_setting`, então vale para PostgREST e para as edge functions, não só para quem se conecta pelo psql.

A migration está em `supabase/migrations/20261221010000_fuso_brasilia.sql`. Vale para sessões novas.

**Aplicada em 23/09/2026 — e o app tinha o mesmo defeito.** Depois do `alter database`, `current_date` passou a ser a data de Brasília e o PostgREST a devolver `-03:00` já na primeira leitura (o pool pegou na hora, sem esperar reciclagem); `cron.timezone` seguiu em `GMT`, como previsto. O aluno que aparecia bloqueado com cobrança vencendo hoje deixou de aparecer.

Mas a correção do banco **revelou a metade que faltava**: o frontend calculava a data com `new Date().toISOString().slice(0, 10)` em 12 lugares, e `toISOString()` converte para UTC. Enquanto os dois erravam juntos ninguém notava; com o banco certo, eles passariam a **discordar três horas por noite** — o aluno registra o treino às 22h, o banco grava hoje, a tela pergunta por amanhã e responde "você ainda não treinou hoje". As edge functions tinham o mesmo problema, e o mais caro estava em `asaas-webhook`: `data_pagamento` gravado em UTC põe o pagamento das 22h do último dia do mês no fechamento do mês seguinte, o que vai para o contador.

Havia **três grafias** convivendo, e a do meio é a mais traiçoeira porque quase acerta:

| Grafia | O que devolve | Veredito |
|---|---|---|
| `new Date().toISOString().slice(0, 10)` | data em UTC | errada sempre, das 21h à meia-noite |
| `getTime() - offset * 60_000` | data **do aparelho** | certa no Brasil com relógio certo; erra para quem viaja ou tem o fuso trocado |
| `- 3 * 3600_000` / `- 3 * 60 * 60 * 1000` | Brasília | valor certo, motivo escrito em lugar nenhum, e some no horário de verão |

O fuso é fixo em São Paulo, e **não o do aparelho**, porque a data que importa é a da academia: aluno viajando veria uma semana de treinos diferente da que a academia e o banco veem. Isso mora agora em `src/lib/dataBrasilia.ts` (`dataBrasilia`, `hojeBrasilia`, `diaBrasilia`, `inicioDoMesBrasilia`) e no espelho em Deno `supabase/functions/_shared/data.ts` — duplicado pelo motivo de sempre, edge function não importa do bundle do app. As 27 ocorrências do app e as 12 das edge functions passaram a usá-los.

`src/lib/dataBrasilia.guarda.test.ts` varre **`src/` e `supabase/functions/`** e falha nas três grafias, verificada quebrando um arquivo de propósito. É a mesma classe do vínculo duplo: parece certo, e por isso volta a cada tela nova.

**Conferido depois do deploy**, porque deploy não é prova: as quatro edge functions tocadas respondem 401 (o módulo sobe e o handler roda) e uma cobrança confirmada no sandbox gravou `data_pagamento = 2026-09-22`, a data de Brasília, ao lado da linha anterior que tinha `2026-09-23` — o antes e o depois na mesma tabela. **Nenhum dado real foi afetado**: o projeto novo só tem a organização de homologação.


## Ciclo de Vida da Cobrança e a Mensalidade da Academia (23/09/2026)

O sistema sabia **criar** cobrança e não sabia **parar**. Não existia cancelar, pausar nem alterar valor em lugar nenhum — nem tela, nem edge function, nem chamada ao gateway —, e o valor `cancelada` do enum era rótulo de tela que ninguém nunca gravava. A ausência puxava sempre para o lado mais caro, que é cobrar quem não deve:

- **excluir um aluno** fazia `cascade` em `aluno_assinaturas`, `mensalidades` e `aluno_matriculas_academia`: o rastro sumia deste lado e o Asaas seguia cobrando uma pessoa real todo mês. A varredura de órfãs detecta e não corrige;
- **pausar um aluno** tirava o acesso e mantinha a cobrança;
- **mudar o preço de varejo** não alcançava quem já era assinante.

**E havia um defeito pior que a ausência: cancelar bloqueava o aluno.** O `PAYMENT_DELETED` do Asaas virava `estornado`, e a condição do B2C pegava qualquer status que não fosse `confirmado` — então a cobrança apagada, com vencimento no passado, trancava justamente quem não devia mais nada.

**A causa raiz é de uma linha, e vale como regra:** o B2C usava **lista de exclusão** (`status <> 'confirmado'`) onde o B2B usa **lista de inclusão** (`status in ('pendente','atrasado')`). A lista de exclusão trata todo status novo como dívida por omissão — foi por isso que só o B2C quebrou quando surgiu `estornado`, e quebraria de novo em `cancelado`. Dívida é só o que espera pagamento. `get_bloqueio_aluno` tinha o mesmo padrão nos números mostrados ao aluno; também corrigido.

`PAYMENT_DELETED` ganhou status próprio (`cancelado`), separado de `estornado`: "não há o que pagar" não é "houve devolução".

### O que o sandbox decidiu

`asaas-assinatura-ciclo/fluxo.ts`, exercitado por `npm run sandbox:ciclo` (24 verificações):

- `DELETE /subscriptions/{id}` **apaga as cobranças pendentes junto** e dispara um `PAYMENT_DELETED` de cada; é idempotente;
- `PUT {status:"INACTIVE"}` pausa a emissão futura e **mantém** o que já foi emitido. Por isso **pausar remove a cobrança que ainda não venceu e mantém a já vencida**: uma é cobrança por período que o aluno não vai usar, a outra é dívida de período usado;
- valor e split vão no mesmo `PUT`, e o split das pendentes acompanha. Isso é obrigatório: a parte da academia é **valor fixo**, então mudar o varejo sem mudar o split mudaria a divisão combinada em silêncio. Cobrança já vencida **não** tem o valor alterado retroativamente, e a resposta diz quais ficaram no valor antigo.

### Saída do aluno: a ordem é obrigatória, não recomendada

`trg_impedir_exclusao_com_cobranca_viva` (`before delete on alunos`) recusa excluir quem tem assinatura viva no gateway. Não impede excluir — obriga a ordem certa. `_shared/encerrarCobrancas.ts` é o que torna a ordem possível, e vale para os **dois** caminhos de saída: a anonimização LGPD preserva o registro financeiro de propósito (auditoria fiscal), mas não pode seguir cobrando quem exerceu o direito de apagamento.

Pausar o aluno na tela passou a pausar a cobrança, e voltar a "em dia" a retoma. Se o gateway falhar, o erro aparece em alto e bom som em vez de virar cobrança silenciosa.

### A mensalidade da academia, rodada pela primeira vez

O fluxo principal do cliente — o aluno pagando a academia — **nunca tinha rodado uma vez sequer**, e estava fora da rede de segurança. A justificativa registrada era que `mensalidades.status` é `NOT NULL` e criar a linha na emissão quebraria o upsert. **Ela não se sustentava:** a coluna tem *default* `pendente`, então bastava **omitir** a chave em vez de mandá-la nula. Hoje `PAYMENT_CREATED`/`PAYMENT_UPDATED` registram a mensalidade como `pendente` com o vencimento, e omitir o status também impede que evento fora de ordem rebaixe uma mensalidade já paga.

**O bloqueio não ganhou caminho novo.** Mensalidade vencida marca `situacao_academia = 'inadimplente'`, que é o mecanismo existente — com a tolerância de 5 dias, a contagem regressiva e o encerramento das automações. Dois caminhos para a mesma pergunta é como eles começam a divergir. `sincronizar_situacao_por_mensalidade()` marca e libera, e **só desfaz a marca que ela mesma criou** (reconhecida pelo motivo): marca feita à mão pela recepção, por outro motivo, fica de pé. Roda no webhook e na rotina `arke-situacao-mensalidade` (05:30 UTC — depois da reconciliação das 04:30, que conserta o `PAYMENT_CONFIRMED` perdido, e antes das rotinas que abrem tarefa de manhã).

### O defeito que só rodar encontrou

Confirmar a mensalidade levantava **`42P10 — no unique or exclusion constraint matching the ON CONFLICT specification`**. O índice existe, mas é **parcial** (`where origem_automatica is not null`), e o PostgreSQL só infere índice parcial quando o `ON CONFLICT` repete o predicado. Sem o `where`, falha **em tempo de execução, nunca na criação** — por isso passou despercebido: o código está correto à leitura.

Atingia duas funções, as duas em produção e nenhuma jamais exercitada: `lancar_receita_mensalidade` (gatilho `after update` na própria `mensalidades` — a exceção derrubaria a transação inteira, e o webhook não conseguiria marcar como confirmada: o aluno ficaria devendo uma mensalidade que pagou) e `lancar_despesa_folha`. **Regra que fica: `ON CONFLICT` sobre índice parcial precisa repetir o predicado.**

### Conferido

Em três camadas. No sandbox, 24 verificações sobre o `fluxo.ts` real. Pela função publicada e autenticado como gestor de verdade, 17 — incluindo excluir um aluno com assinatura ativa e ver a assinatura morrer no gateway sem deixar órfã. E o fluxo da mensalidade de ponta a ponta, 14 verificações: matrícula criada com split (R$129,90 → academia R$125,53, ArkeFit R$4,37 de taxa), emissão registrada, vencimento simulando `PAYMENT_OVERDUE` perdido marcando inadimplente, pagamento liberando, marca manual preservada, exclusão cancelando no gateway, e o lançamento financeiro automático de fato criado. Zero assinaturas órfãs ao fim.


## Repasse Negociado por Academia (Fase 1 do Ecossistema, 23/09/2026)

O modelo comercial passou a negociar contrato a contrato: cada academia tem porte e ticket médio diferentes, então **quanto a ArkeFit retém de cada aluno no Método deixou de ser um custo por nível igual para todas** (`planos_atacado.custo_mensal`, Integrado R$ 45 / Elite R$ 85) e passou a viver na organização — `organizations.repasse_tipo` (`fixo` | `percentual`) e `repasse_valor`.

**Nome.** O documento de conceito chama isso de `split_type`/`split_value`. Aqui não, de propósito: neste código **"split" já significa a fatia da academia**, que é o que vai no payload do Asaas. Usar a mesma palavra para a retenção da ArkeFit — o oposto — seria plantar um erro no lugar mais caro possível. `repasse_*` é o termo que o resto do sistema já usa.

**O valor configurado é o líquido desejado.** A taxa do gateway é somada por cima e sai do lado da academia, porque ela recebe valor **fixo** no split e o que o Asaas desconta sai do que sobra. Isso confirma a decisão de 21/09 e a torna explícita.

**O percentual não exigiu nada novo do Asaas.** Quem vai no payload é sempre a fatia da academia, em `fixedValue`; o percentual é só a forma de calcular a retenção antes disso. A verificação de `percentualValue` que eu tinha previsto no plano deixou de ser necessária.

**Academia sem repasse negociado não cobra ninguém.** `repasse_arke()` devolve NULL, e `asaas-create-subscription` recusa com 422 dizendo onde resolver. Cair num valor padrão seria pior: cobraria o aluno com uma divisão que ninguém acordou, e o erro só apareceria no extrato.

**Só a ArkeFit configura.** `trg_proteger_colunas_organizacao` passou a cobrir as duas colunas — sem isso o gestor se daria retenção zero pela política de UPDATE da própria organização, como já podia fazer com plano e limite de alunos antes daquela trava existir. Configurado em **Visão Master → ficha da organização → Repasse do Método**, com prévia da divisão.

**A conta mora em três lugares e foi provada igual nos três.** `public.repasse_arke()` no banco, `src/lib/repasse.ts` no app e `asaas-create-subscription` no gateway. Uma execução comparou a função do banco com a do app em **9 configurações** — fixo e percentual, incluindo 100% e zero — e os números bateram em todas. É o que transforma o comentário "se uma mudar, as três mudam juntas" de promessa em verificação.

**Conferido pela função publicada**, autenticado como gestor de verdade: repasse percentual de 30% sobre varejo de R$ 149 gravou R$ 49,65 (44,70 + taxa 4,95) e o split no Asaas ficou em R$ 99,35 para a academia; repasse fixo de R$ 49 no mesmo varejo deu R$ 53,95; academia sem repasse negociado foi recusada com 422 **sem deixar assinatura órfã no gateway**; e varejo que não cobre o repasse foi recusado.

**Os níveis Integrado e Elite continuam existindo** como conjuntos de recurso (nutrição, acolhimento expandido, fila prioritária) e como linhas de preço de varejo. O que saiu de cena foi o `custo_mensal` deles como fonte do repasse.

**Dois níveis, e por isso repasse por nível (decisão de 23/09/2026).** O responsável decidiu **manter Integrado e Elite** em vez de colapsá-los num "Método" único. A decisão tem uma consequência que a configuração por organização sozinha não cobria: com um repasse só, os dois reteriam o mesmo valor — e eles custam coisas diferentes de servir. Elite entrega acolhimento expandido, encontros periódicos e fila prioritária, que no Mentor Centralizado é tempo de gente. Antes da Fase 1 eles já diferiam (R$ 45 e R$ 85); igualá-los seria retrocesso disfarçado de simplificação.

O desenho é **padrão mais exceção**, para não obrigar a configurar duas vezes quem fechou um valor só: `organizations.repasse_*` é o negociado com a academia, e `organization_planos_precificacao.repasse_*` é a exceção daquele nível. A exceção mora onde o varejo daquele nível já morava, e não numa tabela nova. Exceção **sem valor não suprime o padrão** — é a armadilha que o `left join` com `repasse_valor is not null` evita.

Conferido em 9 casos de resolução no banco (com exceção, sem exceção, exceção sozinha sem padrão, chamada sem nível) e pela função publicada: academia com padrão de R$ 45 e exceção de R$ 85 no Elite gravou R$ 49,05 para o Integrado a R$ 119 e R$ 91,44 para o Elite a R$ 199 — com split de R$ 107,56 para a academia, que é exatamente a margem da tabela comercial original.


## Sensores da Jornada (Fase 2 do Ecossistema, 23/09/2026)

Fase sem tela e sem automação: só faz o sistema **enxergar**. O motor de avanço automático (Fase 3) e a fila do Mentor Centralizado (Fase 4) leem daqui. A separação é de propósito — um sensor errado que já move aluno de fase é muito mais caro de descobrir do que um sensor errado que ninguém consultou ainda.

`current_date` em todas estas funções **é** a data de Brasília, porque o fuso do banco mudou em 23/09/2026. É por isso que não há conversão explícita em nenhuma delas.

### Última atividade no app

A regra de inércia do conceito é "sem abrir o app **ou** sem check-in por 5 dias". A segunda metade o sistema já sabia; a primeira não existia — `primeiro_acesso_em` é de uma vez só.

`alunos.ultima_atividade_em` é gravada por `registrar_atividade_aluno()`, chamada pelo `AuthContext`. **RPC e não UPDATE pelo mesmo motivo do primeiro acesso:** o aluno tem só SELECT na policy de `alunos`, e o update é descartado em silêncio pelo RLS. Isso foi **demonstrado**, não suposto: o PATCH direto pelo PostgREST responde **200 com zero linhas alteradas** e a coluna segue nula; a RPC grava. Freio de 15 minutos no próprio `where`, porque o app chama a cada carga e a pergunta tem unidade de dia.

`aluno_dias_inativo()` combina os quatro sinais — app, presença, treino e check-in — e devolve **NULL para quem nunca deu sinal nenhum**: isso é caso de ativação, não de inércia, e as duas têm tratamento diferente.

### Constância contra a meta do próprio aluno

`aluno_constancia(aluno, semanas)` mede os 80% do conceito **contra a meta do aluno**, não contra um número absoluto — é a diretriz de *Constância vs. Adesão*: quem tem meta de 2 e cumpre os dois fez 100%. Cada semana vale no máximo 100%, então excesso numa semana não compensa ausência noutra. A semana corrente fica de fora: está pela metade, e incluí-la puxaria a média por um motivo que não é do aluno.

Verificado com os números exatos: meta 2 com 2 dias/semana → 100%; com 1 dia → 50%; **6 dias numa semana e zero nas outras três → 25%**, não 150%.

### Dor bloqueia a progressão

O check-in com dor já abria tarefa. **O registro de treino com `sensacao = 'dor'` não disparava nada** — o aluno relatava dor ao fim do treino e o sistema seguia como se nada fosse. Agora carimba `alunos.progressao_bloqueada_em` e abre tarefa `dor` crítica.

O carimbo **não é reaberto** por relato posterior: a data tem de ser a do primeiro, senão cada treino novo empurraria o caso para a frente e ele nunca venceria SLA. Desfazer é decisão de gente — `liberar_progressao_aluno()`, restrita à equipe ou à ArkeFit, que registra a justificativa no prontuário. O tempo sozinho nunca libera.

### Estouro de ciclo

`aluno_ciclo_estourado(aluno, dias, minimo_pct)` — prazo vencido com constância abaixo do mínimo. Falso enquanto o prazo não venceu: acusar antes transformaria a régua em ansiedade. O início do ciclo sai de `aluno_fase_historico` (`aluno_fase_desde()`), sem coluna nova — duplicar o histórico criaria duas verdades que divergem na primeira correção manual.

### Um achado de passagem

Uma varredura sobre **todo o schema** procurando `ON CONFLICT` contra índice parcial — a classe do `42P10` encontrado na Fase anterior — não achou mais nenhuma ocorrência. As duas funções corrigidas eram as únicas.


## Avanço Automático de Fases (Fase 3 do Ecossistema, 23/09/2026)

**Reverte conscientemente uma decisão registrada.** O projeto dizia: *"as cinco fases são movidas pela equipe, manualmente. A decisão foi não automatizar: quem convive com o aluno é quem sabe se ele mudou de fase."*

O Mentor Centralizado **removeu a premissa dessa decisão** — não há mais um professor acompanhando digitalmente, e esse é justamente o ponto do BPO. Automatizar o fluxo de sucesso e reservar o humano para as exceções é coerente com o modelo novo, não é um recuo. A passagem manual continua por cima, para adiantar, corrigir ou recuar: coisas que critério nenhum decide bem.

| De | Para | Critério |
|---|---|---|
| M.A.P.A.® | B.A.S.E.® | anamnese concluída |
| B.A.S.E.® | R.O.T.A.® | 4 semanas **na fase** com constância ≥ 80% |
| R.O.T.A.® | A.P.E.X.® | 12 semanas na fase com constância ≥ 80% |
| A.P.E.X.® | L.E.G.A.D.O.® | 24 semanas de Método com constância ≥ 80% |

**Tempo na fase é exigido junto com a constância, e isso não é detalhe.** A constância olha para trás; sem o tempo mínimo, um aluno que entra hoje em B.A.S.E.® carregando quatro semanas boas da fase anterior avançaria no mesmo dia — pulando exatamente o ciclo de adaptação que a fase existe para dar. Foi o primeiro caso que o teste cobriu.

**Um passo por vez, nunca para trás.** Pular fase daria por cumprido um ciclo que não aconteceu; regredir automaticamente tiraria do aluno um progresso que ele fez, e é decisão de gente. Verificado: aluno em B.A.S.E.® com 24 semanas perfeitas vai para R.O.T.A.®, não para A.P.E.X.®.

**`motivo_nao_avanca()` devolve o motivo, não um booleano.** A fila do Mentor precisa saber **por que** o aluno parou para decidir o que fazer — `dor`, `inercia`, `situacao_pausado`, `fora_do_metodo` pedem respostas completamente diferentes. Um booleano obrigaria a refazer a pergunta. A ficha do aluno mostra isso em texto, porque com o avanço automático a **ausência de movimento passa a ser informação**.

**A ordem do cron não é estética.** `arke-avanco-fases` roda às 05:45 UTC: depois da reconciliação Asaas↔banco (04:30) e da sincronização de situação por mensalidade (05:30), antes das rotinas que abrem tarefa (06:00). `motivo_nao_avanca` recusa quem não está `em_dia`, então rodar antes da sincronização suspenderia o avanço de um aluno que pagou na véspera.

**O histórico distingue.** `mover_fase_jornada` exige papel de equipe e morreria no cron, onde `auth.uid()` é nulo; `avancar_fase_automatico` é a porta do motor, restrita à `service_role`, e grava `movido_por` nulo com o nome "Avanço automático".

Conferido em **12 casos** em transação revertida: cada transição, cada bloqueio, o não-pular-fase, o fim da régua em L.E.G.A.D.O.® e a varredura movendo de fato. Uma armadilha de teste vale registrar: num `SELECT` só, todas as subconsultas enxergam o snapshot do início da instrução — ler a fase na mesma expressão que a move mostra o valor **de antes**, e parece defeito sem ser.


## Fila do Mentor Centralizado — base (Fase 4 do Ecossistema, 23/09/2026)

O BPO tira a carga de acompanhamento digital da academia: quando o aluno foge do fluxo automático, quem atua é a célula da ArkeFit. A academia recebe **instrução presencial**, não trabalho digital.

**A fila do Mentor é a mesma tabela `tarefas`, com dono — não uma tabela nova.** O motor já tem SLA, escalonamento, desfecho obrigatório e idempotência por `origem_evento`, tudo em produção. Duplicar isso daria duas implementações de "o que fazer quando resolve", que divergem na primeira correção feita só num lado. É a mesma razão de a reconciliação reenviar o evento ao próprio webhook em vez de reimplementar o efeito.

**A regra de roteamento é o produto, não o tipo:** o que é do Método é da ArkeFit; o que é da relação da academia com o aluno é dela. Por isso **cobrança e atestado ficam com a academia mesmo para aluno do Método** — dinheiro e documento são a relação dela, e o Mentor não tem como resolver nem um nem outro. Aluno no plano Free não tem Mentor: a academia segue dona da fila dele inteira.

**A separação mora no RLS, não nas consultas.** Sem isso o BPO quebraria na primeira tela: o gestor continuaria vendo as tarefas que a ArkeFit assumiu, e "zero carga digital" viraria uma lista maior que antes. São seis telas lendo `tarefas` hoje e a sétima nasceria sem o filtro. A condição entrou **na regra existente**, e não numa regra nova — uma segunda regra permissiva se somaria por OU e anularia o filtro. Verificado: o gestor enxerga 1 de 2 tarefas do mesmo aluno e **não consegue alterar** a da ArkeFit (0 linhas).

**`get_fila_mentor()` devolve o contexto da decisão junto**, não só a tarefa: fase, dias inativo, constância, nível e não lidas. O mentor precisa disso para escolher entre resgatar, ajustar ou acionar a academia, e buscar aluno a aluno seria uma consulta por linha da fila — que é exatamente o que mata a produtividade da célula, e a produtividade da célula **é** a economia unitária do BPO. A ordem é vencida → prioridade → prazo: a ordem de pegar, não a de chegada.

**Gatilho de inércia** (`gerar_tarefas_inercia`, cron 06:10 UTC): abre chamado de risco de evasão para quem sumiu há 5 dias ou mais, crítico a partir de 10. Idempotente **por janela de 5 dias, não por dia** — sem isso um aluno sumido há três semanas geraria tarefa nova toda madrugada e afogaria a célula com o mesmo caso; com isso, um agravamento (5 → 10 → 15 dias) ainda merece chamado novo.

**`criar_instrucao_presencial()`** é o caminho de volta: o Mentor investigou, decidiu e já agiu no app, e o que sobra para a academia é o que só acontece presencialmente. Nasce com dono `academia` explícito — o único caso em que a tarefa de um aluno do Método não é da ArkeFit.

Conferido em **13 casos** em transação revertida, mais a separação de RLS com identidades reais. Um defeito real apareceu no caminho: o `case when ... then 'critica' else 'alta' end` devolve texto e a coluna é enum, e o **plpgsql só reclama disso em execução, nunca na criação da função** — o teste pegou o que a leitura não pegaria.


**O console (23/09/2026).** *Visão Master → Mentoria* passou a ter duas abas, porque são duas perguntas diferentes: **Chamados** (quem saiu do trilho) e **Conversas** (quem escreveu). A primeira é o coração do BPO — ela nasce sozinha dos sensores, sem ninguém precisar reclamar antes.

**O contexto vem na própria linha do chamado:** fase, dias sem sinal, constância e nível. Sem isso o mentor abriria a ficha de cada aluno para descobrir se o caso é resgate, ajuste ou acionamento da academia — uma consulta por linha da fila, que é exatamente o que derruba quantos alunos um mentor consegue servir. **Esse número é a economia unitária do modelo**, e o cabeçalho mostra a carga (total e fora de SLA) justamente para que ele deixe de ser hipótese e passe a ser medido.

As três saídas reais de um chamado estão na mesma tela: encerrar com desfecho (obrigatório, como manda o ciclo de atendimento), mandar instrução presencial para a academia e liberar a progressão. Obrigar a navegar para cada uma seria o mesmo problema de produtividade por outro caminho.

**Um defeito anterior que o console revelou.** O `with check` da regra de alteração de `tarefas` nunca teve `superadmin`: a ArkeFit passava no `using` e era recusada no `with check`, então **nunca conseguiu alterar uma tarefa** — só ler. Não doía porque não havia console. A armadilha é que `alter policy ... using (...)` muda só metade da regra, e o sintoma de esquecer a outra é uma atualização que responde sucesso com zero linhas — o mesmo silêncio que já custou o `primeiro_acesso_em` nulo para todo mundo.

Conferido pelo PostgREST numa sessão de Super Admin real: a fila atravessa organizações com o contexto pronto, o SLA vencido é marcado, a instrução presencial nasce com dono `academia`, a liberação de progressão limpa o bloqueio e o chamado encerrado com desfecho sai da fila.


## Briefing Semanal do Gestor (Fase 5c, 23/09/2026)

Toda segunda às 8h de Brasília, o dono da academia recebe no WhatsApp o retrato da base dele.

**Sem LLM, de propósito.** Os números saem de SQL e entram no template como parâmetros. Um modelo só formataria a frase — e introduziria a chance de **inventar um número numa mensagem assinada pela ArkeFit, no WhatsApp do dono**. Num relatório esse é o pior defeito possível: destrói confiança mais rápido do que a ausência do relatório a construiria. A inteligência ali é escolher o que importa, e disso o SQL dá conta.

**A fórmula de retenção** (decisão do responsável): *ativos hoje ÷ ativos há 30 dias*, com ativo = tem presença ou treino registrado nos últimos 30 dias. Contar pelo sinal de uso, e não por `situacao_academia`, é deliberado — a situação é marcada à mão pela recepção e atrasa, então quem parou de aparecer há três semanas ainda consta "em dia". Medida assim, a retenção mediria o cadastro, não o comportamento. Verificado em transação revertida: 8 de 10 → 80% com variação −20%; 0 de 4 → 0%; e um aluno "em dia" sem aparecer há 45 dias **não conta como ativo**.

**Sem base anterior, devolve NULL** em vez de 100% ou 0% — os dois jeitos de mentir ali. A mensagem então diz "primeira semana de acompanhamento".

**O WhatsApp foi descartado, e por governança antes de técnica.** A conta da Meta está num CNPJ que o responsável não controla, e construir dependência num canal de terceiro é risco, não detalhe. A decisão levou junto três problemas: a aprovação de template pela Meta, a fragilidade dos **parâmetros posicionais** (bastava alguém mexer no template para a mensagem sair com os números trocados de lugar, parecendo certa) e o envio dos números da academia para servidores de terceiro. `_shared/whatsapp.ts` foi **removido** em vez de deixado dormindo — é a regra do projeto, a mesma que derrubou `check-notifications` e as funções `create-user`/`delete-user`; o histórico do git preserva.

**No lugar, três camadas.** O relatório vive **dentro do sistema** (`/admin/relatorio-semanal`), onde cabe explicar de onde cada número veio e mostrar a série das semanas anteriores — um template de WhatsApp são oito parâmetros curtos. **Push** avisa que saiu: a PWA já existia completa (manifest, `sw.js` tratando `push`, `usePushNotifications`, `send-chat-push`), e instala em Windows, Android e iOS — **no iPhone a Apple exige o app na tela de início para o push funcionar**, o que vira uma linha no onboarding do gestor. E **e-mail** pelo Resend, que é o que recupera o alcance do WhatsApp para o dono que não abre o painel.

**Cada número diz na tela como é calculado.** Indicador que o gestor não consegue reproduzir vale menos que nenhum: na primeira divergência ele para de confiar no conjunto todo.

**`gerado_em` é gravado antes de qualquer envio**, porque o relatório já existe a partir dali — aviso que falha não pode impedir o gestor de ver o relatório quando abrir o sistema.

**Uma armadilha que o teste pegou.** A função nasceu sem declaração em `supabase/config.toml`, então o Supabase exigia JWT e o cron levava `UNAUTHORIZED_NO_AUTH_HEADER`. Pior: os dois primeiros casos do teste ("recusa sem token") **passaram pelo motivo errado** — eram barrados pelo portão de JWT, não pela checagem de token. Corrigido e reverificado: sem token e com token inventado dão 401 de verdade; com o token do Vault, 200.


## Sentinela: sugestão de resposta no chat (Fase 5b, 23/09/2026)

O módulo `_shared/ia.ts` é, na maior parte, **uma lista do que não sai daqui** — mesma postura de `src/lib/monitoramento.ts` com o Sentry: um SDK no padrão manda muito mais do que se imagina para um terceiro, e a diferença entre ferramenta útil e vazamento contínuo mora inteira na configuração.

**Nunca saem:** nome, CPF, e-mail, telefone ou id do ARKE. O contexto estruturado vai pseudonimizado (fase, dias sem sinal, constância, meta). **Prompt e resposta nunca vão para log**, nem em erro — só o status HTTP, mesma regra do número de cartão.

**Uma limitação que vale dizer em voz alta:** quando o texto é uma **conversa**, as palavras do aluno vão como ele as escreveu, e ele pode ter digitado o próprio nome. Higienizar isso destruiria o sentido do que se quer sugerir — é inerente à tarefa. Por isso entra no termo de consentimento, e não numa promessa técnica que não se cumpre — e desde 23/09/2026 esse consentimento **existe de verdade e é exigido**, com propósito próprio; ver *Consentimento de IA: por propósito, versionado e declarando o exterior*.

**Falha aberta, de propósito.** Modelo fora do ar não trava o mentor: a resposta diz `indisponivel` e ele segue escrevendo como antes de existir sugestão. Transformar indisponibilidade de terceiro em atendimento bloqueado troca um risco pequeno por uma falha certa.

**Dois fornecedores, escolhidos pelo que estiver configurado.** Azure vence quando ambos existem — é ele que mantém o dado no Brasil, e é a **residência**, não a retenção, que elimina a transferência internacional (os dois exigem pedido de zero-retention; nenhum a dá por padrão). No Azure chama-se o **deployment**, não o nome do modelo: é a diferença que mais confunde quem vem da OpenAI direta.

**A fronteira CREF/CRN não se garante com prompt.** Um modelo deriva para conselho técnico se nada o impedir, e o controle real é humano: **a sugestão é um rascunho que entra no campo de texto do mentor**, para ele editar ou apagar. Não existe e não vai existir modo automático.

Verificado no caso mais difícil — aluno relatando dor lombar. A sugestão acolheu, **não prescreveu nada** e encaminhou para avaliação presencial da equipe técnica. Também conferido: sem conversa não inventa sugestão, quem não é da ArkeFit leva 401, e o fornecedor usado volta na resposta.

**A instrumentação nasceu junto, não depois.** `sentinela_sugestoes` registra o que foi sugerido e o desfecho — aceita, editada ou ignorada —, e `sentinela_taxa_de_aceite()` mede o aproveitamento. **Editada conta como aproveitada:** o modelo poupou o começo do trabalho, que é a maior parte dele; só ignorada é desperdício. Se o aproveitamento for baixo, o recurso é ruído e se desliga sem drama — mas isso só se sabe medindo, e medir depois de ligar é tarde.


## Sentinela: auditoria da anamnese (Fase 5a, 23/09/2026)

É a única parte do Sentinela que mexe com **dado pessoal sensível de saúde** (LGPD art. 5º, II) — cirurgias, lesões prévias, condições crônicas, medicamento contínuo. O projeto foi construído com postura oposta a isso: o Session Replay do Sentry está desligado justamente porque gravaria dobras e queixas. Mandar anamnese para um modelo exige o que o resto do sistema não exigiu.

**Consentimento específico e destacado** (art. 11, I), no mesmo desenho do biométrico: finalidade declarada, retenção declarada, revogável, com data. O termo da anamnese não cobre isto, pela mesma razão que não cobria a digital — são finalidades diferentes, e consentimento genérico não é consentimento.

**Só o próprio aluno consente.** A regra de inclusão exige `alunos.user_id = auth.uid()`: nem a academia nem a ArkeFit podem autorizar por ele. Consentimento dado por terceiro é o vício que anularia a base legal inteira. Verificado: o mentor recebe **403** ao tentar.

**A trava mora no banco, não na edge function.** `anamnese_para_auditoria()` recusa sem consentimento, e é ela que entrega o texto — **conferir e obter são a mesma operação**, então não existe caminho novo, escrito por quem for, que esqueça de checar. A checagem na edge function existe só para dar mensagem melhor.

**Minimização:** só objetivo, histórico de dores ou lesões, medicamentos e experiência com exercício. Preferências alimentares, expectativas e sono ficam de fora porque não ajudam a responder "este aluno exige cuidado?", e cada campo a mais é dado sensível viajando sem motivo.

**O resumo é guardado por versão da anamnese** (hash SHA-256 do texto), não gerado a cada abertura de tela: uma chamada por versão custa menos e, o que importa mais, **expõe menos** — cada chamada é um envio de dado de saúde a um terceiro. Anamnese corrigida gera resumo novo; a versão antiga sai, para a tela não mostrar a análise de um texto que já não existe.

**Revogar apaga o resumo.** Gatilho no banco: manter um derivado de dado sensível depois de o titular retirar a autorização é descumprimento, não conveniência.

**O que o resumo nunca faz:** diagnosticar, interpretar sintoma, opinar sobre gravidade, recomendar ou contraindicar exercício, sugerir conduta. A tela diz de onde ele veio — *"gerado por IA a partir do que o aluno declarou; não é avaliação profissional e não substitui ler a anamnese"* —, porque texto de IA apresentado como avaliação profissional seria o mesmo problema que a fronteira CREF/CRN existe para evitar.

Conferido em **12 casos**, incluindo os dois que mais importam: sem consentimento nada é analisado nem gravado mesmo com chave configurada, e o mentor não consegue consentir pelo aluno. Com consentimento, o resumo citou cirurgia de menisco, losartana e tempo de parada — **sem recomendar nem contraindicar nada**.

## Consentimento de IA: por propósito, versionado e declarando o exterior (23/09/2026)

A Azure OpenAI tinha sido escolhida na véspera justamente porque **residência, e não retenção, é o que elimina a transferência internacional**. O responsável não conseguiu passar da criação da conta e desistiu, e perguntou se contratar *zero data retention* na OpenAI resolveria a questão jurídica. **Não resolve** — e a resposta certa obrigou a rever o consentimento inteiro.

**ZDR não elimina a transferência internacional.** A LGPD (art. 5º, X) define tratamento incluindo *acesso, processamento, transmissão e transferência*; o dado atravessa a fronteira e é processado fora do Brasil mesmo que ninguém o guarde. O que a Azure Brasil resolveria era não haver saída do país. Sem essa opção, a base da transferência passa a ser o **art. 33, VIII** — consentimento específico e destacado **com informação prévia sobre o caráter internacional da operação**. É a máquina que a Fase 5a já tinha; faltava a frase.

Isso não é categoria nova para o projeto: Vercel, Sentry e Resend já estão fora, e a política revisada já declara "o banco está em São Paulo e o restante da infraestrutura fora do Brasil". O que é novo é ser **dado sensível de saúde**, e é por isso que aqui não basta a política — precisa do consentimento por titular.

Ir atrás disso revelou três defeitos, que são o mesmo visto de ângulos diferentes: **o consentimento declarava coisas que não correspondiam ao que acontece.**

**(1) O texto prometia o que o contrato não garante.** Dizia *"o provedor de IA processa **sem reter**"*, e o padrão da API da OpenAI retém por até 30 dias para checagem de uso indevido. Consentimento que declara condição falsa é consentimento viciado — pior do que não ter prometido nada, porque o vício contamina a base legal inteira. O texto passou a descrever a retenção real. Se o ZDR for contratado, isto muda junto com a versão, e aí a promessa passa a ser verdadeira — a única condição em que ela pode aparecer na tela.

**(2) O chat ia para o modelo sem consentimento nenhum.** A finalidade declarada era só "resumir a anamnese", e `mentor-sugerir-resposta` lia `mensagens_mentor` **direto com a service role, que ignora RLS** — o tipo de acesso em que esquecer a checagem não dá erro, só manda o dado embora. Hoje a conversa vem de `conversa_para_sugestao()`, que recusa sem o consentimento de propósito `chat`: **conferir e obter são a mesma operação**, o mesmo princípio de `anamnese_para_auditoria()`.

**(3) Um consentimento não pode cobrir dois propósitos.** `aluno_consentimento_ia.proposito` (`anamnese` | `chat`) e **dois interruptores** na tela do aluno. Ler o questionário de saúde e ler a conversa são coisas diferentes, e é coerente aceitar uma e recusar a outra; juntá-las num botão recriaria exatamente o *"consentimento genérico não é consentimento"* que a tabela existe para evitar. `aluno_consentiu_ia` ganhou o parâmetro, e a assinatura antiga `(uuid)` foi **derrubada** — mantê-la ao lado deixaria no PostgREST uma função que responde "sim" para um propósito que ninguém autorizou.

**Versionamento, no mesmo desenho de `documentos_legais`.** `versao_texto` na linha e `versao_consentimento_ia()` como a vigente; consentimento dado sob texto antigo **deixa de valer** e a pessoa é perguntada de novo. Reescrever a linha antiga no lugar falsificaria a prova — diria que ela concordou com um texto que nunca leu. O espelho no frontend é a constante `VERSAO_TEXTO`.

**Revogar apaga o derivado daquele propósito, e só dele.** Revogar o chat não pode apagar o resumo da anamnese, que continua autorizado. E a sugestão é **anonimizada, não excluída**: `sentinela_sugestoes.sugestao` sai, mas desfecho, fornecedor e datas ficam — essa linha mede o comportamento do *mentor* (quanto da sugestão ele aproveita), e é esse número que decide se o recurso se paga. Apagá-la inteira destruiria uma medida sobre outra pessoa para cumprir um pedido que não era sobre ela.

**Ordem das checagens em `mentor-sugerir-resposta`:** consentimento **antes** da chave de IA. Nenhuma das duas ordens manda dado a lugar nenhum; o que muda é a qualidade da resposta — dizer "Sentinela desligado" a quem não tem autorização do aluno deixaria o mentor clicando num botão que nunca ia responder, por um motivo que não é o que ele imagina.

Conferido em **17 verificações** com identidades reais: sem consentimento os dois recusam (e o chat é a trava que **não existia**); o mentor leva **403** ao tentar consentir pelo aluno; consentimento de `chat` **não** abre a anamnese e vice-versa; consentimento carimbado com versão anterior para de contar e a função volta a recusar; revogar o chat limpa o texto de todas as sugestões e preserva o desfecho; revogar a anamnese apaga o resumo sem tocar no resto; e o texto gravado declara o exterior, descreve os 30 dias e não promete mais retenção zero.

**Base da transferência fechada em 23/09/2026 (decisão do responsável).** A METODOS ARKE LTDA aceita eletronicamente o **DPA empresarial padrão da OpenAI**, que traz as cláusulas-padrão contratuais de transferência internacional — o caminho do art. 33, II, elegível sob a **Resolução CD/ANPD nº 19/2024**. Com isso a transferência passa a ter **duas bases sobrepostas**, o que é bom e não redundante: o DPA cobre a relação ArkeFit↔OpenAI, e o consentimento do app (art. 33, VIII) cobre a relação com o titular — se uma cair, a outra segura. O lado do código está pronto para as duas. **A única pendência externa é o formulário de Zero Data Retention** na conta da OpenAI; enquanto ele não for aprovado, o termo continua descrevendo a retenção de 30 dias, que é a verdadeira.

## Documentos Legais, versão 2026-09-23: o Ecossistema mudou os fatos que eles descreviam

Ao fechar a base da transferência internacional apareceu que **os textos publicados tinham ficado desatualizados** — e vale registrar antes de tudo a correção de uma leitura minha: eu afirmei que eles diziam "Academia controladora, ArkeFit operadora" e que isso conflitava com o desenho novo. **Diziam as duas coisas.** A cláusula seguinte, que eu não tinha citado, já ressalvava que *"os dados da conta da Academia e da sua equipe, e os do Método ARKE quando contratado, são tratados pela ArkeFit como controladora"*. Ou seja, o modelo publicado **já estava certo** e não havia conflito com o DPA: ArkeFit controladora do Método, OpenAI operadora dela. **Cocontroladoria não era necessária**, e dizer que era teria custado uma reescrita inteira sem motivo.

O que estava de fato errado era outra coisa, em três pontos — e dois deles desfavoráveis ao titular, que é o que torna a correção obrigatória e não cosmética:

1. **"Acesso restrito aos profissionais da Academia que atendem você"**, na seção de dados de saúde, deixou de ser verdade com o Mentor Centralizado: a célula da ArkeFit também lê a anamnese. O aluno precisa saber quem vê a saúde dele.
2. **A lista de suboperadores não incluía o provedor de IA** — e a cláusula 6.4 do Contrato obriga a usar *"apenas os suboperadores listados na Política de Privacidade"*. Usar um que não está lá é descumprimento do próprio contrato, antes de qualquer discussão de LGPD.
3. **A transferência internacional** falava de hospedagem e registro de erros. Processar anamnese num modelo é categoria diferente, e a única que toca dado sensível.

**A Política ganhou uma seção própria do Método ARKE** (§4), escrita para o aluno: quem o acompanha, que **a conversa com o mentor não é lida pela Academia** e por que, que o avanço de fase é **decisão automatizada** com direito a revisão humana (art. 20), e as duas finalidades de IA com os seus dois botões. Diz também o que não dá para prometer: nas mensagens o texto vai como a pessoa escreveu, e se ela digitou o próprio nome, ele vai junto — limpar destruiria o sentido do que se quer analisar. A §6 declara a transferência com as **duas bases que valem ao mesmo tempo**: cláusulas-padrão contratuais (art. 33, II, Resolução CD/ANPD nº 19/2024) e consentimento do titular (art. 33, VIII).

**O Contrato ganhou as subseções 6.1 e 6.2.** A 6.1 escreve as consequências de a ArkeFit ser controladora do Método — inclusive a que a academia mais precisa saber, que **ela não lê a conversa entre aluno e mentor**. A 6.2 reconhece que treino, frequência e check-in servem aos dois ao mesmo tempo e que aí o tratamento é conjunto, cada uma respondendo pelo que decide.

**Os Termos de Uso não mudaram** e seguem em `2026-09-22.2` — só quem mudou pede aceite de novo, e isso foi verificado.

**Os dois voltaram a `revisadoJuridico: false`**, e as páginas voltam a marcá-los como minuta até a revisão. Manter `true` diria que um advogado leu um texto que ainda não existia quando ele leu.

**A afirmação sobre o banco no Brasil foi conferida antes de escrita.** A Política diz "servidores no Brasil, em São Paulo", sem a antiga ressalva de migração. O bundle publicado em `www.arkefit.com.br` aponta para `lzyxqjibkfblrrjboylp` (sa-east-1) — a migração para o projeto brasileiro **está em produção**, ao contrário do que o registro anterior dizia.

Conferido em **10 casos** com contas reais: a versão nova é pedida a quem nunca aceitou; os Termos **não** são pedidos de novo; o gestor recebe o Contrato e o aluno não; quem aceitou a versão anterior é perguntado outra vez só sobre o que mudou; e o aceite gravado aponta para a versão e o hash exatos do repositório.


## Operação da Célula e Prova de Valor (Fase 6 do Ecossistema, 23/09/2026)

Duas perguntas que o produto não sabia responder, e que decidem se o BPO se sustenta: **a ArkeFit está cumprindo o que prometeu?** e **a academia está vendo o serviço acontecer?**

**O SLA nascia em horas de relógio, e por isso não media nada.** `now() + interval '4 hours'`: tarefa aberta às 19h de sexta vencia às 23h de sexta, com a célula fechada — o painel acusaria atraso de quem não tinha como agir, e a mesma conta perdoaria a tarefa aberta segunda às 9h. Errado nos dois sentidos, o que é pior do que não medir. `prazo_util()` e `horas_uteis_entre()` contam só expediente: **seg–sex 08–20, sáb 08–12**, no fuso de Brasília — que é o do banco desde a migration do fuso, e é por isso que as duas são `stable` e não `immutable`. Na verificação, uma tarefa de **10 dias corridos** saiu como **45,6 horas úteis**.

**A correção é um gatilho, não treze.** Pela mesma razão do fuso: o defeito não está em nenhum gerador, está na premissa de que hora de relógio é hora de trabalho. `trg_ultimo_sla_util_mentor` reescreve o prazo de toda tarefa `dono = 'arkefit'` a partir de `sla_mentor_horas(prioridade)` — crítica 2h, alta 4h, média 8h, baixa 24h, **úteis**, num lugar só. Tarefa da academia fica como está: o expediente dela não é o nosso, e inventar um horário comercial para ela seria medir contra promessa que ninguém fez.

> **A ordem dos gatilhos é carga estrutural.** O Postgres dispara em ordem alfabética, e este precisa ser o **último** `before insert` de `tarefas`: `trg_definir_dono_da_tarefa` decide o dono e `trg_tarefas_bump_prioridade_elite` sobe a prioridade — os dois valores de que o cálculo depende. Daí o prefixo `trg_ultimo_`. Um gatilho novo chamado `trg_validar_*` passaria a rodar depois e o SLA sairia errado **sem dar erro nenhum**: a inserção funciona, o painel enche, só o prazo está errado. `src/lib/ordemGatilhosTarefas.guarda.test.ts` lê as migrations e falha se aparecer um nome que ordene depois.

**`tarefas.concluida_em`, carimbado por gatilho.** Sem ela o tempo de resposta sairia de `updated_at`, que é a **última edição** e não a resolução: bastaria corrigir um desfecho uma semana depois para a tarefa aparecer como resolvida em uma semana. Reabrir limpa o carimbo, senão a mesma tarefa contaria duas vezes.

**O painel da ArkeFit** (Visão Master → Mentoria → *Operação*) responde três coisas, e **cada indicador diz na tela como é calculado**: cumprimento do SLA e vencidos agora; **carga por mentor**, porque uma célula de serviço quebra por uma pessoa segurando tudo e isso não aparece no total; e **capacidade** — alunos sob acompanhamento, alunos por mentor e **chamados por aluno/mês**, que é o número que dimensiona a célula quando a base crescer. O denominador da capacidade é o aluno do Método, não o aluno com tarefa aberta: quem não deu trabalho neste mês continua sendo carga, é dele que virá a próxima. O tempo até a resposta é rotulado como **latência, não esforço** — um chamado resolvido em 3h pode ter dado 10 minutos de trabalho, e confundir os dois dimensionaria a equipe errado. Para isso o console do Mentor passou a gravar `responsavel_id`: sem ele a carga aparece distribuída por ninguém.

**A academia vê o resultado, nunca a fila** (`/admin/acompanhamento`, *Acompanhamento ARKE* no menu). O modelo tira o acompanhamento digital das costas dela — o que, do lado de quem paga, é indistinguível de não estar recebendo nada. E a fila é invisível por desenho (Fase 4), então sem prestação de contas explícita o serviço não aparece e o cliente cancela achando que não tinha nada. O RLS **força** o desenho certo em vez de deixá-lo opcional: a leitura de `tarefas` exige `dono = 'academia'`, então `get_valor_mentor_organizacao` e `get_atendimentos_mentor_organizacao` são `security definer` e entregam contagens e **desfechos** — o mesmo texto que o mentor teve de escrever para encerrar. "42 atendimentos" qualquer um escreve; o desfecho é a prova. O conteúdo da conversa aluno↔mentor continua fora, e a tela **diz isso em voz alta** em vez de deixar a academia descobrir sozinha e achar que é falha do produto.

Conferido em **29 verificações**: 13 de horas úteis (incluindo sexta 19h → sábado 11h, sábado 11h → segunda 11h, domingo inteiro fora, e ida-e-volta entre as duas funções), 9 do gatilho e do carimbo (prazo da ArkeFit reescrito, prazo da academia intacto, Elite com prioridade já bumpada valendo, editar depois não move `concluida_em`, reabrir limpa) e 7 de acesso e números com identidades reais — gestor leva **403** na operação da ArkeFit, gestor de outra academia leva **403** nos dados desta, e a fila do Mentor continua devolvendo **0 linhas** na leitura direta pela academia.

## Trial e Bloqueio por Pagamento

### Trial não é oferta comercial
O `trial` existe **apenas como ferramenta de homologação**, nunca como oferta. Não há período de testes comercial para ninguém. `public.arke_trial_dias()` (15) define o prazo dos dois lados. **Só o Super Admin atribui trial** (decisão de 21/09/2026), e **matrícula e plano B2B valem desde o primeiro dia**.

Até essa data o trial vazava para a operação comercial por quatro caminhos, todos fechados: (1) toda organização nascia `trial` — default da coluna, formulário da Visão Master e convite de profissional autônomo —, hoje nasce `ativo`; (2) a política de UPDATE de `organizations` deixa o gestor alterar qualquer coluna da própria organização, **inclusive `status`**, e um gestor podia pôr a academia em `trial` para sair do bloqueio por inadimplência — hoje `trg_proteger_status_organizacao` recusa: trial (atribuir ou mexer no prazo) só o Super Admin, outras mudanças de status só a ArkeFit; (3) o trial B2C aceitava a equipe da academia; (4) a assinatura paga do Método nascia com a primeira cobrança 15 dias à frente — um período grátis para todo aluno —, e a matrícula de plano próprio vencia no próximo dia escolhido pela academia, até quatro semanas depois. Hoje as duas vencem **no dia da matrícula** (data de Brasília) e as seguintes no mesmo dia do mês; o campo de dia de vencimento saiu da tela e `dia_vencimento` aceita 29–31. A cobrança B2B já vencia no ato da emissão. Contexto sem usuário (service_role, cron) passa pelas travas: as edge functions que chegam ali já conferem o papel de quem chamou.

- **B2B** — `organizations.status = 'trial'`: o tenant usa a plataforma inteira, tem `trial_vencimento` e nunca é bloqueado por pendência financeira, justamente por não ser cliente.
- **B2C** — `aluno_assinaturas.status = 'trial'`: o espelho, por aluno e **por nível** (essencial, integrado, elite), já que cada nível entrega coisas diferentes e a jornada muda. Iniciado por `iniciar_trial_metodo_arke(_aluno_id, _nivel)` e desfeito por `encerrar_trial_metodo_arke(_aluno_id)`, **ambos só do Super Admin**; `trg_proteger_trial_assinatura` recusa trial gravado por qualquer outro caminho. Não cria customer nem subscription no Asaas, e grava `valor_cobrado = 0` para a linha não ser confundida com assinatura real. Recusa aluno com assinatura paga: a função sobrescreve a linha e zeraria o `asaas_subscription_id`, deixando a cobrança órfã no Asaas. Atribuído em **Visão Master → ficha da organização → Trial do Método ARKE (testes)**, que lista os alunos por `get_superadmin_alunos_trial` (só nome e situação no Método — o Super Admin não lê `alunos` pelo RLS). Na ficha do aluno, a academia vê que ele está em trial, sem botão.

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

**Captcha (Cloudflare Turnstile), ligado em 21/09/2026.** Segunda camada por cima do limite por IP: o limite segura o script que sai de um endereço só, o captcha segura o que se espalha por muitos. Turnstile e não reCAPTCHA porque não pede ao aluno para clicar em imagens e não usa cookie de rastreamento. Dois interruptores: o secret `TURNSTILE_SECRET_KEY` em `matricula-publica` (verifica o token em `siteverify`, depois das validações baratas e antes da checagem de senha vazada e da criação do usuário) e `VITE_TURNSTILE_SITE_KEY` na Vercel (mostra o widget, `src/components/public/Turnstile.tsx`, e só libera o botão com o token). Sem eles, tudo como antes. Token ausente ou recusado barra; Cloudflare fora do ar **libera**, pelo mesmo motivo do limitador. O token é de uso único: a cada falha o widget é remontado. Verificado com as chaves de teste oficiais da Cloudflare: aprova, recusa e sem token se comportam como esperado, e na tela o botão fica desabilitado até o token chegar. O widget está na Cloudflare (conta da ArkeFit, domínios `arkefit.com.br` e `www.arkefit.com.br`, modo Managed); a Site Key é a variável `VITE_TURNSTILE_SITE_KEY` da Vercel e a Secret Key o secret `TURNSTILE_SECRET_KEY` do Supabase. Conferido em produção: o widget aparece acima do botão e, sem token ou com token inventado, a função responde 400 com a mensagem em português. **Desligar sem deploy:** `supabase secrets unset TURNSTILE_SECRET_KEY` — a tela continua mostrando o widget, mas o servidor para de exigir. **Armadilha que já aconteceu:** variável de ambiente nova na Vercel só vale no deploy seguinte; e sem o prefixo `VITE_` o app não a enxerga. Consequência: a conta de teste E2E não pode mais ser recriada pela matrícula pública por script — se ela sumir, é criar pela ficha do aluno (equipe da Tietê) ou desligar o secret por alguns minutos.

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

Toda função `returns trigger` herda EXECUTE do PUBLIC e aparece em `/rest/v1/rpc/<nome>`. Chamá-la fora do contexto de trigger só produz erro, mas não há razão para deixá-la alcançável: a migration `20261124010000` revoga EXECUTE de todas elas em bloco. **Esse revoke NÃO se mantém sozinho** — o registro anterior dizia que ele "segue pegando as próximas automaticamente", e isso era falso. Ele rodou uma vez, sobre as funções daquele dia; toda função criada depois nasce com o ACL padrão do Postgres, que concede EXECUTE ao PUBLIC. A auditoria de 22/09/2026 encontrou **sete** funções de gatilho reexpostas assim, das rodadas 3 a 6, e `20261215010000_higiene_execute_e_search_path.sql` as fechou. **Regra: rodar a revogação de novo depois de cada rodada que crie função de gatilho** — o bloco é idempotente. Tornar isso automático exigiria event trigger, que precisa de superusuário. As RPCs `get_superadmin_*` deixaram de aceitar chamada anônima pelo mesmo motivo — todas checam o papel por dentro, então não havia vazamento, mas 9 das 13 aceitavam sondagem sem login e 4 não, defesa em profundidade desigual sem motivo.

Revogar EXECUTE **não** afeta o disparo de triggers — o PostgreSQL não checa esse privilégio ao dispará-los. Foi verificado contra o banco real, em transação revertida, com `exigir_limite_alunos` e `set_updated_at`.

## Regras de Acesso (RLS): uma por operação

Até 21/09/2026, 38 tabelas tinham mais de uma regra permissiva valendo para a mesma operação — quase sempre "equipe gerencia" (`FOR ALL`) somada a "aluno vê o próprio" (`FOR SELECT`) —, e o Postgres avaliava as duas em toda leitura. Foram consolidadas em `20261205010000_consolidar_politicas_rls.sql`: 79 regras viraram 152, **uma por tabela e operação** (`leitura`, `inclusão`, `alteração`, `exclusão`), cuja condição é o OU das que valiam antes — exatamente como o Postgres combina regras permissivas, então o acesso é idêntico por construção. Cada regra nova diz, em comentário, quais originais consolida. O arquivo foi **gerado a partir de `pg_policies`** e aplicado pelo mesmo gerador dentro do banco; o SQL de volta está guardado em `supabase_migrations.schema_migrations` (`consolidar_politicas_rls`, coluna `rollback`).

Verificado em produção: 12 identidades reais (anônimo, 2 Super Admins, gestor, professor, nutricionista, 5 alunos, conta E2E) × 38 tabelas, linhas visíveis antes e depois — **456 medições, 0 divergências** —, mais escritas em transação revertida (aluno não cria treino, não se dá papel, não grava na biblioteca; gestor grava exercício da academia, não global; Super Admin grava global, não de academia; anônimo nada). **Regra nova daqui para a frente:** tabela nova segue o formato de uma regra por operação; somar uma segunda regra permissiva para a mesma operação recria o problema.

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

> **Atualizado em 23/09/2026:** o fluxo de sucesso passou a avançar sozinho — ver *Avanço Automático de Fases*. O que segue descreve a passagem manual, que continua valendo por cima.

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

## Ajustes do App Original — Rodada 1 (app do aluno e comunicação)

O sócio comparou esta versão com o app original (código e esquema em `C:\Users\andre\arke-original\`, fora do repositório; o esquema não tem dados). A rodada 1 cobre o que não dependia de decisão:

- **Treino finalizado não ia para o calendário — era defeito, não layout.** A consulta do calendário pedia `registro_treino.duracao_min`, coluna que não existe; o PostgREST respondia erro, o código não conferia o erro e o resultado era convertido à força (`as unknown as`). Nenhum treino concluído aparecia. Corrigido, e **`src/lib/colunasConsultas.guarda.test.ts`** passa a ler o código e conferir cada coluna de cada `.from().select()` contra o `types.ts` — foi o único caso encontrado.
- **Aba Calendário reorganizada:** Metas de Treino Semanal no topo (dias treinados/meta, editável, e os quatro números da semana num bloco só), Minha Rotina da Semana logo abaixo, calendário em largura total. Saiu o "Resumo da Semana", que repetia os mesmos números — a tela cabe num print.
- **Hoje existe um treino ativo por aluno, sem divisões A/B/C.** As divisões eram do app original e entram na rodada 2 (prescrição).
- **Metas pela equipe:** a ficha do aluno ganhou o bloco *Metas do Aluno* (água por dia e dias de treino por semana). A meta de água já era por aluno e editável pelo próprio aluno no Perfil. `atualizar_meta_agua_aluno` atualizava só **um** cadastro de quem é aluno de duas academias (select into sem critério — a armadilha do vínculo duplo); hoje vale para todos os cadastros da pessoa.
- **Adesão à dieta por refeição:** o aluno marca Sim/Não em cada refeição do plano e o percentual sai disso (`src/lib/adesaoDieta.ts`; refeição sem resposta conta como não seguida), guardado em `dieta_adesao.refeicoes_marcadas` pela `ordem` da refeição. A régua de percentual ficou só para dieta sem refeições (só PDF). Saiu a pergunta de horário da fome; doce, álcool, saciedade, água e observação ficaram.
- **Caixa de Mensagens** (`/admin/mensagens`, item no menu com contador de não lidas): todas as conversas de treino e dieta num lugar só, não lidas primeiro, respondidas pelo mesmo `ChatPanel` da ficha. Professor vê o canal de treino, nutricionista o de dieta, gestor e recepção os dois (`canaisDoPapel`). Dados por `get_caixa_mensagens(org)` — restrita à equipe da organização.
- **Histórico e Observações na ficha:** linha do tempo com atendimento aberto e **resolvido com o desfecho**, check-ins, fase, agendamentos, publicações e observações da equipe (`get_historico_aluno`). As observações são o prontuário do original: tabela `aluno_observacoes`, só a equipe lê, sem edição depois de escrita; quem escreveu ou o gestor apaga.
- **Achados de passagem:** o `Onboarding` do aluno chamava `useMutation` depois de um `return` antecipado (hook condicional — quebraria a tela se a adesão mudasse com ela aberta); corrigido. O interruptor do cartão virou função (`cartaoRecorrenteLigado()`), e o teste dele deixou de recarregar o módulo a cada caso — era o que falhava de forma intermitente na suíte completa.

## Ajustes do App Original — Rodada 2 (acervo e prescrição)

A estrutura do acervo do app original, trazida para o esquema multitenant:

- **Listas de apoio no banco:** `grupos_musculares` e `equipamentos` (globais, mantidas pela ArkeFit), no lugar da lista fixa de 7 grupos no código e do CHECK no banco. A lista de grupos junta a antiga com a do original (13); a definitiva é decisão de conteúdo (D7) e se muda sem deploy.
- **Exercício com vários grupos e equipamento:** `exercicios_biblioteca.grupos_musculares text[]` e `equipamento` (FK para a lista). `grupo_muscular` continua como o **principal** — o primeiro da lista, mantido por `trg_normalizar_grupos_exercicio`, que também recusa grupo que não existe —, porque fichas publicadas e o De-Para leem ele.
- **Mídia dentro do app:** os espaços `exercicio-videos` e `exercicio-imagens` existiam, mas **só com regra de leitura — ninguém conseguia enviar arquivo**. Hoje envio, troca e exclusão exigem a pasta do dono (`<organization_id>/` para gestor ou professor dela; `global/` para a ArkeFit), conferida por `pode_gravar_midia_exercicio`. Vídeo até 15 MB, imagem/GIF até 5 MB (antes a de imagens aceitava qualquer tamanho e tipo). O vídeo perde o áudio no navegador antes de subir (`lib/removerAudio.ts`, do original; onde o navegador não deixa, como no Safari do iPhone, sobe como está) e o app toca todo vídeo de exercício sem som. `MidiaExercicio` toca vídeo próprio no player nativo e YouTube embutido — **antes o botão "Ver execução" abria um iframe com o link cru, e link comum do YouTube não carrega em iframe: a tela ficava em branco**.
- **Acervo (academia e global):** busca, filtros por grupo e equipamento, miniatura na lista, envio de vídeo e imagem ou link.
- **Prescrição:** escolha do exercício com filtros rápidos e miniatura (`SeletorExercicio`, busca sem acento em `lib/buscaExercicios.ts`); **divisões A–J** (`modelo_treino_exercicios.divisao`); **séries individuais** — repetições, descanso e técnica (drop-set, rest-pause, bi-set, isometria, até a falha) por série (`series_detalhe`, `EditorSeries`, `lib/seriesTreino.ts`). O detalhe só é gravado quando as séries diferem; `series`/`repeticoes`/`descanso_seg` seguem como resumo ("12-10-8"), e ficha antiga sem detalhe é lida como séries iguais. `publicar_treino` congela divisão, séries, equipamento e o id do exercício no snapshot.
- **Aluno:** escolhe a divisão do dia (abre na que já registrou hoje), vê cada série, e o registro guarda a divisão (`registro_treino.divisao`) — o calendário mostra "Treino A". A impressão da ficha também sai por divisão e por série.
- **Pendência de conteúdo:** os 105 exercícios globais continuam **sem vídeo nem imagem**. A estrutura está pronta; produzir ou licenciar o material é decisão de vocês (D7). Com vídeos, o armazenamento do plano gratuito (1 GB) acaba rápido — mais um motivo para o upgrade vir antes de popular o acervo.

## Plano Free no lugar do Essencial (Rodada 3, 22/09/2026)

Até aqui tudo girava em torno de "aderiu ao Método": 9 dos 11 alunos apareciam como "não aderiu", a tela de dieta ficava trancada fora do Integrado e do Elite, e o chat era só do Método. Agora **todo aluno matriculado e em dia com a academia usa o app no plano Free**, e o Método ARKE pago (Integrado e Elite) soma o que é da metodologia. As decisões (D1–D4, D7) foram do responsável e do sócio:

| | Free | Método (Integrado / Elite) |
|---|---|---|
| Treinos, calendário, rotina | ✓ | ✓ |
| Diário de água e dieta (da nutricionista **da academia**) | ✓ | ✓ |
| Chat com os professores da academia | ✓ | ✓, com prioridade |
| Acolhimento M.A.P.A.®, fases da jornada, chat com a nutricionista | — | ✓ |
| Acolhimento expandido | — | Elite |

**O plano é calculado, não gravado:** `plano_do_aluno(metodo_arke_status, nivel_atacado)` no banco e `planoDoAluno()` em `src/lib/planoAluno.ts` — Método ativo vale o nível, qualquer outra coisa é Free. Nível gravado em quem não está no Método é só intenção. Foi por olhar só o nível que o gatilho `bump_prioridade_elite` subia a prioridade de tarefa de aluno fora do Método; corrigido junto.

**Situação na academia (D1).** `alunos.situacao_academia` (`em_dia`, `inadimplente`, `pausado`), marcada pela academia na lista de alunos, na ficha e na importação (coluna "situação"; texto que não dá para interpretar falha a linha, e inativo ou cancelado não é importado). Só em dia entra no app: os outros veem a tela do `AlunoSituacaoGate`, que manda falar com a recepção — a mensalidade, hoje, é cobrada pela academia fora do ARKE; quando ela cobrar pelo ARKE, a situação passa a ser automática. Quem altera é gestor, recepção ou a ArkeFit: a política de UPDATE de `alunos` vale para toda a equipe, então a trava é por coluna, no gatilho `trg_proteger_situacao_aluno`, que também carimba quem e quando. Marcar pausado ou inadimplente **encerra as tarefas automáticas** abertas do aluno (ativação, barreira, engajamento, acolhimento Elite), com o desfecho registrado — é a regra "pausas encerram automações". E as rotinas só olham quem está em dia.

**Automações.** A tarefa de ativação em 48h passou a valer também para o Free, mas **não para a base importada**: ela é ativada em bloco pelo convite de primeiro acesso (QR Code), e 400 tarefas de uma vez afogariam a fila. Engajamento baixo e acolhimento Elite seguem só no Método — a pontuação de engajamento mede os pilares do Método.

**Chat com prioridade (D2).** `get_caixa_mensagens` devolve o plano e ordena: conversas esperando resposta primeiro e, entre elas, o Elite fura a fila e o Integrado vem antes do Free. A Caixa de Mensagens mostra a etiqueta do plano.

**Essencial fora da tabela (D4).** `planos_atacado.disponivel` = falso para o Essencial (o valor do enum fica, porque há histórico apontando para ele); a precificação da academia deixou de ter a linha, e `trg_exigir_nivel_disponivel` recusa Método ativo em nível indisponível por qualquer caminho, inclusive o trial do Super Admin. A conta E2E, que era Essencial, virou Free.

**Matrícula pública é matrícula no Free.** Antes ela ativava o Método no nível escolhido sem gerar cobrança nenhuma — o produto pago saía de graça pelo link. Agora a página não mostra planos nem preços, e sim o anúncio do Método.

**Método ARKE — breve lançamento.** O Método é upgrade pós-lançamento, então o app anuncia em vez de vender: cartão na home do aluno Free, no chat com a nutricionista e na matrícula pública (`MetodoArkeEmBreve`). No painel, a adesão pela academia (e o "Tentar cobrar") fica atrás de `VITE_METODO_ARKE_VENDA`, desligada; o Super Admin segue atribuindo o Método em trial para homologar. Ligar a venda é pôr `VITE_METODO_ARKE_VENDA=true` na Vercel e fazer um deploy.

**Grupos musculares do app original (D7).** Os 11 do original — Peito, Costas, Ombros, Bíceps, Tríceps, Pernas, Glúteos, Abdômen, Antebraços, Panturrilha, Cardio. Os que saíram foram convertidos pelo nome do exercício: "Braços" virou Bíceps ou Tríceps (rosca inversa ganha Antebraços), "Core" virou Abdômen, quadríceps e posterior viraram Pernas, e os exercícios em que o glúteo manda ganharam Glúteos (como principal no hip thrust e na ponte). Os modelos de treino acompanharam; fichas já publicadas ficam como foram publicadas (snapshot imutável).

## Onboarding da Academia em Etapas, Conta Asaas e Mensalidade B2B (Rodada 4, 22/09/2026)

O onboarding antigo tinha 3 passos e pedia o Wallet ID do Asaas digitado à mão. Agora é um **checklist de 5 etapas** — dados, recebimentos, planos, equipe, alunos — feitas em qualquer ordem e retomadas depois, com percentual, próximo passo e tempo estimado no topo do painel (`/admin/onboarding` e cartão na tela inicial). O que está pronto é **lido do estado real**, não marcado à mão: `onboarding_etapas_interno()` confere os campos que o Asaas exige, plano ativo, equipe, aluno cadastrado; `get_onboarding_organizacao()` é a versão com checagem de papel. Só a equipe tem dispensa explícita ("trabalho sozinho").

**D5 — o que trava enquanto não conclui.** O painel funciona desde o primeiro dia (cadastrar, prescrever, importar). **Alunos no app e cobranças** só com o onboarding concluído: o aluno vê "seu app está quase pronto" (`AlunoSituacaoGate`), a matrícula pública responde que as matrículas abrem em breve, e `asaas-create-subscription`/`academia-criar-matricula` recusam. Organização em trial passa (é homologação) — `organizacao_liberada()`. `onboarding_completed` só liga por `concluir_onboarding_organizacao()`, que recusa etapa pendente.

**Trava por coluna em `organizations`.** A política de UPDATE deixava o gestor alterar qualquer coluna da própria organização: podia se dar o plano Enterprise, subir o próprio limite de alunos, trocar a carteira que recebe o split ou marcar o onboarding como concluído. `trg_proteger_colunas_organizacao` recusa — plano, limite, mensalidade B2B e conta Asaas são da ArkeFit ou das edge functions que conferem antes de gravar. A tela de Organização passou a só mostrar a carteira, com link para o onboarding.

**Dados sem digitar (BrasilAPI).** CNPJ válido traz razão social, nome fantasia, endereço e tipo de empresa (MEI/LTDA/individual/associação, da natureza jurídica); CEP completa o endereço. Preenche só o que está vazio, e falha da BrasilAPI nunca trava — o gestor digita (`src/lib/brasilApi.ts`, testado). Os campos são conferidos enquanto a pessoa digita.

**Recebimentos (D6): os dois caminhos.** `asaas-conta-academia`:
- `criar` — o ARKE abre a subconta (`POST /v3/accounts`). **Documentos e conta bancária ficam com o Asaas:** no modelo padrão (sem BaaS contratado com o gerente do Asaas), a academia recebe um e-mail de ativação, define a senha e envia documentos e dados bancários na tela dele. O link de documentos pela API (`onboardingUrl`) só existe no BaaS. O ARKE não guarda documento nem dado bancário — melhor para a LGPD e menos tela. A chave da subconta vem **uma única vez** e o Asaas não deixa gerar outra: vai para o **Vault** (`guardar_chave_subconta_asaas`), porque é o único jeito de consultar a aprovação (`GET /myAccount/status`). Idempotente: criou e falhou ao gravar → a próxima tentativa acha pelo CNPJ e adota. Só CNPJ (para CPF o Asaas exige data de nascimento; o autônomo usa o outro caminho).
- `existente` — a academia informa o Wallet ID; a função recusa formato inválido, **a carteira da própria ArkeFit** (split para ela é recusado pelo Asaas) e carteira já vinculada a outra academia.
- `situacao` — consulta a aprovação com a chave do Vault. A etapa conta como pronta com a carteira configurada; a aprovação aparece como informação (as cobranças podem começar, o saque espera a aprovação).

**Mensalidade B2B recorrente.** `asaas-assinatura-b2b` cria a assinatura no Asaas (`billingType: UNDEFINED` — a academia escolhe PIX, boleto ou cartão na fatura; ciclo mensal; primeira cobrança **hoje**, porque o plano B2B vale desde o primeiro dia). Chamada ao concluir o onboarding e pela Visão Master (ficha da organização → Mensalidade B2B) para academias que já estavam no ar. Valor sempre do banco: `valor_mensal_b2b()` = valor negociado da organização ou preço de tabela em **`planos_b2b_precos`** (Starter 390, Growth 790, Enterprise 1.290; Custom e autônomo sem preço de tabela — editável em Visão Master → Configurações). Idempotente pelo `externalReference` `b2b:<org>` (cliente por `org:<id>` e depois CNPJ). As cobranças da assinatura herdam o `b2b:`; o **webhook registra cada uma na emissão** (`PAYMENT_CREATED` → `cobrancas_b2b` pendente com o vencimento), o que alimenta a rede de segurança da inadimplência B2B. Trial nunca é cobrado.

**Conferido no sandbox do Asaas** (`npm run sandbox:conta`, só aceita chave `$aact_hmlg_`, exercita os `fluxo.ts` reais): subconta criada com chave, segunda tentativa adota a mesma, situação consultada com a chave da subconta, carteira da subconta ≠ carteira da conta-mãe; cliente e assinatura B2B idempotentes; a primeira cobrança vence hoje, herda `b2b:` e sai com tipo escolhido na fatura. **16 verificações.** No sandbox a subconta nasce aprovada; em produção passa pela análise do Asaas.

**Menos atrito, os outros itens.** Planos modelo (mensal, trimestral, anual) nascem **inativos** em toda organização nova — ativos, completariam a etapa com preço que ninguém conferiu. Equipe em lote: colar "Nome; e-mail; papel" por linha, uma chamada de cada vez a `cadastrar-membro-equipe`, com a senha temporária de cada um para copiar. Alunos: importar ou cadastrar, e o convite de primeiro acesso (QR Code) na mesma etapa. A importação reconhece as colunas das exportações de EVO, Tecnofit, Next Fit e Pacto (`src/lib/mapaColunas.ts`, testado): situação antes de nome ("Status do cliente"), colunas de outra pessoa ignoradas ("Nome da mãe", "CPF do responsável"), e **cada campo recebe uma coluna só** — antes a segunda coluna de telefone sobrescrevia a primeira em silêncio. "Bloqueado" (EVO) conta como inadimplente. Botão **"falar com o suporte"** em cada etapa, com o canal em `plataforma_textos` (Visão Master → Configurações); sem canal, o botão não aparece. **Lembrete por e-mail** para onboarding parado: cron `arke-lembrete-onboarding` (9h de Brasília) → `lembrete-onboarding` pelo Resend, a cada 3 dias, no máximo 5 vezes, listando as etapas que faltam; token no Vault como o alerta de rotinas.

**Pausa com motivo.** Pausar o aluno pede o motivo (viagem, saúde, financeiro, rotina, gestação, outro) e a volta prevista (`situacao_academia_motivo`, `situacao_academia_retorno`); inadimplente aceita uma observação. Voltar a em dia limpa os dois. Mesmo gatilho de papel da situação.

`types.ts` passou a ser **gerado** (`supabase gen types`) em vez de editado à mão: o gerado era um superconjunto — faltavam tabelas e colunas antigas que ninguém tinha acrescentado.

## Documentos Legais, Contrato de Matrícula e PAR-Q (Rodada 5, 22/09/2026)

**Termos de Uso, Política de Privacidade e Contrato da Academia** (licença de uso + acordo de tratamento de dados, em que a academia é controladora e a ArkeFit operadora). São **minutas** para revisão jurídica — as páginas mostram isso enquanto `revisadoJuridico` for falso — com os dados da ArkeFit que ainda faltam marcados como `[preencher]` (ver `docs/DECISOES_PENDENTES.md`). A política declara a transferência internacional: o banco está em **us-west-2 (EUA)**.

**O texto mora no repositório** (`src/content/legal/*.md`), versionado pelo git; o banco guarda só versão e **hash SHA-256** em `documentos_legais`, e cada aceite (`aceites_documentos`) aponta para essa linha — o registro prova qual texto exato foi aceito. `src/lib/documentosLegais.test.ts` falha se o texto mudar sem o hash mudar junto. Nova versão = nova linha no banco + hash novo, e a plataforma pede o aceite de novo a todos. Páginas públicas `/termos`, `/privacidade`, `/contrato-academia`, com um renderizador de Markdown mínimo que não interpreta HTML (`lib/markdownSimples.tsx`) — sem dependência nova.

**Aceite.** `AceiteDocumentosGate` envolve o app do aluno e o painel: pede termos e privacidade vigentes a todos, e o contrato ao gestor de academia fora de trial (em nome dela). O que falta vem de `get_aceites_pendentes`; o aceite só nasce por `registrar_aceite` (data, versão, navegador) — a tabela não tem política de escrita, porque aceite é prova. A ArkeFit não passa pela tela. A matrícula pública exige a caixa marcada e grava o aceite no servidor com a própria matrícula; o cadastro também tem a caixa. O onboarding ganhou a sexta etapa, **Contrato**. O teste de ponta a ponta aceita a tela quando ela aparece — é a única escrita dele, uma vez por versão.

**Contrato de matrícula (academia ↔ aluno).** A academia escreve o dela (Organização → Contrato de matrícula), com um modelo ARKE para começar. Nunca é editado no lugar: `publicar_contrato_matricula` cria uma versão nova e aposenta a anterior. O aluno assina no app — **assinatura eletrônica simples** (Lei 14.063/2020): nome digitado, conta autenticada, data, navegador e o **hash SHA-256 do texto assinado**, calculado no banco (`assinar_contrato_matricula`); versão antiga é recusada. A ficha do aluno mostra se assinou a vigente.

**PAR-Q e atestado.** As 7 perguntas do PAR-Q+ (`aluno_parq`, dado sensível: o aluno e a equipe leem, a ArkeFit não). Qualquer "sim" pede atestado; em SP a Lei 16.724/2018 aceita o PAR-Q sem "sim" no lugar do atestado. O aluno envia o arquivo para o bucket **privado** `atestados` (pasta `<organização>/<aluno>/`, 5 MB, PDF ou imagem, conferido por `pode_acessar_atestado`); a equipe abre por link temporário e **registra a validade** — só ela: o gatilho `trg_proteger_validade_atestado` recusa a validade vinda do aluno, e um atestado novo zera a validade anterior. A rotina `arke-alerta-atestado` (07:15 UTC) abre tarefa `atestado` quando há "sim" sem atestado ou o atestado vence em até 15 dias, uma por aluno e validade. Nada disso trava o app; o registro de treino, sim, fica bloqueado com PAR-Q "sim" sem atestado conferido (ver Rodada Final). Os três aparecem para o aluno num cartão "Documentos da matrícula" na home, que some quando não há pendência.

**Aplicar migration pela CLI.** Nesta rodada as migrations entraram com `supabase db query --linked --project-ref … -f arquivo.sql` (API de gerenciamento, sem colar o conteúdo) e o registro em `supabase_migrations.schema_migrations` feito à parte. Tabela nova que precisa ser lida sem login precisa de `grant select … to anon` explícito: os privilégios padrão do projeto não cobrem o anon.

## Multiunidade, Exportação, Check-in por QR e Comunicados (Rodada 6, 22/09/2026)

**Multiunidade.** O plano Enterprise promete gestão multiunidade, e a pessoa não conseguia trocar de unidade na sessão. Agora quem tem vínculo em mais de uma organização vê um seletor no cabeçalho (`SeletorOrganizacao`); a escolha fica guardada no aparelho (`arke:organizacao:<usuário>`) e `escolherVinculo()` a respeita enquanto houver vínculo ativo lá — sem preferência válida, vale a hierarquia de antes. A troca **recarrega o app** em vez de só mudar o estado: nenhuma consulta em cache ou rascunho da unidade anterior sobrevive. Vale também para o aluno de duas academias.

**Exportação para o contador.** Financeiro → "Exportar para o contador" gera o fechamento do mês em Excel, uma aba por assunto: lançamentos, mensalidades dos planos da academia, Método ARKE e folha — cada cobrança com bruto, taxa do meio de pagamento, repasse e líquido, que é o que se concilia com o extrato do Asaas. A lista de alunos também exporta (plano, situação, motivo da pausa). `src/lib/exportarPlanilha.ts`, biblioteca carregada só na hora.

**Check-in por QR Code.** A frequência de quem não tem catraca. A recepção abre Check-in QR (tela cheia) e o aluno escaneia com a câmera do celular; `registrar_presenca_qr` grava uma presença por aluno por dia (`presencas`). O código muda a cada **10 minutos** e sai de um HMAC com um segredo da academia que **ninguém lê pela API, nem o aluno** (`organizacao_segredo_checkin` sem política de leitura) — foto do QR enviada para casa não serve; aceita a janela anterior para quem escaneou na virada. Aluno pausado ou inadimplente é recusado. A rota `/checkin` é pública: sem sessão, guarda o código na aba e manda ao login, e a home retoma. A ficha mostra as presenças dos últimos 30 dias.

**Comunicados em massa.** Gestor ou recepção publicam (feriado, horário especial, evento) para alunos, equipe ou todos, com data de validade opcional; `enviar-comunicado` grava como o próprio chamador (as regras conferem o papel) e manda notificação no celular de quem ativou, pulando aluno pausado ou inadimplente. O aluno vê os não lidos na home e marca como lido; a equipe vê quantos leram.

## Rodada Final: decisões do responsável (22/09/2026)

As respostas registradas em `docs/DECISOES_PENDENTES.md`, aplicadas:

- **Documentos legais revisados** (versão `2026-09-22.2`, `revisadoJuridico: true`): METODOS ARKE LTDA, CNPJ 68.456.606/0001-70, sede em São Paulo/SP; encarregado de dados André Aquino (contato.iconprime@gmail.com); foro de São Paulo/SP; reajuste pelo **IPCA/IBGE** com aviso de 30 dias; aviso prévio de encerramento de **30 dias**; suspensão da equipe por inadimplência após **7 dias** de tolerância. Nova versão → todos aceitam de novo (o E2E aceita sozinho). A política descreve o banco em São Paulo e o restante da infraestrutura fora do Brasil — escrita para valer depois da migração para o projeto `lzyxqjibkfblrrjboylp` (sa-east-1), que é o próximo passo.
- **Tolerância B2B de 7 dias:** `organizacao_inadimplente_b2b()` só bloqueia a equipe com cobrança vencida há mais de 7 dias corridos. Dentro do prazo, o `OrganizacaoBillingGate` deixa o painel aberto com aviso no topo e link da fatura.
- **Tolerância de 5 dias para o aluno inadimplente:** marcado como inadimplente, o aluno usa o app por mais 5 dias corridos a partir da marcação, com contagem regressiva no topo (`acessoPelaSituacao()` em `lib/planoAluno.ts`, espelho de `situacao_permite_app()` no banco, que também vale para o check-in por QR). Pausado sai na hora.
- **PAR-Q com "sim" e sem atestado bloqueia o treino** — só o treino: `trg_exigir_atestado_para_treinar` recusa o registro em `registro_treino` até a equipe registrar a validade de um atestado. O resto do app segue aberto, porque é por ele que o atestado chega. A tela de treino explica, e o cartão de documentos mostra "aguardando a academia conferir" depois do envio.
- **Chat com a nutricionista no Free** quando a academia tem nutricionista ativa na equipe (`academia_tem_nutricionista()`, hook `useNutricionistaDaAcademia`): a academia paga a profissional, então o ARKE não esconde o chat. Sem nutricionista, o chat mostra o Método. A nutricionista **da ArkeFit** continua sendo do Método.
- **Funil de vendas** (`leads`, `/admin/funil`): Kanban de seis colunas (novo, em contato, aula experimental, negociação, matriculado, perdido), cartão que anda por botões, WhatsApp num toque, motivo obrigatório para "perdido" e taxa de conversão no topo.
- **Buckets com dado pessoal privados:** `dietas` (vazio e sem uso) e `chat-videos`, que era público. Os vídeos do chat passam a ir para `<organização>/<aluno>/`, com a regra dos atestados, e tocam por link temporário (`VideoChat`).
- **Fora do escopo por decisão:** WhatsApp (módulo futuro); NFS-e (emitida no painel do Asaas ou no portal da prefeitura); preço do profissional autônomo (pós-lançamento); canal de suporte (preenchido pelo responsável em Visão Master → Configurações quando existir); vídeos e GIFs (material novo, subido depois); venda do Método (mantida desligada).

## CPF obrigatório na matrícula (22/09/2026)

**O CPF é item obrigatório em toda matrícula de aluno.** Matrícula gera cobrança, e o gateway não emite cobrança sem CPF — não há caminho de aluno pago sem ele.

Isto começou como correção de um erro de leitura meu, e vale registrar o erro porque ele contaminou documento derivado. Eu havia anotado que "os CPFs dos alunos não estão sendo coletados por decisão de privacidade", e uma auditoria inteira de prontidão foi escrita em cima disso — concluindo que a cobrança do aluno era um recurso desligado por escolha. A realidade é outra: **o CPF sempre foi obrigatório pela regra do produto**; o que existe é uma limitação de homologação, porque não há números de CPF válidos suficientes para cadastrar dez ou mais alunos de teste, e não se quer usar CPF de terceiros. Limitação operacional não é decisão de produto, e registrar uma como a outra estraga tudo que se apoia no registro.

**Para testar em volume não é preciso CPF de pessoa real.** CPF válido pelo dígito verificador pode ser gerado pelo próprio módulo 11 — foi assim que o teste de sandbox do Asaas passou, com número sintético que o gateway aceitou. `scripts/asaas-sandbox-assinatura.mjs` tem o gerador.

**O código, porém, não implementava a regra.** Até esta data o CPF era opcional em todos os caminhos: a constraint do banco era `cpf is null or cpf = '' or cpf_valido(cpf)`, a matrícula pública aceitava o campo ausente (`payload.cpf?.trim() || null`), e a ficha do aluno e a importação também. Corrigido nos cinco pontos:

- **`erroCpfObrigatorio`** (`src/lib/cpf.ts`) ao lado de `erroCpf`. As duas existem porque há um caso legítimo de CPF opcional: o documento da própria academia no onboarding, que é CNPJ na maioria das vezes e só é CPF no profissional autônomo. Misturar as duas faria a tela de dados exigir CPF de quem tem CNPJ.
- **Matrícula pública** (`PublicMatricula.tsx` e `matricula-publica`): a tela avisa na hora, o servidor garante. A validação da edge function é duplicada em Deno pelo motivo de sempre — ela não importa do bundle do app.
- **Ficha do aluno** (`AdminAlunos.tsx`) e **importação** (`AdminImportarAlunos.tsx`): obrigatório por linha. Base importada sem CPF vira aluno que não pode ser cobrado.
- **`trg_exigir_cpf_na_matricula`**, em `alunos`. A trava mora na matrícula, não em `profiles`, por dois motivos: `alunos` **é** a matrícula, então a regra vale para todo caminho de criação — inclusive os que ninguém lembrar de ajustar e inclusive `service_role`, que ignora RLS; e `profiles` é compartilhado com a equipe, que não é matriculada nem cobrada, e exigir CPF dela quebraria o cadastro em lote sem ganho.

**Linhas que já existem não são tocadas**: o gatilho é `before insert`. Base importada antes da regra não some do app de um dia para o outro; o CPF entra quando a academia editar a ficha. Conferido em transação revertida: matrícula sem CPF recusada, com CPF válido aceita, e CPF com dígito errado barrado antes, pela constraint `profiles_cpf_valido`. A função publicada responde "Informe o CPF — é obrigatório para a matrícula." e "CPF inválido — confira os dígitos."

**Fora de escopo, de propósito:** a equipe (gestor, professor, nutricionista, recepção) segue sem exigência de CPF. A justificativa da regra é a cobrança do aluno, e ninguém da equipe é cobrado pelo ARKE.

## Migração para o Projeto Brasil (22/09/2026)

O banco mudou de região: `jbkrxrfdrmrkyldrrdpq` (us-west-2) → **`lzyxqjibkfblrrjboylp`, ArkeFit PROD BR (sa-east-1, São Paulo)**, porque a política de privacidade revisada passou a declarar o banco no Brasil. **O projeto novo está pronto e conferido; a produção ainda aponta para o antigo.** O passo a passo completo, incluindo os três passos manuais que faltam, está em `docs/MIGRACAO_SUPABASE.md`; os scripts, em `scripts/migracao/`.

**O schema atravessou sem `pg_dump`.** A senha do banco antigo não estava disponível, e o caminho que dispensa senha estava debaixo do nariz: o Supabase guarda o SQL de cada migration aplicada em `supabase_migrations.schema_migrations.statements`. A partir de `reset_schema_public`, essa lista é a história completa do banco atual. Das 161 migrations, 155 vieram do banco e 6 — as rodadas 5, 6 e final, aplicadas por `supabase db query`, que não grava o SQL na tabela — vieram do arquivo no repositório; o script para antes de tocar no destino se faltar SQL para alguma. Duas armadilhas apareceram e valem para a próxima: uma regra de RLS renomeada **fora de migration** fez a consolidação procurar um nome que a reconstrução nunca teve (o `drop` abortava a migration inteira), e uma migration aplicada hoje recebeu o carimbo real de data enquanto as rodadas 5 e 6 usam datas fictícias no futuro — pela ordem de versão ela caía antes das funções de que depende. **Migration nova segue a numeração do repositório, não a data do relógio.**

**Contagem não é conferência.** 232 regras de um lado e 232 do outro podem ser conjuntos diferentes. `scripts/migracao/comparar.mjs` compara objeto a objeto e, onde a definição importa, compara a definição: o **md5 do corpo** de cada função e o **md5 da condição** de cada regra de RLS. Bateram, sem divergência: 88 tabelas, 891 colunas com tipo/nulidade/default, 136 funções e 136 corpos, 237 regras de RLS, 60 gatilhos, 297 índices, 372 restrições, 34 enums, 702 privilégios de tabela, 83 EXECUTE em funções, 8 buckets, 12 rotinas e 2 tabelas no realtime.

**Só os dados globais foram.** A única organização do projeto antigo é a Tietê Fitness, de testes, e das 16 contas 8 eram `*.teste@email.com`. Atravessaram os 105 exercícios globais, 83 alimentos, 11 grupos musculares, 10 equipamentos, 3 níveis de atacado, 5 preços B2B, 5 SLAs, os 6 documentos legais (conferidos por `tipo + versão + sha256`) e a configuração da plataforma. Ficaram para trás, de propósito, a organização e seus modelos, o histórico de webhooks, a auditoria, os snapshots de MRR e as reconciliações. Isso encerrou a pendência da exclusão da Tietê: não há o que excluir. Em troca, **a conta E2E precisa ser recriada** no projeto novo, senão `jornada-aluno.spec.ts` falha em todo deploy.

**O que não sai em migration teve de ser refeito.** Buckets e regras de `storage.objects` são linhas e regras de tabela do Supabase. As 12 rotinas do `pg_cron` não saem em dump — `cron.job` pertence à extensão — e as três que chamam edge function traziam a URL do projeto escrita por extenso: recriá-las não era opcional. Os 3 tokens do Vault nasceram novos, porque o Vault cifra com uma chave que é do projeto e segredo copiado de outro projeto não decifra nunca mais. E um projeto Supabase novo não traz `pg_cron` nem `pg_net`.

**`verify_jwt` deixou de depender de memória.** Quais funções respondem sem JWT vivia só na flag `--no-verify-jwt` da linha de comando; quem deployasse sem ela fechava um endpoint público em silêncio — o webhook do Asaas pararia de receber evento, a matrícula pública responderia 401 a todo aluno. As 13 estão declaradas em `supabase/config.toml`, e o deploy reproduz o ajuste sozinho. Conferido: as 33 funções publicadas no projeto novo têm o mesmo `verify_jwt` da produção.

**O hook de e-mail é o item que engana.** O Supabase só chama a edge function `send-email` — a do e-mail com a identidade visual do ARKE — se o hook estiver ligado nas configurações de Auth, e a assinatura é validada contra um segredo que precisa ser **o mesmo** na configuração de Auth e no ambiente da função. Configurar um e esquecer o outro não dá erro na hora; dá e-mail que não chega, dias depois, quando um aluno pedir a senha. `auth-config.mjs` grava os dois na mesma execução.

**Regras de Storage: uma por operação, e um buraco fechado no caminho.** `feed-images` tinha duas regras permissivas de INSERT — uma exigindo a pasta do próprio usuário, outra pedindo só o bucket. Como regras permissivas se somam com OU, a frouxa vencia: qualquer pessoa logada podia gravar e sobrescrever arquivo na pasta de qualquer outra. As 23 regras de `storage.objects` viraram 5 (uma por operação para `authenticated`, mais a leitura pública para `anon`), e `feed-images`, `chat-videos` e `email-assets` ganharam limite de tamanho e tipo — os três não tinham nenhum, então o teto real era o do plano. Conferido em transação revertida: pasta própria passa, pasta de outro é negada, atestado de outro aluno é negado.

## Primeiro Acesso por QR Code (um link por academia)

Ativar a base importada era aluno a aluno: o botão "Enviar Ativação via WhatsApp" da lista, centenas de vezes. Agora cada academia tem **um link e um QR Code só** — `/p/:slug/primeiro-acesso` —, para colar na recepção, no grupo e no Instagram. O aluno digita o e-mail ou o celular que a academia cadastrou e recebe no e-mail o próprio link para criar a senha (o mesmo `/auth/definir-senha` do link individual). O cartão **Convite de primeiro acesso** fica no topo de *Alunos & Prescrições*, com copiar, baixar o QR em PNG, enviar pelo WhatsApp e a contagem de quantos alunos já entraram no app (`primeiro_acesso_em`). O botão individual continua na lista para quem ficou para trás.

`primeiro-acesso` (edge function, `verify_jwt = false`) tem as travas da matrícula pública — limite por IP em `matricula_publica_tentativas` e Turnstile — e **responde sempre a mesma frase**, exista ou não o cadastro: sem isso, o QR viraria um jeito de descobrir quem é aluno de qual academia digitando e-mails. A busca mora em `buscar_aluno_primeiro_acesso(_organization_id, _contato)`, só `service_role`: e-mail sem diferenciar maiúsculas, ou celular pelos **últimos 10 dígitos**, para "+55 (11) 9..." e "(11) 9..." baterem. O envio é `resetPasswordForEmail`; o Auth segura um envio por minuto por e-mail, e repetir cedo demais só não manda de novo. **Conferido de ponta a ponta em 22/09/2026** pelo responsável, com um aluno vindo importado de outro sistema: o e-mail chega já com o visual do ARKE, o link abre a tela de criar senha e o acesso funciona.

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

**E também por e-mail (desde 21/09/2026).** A faixa vermelha só avisa quem abre a tela. A edge function `alertar-rotinas`, chamada de hora em hora (cron `arke-alerta-rotinas`, aos 50 min, autenticada por token no Vault como a reconciliação), manda e-mail aos Super Admins (`emails_superadmin()`) pelo Resend, de `alertas@arkefit.com.br`. Só quando algo muda, para não virar ruído: **novo** (entrou em problema ou trocou de problema), **lembrete** (continua em problema e o último aviso tem mais de 24 h) e **recuperou**. Problema é *falhou* ou *parou de rodar*; *nunca rodou* fica de fora porque é o estado de toda rotina recém-criada. O estado fica em `alertas_rotinas` e só é gravado **depois** do envio — se o Resend falha, o aviso sai de novo na hora seguinte. A classificação mora em `avaliar_rotinas()`, a mesma que a Visão Master usa. Testado em produção com um aviso falso (`teste-do-alerta`): e-mail enviado, registro limpo. Limite conhecido: se a própria `alertar-rotinas` quebrar, o cron que a chama segue "ok" (o `net.http_post` é assíncrono) — nada avisa desse caso.

## Arquitetura de Proteção e Resiliência Operacional
- **Versionamento Imutável:** Prescrições publicadas possuem snapshot travado (`versao_id`). Alterar modelos na biblioteca global não altera planos em uso por alunos[span_87](start_span)[span_87](end_span).
- **Sanitização de Dados:** Módulo de ingestão de arquivos CSV com validação rígida de e-mails, telefones e CPFs[span_88](start_span)[span_88](end_span).
- **Privacidade e LGPD:** Dados sensíveis (anamnese, fotos de avaliação corporal) possuem RLS estrito e acesso restrito ao profissional vinculado ao atendimento[span_89](start_span)[span_89](end_span).

## Testes de Ponta a Ponta (Playwright, contra produção)

`e2e/` roda contra o app publicado — o projeto não tem homologação separada, e o que se quer pegar é o que só aparece com o app de verdade no ar: página que não baixa o próprio arquivo (code splitting), rota protegida que deixa de redirecionar, tela pública que quebra. O workflow (`.github/workflows/e2e.yml`) dispara sozinho quando a Vercel avisa o GitHub que um deploy de **produção** terminou; não bloqueia merge (o código já está no ar), mas avisa antes de um aluno descobrir. Usa o Chrome já instalado (`channel: "chrome"`), sem baixar navegador.

- **`fumaca.spec.ts`** só lê telas: login, cadastro, navegação login → cadastro, as três áreas protegidas mandando para o login, matrícula pública de academia inexistente e da academia de homologação (`tiete-fitness`). Falha também se a página emitir erro de carregamento de módulo ou cair no ErrorBoundary.
- **`jornada-aluno.spec.ts`** faz login e percorre home, treinos e perfil — **só roda com os secrets `E2E_EMAIL` e `E2E_SENHA`** (conta de aluno de teste permanente, que mora em produção na academia de homologação: `e2e-jornada@arkefit.com.br`, na Tietê Fitness, recriada em 21/09/2026 pela matrícula pública e com o acolhimento M.A.P.A.® já concluído — sem ele o app abre no acolhimento e não na home. A senha só existe nos secrets do GitHub. **Não excluir**: sem ela a jornada falha em todo deploy). Sem eles aparece como *skipped*, não como aprovado. Também só lê: registrar treino ou responder check-in viraria ruído nas métricas da academia.

Os campos de login, cadastro, definir e redefinir senha têm `<Label>` associado, visível só para leitor de tela (`sr-only`) para não mudar o visual com ícone dentro do campo, além de `autoComplete` e nome no botão de mostrar/ocultar senha. Os testes usam `getByRole("textbox", { name })`, que funciona igual com a etiqueta. O `expect` espera 20 s: a latência até o Supabase já mostrou pico de 6 s entre o preflight e a chamada, e o teste deve pegar lentidão sistemática, não a cauda de um pico isolado.

O teste da home confere o bloco **Próxima Ação** pelo nome, não "algum título": com uma conta sem acolhimento concluído ele passava olhando o título do acolhimento. O primeiro E2E achou um defeito real: numa falha transitória de rede a matrícula pública dizia **"Academia não encontrada"** a quem tinha o link certo. Hoje falha de carregamento e academia inexistente são telas diferentes, e a primeira oferece tentar de novo.

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
