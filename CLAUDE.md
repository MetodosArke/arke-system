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

* Taxa do Asaas, somada ao atacado (decisão de 21/09/2026): 2,99% + R$ 0,49 sobre o valor cobrado, **com mínimo de R$ 1,99 por cobrança** (a taxa fixa do boleto e do PIX, desde 24/09/2026 — ver *Cobrança avulsa e taxa de matrícula*), configurável em Visão Master → Configurações. Os valores acima são no preço sugerido; com outro varejo, a taxa acompanha.

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

> **Superado em 23/09/2026:** o provedor passou a ser o Amazon Bedrock em São Paulo, e os caminhos da OpenAI e do Azure foram removidos — ver *IA no Brasil*.

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


### Parecer jurídico recebido, e o que ele mudou no código (23/09/2026)

O parecer **aprovou as duas minutas** e determinou cinco ajustes, todos aplicados. Três são de texto e dois são de comportamento do produto.

| Item | Determinação | O que foi feito |
|---|---|---|
| 3.1 | Nomear a **cocontroladoria** e citar o art. 42, § 1º, I | Política §1 e Contrato 6.2 reescritos; a 6.2 ganhou a distribuição do art. 18 e **afastou a responsabilidade da ArkeFit por falha exclusiva da academia na execução presencial** |
| 3.3 | **Recolher** o consentimento de saúde dos alunos legados | O termo foi corrigido e **versionado**; aceite sob texto anterior deixou de contar, e o aluno legado reconfirma na próxima abertura do app |
| 3.5 | Manter a ressalva do texto livre **em negrito no opt-in** | O aviso passou da Política para dentro do próprio interruptor de IA |
| 3.7 | *Disclaimer* na minuta de matrícula | Inserido ao lado do botão que oferece o modelo, com a redação do parecer |
| 3.8 | Declarar a trava do PAR-Q nos Termos §3 e no modelo §4 | Feito nos dois — a trava existia no produto e não estava escrita em documento nenhum |

O item **3.6** (retenção zero) foi na direção oposta: o parecer concluiu que reduzir o prazo a zero **não exige novo aceite**, por ser só redução de risco. A Política prometia o contrário e foi corrigida.

**Versões resultantes:** Política `2026-09-23.2`, Contrato `2026-09-23.2`, Termos `2026-09-23` — os três com `revisadoJuridico: true`, porque as alterações são exatamente as que o parecer prescreveu, inclusive na redação. Os Termos, que não iam mudar, mudaram por causa do item 3.8 e passam a pedir aceite de novo também.

**Conferido em 10 casos com contas reais**, sendo o que mais importa o do aluno legado: aceite antigo não conta, ele reconfirma, e a partir daí conta. Os documentos vigentes passaram a ser pedidos nas versões novas, e o consentimento de IA nasce na `2026-09-23.2` já com a ressalva gravada no registro.

**A única pendência externa continua sendo o formulário de Zero Data Retention** na conta da OpenAI. Quando sair, a mudança é de uma frase na Política — e, por 3.6, sem novo aceite.

## IA no Brasil: Amazon Bedrock em São Paulo (23/09/2026)

O Sentinela saiu da OpenAI (servidores nos EUA) e passou para o **Amazon Bedrock em `sa-east-1`**. Com isso a análise da anamnese e o rascunho de resposta **deixam de envolver transferência internacional** — o que o Azure Brasil teria resolvido e não chegou a resolver, porque a conta não passou da criação.

**"Configurado" não era "funcionando", e a diferença só apareceu perguntando ao próprio Bedrock.** A configuração recebida apontava para `anthropic.claude-3-5-sonnet-20240620-v1:0`, e o Bedrock em São Paulo respondeu **"identificador de modelo inválido"** tanto na consulta quanto na chamada. A listagem dos modelos da Anthropic na região mostrou o que decide tudo:

| Modelos em `sa-east-1` (23/09/2026) | Como são invocados | Onde processam |
|---|---|---|
| Haiku 4.5, Sonnet 4.5 a 5, Opus 4.5 a 5.5, Fable | só por perfil `global.*` | **qualquer região comercial da AWS no mundo** |
| Claude 3 Haiku, Claude 3 Sonnet | invocação direta (`ON_DEMAND`) | **São Paulo** |

Ou seja: **"100% em São Paulo" só é possível com os modelos de 2024.** Qualquer modelo moderno, na data, mandaria o dado para fora do Brasil — e para uma região que nem se sabe qual. A escolha foi o **Claude 3 Haiku**, pelo lugar do processamento, que é o que o termo promete ao aluno. A qualidade foi conferida antes de trocar, nas duas tarefas reais e com os prompts de produção: o resumo citou só o que o aluno declarou e marcou atenção; a sugestão acolheu dor lombar e encaminhou para avaliação presencial **sem prescrever nada**; ~1,5 s por chamada.

**A garantia mora no código, porque os dois defeitos que a desfariam não dão erro.**

- **A região é fixa** em `_shared/ia.ts` (`const REGIAO = "sa-east-1"`), e não lida de variável de ambiente. Uma variável seria um jeito de mandar dado de saúde para fora do país trocando um texto num painel, com a Política afirmando o contrário.
- **Modelo com prefixo de roteamento é recusado antes de qualquer envio** (`modeloRodaNaRegiao`): `global.`, `us.`, `sa.`, ARN de perfil. A recusa é em tempo de execução porque o id do modelo vive num secret que teste nenhum enxerga — e trocar por um `global.anthropic.claude-sonnet-5` é exatamente a "atualização" que alguém faria de boa-fé. Verificado: com modelo `global.` a função recusa e **nenhum byte sai para a AWS**.
- `src/lib/iaNoBrasil.guarda.test.ts` trava as duas regras e confere que nenhuma edge function fala com `api.openai.com`, Azure OpenAI ou `api.anthropic.com`.

**O caminho da OpenAI e do Azure foi removido, não deixado dormindo.** Com os dois no código, bastaria o Bedrock sair do ar ou alguém apagar a credencial para o Sentinela voltar em silêncio para os EUA — com os documentos dizendo São Paulo. Falha do Bedrock agora é `indisponivel`, nunca troca de fornecedor. O secret `OPENAI_API_KEY` continua no projeto por decisão do responsável, para uso futuro, mas é inerte: nenhum código o lê — e religá-lo exigiria texto novo na Política, porque a OpenAI processa fora do Brasil.

**Assinatura AWS feita à mão**, com WebCrypto e sem SDK (o SDK traria dezenas de dependências para uma função que lida com dado de saúde). A armadilha que ela resolve: fora do S3, cada segmento do caminho é codificado **duas vezes** na forma canônica — o `:` do id do modelo vira `%253A` na assinatura e `%3A` na URL. Provada executando **o próprio `ia.ts`** contra o Bedrock, antes do deploy, e depois pela função publicada: `fornecedor = bedrock` gravado em `sentinela_anamnese` e `sentinela_sugestoes`.

**O registro de invocações do Bedrock na conta está desligado** (`loggingConfig: null`, conferido pela API) — então os prompts não ficam gravados na conta da AWS. Segundo a documentação de proteção de dados do Bedrock, o serviço não guarda prompts nem respostas, não os usa para treinar modelos e **não os repassa ao autor do modelo**: a Anthropic não recebe o conteúdo.

**Credenciais:** `BEDROCK_ACCESS_KEY_ID`, `BEDROCK_SECRET_ACCESS_KEY` e `BEDROCK_MODEL_ID` nos secrets do Supabase. Os nomes não usam `AWS_*` de propósito, para não colidir com convenções de SDK que leem essas variáveis sozinhas.

**Os textos acompanharam.** Política e Contrato foram para `2026-09-23.3` — a IA agora processa no Brasil, sem transferência internacional, e o suboperador passou de OpenAI para AWS (Amazon Bedrock). O consentimento de IA foi para `2026-09-23.3`. Mudanças a favor do titular, mas mudanças: versão nova, hash novo, aceite novo. Os dois documentos voltaram a `revisadoJuridico: false` até o encarregado confirmar **o texto** — ele tinha confirmado o desenho, e o texto não existia quando ele confirmou. **Confirmado no mesmo dia, com um ajuste:** *"o provedor não guarda o seu conteúdo"* virou *"o conteúdo não fica registrado na nossa conta do provedor"*. A primeira frase se apoiava na documentação da AWS; a segunda diz só o que foi verificado. **Texto jurídico afirma o que se consegue provar.** Versões finais: Política `2026-09-23.4`, Contrato `2026-09-23.3`, consentimento de IA `2026-09-23.4`, todos com `revisadoJuridico: true`.

**E a ordem de aplicação passou a ser a certa.** Nas rodadas anteriores a linha do documento entrou no banco **antes** do deploy do texto: nesse intervalo o banco tratava como vigente um texto que a página ainda não mostrava, e um aceite dado ali ficaria gravado com o hash de um texto que a pessoa não leu. Não atingiu ninguém (só a conta E2E aceita documentos), mas o registro de aceite existe justamente para ser prova. A partir da `.4`, a migration do documento entra **depois** de o deploy estar no ar. A solução definitiva, se algum dia houver volume que justifique, é o aceite mandar o hash do texto que a tela mostrou e o banco recusar se não for o vigente — aí a ordem deixa de importar.

**O que isto encerrou e o que abriu.** Encerrou o pedido de *Zero Data Retention* à OpenAI e o aceite do DPA dela, que deixaram de ter objeto. Abriu duas coisas: **a conta AWS ainda estava em verificação** na data (uma chamada ao Claude 3 Sonnet levou 403 "account is currently being verified"; o Haiku passou em todas), e **a longevidade do Claude 3 Haiku** — é modelo de 2024, e quando a AWS o aposentar em São Paulo o Sentinela fica indisponível (falha aberta, sem travar ninguém) até existir outro modelo invocável na região. Nesse dia a decisão volta: esperar um modelo novo em São Paulo, ou aceitar a transferência internacional com texto novo.

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

## Catraca: presença, confirmação de giro e uma regra de acesso só (23/09/2026)

A investigação de um emulador para a Control iD respondeu à pergunta original em uma linha — **a fabricante não tem emulador oficial, e não precisa: o protocolo é HTTP documentado** — e encontrou quatro defeitos que importavam mais que o emulador. Eles não eram independentes: corrigir um sem os outros criaria outro.

**1. Quem entrava pela catraca não contava como presença.** O acesso ia para `acessos_catraca_logs`, que só alimentava telas; os sensores do Ecossistema (`aluno_dias_inativo`, `aluno_constancia`, `aluno_ativo_em`) leem `presencas`, que só recebia o check-in por QR. Numa academia com catraca — justamente a maior —, o aluno que vinha todo dia e não abria o app aparecia inativo na retenção do relatório do gestor, com constância baixa travando o avanço de fase, e podia gerar chamado falso de "risco de evasão" para o Mentor. **A presença agora nasce do próprio registro da catraca, por gatilho** (`trg_presenca_pela_catraca`), e não por escrita em cada edge function: o registro chega por três caminhos (online, confirmação de giro, sincronização offline) e a regra de presença precisa ser a mesma nos três. O dia é o do **acesso**, não o da gravação — acesso offline sincronizado amanhã é presença de hoje.

**2. "Liberado" não é "entrou".** A iDBlock confirma o giro pelo **Monitor** (`/api/notifications/catra_event`: `TURN LEFT`, `TURN RIGHT`, `GIVE UP`), e o Gateway não o ouvia. Com a catraca ligada à presença, cada desistência na frente da borboleta viraria presença. `acessos_catraca_logs.giro`: `null` (equipamento não informa — conta), `pendente`, `confirmado` (conta), `desistencia` (**não conta**), `sem_confirmacao` (conta). Configurável por Gateway (`confirmacao_giro`: `decisao` | `catra_event`), porque só a iDBlock tem Monitor. **A ausência de aviso conta presença, e isso é deliberado:** a desistência chega como evento próprio, então silêncio é problema de Monitor, não do aluno — e o custo é assimétrico: no pior caso um aviso de desistência perdido vira uma presença a mais; nunca a presença de quem entrou some. `fechar_giros_pendentes()` (cron `arke-fechar-giros-pendentes`, de hora em hora) fecha o que ficou pendente por mais de 10 minutos. O casamento do aviso com a liberação é pelo `uuid`; se não bater e houver **um só** acesso esperando naquele equipamento, é ele (numa borboleta passa uma pessoa por vez); com mais de um, não se adivinha.

**3. O acesso decidido offline pela Control iD se perdia.** O registro para sincronizar depois só existia no caminho antigo do driver; o receptor da Control iD chamava a validação direto e nunca enfileirava nada. Quando a internet caía, as entradas pela catraca sumiam. Hoje `registrarAcessoOffline()` é público e o receptor o usa, com o giro pendente fechado localmente quando o aviso chega.

**4. A catraca barrava por uma regra diferente da do app.** Olhava só mensalidade com status `atrasado`: bloqueava na hora, sem a tolerância de 5 dias decidida para o inadimplente, e **deixava passar o aluno pausado**. Agora é `situacao_permite_app()`, a mesma do app e do check-in por QR, via `aluno_barrado_na_catraca()` (online) e `alunos_barrados_na_catraca()` (cache offline). A mensalidade vencida chega pela situação, que `sincronizar_situacao_por_mensalidade()` marca — não há segundo caminho olhando a mensalidade direto. Resultado novo `negado_pausado`. Se a consulta da regra falhar, a função responde erro, não negação: o Gateway cai para o cache, que tem a mesma regra, em vez de trancar a academia inteira por uma falha de consulta.

**E um quinto, de configuração, que só a medição mostrou.** O código prometia validação "em menos de 300 ms" e usava 300 ms de timeout — nunca medido. Medido: **mediana 405 ms, p90 437 ms, 0 de 12 abaixo de 300 ms, 4 s na partida a frio**; só a ida e volta de rede custa ~150 ms. Com o padrão antigo o Gateway cairia em contingência em praticamente todo acesso. O padrão passou a **1000 ms**; a partida a frio continua indo para o cache, que é o certo.

**O emulador** (`packages/gateway/scripts/emulador-controlid.mjs`, `npm run emular:controlid`) envia exatamente o que a catraca envia e mostra a resposta e o tempo. Serve de ensaio de instalação. **A corrente inteira foi provada sem hardware:** um Gateway real rodando localmente, falando com a nuvem real, dirigido pelo emulador — aluna identificada e liberada girou e ganhou presença; aluno liberado que desistiu não ganhou; usuário desconhecido foi negado e registrado. Mais **24 verificações contra a nuvem** (presença por decisão e por giro, desistência, repetição, trava entre catracas, fechamento por prazo, pausado e inadimplente dentro e fora da tolerância, cache offline, sincronização offline caindo no dia do acesso) e **19 testes novos no Gateway**, conferidos quebrando o código de propósito em dois pontos.

**O Gateway passou a rodar no CI** (job `gateway` em `ci.yml`: verificação de tipos e testes). Até aqui os testes dele só rodavam na máquina de quem mexeu. O primeiro CI pegou um defeito que só ambiente limpo mostra: o Vitest do Gateway subia pela árvore procurando configuração de PostCSS, achava a do app na raiz — que carrega o Tailwind, não instalado no job — e nem subia. `packages/gateway/vitest.config.ts` tem PostCSS próprio e vazio por isso.

**O que continua fora, e por quê.** ~~O **cadastro do aluno no equipamento** segue manual~~ — **resolvido na versão 1.0** (ver *Versão 1.0*): o canal de comando existe, a recepção cadastra aluno, digital e cartão pela ficha, e a revogação apaga do equipamento sozinha. O que só a bancada responde: sentido de giro como a borboleta foi montada, tempo real de acionamento, leitura de digital, firmware — e se o `uuid` do aviso de giro é mesmo o da identificação.

## Ponte Topdata implementada (23/09/2026)

A ponte que a seção *Catraca: quem disca é o equipamento* especificou existe: `packages/ponte-topdata/` (`ArkeInnerBridge.exe`, C# de 32 bits compilado pelo `csc` do .NET Framework que já vem no Windows, sem Visual Studio). O manual de instalação e o roteiro de bancada ficam em `docs/PONTE_TOPDATA.md`.

**A primeira execução contra a DLL real achou o que nenhum teste acharia.** No modo em que a catraca conecta no computador (TCP porta fixa), a `EasyInner.dll` ativa por COM o `InnerIPListener`, que mora na `Inner.dll`, um componente **.NET 2.0**. Sem o registro com o **RegAsm** (exige administrador), a abertura da porta devolve **8, "erro GPF"**. O instalador do SDK "geralmente" faz esse registro, segundo o manual; nesta máquina não tinha feito. A causa foi isolada por eliminação: o .NET 3.5 estava instalado; o tipo 1 abria a porta; com janela Windows o erro era o mesmo; e a reflexão sobre a `Inner.dll` mostrou as 30 classes COM sem registro. A ponte agora detecta isso e mostra o comando exato. **Ninguém instala uma Topdata sem esse passo**, e ele está no roteiro.

**Sem a ponte, a catraca trava, e isso é decisão, não detalhe.** No exemplo da Topdata, o equipamento que perde o computador cai para o modo offline e libera qualquer cartão, sem saber se o aluno está pausado ou inadimplente. Por isso a mudança automática para offline fica desligada, e a configuração offline, que o equipamento usa se reiniciar sem a ponte, tem lista branca vazia. É a mesma postura da Control iD. Catraca funcionando com o computador desligado exigiria gravar a lista de alunos no equipamento.

**O lado do gateway tinha ficado para trás da Control iD, com os mesmos dois defeitos:**
- não fechava o giro, então desistência viraria presença;
- não guardava o acesso decidido em contingência, então ele se perdia.

Hoje todo acesso liberado espera o aviso daquele Inner: origem 6 é presença, origem 5 é desistência, o prazo esgotado conta "sem confirmação" e uma leitura nova fecha a anterior. Se a ponte não consegue liberar a catraca, avisa "não girou", para quem ficou do lado de fora não ganhar presença. Os bilhetes que a catraca guardou sozinha chegam por `/topdata/bilhetes` e viram passagem na hora em que aconteceram. Na ponte, cada bilhete vai **para o disco no instante da coleta**, porque coletar o tira da catraca. As rotas `/topdata/*` **só atendem a própria máquina**: sem isso, qualquer aparelho da rede da academia colheria nomes de alunos perguntando por identificadores.

**A consulta ao gateway sai da thread da DLL.** A DLL não é thread-safe e fica numa thread só, mas a consulta à nuvem não é chamada à DLL. Segurar a thread nela congelaria as outras catracas e o `PingOnLine` enquanto a nuvem responde.

**Conferido:**
- **Ponte:** 24 testes da máquina de estados real, com a DLL falsa e o relógio controlado. Rodam no CI num runner Windows (job `ponte-topdata`) e pegam as três mutações feitas de propósito.
- **Gateway:** 11 testes novos, também com mutação.
- **Corrente real:** 13 verificações com a ponte em `--simular` e o gateway e a nuvem de verdade:
  - giro virou presença;
  - desistência não virou;
  - o aluno pausado foi barrado;
  - o CPF digitado no teclado liberou;
  - o cartão desconhecido foi negado e registrado;
  - o bilhete subiu depois da queda do equipamento;
  - a ponte reconectou sozinha;
  - o CPF não apareceu no log.

**Continua fora do alcance sem equipamento:** a DLL conversando com um Inner, o sentido de giro, o tempo de acionamento, o formato exato do valor lido e do bilhete, e a leitura biométrica. A Topdata oferece o **Kit Integrador**, que simula a catraca em bancada e é pedido pelo suporte@topdata.com.br. Com ele, a maior parte do roteiro de bancada roda antes do primeiro cliente.

## Volume da catraca: diferença, retenção e aviso de capacidade (23/09/2026)

Medido antes de decidir: `acessos_catraca_logs` custa **277 bytes por linha** com índices e `presencas` 215; o banco inteiro tinha 30 MB. O que pesava não era o disco, era o **tráfego**: o Gateway baixava a lista inteira de alunos a cada 5 minutos — ~75 KB por rodada numa academia de 500 alunos, 8.640 rodadas por mês, **~630 MB/mês por academia**. No plano gratuito (5 GB de saída) isso acaba com a oitava academia; no Pro (250 GB), com umas quatrocentas. Três mudanças, nenhuma delas dependente do upgrade — que, por decisão do responsável, vem antes do primeiro cliente pagante implantado.

**1. Sincronização por diferença.** `catraca-sincronizar-alunos` aceita `desde` e devolve só quem mudou, quem saiu e o **hash dos ids** que o cache deve ter (`alunos_catraca_hash()`: md5 dos ids em ordem, separados por vírgula — a ordem de uuid no Postgres coincide com a ordem do texto em minúsculas, e é por isso que um `sort()` de strings no Gateway reproduz o mesmo hash). A regra de quem entra no cache e de quem a catraca barra mora num lugar só, `alunos_catraca()`, e **o veredito é calculado no momento do `desde` e no de agora**: é assim que a tolerância de 5 dias do inadimplente, que vence sem ninguém editar nada, aparece na diferença. O Gateway aplica, confere o hash e, se não bater, pede a lista inteira na mesma rodada — aluno excluído não deixa linha para aparecer na diferença, e o hash é o que o pega (junto com qualquer divergência que ninguém previu). Dois minutos de sobreposição entre rodadas, porque repetir é inofensivo e o vão não seria. Marco só em memória: Gateway reiniciado começa pela lista inteira. `alunos_barrados_na_catraca()` foi derrubada — era a segunda versão da mesma regra.

**2. Retenção de 13 meses** em `acessos_catraca_logs` (`limpar_acessos_catraca_antigos()`, cron `arke-retencao-logs-catraca` às 03:40 UTC, em lotes pelo índice de `created_at`). A frequência que importa já não mora ali — cada entrada vira `presencas`, e **presença não é apagada**. Quem lê o log olha no máximo 7 dias. Treze meses, e não menos, porque o check-in de parceiro (Wellhub, TotalPass) mora na mesma tabela e é por ele que a academia confere o repasse anual. A Política promete guardar "enquanto houver vínculo": apagar antes é mais restritivo, sem nova versão nem novo aceite.

**3. Aviso de capacidade do banco.** No plano gratuito, passar de 500 MB deixa o banco **somente leitura** — nenhuma academia grava nada — e o primeiro sinal seria o erro. `avaliar_capacidade()` mede `pg_database_size()` contra `plataforma_config.limite_banco_mb` (500 hoje; **depois do upgrade, trocar pelo disco contratado** em Visão Master → Configurações, e o aviso passa a ser de custo, não de parada). Entra em `rotinas_para_alertar()` como `capacidade:banco`, então anda no mesmo trilho das rotinas: faixa vermelha, e-mail de hora em hora, registro de "já avisei". Lembrete a cada 24 h acima de 85%, e a cada **7 dias** entre 70% e 85% — aviso de planejamento lembrado todo dia por semanas vira ruído, e o ruído ensina a ignorar o e-mail que importa. Mudar de faixa, para cima ou para baixo, é aviso novo. O e-mail fala de banco, não de rotina: sem "última execução" nem "Erro:".

**Conferido.** Sincronização: 8 testes no Gateway (com mutação — sem a checagem de hash e sem a trava de concorrência, eles falham) e **19 verificações com o código real do Gateway contra a função publicada**: lista inteira na primeira, diferença de 134 bytes quando nada muda, aluno novo e pausado pela diferença, tolerância vencendo sem edição trazendo **só** aquele aluno, exclusão pega pelo hash com a lista inteira em seguida. Retenção e alerta: 14 casos em transação revertida (14 meses apagado, 12 mantido, presença preservada, cron reconhecido pela saúde das rotinas; 75% → `banco_70`, silêncio depois do aviso, sem lembrete em 2 dias e com lembrete em 8, 90% → novo `banco_85`, lembrete em 25 h, recuperação). E a corrente real, pelo mesmo comando do cron: alerta enviado, nenhum reenvio na rodada seguinte, "voltou ao normal" ao restaurar o limite.

## Versão 1.0: o Gateway recebe ordens, a biometria fecha o ciclo e a Visão Master vê os equipamentos (23/09/2026)

A auditoria 360° de 23/09/2026 perguntou o que faltava para a ArkeFit ter controle da operação e encontrou três coisas pela metade, todas no mesmo lugar: **a nuvem não tinha como falar com o Gateway.** Ele validava, sincronizava e subia o que decidiu offline, mas não recebia nada de volta — nem "sincronize agora", nem "apague este aluno do equipamento", que a LGPD exige depois da revogação. Consequências: o cadastro no equipamento era manual, a remoção dependia de alguém lembrar, e a ArkeFit só sabia que um Gateway tinha caído quando uma academia ligava. O responsável decidiu implementar tudo menos as marcas sem documentação (Henry e Dimep), que entram na implantação do primeiro cliente de cada uma. Checklist de lançamento em `docs/LANCAMENTO_1_0.md`; o que continua pendente, em `docs/DECISOES_PENDENTES.md`. As decisões que o responsável tomou sobre esta versão estão em *Decisões do responsável sobre a 1.0*, no fim desta seção.

### Canal de comandos: escuta longa

`catraca-comandos` segura a chamada do Gateway por até 25 s esperando ordem e responde assim que ela existe — a ordem chega em ~1 s, **sem abrir porta na rede da academia** (quem conecta continua sendo o Gateway), com umas 100 mil chamadas por Gateway por mês. Cada chamada leva a **telemetria** (versão, estado, fila offline, cadastro local, equipamentos vistos, capacidades) e os **resultados** das ordens executadas. É por ela que o sinal de vida passou de 5 minutos para ~20 s de precisão.

O Gateway executa em **duas filas**: as do equipamento (cadastrar, apagar) uma de cada vez, porque o cadastro remoto prende o leitor por até 90 s; as rápidas (liberar, sincronizar, diagnóstico) sem esperar ninguém — liberar a catraca atrás de um cadastro de digital deixaria alguém parado na borboleta. Resultado pronto no meio de uma escuta longa sai numa chamada curta à parte; resultado que não foi entregue volta para a frente da fila.

**A nuvem só pede o que o Gateway anuncia.** `solicitar_comando_gateway()` confere papel (gestor, recepção, ArkeFit), capacidade anunciada e, para ordens interativas, telemetria recente — pedir cadastro de digital a um Gateway fora do ar deixaria a recepção esperando por nada. Liberação remota exige **motivo**, vai para `auditoria_acoes_sensiveis` e grava `liberado_remoto`, que **não vira presença** de ninguém. A conclusão aplica os efeitos no banco (o número do aluno ao cadastrá-lo, o fim da remoção) em `concluir_comando_gateway()`, não no Gateway — o Gateway não decide o que o cadastro significa.

### Control iD: gestão remota

`controlid_equipamentos` no `config.json` (nome, IP, senha, sentido de entrada). Com ela: **criar o aluno em todos os equipamentos** com o mesmo número, **cadastro remoto de digital e cartão** (`remote_enroll`, síncrono) com **cópia para as outras catracas** da academia (cada equipamento guarda as próprias digitais), **remoção** de digitais, cartões e usuário — nessa ordem, porque a documentação não diz se apagar o usuário apaga em cascata — e **liberação remota**. **A senha do equipamento nunca sobe**: para a nuvem vai só o nome, para a recepção escolher o leitor.

**A resposta do cadastro de digital traz as imagens das digitais.** O cliente lê só `success` e descarta o resto; o template atravessa a memória do Gateway na cópia entre catracas, pela rede local, sem ir para log, resultado ou nuvem. Provado por teste: o resultado que sobe não contém imagem nem template. O número do cartão também não sobe — no modo Pro quem reconhece o cartão é o equipamento, e guardar o número no ARKE seria dado a mais sem uso.

### Biometria de ponta a ponta

Três defeitos na mesma direção, corrigidos juntos (`20261245010000`):

1. **O consentimento era registrado pela equipe**, com um clique. Consentimento dado por terceiro não é consentimento (art. 11, I) — o mesmo vício que o consentimento de IA já tinha corrigido. Agora **só o próprio aluno consente, no app** (Perfil → Privacidade), com **texto versionado** (`versao_consentimento_biometrico()`; espelho em `VERSAO_CONSENTIMENTO_BIOMETRIA`, travado por `versaoBiometria.guarda.test.ts`). A equipe vê o estado na ficha e não registra — o banco recusa.
2. **Revogar só mostrava um aviso** ("apague no equipamento") e nada registrava que foi apagado. Agora agenda `apagar_usuario` em todo Gateway com gestão remota ou, onde não há, abre tarefa `equipamento` com desfecho obrigatório (sempre da academia, mesmo para aluno do Método: é trabalho físico). O consentimento **só ganha `excluido_do_equipamento_em` quando todo o lote conclui** — e o aluno vê essa data no app.
3. **Excluir ou anonimizar o aluno deixava tudo no equipamento.** Agora os dois caminhos agendam a remoção **por gatilho**, e não pelas edge functions de hoje: vale para qualquer código que exclua ou anonimize.

A Política passou a descrever isso na versão `2026-09-23.5` — ver *Decisões do responsável sobre a 1.0*.

### Visão Master → Equipamentos

Três abas. **Gateways e catracas** de todas as academias, ordenados pelo que precisa de ação, com histórico e as ações remotas no detalhe (o mesmo componente `SaudeGateway` da tela da academia — suporte e recepção olham para os mesmos números). **Acessos**: o suporte precisa entender o que a catraca fez, não quem entrou — então **o aluno vira pseudônimo estável**, a credencial só pelo tipo, e **cada consulta fica na Auditoria** com filtros e número de linhas (máx. 31 dias, 500 linhas). **Biometria**: só contagens por academia, com destaque para **remoção parada** (revogado há mais de 24 h e ainda no equipamento), que é descumprimento, não pendência.

**Uma regra de "no ar", não duas.** `situacaoGateway()` em `src/lib/gateway.ts` é espelho de `public.situacao_gateway()` (3 min para o Gateway 1.0; 15 min para o anterior), e o card da Visão Master deixou a consulta antiga (`get_superadmin_gateways`, só o sinal de 5 em 5 minutos) — ela sai na migration pós-deploy. Duas telas com duas regras para a mesma catraca é o desacordo que o espelho existe para evitar.

**Catraca fora do ar vira e-mail** para a ArkeFit e para o gestor da academia — ver *Decisões do responsável sobre a 1.0*. A avaliação é `avaliar_catracas()`: só Gateway 1.0 (o anterior avisaria à toa), e fora da janela de horário a situação é `catraca_offline_fora_horario`, que **não avisa nem manda "voltou"** só porque anoiteceu.

### O que mais a auditoria encontrou

- **Credenciais do Wellhub e do TotalPass em texto puro.** Foram para o **Vault**, só de escrita (`salvar_credencial_parceiro`); a tela mostra que existem e os 4 últimos caracteres quando a chave é longa. Apagar a linha apaga o segredo (gatilho). As colunas antigas saem em `20261270010000`, **aplicada depois do deploy** — antes, quebraria a tela publicada; até lá uma restrição impede gravar nelas.
- **"Mapeamento de hardware" que nada lia.** A tela de Integrações gravava fabricante, IP e porta que o Gateway nunca consultou (ele sempre usou o `config.json`). Removido da tela, e é o certo: a senha de administrador da catraca não tem por que ir para a nuvem.
- **Três edge functions sem tratamento de erro geral.** `lembrete-onboarding` morria no meio do laço numa falha de rede e deixava sem lembrete as academias seguintes; `briefing-semanal` idem, por academia; `ativar-cadastro` dizia **"este link expirou"** com o banco fora do ar — a lição da matrícula pública de novo: falha nossa e link inválido são telas diferentes.
- **Henry e Dimep: o Gateway se recusa a subir**, com mensagem. Os drivers eram stubs que lançavam erro a cada leitura — subir "quase funcionando" deixaria a academia achando que estava integrada.

### Decisões do responsável sobre a 1.0 (23/09/2026)

Revisadas uma a uma depois da entrega; as que pediam código entraram antes do merge.

**Aluno sem app: termo impresso** (`20261250010000`). Cadastro, digital, cartão e exclusão ficam com a gestão e a recepção, e a autorização pelo app continua. Para quem não usa o app e está **em dia**, a recepção imprime o termo — **o mesmo texto e a mesma versão do app**, que moram num lugar só (`src/lib/termoBiometria.ts`) —, o aluno assina e a recepção anexa o termo assinado. `registrar_consentimento_biometria_termo()` confere papel (gestão ou recepção), situação em dia e que o arquivo existe na pasta do aluno, grava `origem = 'termo_assinado'` com quem registrou e o arquivo, e audita. **Quem consente continua sendo o titular**: a assinatura é dele, a equipe só registra, e o arquivo é a prova. O bucket `termos-biometria` é privado; leem o aluno e a equipe da academia, gravam só gestão e recepção, e ninguém altera nem apaga. As regras de `storage.objects` continuam **uma por operação**: o bucket entrou nas existentes por `alter policy`, e não numa regra a mais.

**Cartão num clique, e "Aluno" no display.** Digital e cartão pedem o aluno já criado no equipamento; quando falta, a ficha cria antes, sozinha. O display da Control iD mostra **"Aluno"**, não o nome: quem está na fila atrás não vê o nome de ninguém. Sem gestão remota, o campo manual diz o que vai nele — na Topdata com cartão, **o número do cartão**. Na Topdata o aluno tem um número só; cartão e digital ao mesmo tempo é item da primeira implantação dessa marca.

**Aviso ao gestor, aos 10 minutos** (`20261251010000`). O aviso de catraca saiu do trilho do alerta de rotinas, que roda de hora em hora — com ele, os 10 minutos pedidos virariam até 70. Ganhou rotina própria, `arke-alerta-catracas`, de **2 em 2 minutos**, e a edge function `alertar-catracas`: a ArkeFit recebe todas as catracas num e-mail, **o gestor recebe só as da academia dele**, com o que conferir na recepção, sem jargão. `alertas_catracas` é o "já avisei" próprio — dividir a tabela das rotinas faria o alerta de rotinas ver as linhas da catraca como rotinas que sumiram e mandar "voltou" por elas. `avaliar_rotinas()` passou a reconhecer agendamento de N em N minutos, para a rotina nova ter a mesma vigilância das outras. Provado pelo cron de verdade, com um gestor no endereço de teste do Resend: avisou, não repetiu, avisou a volta, e os quatro e-mails foram entregues.

**Política `2026-09-23.5`** (`20261271010000`, **aplicada depois do deploy**). Diz o que a digital faz de fato: autorização no app ou pelo termo assinado; retirar a autorização, encerrar a matrícula ou eliminar os dados apaga a digital dos equipamentos; o termo assinado fica pelo prazo legal, como prova. Versão nova, hash novo, aceite novo.

**Método ARKE à venda desde o primeiro dia.** Saiu o interruptor `VITE_METODO_ARKE_VENDA` e o anúncio de "breve lançamento". O app oferece o Método **só quando a academia de fato vende** — `metodo_ofertas_academia()`: nível disponível, preço de varejo e repasse negociado, as mesmas condições da cobrança —, com o preço e "fale com a recepção para assinar". Anunciar a quem não pode comprar mandaria o aluno à recepção atrás de algo que não existe. A matrícula pública deixou de mostrar o Método: ela é a entrada no Free, e a oferta mora no app.

**Arquivos do aluno saem com ele.** Achado de passagem, ao limpar um teste: excluir ou anonimizar o aluno apagava as linhas e **deixava os arquivos** — atestado médico e vídeo de conversa, dado de saúde sem nada apontando para ele. `_shared/arquivosDoAluno.ts` apaga a pasta do aluno nos buckets privados, **depois** do banco (se a exclusão falhasse, o aluno ficaria sem o atestado que vale). A exclusão leva atestados, vídeos e o termo da digital; a anonimização leva atestados e vídeos e **guarda o termo**, que é a prova da autorização.

**Encerradas sem código:** "servidor de suporte" são as ações remotas pelo Gateway; acessos na Visão Master sem nome nem CPF e auditados; QR Code na catraca continua negado; credenciais de parceiro no cofre; configuração do equipamento no `config.json`; liberação remota só por gestão, recepção e ArkeFit; e o instalador do Gateway **sem assinatura de código**, com o aviso do SmartScreen aceito — a conexão com as catracas é acertada na implantação do primeiro cliente.

### Um defeito que só o navegador mostrou

Na rodada pela tela, a chave do parceiro digitada sumia antes de salvar. `const { data: credenciais = [] } = useQuery(...)` cria **um array novo a cada renderização** enquanto a consulta carrega; um `useEffect([credenciais])` que preenche o formulário rodava em laço ("Maximum update depth exceeded") e **apagava o que o gestor tinha acabado de digitar**. A versão anterior da tela tinha o mesmo padrão e escapava por acaso: gravava sempre o mesmo objeto constante, e o React descartava a atualização. **Regra: não usar valor padrão literal (`= []`, `= {}`) em dado que é dependência de efeito.**

### Conferido

- **Corrente real, sem hardware:** Gateway rodando localmente, `catraca-comandos` publicada, banco real e o emulador no papel do equipamento (`npm run emular:controlid -- --servir`) — **22 verificações**, da telemetria à revogação apagando o aluno do equipamento.
- **Pela tela, num navegador**, com gestor e aluna temporários da homologação — **16 verificações**: catraca no ar com a versão, sincronizar e liberar pela tela, cadastro do aluno, da digital (só depois de a aluna autorizar no app) e do cartão pela ficha, segredo no cofre sem voltar à tela, revogação pelo app apagando do equipamento e mostrando a data.
- **Banco em transação revertida:** 15 grupos do canal e do consentimento; 27 casos do painel, do alerta com janela de horário, da pseudonimização (o CPF não aparece em nenhuma linha) e do cofre; 5 do vigia das funções agendadas.
- **Gateway: 112 testes**, com três mutações feitas de propósito (usuário apagado antes da digital, ordens do equipamento sem fila, resultado que não volta para a fila) — as três pegas.

## Vigia: o segundo agente, em modo sombra (24/09/2026)

O ARKE tem **dois agentes**, e a separação é de propósito. O **Sentinela** é a IA do Mentor: resume a anamnese e sugere resposta no chat, com o consentimento do aluno e processando em São Paulo. O **Vigia** cuida da saúde técnica da plataforma — Gateways de catraca, rotinas agendadas, conferência com o Asaas, avisos de pagamento, capacidade do banco — e **não lê dado de aluno**. O responsável decidiu que o Vigia é um agente só, com duas camadas que se completam: **regras** para o que já se sabe tratar e **análise por IA** para olhar o quadro inteiro.

**Começou em modo sombra, e executa desde a Fase 3 (24/09/2026).** O Vigia começou registrando o que faria, sem executar nada; o plano era esperar duas semanas, mas sem cliente em produção não haveria o que medir, e a avaliação foi feita por simulado (ver *Fase 2*). Com o resultado, o responsável decidiu o que passa a rodar (ver *Fase 3*). É evidência antes de autonomia: a pergunta que decide se uma correção automática vale a pena — o problema teria sumido sozinho? — só se responde medindo, e a tela continua medindo.

### Camada de regras

`vigia_detectar()` tem 9 regras em `vigia_regras`: 6 de **nível 1** (faria sozinho: sincronizar Gateway atrasado, reenviar acessos guardados, pedir diagnóstico de Gateway em contingência prolongada, reenviar remoção de digital quando o Gateway volta, rodar de novo rotina repetível que falhou, repetir a conferência com o Asaas) e 3 de **nível 2** (pediria aprovação: rotina que fala com academias, assinatura órfã, aviso do Asaas não processado). `vigia_varrer()`, de 5 em 5 minutos, abre a ocorrência quando a regra vê o problema e a fecha quando ele some, registrando no caminho o que teria acontecido:

- **espera antes de agir** — o que some antes vira "sumiu antes da hora de agir", ou seja, a ação teria sido desnecessária. É o número que mais importa na avaliação;
- **novas tentativas com limite** e, esgotadas, **"iria para uma pessoa"**;
- **freio de falha geral** — a mesma regra em muitos alvos de uma vez indica causa comum (nuvem, fornecedor), e agir em cada alvo seria tratar sintoma.

Os freios já valem no modo sombra, para a avaliação medir o que de fato rodaria. **Rotina repetível** mora numa lista só, `vigia_rotina_repetivel()` — as rotinas que criam tarefa com `on conflict … do nothing` ou atualizam por condição; quem manda e-mail para academia fica fora, e rotina nova fica fora até alguém conferir. O próprio Vigia não se avalia: se a rotina dele falha, quem avisa é o alerta de rotinas.

### Camada de análise por IA

`vigia_quadro()` monta o que o modelo vê e só chama a análise quando o conjunto de anomalias muda — mesmo problema persistindo não gera chamada nova a cada varredura —, no máximo 4 por hora, com reavaliação a cada 6 h. O modelo é o **Claude Sonnet 4.6 pelo perfil `global.` do Bedrock**, que processa fora do Brasil, e isso só é aceitável porque **o que sai não é dado pessoal**:

- **lista do que é permitido, não do que é proibido:** tipos de anomalia, contagens, minutos, nomes de rotina e pseudônimos que valem só dentro de uma análise (A1 = uma academia, G1 = um Gateway). Nenhum nome, id, e-mail, CPF ou texto livre — **nem mensagem de erro**, que pode carregar valor de coluna: o erro vai só pela classe (`vigia_classificar_erro`). `validarQuadro()` (`_shared/vigiaAnalise.ts`) confere de novo e recusa o quadro inteiro por um campo fora da lista;
- **o `mapa`** que liga pseudônimo a academia fica no banco (`vigia_analises`) e nunca sai;
- **sem texto livre, não há por onde uma instrução plantada num log chegar ao modelo.**

A família Claude 5 não estava liberada para esta conta AWS na data; o Sonnet 4.6 estava, com uso de ferramenta. O modelo é **constante no código** (`MODELO_VIGIA`), não secret: trocar para onde vai a telemetria é mudança com revisão. `iaNoBrasil.guarda.test.ts` ganhou as travas da exceção: o único `global.` do código é o do Vigia; `consultarVigia` valida o quadro antes de montar o pedido e de enviar; o Sentinela não usa o modelo do Vigia; só a função `vigia` usa a porta. Conferido quebrando o código de propósito.

**A autonomia é da ferramenta, não do modelo.** O modelo escolhe ações de um catálogo fechado (`FERRAMENTAS`) chamando uma ferramenta forçada, mas **a classe de cada ação — sozinho, aprovação, pessoa — é do catálogo**: só é "sozinho" o que continua inofensivo com o diagnóstico errado. Ferramenta fora da lista ou alvo fora do quadro é recusada e contada. A **confiança que o modelo declara é guardada e não decide nada**: um número que o modelo escreve sobre si mesmo não é probabilidade medida, e a avaliação vai dizer se ele acompanha o acerto. Ficam **fora do catálogo**, e portanto fora do alcance do modelo: liberar catraca, limpar a fila do Gateway (ela guarda acessos que viram presença), apagar registro, mudar situação ou plano de aluno, ação financeira fora dos caminhos existentes, schema, RLS e segredos.

**O modo sombra já mostrou para que serve.** Na primeira análise de teste, três Gateways de uma academia com a lista atrasada e **todos no ar** saíram como "internet da academia" — errado, porque Gateway no ar prova que a rede funciona. O roteiro do modelo passou a dizer isso, e a análise seguinte apontou a nuvem. É esse tipo de erro que se quer ver antes de dar autonomia.

### Resumo, tela e interruptor

O **resumo diário** sai às 8h de Brasília (`vigia-resumo`, cron `arke-vigia-resumo`) para os Super Admins, **mesmo num dia sem ocorrência**: no modo sombra, "rodou 288 vezes e não viu nada" distingue um dia calmo de um Vigia parado. **Visão Master → Vigia** mostra os mesmos números (`get_superadmin_vigia`), com as análises em nomes de verdade (`vigia_resolver_nomes`) e o **interruptor** (`definir_vigia_ativo`, só a ArkeFit, registrado na Auditoria). As duas funções usam o token do alerta de rotinas e registram o próprio desfecho em `execucoes_agendadas`.

### Conferido

- **26 casos em transação revertida**, com catracas, rotinas e eventos do Asaas simulados: o ciclo inteiro de uma regra (espera, ação, tentativas, escalonamento, fechamento, "sumiu sozinha"), freio com 3 Gateways, regra desligada, as nove regras, o quadro sem nome, id, e-mail, CPF ou mensagem de erro, a análise repetida não chamando o modelo de novo, o resumo e os acessos (gestor leva 403; desligar fica na Auditoria).
- **Corrente real em produção:** uma falha de rotina provocada abriu a ocorrência, a função publicada chamou o modelo e gravou a análise, e o resumo foi **entregue** às caixas dos Super Admins. Depois a falha foi desfeita, a ocorrência fechou sozinha e os registros do teste foram apagados, para não entrar na avaliação.
- **Testes:** validação do quadro (13 formas de sujá-lo, todas recusadas), catálogo e classes, leitura da resposta, e-mail, tela e o espelho dos rótulos — 43 testes, mais as quatro travas novas de `iaNoBrasil.guarda.test.ts`.

### Fase 2: o simulado, em vez de esperar incidente (24/09/2026)

Esperar as duas semanas daria uma avaliação vazia: sem cliente nem catraca em produção, o Vigia não tem o que ver. `npm run simulado:vigia` (`scripts/vigia-simulado.mjs`) monta **13 cenários de falha no banco de verdade**, cada um numa transação desfeita no fim — sem e-mail e sem linha nova —, simula a passagem do tempo para as regras e manda o quadro de cada um ao modelo **pelo mesmo código de produção**, 3 vezes. Como os cenários foram montados à mão, a causa certa e as ações esperadas são conhecidas, e dá para dar nota. Mede se o Vigia acerta; **com que frequência** cada caso acontece só a operação real diz.

**Três rodadas, e o que cada uma consertou:**

| Rodada | Causa certa | Ação esperada | Sem ação fora de lugar |
|---|---|---|---|
| 1 — roteiro original | 100% | 96% | **72%** |
| 2 — Gateway sem sinal explicado e travado | 100% | 79%* | 100% |
| 3 — freio de falha geral na análise | 95% | 100% | 100% |

\* nota errada do simulado, não do modelo: nos casos em que uma regra já tratava o problema, ele deixou para ela, como o roteiro manda. A rodada 3 conta isso como acerto.

Dois defeitos reais, que teste unitário nenhum acharia:

- **Ordem para Gateway sem sinal.** O modelo acertava "internet da academia" e ainda propunha reenviar acessos e pedir diagnóstico às catracas caídas, "para quando voltarem" — ordem que não chega, e que o Gateway faz sozinho ao voltar. Agora o roteiro explica e o catálogo recusa (`alvo_sem_sinal`), a mesma trava das regras, que só agem em Gateway no ar.
- **Sintoma tratado um a um.** Com três academias em contingência, acertava "nuvem" e mandava sincronizar cada Gateway — com cem academias, cem downloads da lista inteira numa nuvem que já não responde. Agora a análise tem o **mesmo freio das regras** (`aplicarFreio`: a mesma ordem para 3 Gateways ou mais é segurada) e o roteiro explica que contingência é demora da nuvem, que sincronizar não resolve.

**Confiança declarada:** 83 em média quando acertou a causa, 65 quando errou — acompanha o acerto, mas com dois erros a amostra é pequena demais para virar régua. O erro restante: falha de cadastro no equipamento, lida como nuvem em 2 de 3.

**A conta AWS tem cota baixa para o modelo.** Três chamadas em paralelo esgotaram a cota em segundos (429). Em produção não pesa — no máximo 4 análises por hora, e recusa vira "indisponível" com nova tentativa depois —, mas o simulado chama uma de cada vez e espera. Cada análise custa uns 2.500 tokens de entrada e 700 de saída, cerca de US$ 0,02.

### Fase 3: executa (24/09/2026)

Decisão do responsável, depois do simulado: **as 6 regras de nível 1 agem sozinhas; as 3 de nível 2 pedem aprovação de um clique; a análise por IA é conselheira** — o diagnóstico fica visível e as ações dela pedem aprovação, mesmo as que o catálogo classifica como "sozinho", até acumular casos reais (`20261273010000_vigia_execucao.sql`).

**Quem executa é o banco, não a função publicada.** O cron `arke-vigia` chama `vigia_varrer()` direto: se a edge function quebrar num deploy, as correções continuam — e a rotina do cron não tem o **limite de 8 s que o PostgREST impõe** a cada chamada (`statement_timeout` do papel `authenticator`), o que importa quando a correção é rodar de novo uma rotina do banco. A edge function `vigia` ficou com a análise por IA e os avisos por e-mail (cron `arke-vigia-analise`), e a nova `vigia-aprovar` com a aprovação.

**O executor** (`vigia_executar`) só conhece ferramentas do catálogo e só com alvo de verdade: ordem ao Gateway pelas mesmas travas da tela (catraca ativa, capacidade anunciada, Gateway no ar) e **sem empilhar ordem igual** — ordem já na fila espera a próxima varredura **sem gastar tentativa**; rotina rodada de novo com o mesmo comando do cron. Teto de 20 execuções por varredura. Cada ação fica em `vigia_acoes`, com o comando do Gateway ao lado, e o que precisa de uma pessoa — aprovação pedida ou tentativas esgotadas — sai por **e-mail na hora**, uma vez (`vigia_avisos_pendentes`).

**Quatro coisas que o modo sombra escondia e a execução não podia esconder:**

- **Detectar deixou de depender da ordem pendente.** Em sombra, a regra ignorava o Gateway com ordem na fila, para não contar em dobro o que alguém já pedira. Executando, a própria ordem do Vigia fecharia a ocorrência e ela reabriria como nova, zerando tentativas e escalonamento. A regra olha só o problema; quem espera a ordem é o executor.
- **A remoção de digital reenviada fecha o ciclo.** A remoção só valia quando **todas** as ordens do lote concluíam — a que expirou ficava "expirada" para sempre e o consentimento nunca ganhava a data de exclusão. `verificar_remocao_concluida` passou a olhar a ordem **mais recente** de cada catraca do lote, e fecha a tarefa da falha com desfecho quando o reenvio conclui. A tarefa de equipamento **sem** gestão remota continua exigindo uma pessoa.
- **Rotina de banco consertada pelo Vigia conta.** O histórico do cron só tem as execuções agendadas: sem isso, a rotina seguiria "falhou" até a próxima execução e o Vigia tentaria de novo e escalaria à toa. A regra considera a reexecução bem-sucedida dele. Rotina de edge function registra o próprio desfecho, então ali vale o registro dela.
- **Aviso do Asaas agrupado por tipo:** uma queda do Asaas vira um pedido de aprovação, não um por aviso.

**Aprovação sem clique duplo.** `vigia-aprovar` chama `vigia_preparar_aprovacao`, que confere o papel (só a ArkeFit) e **reserva a decisão antes de executar** — a ocorrência ganha `decisao` e a ação nasce "executando" com índice único por ação da análise —; só então executa, e `vigia_concluir_acao` grava o desfecho e a **Auditoria**. O que precisa do Asaas roda na função: cancelar assinatura órfã (produção, pelo `ambienteAsaas`, com o `cancelarAssinatura` do ciclo de cobrança) e reprocessar avisos, reenviando o aviso guardado ao próprio `asaas-webhook` — o mesmo caminho da reconciliação. Ação de pessoa e cancelamento proposto pela IA não têm botão: a órfã se aprova na ocorrência da regra, que sabe qual é. Análise de mais de 12 horas não se aprova mais — o quadro mudou.

**O modo de cada regra muda pela tela** (`definir_modo_regra_vigia`, auditado), com a trava no banco: **nível 1 nunca pede aprovação e nível 2 nunca age sozinho** sem mudança de código. Dispensar pede motivo opcional e fica registrado. O resumo diário deixou de falar em sombra quando há regra executando: conta o que o Vigia fez e o que espera aprovação.

**Conferido:** 28 casos em transação revertida (a ordem que sai e a que não empilha, tentativa sem gastar, fechamento, escalonamento e aviso, freio sem ordem nenhuma, rotina de edge e de banco, aprovação com gestor barrado e clique duplo recusado, dispensa, modo por regra, ação da IA com o pseudônimo virando a catraca de verdade, remoção reenviada fechando tarefa e ocorrência, interruptor) e **a corrente real em produção**, 9 verificações: uma falha provocada consertada sozinha, com a rotina voltando de verdade; outra pedindo aprovação por e-mail, gestor com 403, Super Admin aprovando **pela função publicada** com sessão real, segundo clique com 409, Auditoria gravada e a rotina voltando. Os registros do teste foram apagados; a linha da Auditoria ficou, porque é prova.

## Rodada 360° de 24/09/2026: prontidão para as primeiras academias

Conferência de ponta a ponta, com a infraestrutura paga como premissa (regra do responsável: todo upgrade vem antes do primeiro cliente pagante).

**O que estava bem, e como foi conferido:**

- 23 rotinas agendadas no ar, nenhuma execução com falha no cron em 7 dias, zero linhas órfãs, banco em 4,8% do limite, última reconciliação com o Asaas sem erro;
- as 43 edge functions do repositório são exatamente as 43 publicadas, com o mesmo `verify_jwt` do `config.toml`, e todas sobem: chamada sem credencial responde 400 ou 401, nunca 5xx;
- **52 telas em produção** abertas com sessões reais de gestor, aluno, Super Admin e visitante, sem clicar em nada: nenhum erro de console, exceção, resposta ≥ 400 do Supabase ou queda no ErrorBoundary;
- o teste de ponta a ponta da jornada do aluno roda de verdade a cada deploy (10 de 10), e não "pulado".

**O que foi encontrado e corrigido:**

1. **Funções que respondiam sobre qualquer aluno.** Treze funções SECURITY DEFINER sem checagem de quem chama estavam alcançáveis por qualquer pessoa logada em `/rest/v1/rpc`, recebendo o id de um aluno ou de uma academia: constância, dias sem aparecer, se está inadimplente, se consentiu IA, o briefing inteiro da academia, o repasse negociado com a ArkeFit. Um aluno de uma academia conseguia perguntar sobre aluno de outra. Nenhuma era usada pelo app — quem chama são outras funções SECURITY DEFINER e edge functions com a service role —, então foram fechadas (`20261274010000`). A ficha do aluno usava outras três direto; passou a usar `get_jornada_aluno()`, que confere se quem pergunta é da equipe, da ArkeFit ou o próprio aluno, e as três fecham em `20261275010000`, **depois do deploy da tela**. `valor_mensal_b2b` ganhou a checagem por dentro (a Visão Master e a edge function usam). Conferido em 25 casos, inclusive gestor de outra academia e outro aluno da mesma levando 42501 e as chamadas com service role seguindo iguais. **Regra que fica:** função SECURITY DEFINER nova que recebe id de aluno ou de academia confere quem chama, ou nasce sem EXECUTE para `authenticated` — o mesmo tipo de higiene que a revogação das funções de gatilho, e que também não se mantém sozinha.
2. **Rotina em andamento contava como rotina que falhou.** O pg_cron grava a execução como `running` e só depois como `succeeded`; `avaliar_rotinas()` pegava a última linha, qualquer que fosse. A varredura do Vigia, a análise dele e o alerta de catracas disparam no mesmo segundo a cada 10 minutos, e o Vigia via a vizinha em andamento: **22 ocorrências falsas em 3 horas**, desde que a Fase 3 entrou no ar, três delas com a própria análise reexecutada sem necessidade. Nenhum e-mail falso saiu, porque o alerta de rotinas lê meio segundo depois. Agora só a execução terminada conta; desde a correção, nenhuma ocorrência nova. **As 22 de 24/09/2026 entre 10:35 e 12:30 são do defeito e não entram na avaliação do Vigia.**
3. **Números escritos com ponto.** O saldo do financeiro da academia aparecia como "R$ 125.53", a Visão Master como "41.2%" e a mensagem de erro da cobrança como "R$ 49.05" — `toFixed` escreve no padrão americano, e eram mais de 40 pontos em 21 arquivos, cada tela copiando a vizinha. Tudo passou por `src/lib/numeros.ts` (`reais`, `decimal`), e `numeros.guarda.test.ts` falha se um `toFixed` voltar a ir para a tela.
4. **Faixa vermelha por rotina que ainda não teve a primeira janela** — ver *Rotinas agendadas não falham em silêncio*.
5. **O aluno não via a mensalidade da academia.** O app mostrava só a assinatura do Método; vencimento, segunda via e histórico existiam só no e-mail do Asaas, e "me manda o boleto" ia para a recepção. `MinhasMensalidades` (Perfil) mostra a que está em aberto, com o link da fatura, e as últimas pagas; sem mensalidade cobrada pelo ARKE, não aparece.
6. **Importação com sobrenome ou DDD em coluna própria.** O aluno entrava só com o primeiro nome, e o celular sem DDD não serve nem para o WhatsApp nem para o primeiro acesso por QR, que procura pelos últimos 10 dígitos. `juntarPartes()` junta os dois antes de validar, sem duplicar sobrenome repetido e sem mexer em telefone que já tem DDD.
7. **Lint fora do CI.** Sete erros acumulados que ninguém via; corrigidos, e o `npm run check`, que o CI já roda, passou a incluir o `eslint` (só erro reprova; aviso fica como aviso). Foi pelo `check`, e não por um passo novo no workflow, porque o token destas sessões não tem permissão para alterar `.github/workflows`.
8. **`search_path` fixo** nas onze funções que tinham nascido sem ele.

Um achado de dado, não de produto: o nome do gestor de homologação estava gravado como "Homologa��o" desde a migração — o único texto com U+FFFD no banco inteiro, vindo de um script. Corrigido.

## Cobrança avulsa e taxa de matrícula (24/09/2026)

Decisão do responsável depois da rodada 360°: taxa de matrícula e cobrança avulsa entram antes das primeiras academias; plano com fidelidade e desconto esperam o primeiro cliente que precisar. Até aqui o ARKE só cobrava de forma recorrente, e taxa de matrícula, avaliação física, personal, diária e produto eram cobrados por fora e lançados à mão — ou não eram lançados.

**O desenho é o da mensalidade, de propósito** (`20261276010000`, edge function `asaas-cobranca-avulsa`):

- **A linha nasce no banco antes de ir ao Asaas**, e vai com `externalReference = avulsa:<id>`. Emitir de novo procura a referência antes de criar, então uma cobrança criada no Asaas cuja resposta se perdeu é **adotada, não duplicada**. Recusa definitiva do Asaas desfaz a linha; falha de rede ou tempo a deixa como "emissão não confirmada", com o botão "Tentar de novo".
- **Mesmo split**: a academia recebe o valor menos a taxa de processamento, que fica com a ArkeFit para cobrir o Asaas. Repasse e líquido travados na linha.
- **O webhook atualiza** (pelo id do pagamento ou, na falta dele, pela referência — é o que completa a linha se a gravação do id falhou), a **conciliação diária** confere as que ficaram em aberto, e o pagamento **vira lançamento de receita** sozinho ("Cobranças avulsas (automático)").
- **Sem regra de escrita no RLS**: só a edge function (que confere papel e fala com o Asaas) e o webhook escrevem. Uma política de UPDATE para a equipe deixaria marcar como paga uma cobrança que o gateway nunca recebeu.
- **Quem emite e cancela:** gestão e recepção da academia do aluno — a mesma regra da situação. O resto da equipe vê.
- **Vencida abre tarefa de cobrança para a recepção, mas não marca o aluno como inadimplente.** A situação acompanha a mensalidade, que é o contrato; avaliação física atrasada não tira ninguém da academia.
- **A saída do aluno leva as avulsas junto:** excluir ou anonimizar cancela no Asaas as que estão em aberto (`_shared/encerrarCobrancas.ts`), e `trg_impedir_exclusao_com_cobranca_viva` passou a barrar a exclusão com avulsa em aberto, inclusive a de emissão não confirmada.

**Onde aparece:** bloco *Cobranças avulsas* na ficha do aluno (com prévia de quanto a academia recebe antes de emitir, copiar link, cancelar, tentar de novo); campo **Taxa de matrícula** no diálogo de matrícula, que emite a taxa numa fatura à parte vencendo hoje — se ela falhar, a matrícula não se desfaz e a mensagem diz onde emitir; **Pagamentos da academia** no Perfil do aluno (mensalidade e avulsas, com o botão Pagar); aba própria na **exportação para o contador**; e receita do **Gestão 360**. A série histórica de receita da Visão Master ainda não separa as avulsas.

**O que o sandbox decidiu** (`npm run sandbox:avulsa`, 17 verificações sobre o `fluxo.ts` real):

- **O Asaas não emite abaixo de R$ 5,00** quando o aluno escolhe a forma de pagamento na fatura. A validação barra antes.
- **Cobrança pequena era recusada por causa do split** — o achado que mais importa, e que valia também para a mensalidade. A taxa retida era estimada só pela fórmula do cartão (2,99% + R$ 0,49), mas boleto e PIX custam **R$ 1,99 fixos** por cobrança (conferido em `/myAccount/fees` nas contas de produção e sandbox; R$ 0,99 com desconto promocional até 08/12/2026). Abaixo de R$ 50,17 a estimativa fica menor que isso, a parte da academia passa do valor líquido e o Asaas recusa criar a cobrança ("o valor total do Split excede o valor a receber"). Hoje isso já barrava cobrança abaixo de ~R$ 17; depois da promoção, barraria toda cobrança abaixo de ~R$ 50 — taxa de matrícula, diária e **mensalidade de plano barato**.

**A correção é um piso na taxa, num lugar só** (`20261277010000`): `arke_taxa_processamento()` nunca devolve menos que `taxa_processamento_minima` (R$ 1,99, editável em Visão Master → Configurações). Acima de R$ 50,17 nada muda — o Método a R$ 119 segue retendo R$ 49,05. `src/lib/repasse.ts` espelha a regra, e as três telas que liam a configuração passaram a usar um hook só (`useTaxaProcessamento`). Pelo caminho apareceu **uma quarta cópia da conta**: `academia-criar-matricula` calculava a taxa por conta própria a partir de `plataforma_config`, e por isso ficaria sem o piso; passou a chamar a função do banco. Assinaturas já criadas mantêm o split travado na criação.

**Conferido:** 12 casos da migration em transação revertida (leitura por aluno e equipe, escrita barrada, lançamento uma vez só, tarefa idempotente com dono academia, exclusão barrada e liberada); 17 no sandbox, incluindo a prova direta do defeito — sem o piso, R$ 5 é recusado; com ele, R$ 5 e R$ 20 passam —; e **27 na corrente real** em homologação, pelas funções publicadas e com sessões de verdade: aluno leva 403, gestor de outra academia 404, a taxa de R$ 40 sai com repasse de R$ 1,99 e split de R$ 38,01, o pagamento confirmado no sandbox volta pelo webhook e vira lançamento, a paga não se cancela, a cancelada some do Asaas, "tentar de novo" adota a cobrança que já existia em vez de duplicar, e excluir uma aluna com taxa em aberto remove a cobrança dela no Asaas. Os registros de teste foram apagados.

## Nota fiscal automática da academia (24/09/2026)

**A responsabilidade fiscal segue o split** (decisão do responsável): a ArkeFit trata do fiscal do que entra no caixa dela, e a academia do que entra no dela. Por isso a nota da academia sai **no CNPJ dela, na conta Asaas dela**, pelo **valor que entrou no caixa dela** (`valor_liquido_academia`) — mensalidade, cobrança avulsa e a parte da academia no Método ARKE. Não é ERP: a contabilidade continua com o contador, e a exportação do fechamento segue como está.

**Como a nota nasce.** A cobrança mora na conta da ArkeFit e o dinheiro chega à academia pelo split, então a nota dela é **avulsa, por cliente**: o aluno é cadastrado como cliente também na conta da academia (`garantirCliente`, pelo id do aluno e depois pelo CPF, com o endereço). `enfileirar_nota_fiscal` (gatilho em `mensalidades`, `cobrancas_avulsas` e `pagamentos`) põe a nota na fila quando o pagamento confirma — **só com a emissão ligada, e sem retroagir** —, e o estorno pede o cancelamento. `nfse-emitir` (cron `arke-emitir-notas`, de 10 em 10 minutos, token do Vault) emite, acompanha a prefeitura (agendada → emitida), cancela e adia o que falhou, com até 5 tentativas. A referência `nfse:<id da linha>` torna a emissão idempotente: "tentar de novo" adota a nota que já existe. A tela da academia fica em **Financeiro → Notas fiscais**; o aluno vê o link da nota em **Perfil → Pagamentos da academia**.

**O cadastro fiscal é da academia, e o formulário se monta sozinho.** Cada prefeitura pede uma coisa, e o ARKE vende para qualquer cidade: manter uma tabela de prefeituras seria um projeto à parte. `GET /fiscalInfo/municipalOptions` diz o que a prefeitura da academia exige (certificado A1, usuário e senha do portal, ou token) e quais regimes existem, e a tela mostra só isso. **Certificado e senhas atravessam `asaas-fiscal-academia` e vão direto ao Asaas**: não são gravados nem vão para log. Ligar a emissão confere o cadastro no Asaas na hora (`pronta`), não o retrato guardado.

**A chave da conta tem de ser da conta que recebe o split.** A subconta aberta pelo ARKE já tem a chave no cofre. Quem trouxe conta Asaas própria cola a chave de API, e a função confere que `GET /wallets` devolve a mesma carteira de `organizations.asaas_wallet_id` — sem isso, a nota sairia no CNPJ de outra empresa. O ambiente vem pelo prefixo, como no resto: organização em trial só aceita chave de sandbox.

**O endereço do aluno virou dado do cadastro, porque a prefeitura exige.** No sandbox, a nota sem endereço fica agendada e a emissão responde "Endereço do cliente incompleto; CEP do cliente é inválido". `profiles` ganhou CEP, rua, número, complemento, bairro, cidade e UF; `atualizar_endereco_aluno()` aceita o próprio aluno (Perfil) ou a gestão e a recepção (ficha, para quem não usa o app), e devolve à fila as notas que esperavam o endereço. A importação reconhece as colunas de endereço das exportações e o convite leva o endereço junto. A Política de Privacidade foi para `2026-09-24`: endereço no cadastro, o Asaas emitindo a nota da academia, a prefeitura recebendo a nota e a BrasilAPI recebendo só o CEP do aluno — aprovada pelo responsável como estava. O Contrato da Academia foi para `2026-09-24` com a **cláusula de responsabilidade fiscal** na seção 3: cada parte responde pelo fiscal do que entra no próprio caixa, a nota sai no CNPJ da academia, e o cadastro fiscal é dela — a ArkeFit transmite ao Asaas e não responde pelo enquadramento tributário escolhido. Os dois textos foram aprovados pelo responsável como estavam.

**O que o sandbox decidiu** (`npm run sandbox:nfse`, 14 verificações sobre o `fluxo.ts` real): o serviço 6.04 (ginástica) se acha pelo nome, já com o ISS; o cadastro fiscal aceita dados parciais, mas a emissão recusa sem autenticação na prefeitura; a nota passa de agendada a autorizada em segundos, com número, PDF e XML; e o cancelamento chega a cancelada. O sandbox já não cria subcontas de teste ("teste controlado"), então a conta-mãe fez o papel da academia.

**Dois defeitos que só apareceram fazendo.**

- **Duas rodadas emitiriam a mesma nota.** A do cron e uma chamada à mão (ou uma rodada lenta) leriam a mesma linha pendente, e a referência não fecha a corrida: as duas consultam o Asaas antes de qualquer uma criar. Cada linha é **reservada** por uma troca condicional do horário da próxima tentativa, e quem não reserva pula.
- **O botão mandava o formulário de antes.** O `useMutation` troca a função que envia só depois do efeito; um clique logo após o formulário se preencher enviava os campos vazios. Os dados passaram a ir como argumento do `mutate`, montados no clique. **Regra: mutação que envia estado de formulário recebe os dados no `mutate`, não pelo fechamento.**

**Conferido na corrente real**, na homologação, pelas funções publicadas e com sessões de verdade — **29 verificações**: aluno e gestor de outra academia barrados; chave de produção e chave de outra conta recusadas sem nada ir ao cofre; ligar sem serviço recusado; a taxa de matrícula paga no sandbox entrou na fila pelo webhook, por R$ 38,01 (o líquido da academia sobre R$ 40); sem endereço a nota esperou e disse por quê; o aluno gravou o endereço no app e a nota voltou à fila; a prefeitura autorizou com número e PDF, uma nota só no Asaas; o aluno viu o link; o estorno pediu o cancelamento e a nota chegou a cancelada; cada rodada ficou registrada para o alerta de rotinas. O estorno foi simulado no banco, porque o sandbox não estorna pagamento confirmado pelo atalho de teste — o webhook de estorno de verdade grava `estornado`, que é exatamente o que o gatilho observa. Os registros do teste foram apagados, e as notas emitidas foram canceladas no sandbox.

## Rodada de lançamento — Fase 0: o sistema para 10 a 50 academias (24/09/2026)

Pergunta dos sócios: o sistema precisa de mais alguma coisa para as primeiras 10 a 50 academias, com a infraestrutura paga? A conferência no código achou quatro pontos que só apareciam com volume, e os sócios aprovaram mais três ajustes. Plano, decisões e respostas no documento *ARKE — Plano da rodada de lançamento*.

**Conferência diária com o Asaas, em lote.** Ela perguntava ao Asaas, uma de cada vez, pelas cobranças de cada assinatura ativa, dentro de uma única execução; e a leitura do banco parava em mil linhas. Por volta de mil assinaturas somando todas as academias, deixava de conferir parte da base sem avisar — e é ela que impede bloquear quem pagou. Hoje (`asaas-reconciliar/fluxo.ts`) o Asaas lista, de 100 em 100, as vencidas, as criadas e as recebidas nos últimos dias e as confirmadas no cartão; o banco é lido em páginas; só a cobrança vencida que nenhuma lista trouxe é consultada uma a uma, dentro de um orçamento de tempo, e o que sobrar vira aviso ("varredura incompleta"), nunca "nada a corrigir". A origem de cada cobrança sai da referência (`metodo:`, `plano:`, `b2b:`, `avulsa:`), que o sandbox confirmou ser herdada pelas cobranças de assinatura (`npm run sandbox:reconciliacao`).

**Mil linhas e ids demais no endereço.** Nenhuma lista do sistema paginava, e a API do banco (`max_rows = 1000`) corta sem avisar. Pior, medido na API do projeto: `.in()` com 800 ids volta **400** (a partir de 2.000, 414) — numa academia com uns 700 alunos a busca dos nomes falhava e a lista mostrava "—" em todos. `src/lib/paginar.ts` (`todasAsLinhas`, de mil em mil; `porLotes`, ids em lotes de 200) e o espelho `_shared/paginar.ts` passaram pela lista de alunos, exportação do contador, retenção (cinco dias de treino de uma academia de 500 alunos já passam de mil registros, e quem treinou aparecia "em risco"), Gestão 360, agenda, dietas, treinos, desafios, competições, acervo, feed e a lista offline da catraca (sem isso, o hash nunca bateria e o Gateway pediria a lista inteira a cada rodada, para sempre). `paginar.guarda.test.ts` falha em leitura da academia inteira sem página e em lista de ids fora de lote, salvo as curtas por natureza, listadas com o porquê.

**Encerramento de academia.** "Excluir organização" era um DELETE: não cancelava a mensalidade B2B (a ex-cliente seguiria cobrada), era barrado por aluno com assinatura viva, deixava atestados, vídeos e termos no storage e a chave no cofre, não mandava apagar as digitais das catracas, não entregava a exportação que o contrato promete e apagava junto o registro de receita da ArkeFit. O ciclo segue o contrato (cláusulas 7 e 6.7):
- **aviso** — a academia pelo painel (Organização → Dados e encerramento) ou a ArkeFit pela ficha da organização; 30 dias, ou imediato só pela ArkeFit (violação grave); e-mail à gestão e à ArkeFit; retirável antes do término;
- **término** — cobranças dos alunos canceladas no Asaas, mensalidade B2B **pausada** (a vencida fica: é dívida, não cobrança futura), organização `cancelado`, nota automática desligada, digitais agendadas para sair das catracas; o painel fica só com a exportação (a gestão) e o app avisa o aluno;
- **eliminação**, 30 dias depois — o que é da ArkeFit por obrigação fiscal vai para `arquivo_fiscal_arkefit` (sem dado de aluno), e saem arquivos, segredos, as contas que só existiam ali e a organização. O registro do encerramento sobrevive, sem a organização.
A rotina `arke-encerramentos` roda de hora em hora e retoma de onde parou (mil assinaturas não cabem numa rodada). A exclusão direta ficou só para homologação (trial). **Exportar todos os dados** (alunos com e-mail, contato e endereço, matrículas, mensalidades, avulsas, presenças, avaliações) está sempre disponível para a gestão, não só no encerramento.

**Verificação em duas etapas nas contas da ArkeFit.** Super Admin e Admin ARKE alcançam todas as academias e podem entrar como qualquer perfil; uma senha vazada abria tudo. Agora o papel da ArkeFit só vale numa sessão verificada com o código do aplicativo autenticador (`aal2`): no banco, em `has_role` — por onde passam todas as regras (conferido: nenhuma política lê `user_roles` direto) —, só quando a própria conta usa o papel; nas 15 edge functions que decidem pelo papel, por `_shared/verificacao.ts`, travado por `verificacao.guarda.test.ts`; e na tela, que pede o cadastro do código (QR code) na primeira entrada e o código de 6 dígitos nas seguintes. Consultar o papel de outra pessoa e as rotinas sem sessão não mudam. **Perdeu o celular:** o fator sai de `auth.mfa_factors` da conta pelo banco e a tela pede o cadastro de novo.

**Cartão automático também na mensalidade da academia** (decisão 1). O interruptor do Método foi ligado, e `asaas-cartao-assinatura` aceita `tipo: "plano"`: o cartão vai na assinatura do plano próprio, com as mesmas regras (só final e bandeira no banco; recusa marca a matrícula e abre tarefa **da academia**, porque a mensalidade é relação dela). Aparece no Perfil do aluno (Pagamentos da academia) e na ficha, para gestão e recepção.

**Taxa de implantação** (decisão 5): valor e parcelamento de cada contrato, R$ 1.490 de referência (Visão Master → Configurações), emitida na ficha da organização por `asaas-taxa-implantacao`. O sandbox decidiu (`npm run sandbox:implantacao`): parcelamento aceita a forma escolhida pela academia em cada parcela, cada parcela herda `b2b:<organização>`, e a última absorve o arredondamento. Cada parcela vira linha de `cobrancas_b2b` na emissão, então entra no webhook, na conferência diária e na inadimplência B2B sem caminho novo. Emitir de novo adota a mesma cobrança; uma taxa emitida por academia.

**Backup:** fica o diário do Pro (decisão 2). O ensaio de restauração, que nunca foi feito, tem roteiro em `docs/RESTAURACAO_BACKUP.md` e roda logo depois do upgrade — no gratuito não há backup para restaurar.

**Conferido:** conferência diária em produção (0,9 s, sem erro) e 12 testes do fluxo; 10 no sandbox da conferência e 10 da taxa; paginação com trava e 6 testes; encerramento em 27 casos no banco (transação desfeita) e 17 na corrente real, pela função publicada, com academia temporária, conta que só existia nela, catraca e atestado no storage; verificação em duas etapas em 9 casos no banco e 3 da tela; cartão no plano em 8 verificações pela função publicada no sandbox; taxa em 9, com Super Admin verificado de verdade e a parcela paga voltando pelo webhook.

**Visão Master com conta só de Super Admin.** Conferindo a Fase 0 pela tela, a ficha da organização ficava em "Carregando…" e o quadro de atividade dava erro para as duas contas da ArkeFit que têm só o papel `superadmin`: `organizations`, `organization_planos_precificacao` e `plataforma_config` davam leitura só a `admin_arke`, papel de antes do Super Admin, e `get_superadmin_organizacao_atividade` respondia 0A000 desde que nasceu (`order by` pelo nome da coluna de saída num `union`). Corrigido em `20261286010000`; tabelas com dado de aluno ficaram como estão, porque ali o Super Admin chega pelas funções `get_superadmin_*`.

## Rodada de lançamento — Fase 1: Central de Ajuda (24–25/09/2026)

Os manuais viraram parte do produto: **Ajuda** no menu do painel, do app e da Visão Master, e um **?** no alto de cada tela que abre o artigo daquela tela. São 54 artigos, escritos para quem usa (gestor e recepção, professor e nutricionista, aluno, ArkeFit), a partir do código e não dos manuais antigos de `docs/`, que estavam desatualizados.

- **O texto mora no repositório** (`src/content/ajuda/<artigo>.md`) e o catálogo em `src/lib/ajuda/catalogo.ts`: título, resumo, seção, **quem vê** e as telas que o artigo explica. Quando a tela muda, o artigo muda no mesmo PR. O texto só é baixado quando alguém abre a Central.
- `catalogo.test.ts` trava o que costuma apodrecer: artigo sem texto ou texto sem artigo, tela do **?** que não existe, imagem que não está em `public/ajuda/`, link para tela ou artigo inexistente, artigo que leva a quem lê a um artigo que ele não pode abrir, e artigo do aluno apontando para o painel. Link entre artigos é `ajuda:<artigo>`, resolvido na área de quem lê.
- `markdownSimples` ganhou imagens (só de `/ajuda/`), links (só rota do app ou https), dicas e blocos de código; os documentos legais renderizam como antes.
- **Imprimir ou salvar em PDF** em todo artigo; o manual técnico do Gateway é pensado para isso. A impressão térmica (80 mm) passou a ser uma página nomeada: antes o `@page` valia para toda impressão.
- **Guia do aluno** no cartão do convite de primeiro acesso: folha A4 com o QR Code e o passo a passo, em PNG ou para imprimir, gerada no navegador (`src/lib/guiaAluno.ts`).
- **Imagens das telas** tiradas do app publicado com uma academia fictícia (`scripts/ajuda/demonstracao.mjs semear|limpar` e `capturar-telas.mjs`): trial, contas em `demo.arkefit.com.br`, nenhum e-mail enviado, e a limpeza confere órfãos no fim.

**O que escrever os artigos encontrou**, porque descrever cada tela obriga a conferir o que ela faz:

1. **A mensalidade do plano da academia não tinha como parar.** Pausar, cancelar e mudar valor existiam só para o Método; a assinatura do plano mora na conta Asaas da ArkeFit, então a academia não alcançava nem pelo Asaas. Quem trancasse ou saísse do plano seguia cobrado até alguém excluir o aluno. `asaas-assinatura-ciclo` aceita `tipo: "plano"` (tabelas `aluno_matriculas_academia` e `mensalidades`, repasse só da taxa de processamento) e a ficha mostra os botões. O aluno **não** cancela o plano pelo app: é contrato com a academia. Pausar o aluno pergunta se pausa também a mensalidade do plano (há academia que cobra no trancamento), e voltar a em dia retoma. `20261287010000` guarda quem pausou e cancelou, e passa a ter **uma matrícula viva por aluno contando a pausada** — antes dava para matricular de novo quem estava pausado, com duas assinaturas. Conferido no sandbox, pela função publicada, em 21 verificações.
2. **A importação de dieta por PDF mandava o arquivo ao Google Gemini** (`parse-dieta-pdf`, com `GEMINI_API_KEY` configurada): fora do Brasil, sem consentimento e sem o Google na lista de suboperadores — o contrário do que a Política diz. Nenhuma dieta real tinha passado por ali (o banco não tinha dieta nenhuma). A função foi removida do repositório e do projeto publicado, a tela perdeu os botões, e `iaNoBrasil.guarda.test.ts` passou a barrar Google, Mistral, Cohere, Groq, DeepSeek e Hugging Face além de OpenAI, Azure e Anthropic. O secret `GEMINI_API_KEY` ficou, inerte, até ser apagado em 25/09/2026. **A importação voltou no mesmo dia, no Brasil** — ver *Importação de dieta por PDF, de volta e no Brasil*.
3. **Datas um dia antes em cerca de trinta telas.** `new Date("2026-07-01").toLocaleDateString("pt-BR")` lê a data como meia-noite UTC, que em Brasília é o dia anterior: treino "válido até" um dia antes, avaliação "registrada" na véspera, mensalidade de julho mostrada como de junho. `formatarDataBR()` em `src/lib/dataBrasilia.ts` lê data pura ao meio-dia de Brasília; as 37 chamadas passaram por ela, e `dataBrasilia.guarda.test.ts` barra a volta do padrão (salvo quem fixa `America/Sao_Paulo` nas opções).
4. **Os interruptores de IA apareciam para o aluno do Free**, a quem a Política diz que nada da IA se aplica. Agora só aparecem no Método, ou para quem ainda tem autorização não retirada — retirar tem de continuar possível.
5. **Recepção não cadastra aluno.** Cadastrar, importar e o convite de primeiro acesso são só do gestor (tela e `convidar-membro`). Os artigos descrevem isso; mudar é decisão (ver `docs/DECISOES_PENDENTES.md`). **Decidido em 25/09/2026: a recepção cadastra aluno**, gera o convite de primeiro acesso e o link de ativação individual; equipe, exportação e importação em massa seguem com o gestor. De passagem, `convidar-membro` passou a receber a unidade que a tela mostra e a conferir que quem chama é gestor ou recepção **daquela** unidade — antes escolhia pelo vínculo de gestor mais antigo, e quem tem duas unidades (o seletor da Rodada 6) cadastrava o aluno na errada. Sem a unidade, vale o vínculo mais antigo, para chamadas antigas. Conferido pelas funções publicadas: recepção cadastra na própria academia e é barrada na alheia, gera o link do aluno e não o do gestor, e o gestor segue cadastrando com e sem a unidade.

Depois do deploy, as imagens das telas foram tiradas com a academia de demonstração e entraram em 27 artigos; ao tirá-las apareceram mais três coisas, corrigidas: o cartão **Privacidade** do aluno do Free ficava vazio (ganhou os links da política e do resumo), o Gestão 360 mostrava a frequência com ponto decimal, e a academia de demonstração nascia com a configuração "concluída" e etapas pendentes ao mesmo tempo.

## Rodada de lançamento — Fase 2: página de vendas (25/09/2026)

A página de vendas (`src/pages/public/Landing.tsx`) mora na **raiz de arkefit.com.br**, no mesmo build do app. Mensagem principal: retenção e inadimplência, com a catraca como apoio (decisão 9). Números de mercado só com fonte citada e link (item 11, `FONTES` em `src/lib/landing.ts`): 63% dos novos alunos saem antes do 3º mês (Sperandei, Vieira e Reis, 2016); 9,68% contra 12,72% de evasão e 10,36 contra 7,93 meses de permanência, com mais e com menos cobrança automática (Panorama Setorial Fitness Brasil, 5ª edição, 2026). Inadimplência não tem número: não há fonte com metodologia. Sem depoimentos. A fila "ao vivo" do topo diz que é exemplo ilustrativo.

**Cores do sistema (25/09/2026).** A página vive sob o tema escuro do app (classe `dark` na raiz) e usa só os tokens dele: `primary` (o dourado), `background`, `card`, `foreground`, `muted-foreground`, e `success`/`warning` na fila de exemplo. Cor nova na página entra como token, nunca como hexadecimal, senão ela volta a se afastar do produto. Os cards de números abrem pela conclusão (**63 de cada 100**, **24% menor**, **+2,4 meses**) e mostram a comparação em barras rotuladas; os derivados são calculados no código a partir dos números da fonte (`PANORAMA`), e a evasão segue sem período porque o Panorama não informa.

**Quem vê a página:** só o visitante que chega de fora na raiz do endereço de vendas (`mostrarPaginaDeVendas`). Quem tem sessão guardada ou abre o app instalado na tela de início — que começa em "/" — segue para o app como antes; `?vendas` força a página em qualquer endereço, para conferir. Os links internos da página rolam em código, porque o app usa HashRouter e um `href="#contato"` viraria a rota `/contato`.

**Contatos (decisão 10: os dois).** O formulário grava em `leads_site` pela edge function `lead-site` (pública, com Turnstile, limite por IP e campo-isca) e avisa o e-mail de `plataforma_textos.comercial_email` (começa em comercial@metodosarke.com.br, o endereço da conta da Vercel; sem valor, vai aos Super Admins). A ArkeFit trabalha os contatos em **Visão Master → Contatos do site**, com situação e anotações. `leads_site` não tem regra de inclusão: só a função grava; leitura e alteração só da ArkeFit (duas etapas).

**App em app.arkefit.com.br (decisão 8) — no ar desde 25/09/2026.** O DNS de arkefit.com.br está no Registro.br: o responsável criou o CNAME `app` → `bdcd07e5eb5d98ec.vercel-dns-017.com` (o mesmo destino do `www`), a Vercel emitiu o certificado (Let's Encrypt, renovação automática), e a troca seguiu a ordem planejada: `VITE_APP_HOST=app.arkefit.com.br` na Vercel (só produção) com nova publicação; secret `SITE_URL` e `site_url` do Auth em `https://app.arkefit.com.br`, com www e a raiz mantidos na lista de redirecionamento do Auth, para os links antigos continuarem aceitos. Uma rota do app aberta em arkefit.com.br — QR Code impresso, e-mail de convite — vai para o endereço do app com o caminho e os tokens inteiros (`destinoNoApp`, em `main.tsx`, antes de montar o React); a raiz e os documentos legais ficam no endereço de vendas. **Desfazer:** apagar `VITE_APP_HOST` na Vercel e publicar de novo; o app volta a responder nos dois endereços.

**O que a troca revelou: o token do convite se perdia no caminho.** O script inline do `index.html` que arruma os links do Supabase para o HashRouter (tira os tokens do segundo `#` e os põe depois do `?` da rota) roda a cada carga da página. Com o app em outro endereço, um link de convite ou de senha que abre no www carrega **duas vezes**: o www arruma e redireciona, e o app recebia o link já arrumado, não o reconhecia e o reprocessava pelo caminho de reserva, que guardava só `type=invite` e descartava o `access_token`. Quem clicasse num convite enviado antes da troca cairia em "definir senha" sem sessão. O script agora reconhece o link já arrumado e o deixa como está; `linkAuthIndexHtml.test.ts` executa o próprio script do arquivo nos três casos (link cru, link arrumado, e as duas cargas em sequência), e falha sem a correção. Os links gerados depois da troca já saem com o endereço do app e não passam pelo www.

**Conferido em produção:** visitante na raiz do www vê a página de vendas, e o "Entrar" leva ao app; `#/auth/login` aberto em www e em arkefit.com.br, e o convite de primeiro acesso aberto no www, chegam ao app com o caminho; a Política fica no www; a raiz do app leva o visitante ao login e quem tem sessão ao painel; o captcha carrega no subdomínio igual ao do www; o link de recuperação gerado pelo Auth volta para o app; e no celular não há rolagem lateral.

**O captcha dos formulários públicos nunca esteve valendo no projeto Brasil (achado em 25/09/2026).** Testando o formulário novo, um token inventado passou. Eram dois defeitos juntos: (1) o `TURNSTILE_SECRET_KEY` gravado no Supabase é a **site key** (pública), e não a secret key — o hash do secret bate com a site key —, e o Cloudflare responde `invalid-input-secret`; (2) o código tratava qualquer resposta sem HTTP 200 como "Cloudflare indisponível" e liberava, e o siteverify responde **400** também para token inválido. Com (2) sozinho, qualquer token inventado passaria mesmo com a chave certa. Corrigido o código: a verificação mora em `_shared/captcha.ts`, igual para matrícula pública, primeiro acesso e contato do site, e quem decide é o corpo da resposta — token recusado é recusado com qualquer status; só erro de rede, 5xx, `internal-error` ou chave nossa inválida contam como indisponível (e liberam, pela regra de não travar cadastro por falha de terceiro). `captcha.test.ts` trava as duas coisas: a interpretação e que nenhuma função chama o siteverify por conta própria. **Chave certa gravada em 25/09/2026.** Conferido: a Cloudflare aceita a secret (recusa só o token), e os três formulários — contato, primeiro acesso e matrícula — recusam token inventado e envio sem token, sem gravar contato nem conta. Um envio de verdade passar só dá para conferir pela mão de uma pessoa, porque o captcha existe para barrar navegador automatizado. No `chaves.txt`, as duas chaves estão com o nome certo: `TURNSTILE_SITE_KEY` (pública, a da Vercel) e `TURNSTILE_SECRET_KEY` (a do Supabase).

## Importação de dieta por PDF, de volta e no Brasil (25/09/2026)

Decisão do responsável: **a importação tem de existir, porque a maioria das nutricionistas monta a dieta em PDF**. Ela tinha saído na Fase 1 por mandar o arquivo ao Google Gemini, fora do Brasil e da Política. Voltou pela mesma porta do Sentinela, o Amazon Bedrock em São Paulo (`_shared/ia.ts`), com a tela antiga restaurada em `AdminDietas` (modelo na biblioteca, ou publicação direto no aluno).

- **O arquivo não sai do aparelho.** `src/lib/textoDoPdf.ts` extrai o texto com o pdf.js (build "legacy", carregado só nessa hora) e só o texto vai para `importar-dieta-pdf`. A função tira as linhas de identificação que reconhece (`Paciente:`, `Nome:`, CPF, e-mail, telefone), chama o modelo com temperatura zero e não grava nada: quem salva é a tela, depois da revisão.
- **O modelo inventa, então tudo volta conferido.** Testado antes de construir: com um PDF escaneado, sem texto, o Claude 3 Haiku devolveu uma dieta inteira que não existia no documento. Por isso `fluxo.ts` recusa texto insuficiente antes de chamar o modelo, e `conferirNoOriginal` exige que cada alimento, cada número de quantidade e cada substituição apareçam no texto original. O item que não bate chega marcado "confira"; se passar de 30% dos itens, a leitura inteira é descartada. Na publicação direto no aluno, que vira versão travada, o botão só libera com a confirmação de que os itens marcados foram conferidos. `importarDietaPdf.test.ts` usa a dieta inventada de verdade como caso de recusa.
- **PDF escaneado não é lido**, e a tela diz o porquê e o que fazer (exportar o PDF do programa de dietas, ou digitar). Ler imagem exigiria mandar a página como foto ao modelo e perderia a conferência contra o texto.
- **Conferido pela função publicada:** aluno com 403 e sem sessão com 401; o PDF comum virou 5 refeições e 14 itens, sem nada para conferir; um PDF de 2 páginas em tabela, no formato dos programas de nutrição, virou 6 refeições e 17 itens com substituições, horários e orientações; o escaneado e um documento que não é dieta foram recusados.
- **A Política acompanhou (versão 2026-09-25):** a leitura é transcrição e não análise sobre o aluno, sai sem as linhas de identificação, é processada no Brasil, o conteúdo não fica registrado na conta do provedor, e a base legal é a do acompanhamento (consentimento para dados de saúde). Na mesma versão entrou o contato pelo site, com guarda de 12 meses sem andamento, cumprida pela rotina `arke-retencao-contatos-site` (`limpar_leads_site_antigos()`, que mantém o contato fechado), criada antes da Política para a promessa já nascer verdadeira. A versão vai como minuta até o responsável aprovar o texto.

## Marca do sistema: ArkeFit, o Arco e o amarelo (25/09/2026)

O sistema tem marca própria, separada da do Método ARKE (o "A" dourado metálico, que continua em `public/logo.png` e segue sendo a marca do Método). Escolha do responsável entre três propostas: o **Arco** — o arco do nome, com o aluno (o ponto) entrando por ele — e o nome **ArkeFit**, com "Arke" em branco e negrito e "Fit" no amarelo, em peso médio, em Plus Jakarta Sans.

- **Um desenho só, em traços.** `src/components/marca/MarcaArkeFit.tsx` (`MarcaArkeFit`, `SimboloArkeFit`) traz o nome já convertido em caminhos, para sair igual em qualquer tela sem depender de fonte carregada. `scripts/marca/` refaz o desenho e todos os arquivos a partir das fontes: favicon, ícones do app instalado (o 512 também como `maskable`, para o Android não pôr moldura branca), `logo-email.jpg`, `og-arkefit.png` e `public/marca/*.svg`.
- **Amarelo elétrico no tema escuro.** O primário do `.dark` passou a `#FFC700` (hsl 46,8 100% 50% — com 47 o navegador arredonda para `#FFC800`), com brilho de 20 px nos botões da página de vendas e na marca. O âmbar `#F59E0B`, a outra opção considerada, ficou de fora porque **é** a cor de alerta do sistema (`--warning`): botão e aviso de vencimento ficariam iguais. **O tema claro continua no dourado mais fechado** (`43 74% 49%`): amarelo sobre branco não se lê.
- **O fundo continua o preto neutro do app** (`#0F0F0F`), e não o preto-azulado `#0B0F17` sugerido junto: a página de vendas e o app usam o mesmo preto, e trocar só um deles desfaria o alinhamento.
- **O logo dos e-mails saía achatado:** era a imagem 600×400 do "ARKE" exibida num quadrado de 56×56. Agora é o ícone quadrado, no mesmo endereço, então os e-mails mudam sem republicar a função.
- **O que ainda diz "ARKE":** a Central de Ajuda chama o sistema assim 63 vezes (fora "Método ARKE"). Trocar é revisão de texto caso a caso, e ficou para uma passada própria.

## Importação: as planilhas dos concorrentes, de verdade (25/09/2026)

O responsável mandou três planilhas de exemplo, montadas a partir do formato oficial de exportação do EVO, do Next Fit e da Tecnofit, e a importação foi rodada contra elas. A do Next Fit passava. **A do EVO não importava ninguém:** `NOME_COMPLETO`, `CPF_ALUNO` e `STATUS_CONTRATO` caíam em "ignorar", porque as regras procuram palavra inteira (`\bnome\b`) e o sublinhado conta como letra. Toda linha falhava por falta de CPF, e sem nome o gestor nem avançava do mapeamento. A da Tecnofit trazia CPF com **10 dígitos**: guardado como número no sistema de origem, perde o zero à esquerda, e o ARKE recusava por "CPF deve ter 11 dígitos".

O que mudou (`src/lib/mapaColunas.ts`):

- **O cabeçalho é lido com sublinhado e ponto como espaço.** Palavras coladas (`DataNascimento`) só são separadas quando o cabeçalho como veio não casa com nada, porque separar sempre transformaria `WhatsApp` em "whats app".
- **`normalizarRegistro()` conserta o que as exportações estragam:** CPF com 9 ou 10 dígitos volta a ter 11 com zeros à esquerda (o dígito verificador continua decidindo se é válido); o 55 do Brasil sai do celular, para o número ficar gravado como o resto da base, com DDD e sem código do país; o nome todo em maiúsculas vira nome próprio com as partículas (da, de, do, dos, das, e) em minúsculas, e o nome já em caixa mista fica como a academia digitou; e o e-mail vai em minúsculas.
- **O CSV é lido como texto** (`raw: true` em `lerPlanilha.ts`). Sem isso a biblioteca interpretava a planilha: `1990-05-14` virava `5/13/90`, e um CPF só com dígitos podia virar número e perder o zero antes de a normalização o ver.

Plano, datas do contrato e código de cartão ou catraca continuam fora da importação, de propósito: o plano é criado no ARKE e o cartão é cadastrado na ficha. Os CPFs das planilhas de exemplo são fictícios e falham no dígito verificador, então as linhas aparecem com erro. É o comportamento certo, porque base de verdade traz CPF válido.

## Visão Master com menu lateral (25/09/2026)

Pedido do responsável: os itens da Visão Master saíram da faixa de abas no alto e foram para um menu lateral, igual ao do painel da academia. Com onze itens, a faixa rolava para o lado no celular e escondia metade deles. `SuperAdminSidebar.tsx` segue o desenho de `AdminSidebar.tsx`: três grupos (Operação, Monitoramento, Configurações), recolhível no desktop, gaveta no celular, e Ajuda e Sair no rodapé. O estado de recolhido reaproveita `AdminSidebarContext`. O cabeçalho mostra o nome da tela aberta, tirado da mesma lista `SECOES_SUPERADMIN`, e **não** é `h1`: a página já tem o dela, e o `h1` do app usa a fonte serifada dos títulos. A faixa vermelha das rotinas ficou logo abaixo do cabeçalho.

Conferido no navegador com um Super Admin temporário, verificado em duas etapas e apagado no fim. No desktop, os dez itens aparecem, a navegação funciona e o item ativo fica marcado, o menu recolhe para 64 px com o nome em cada ícone, e a Ajuda abre a Central da Visão Master. No celular, a gaveta traz os mesmos itens e fecha ao escolher, e a página não rola para o lado.

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

**Método ARKE — breve lançamento.** *(Superado em 23/09/2026: o Método está à venda desde o primeiro dia; ver* Decisões do responsável sobre a 1.0*.)* O Método é upgrade pós-lançamento, então o app anuncia em vez de vender: cartão na home do aluno Free, no chat com a nutricionista e na matrícula pública (`MetodoArkeEmBreve`). No painel, a adesão pela academia (e o "Tentar cobrar") fica atrás de `VITE_METODO_ARKE_VENDA`, desligada; o Super Admin segue atribuindo o Método em trial para homologar. Ligar a venda é pôr `VITE_METODO_ARKE_VENDA=true` na Vercel e fazer um deploy.

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
- **Fora do escopo por decisão:** WhatsApp (módulo futuro); NFS-e (emitida no painel do Asaas ou no portal da prefeitura — *superado em 24/09/2026: emitida automaticamente na conta da academia; ver* Nota fiscal automática da academia); preço do profissional autônomo (pós-lançamento); canal de suporte (preenchido pelo responsável em Visão Master → Configurações quando existir); vídeos e GIFs (material novo, subido depois); venda do Método (mantida desligada — *superado em 23/09/2026: à venda desde o primeiro dia*).

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

`get_superadmin_rotinas()` (restrita à ArkeFit) classifica cada uma em **ok**, **falhou**, **parou de rodar**, **nunca rodou** ou **desativada**. "Parou de rodar" é a traiçoeira: não gera erro, só silêncio. É detectada comparando a última execução com o intervalo que o próprio agendamento promete (`m * * * *` horária, `m h * * *` diária, `m h * * d` semanal) — acusa quando passou do dobro, com folga de 15 min. Agendamento fora desses formatos acusa falha, mas não atraso. Rotina que **falhou** ou **parou de rodar** vira **faixa vermelha no topo da Visão Master**, a tela que se abre todo dia; o detalhe (último erro, falhas na semana) fica em **Visão Master → Webhooks**. "Nunca rodou" ficou fora da faixa em 24/09/2026, pelo mesmo motivo que já ficava fora do e-mail: é o estado de toda rotina nova até a primeira janela, e uma semanal criada na quarta acusava alarme até segunda. Só a execução **terminada** conta — ver *Rodada 360° de 24/09/2026*.

**E também por e-mail (desde 21/09/2026).** A faixa vermelha só avisa quem abre a tela. A edge function `alertar-rotinas`, chamada de hora em hora (cron `arke-alerta-rotinas`, aos 50 min, autenticada por token no Vault como a reconciliação), manda e-mail aos Super Admins (`emails_superadmin()`) pelo Resend, de `alertas@arkefit.com.br`. Só quando algo muda, para não virar ruído: **novo** (entrou em problema ou trocou de problema), **lembrete** (continua em problema e o último aviso tem mais de 24 h) e **recuperou**. Problema é *falhou* ou *parou de rodar*; *nunca rodou* fica de fora porque é o estado de toda rotina recém-criada. O estado fica em `alertas_rotinas` e só é gravado **depois** do envio — se o Resend falha, o aviso sai de novo na hora seguinte. A classificação mora em `avaliar_rotinas()`, a mesma que a Visão Master usa. Testado em produção com um aviso falso (`teste-do-alerta`): e-mail enviado, registro limpo. ~~Limite conhecido: se a própria `alertar-rotinas` quebrar, nada avisa~~ — **fechado na versão 1.0**: as três funções chamadas por cron registram o próprio desfecho em `execucoes_agendadas`, e `avaliar_rotinas()` acusa a rotina cujo cron roda mas a função falhou ou não conclui (ver *Versão 1.0*).

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
