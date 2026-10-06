# Cobrança e Asaas

A integração com o Asaas, o ciclo de vida da cobrança, o repasse, o bloqueio por pagamento, a cobrança avulsa e a nota fiscal.

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

**A tabela de atacado de referência (02/10/2026).** `planos_atacado` continua guardando, por nível, um repasse (`custo_mensal`) e um preço sugerido ao aluno (`valor_sugerido_varejo`), mas desde a negociação por academia ela é **referência, não cobrança**. Até aqui não tinha tela, e a regra de gravação aceitava só o papel antigo `admin_arke`. Agora a ArkeFit a edita em **Visão Master → Configurações → Método ARKE — atacado de referência**, com a divisão ao lado de cada nível e a recusa de varejo sugerido que não cubra a referência mais a taxa (`conferirAtacado`, em `src/lib/repasse.ts`). Na ficha da organização, **Aplicar a tabela de referência** (`aplicar_repasse_referencia()`, só a ArkeFit, auditada) copia a tabela para a academia: o Integrado vira o padrão, e o nível com valor diferente ganha a exceção. Sobre um repasse já negociado, a tela pede um segundo clique. **A tabela nunca vale por omissão**: academia sem repasse negociado segue sem cobrar o Método, pelo mesmo motivo de sempre. O varejo sugerido continua preenchendo a precificação das academias novas (`seed_precificacao_sugerida`). Migration `20261307010000_atacado_referencia.sql`.

De passagem, a tela de precificação da academia tinha dois defeitos. O primeiro: mostrava "custo atacado R$ 45.00", que é a referência e não o que a academia negociou (com ponto decimal, ainda por cima). O segundo era mais sério: **a divisão e a conferência do preço usavam o repasse padrão mesmo quando o Elite tinha exceção própria**. Um Elite a R$ 90 aparecia com a divisão do padrão de R$ 45, e um varejo que não cobria a exceção passava pela tela e só seria recusado na cobrança. Hoje cada nível usa `resolverRepasse(padrão, excecaoDoNivel(linha))`. Conferido em 20 casos em transação desfeita (só a ArkeFit com as duas etapas altera e aplica; valor zero recusado; sem negociação a cobrança segue recusada; aplicar gera o padrão e a exceção certos e limpa a exceção quando os níveis se igualam; auditado; anon sem acesso) e em testes de `repasse.test.ts`.

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

## Cobrança: o aviso velho não volta atrás (04/10/2026)

Uma conferência do webhook do Asaas em 04/10/2026 achou cinco defeitos. Todos vinham da mesma premissa: o aviso que chega descreve o estado de agora. Não descreve. O Asaas não garante a ordem de entrega, e a conferência diária e o Vigia reenviam avisos guardados. Nenhum dinheiro real foi afetado: até hoje só a homologação recebeu cobrança. Migration `20261324010000_transicoes_cobranca.sql`.

1. **Aviso velho rebaixava cobrança paga.** O `soEmissao` protegia só a emissão. Um `PAYMENT_OVERDUE` que chegasse depois da confirmação voltava a cobrança a "atrasado", bloqueava quem pagou e abria tarefa de cobrar. Agora o gatilho `trg_transicao_cobranca`, em `pagamentos`, `mensalidades`, `cobrancas_avulsas` e `cobrancas_b2b`, segura isso venha o UPDATE de onde vier. O que foi pago, estornado ou cancelado não volta a pendente nem a atrasado, e o que foi pago não vira cancelado, porque estorno é outro status. A transição recusada mantém o status anterior sem erro, e o aviso fica no log com o que trouxe. As duas funções de tarefa atrasada passaram a exigir a cobrança de fato atrasada. Desfazer um recebimento em dinheiro (`PAYMENT_RECEIVED_IN_CASH_UNDONE`) continua sem efeito, como já era; se um dia tiver efeito, precisa de um caminho explícito por essa trava.
2. **Pagar uma cobrança antiga reativava a assinatura pausada ou cancelada.** O webhook gravava "ativa" em toda confirmação. Agora as quatro mudanças de status de `aluno_assinaturas` só valem a partir de ativa ou atrasada. Além disso, a assinatura acompanha só o status que o pagamento de fato gravou: o aviso velho barrado pelo gatilho não marca a assinatura como atrasada.
3. **A data do pagamento era a do relógio.** No cartão, o Asaas manda o `PAYMENT_CONFIRMED` e, uns 30 dias depois, o `PAYMENT_RECEIVED`. Um aviso reenviado também chega em outro dia. Nos dois casos o pagamento mudava de mês, e é pelo mês que a receita vai ao contador. Agora a data é a do Asaas: `clientPaymentDate`, depois `confirmedDate`, depois `paymentDate`, e só sem nenhuma delas a data de hoje. O gatilho também não deixa regravar a data de uma cobrança já confirmada.
4. **Gravação que falhava marcava o aviso como processado.** O supabase-js não lança erro, ele devolve o erro. O webhook não o conferia, então uma gravação recusada pelo banco virava "processado" e nada acusava. Agora toda leitura e gravação do processamento passa por `exigir()`, que lança. O aviso fica sem processar e com o erro, e é isso que a regra do Vigia de aviso não processado vê.
5. **A cobrança B2B não aceitava `cancelado`.** O webhook grava esse status quando o Asaas apaga a cobrança (`PAYMENT_DELETED`, por exemplo na pausa da mensalidade do encerramento), e a gravação falhava em silêncio. Era o defeito 4 em ação. A inadimplência B2B conta só pendente e atrasado, então `cancelado` não vira dívida.

`webhookAsaas.guarda.test.ts` trava três regras: nenhuma chamada ao banco sem `exigir`, nenhuma data de pagamento do relógio, e nenhuma mudança de status da assinatura sem a condição de partida.

**Conferido:** 14 casos da migration em transação desfeita. A **corrente real** teve 9 verificações pelo webhook publicado, com avisos simulados assinados com o token, numa academia temporária apagada no fim, sem nenhuma linha órfã. Os casos:
- a cobrança paga de uma assinatura pausada ficou confirmada com a data do Asaas, e a assinatura seguiu pausada;
- o aviso velho de vencida não rebaixou a cobrança, nem a assinatura ativa, nem a mensalidade paga, e não abriu tarefa;
- o cartão recebido um mês depois manteve a data;
- a B2B apagada no Asaas gravou `cancelado`;
- uma gravação recusada pelo banco deixou o aviso sem processar, com o erro `23514`.

## Cobrança: prazo em toda chamada, e o valor conferido (05/10/2026)

Rodada B, a parte da cobrança. Nenhum dinheiro real foi afetado: até hoje só a homologação recebeu cobrança.

- **Toda chamada externa das funções tem prazo.** Eram 17 sem, em 15 funções: o Asaas, o Resend e o reenvio de aviso ao próprio `asaas-webhook`. Uma chamada que trava segura a função até a plataforma cortar, e a conferência diária com o Asaas tem um orçamento de tempo que só funciona se cada chamada voltar. Agora é `AbortSignal.timeout(20_000)` em cada uma. `prazoChamadas.guarda.test.ts` falha em `fetch(` sem `signal`.
- **A conferência diária compara o valor.** Antes ela olhava só o status. Agora, cobrança com valor diferente no Asaas e no banco vai para `detalhes.valores` (`valorDiverge`, em `asaas-reconciliar/fluxo.ts`; até um centavo é arredondamento). Ela **não se corrige sozinha**, porque não dá para saber qual lado está certo: o Vigia avisa uma pessoa (ver *Vigia: nível 3* em [agentes.md](agentes.md)).
- **A saída do aluno lia as cobranças sem conferir o erro.** Em `_shared/encerrarCobrancas.ts`, uma leitura que falhasse virava "nada a cancelar". Na exclusão, a trava do banco ainda segurava. **Na anonimização, que guarda o registro, o aluno seguiria cobrado.** E uma gravação que falhasse depois de cancelar no Asaas contava como cancelada. Hoje as duas param com a mensagem, e a próxima tentativa retoma.
- **O desfazer da criação de academia nunca rodou.** `criar-organizacao-superadmin` fazia `.delete().eq(...).catch(...)`. A consulta do PostgREST não tem `.catch`, então o desfazer quebrava antes de apagar, e uma criação que falhava no meio deixava a academia para trás. É o mesmo defeito do convite de profissional de 03/10, que ficou sem trava naquele dia. A trava agora é o `deno check` no CI (ver [operacao.md](operacao.md)).

**Conferido:** 836 testes do app, com os novos de `valorDiverge` e a trava dos prazos; as 52 funções no `deno check`; as 20 funções tocadas publicadas, todas respondendo 401 sem credencial (a função sobe); e a **conferência diária real**, pelo comando do cron: 2 cobranças conferidas, nenhum erro, e `valores` gravado como lista vazia.

## Dinheiro: os achados médios da auditoria de prontidão (06/10/2026)

Rodada 3 da auditoria de 05/10, a parte do dinheiro: cobrança, webhook, nota fiscal e conferência. Sete achados médios. Nenhum dinheiro real foi afetado: até hoje só a homologação recebeu cobrança. Migrations `20261365010000` a `20261368010000`.

1. **A cobrança que nascia paga ficava sem receita e sem nota.** Os gatilhos do lançamento de receita (mensalidade e cobrança avulsa) e da fila da nota fiscal eram só `after update`: olhavam a troca para `confirmado`. Quando o aviso de emissão se perde, a primeira notícia da cobrança é a confirmação, que a conferência diária reenvia, e o webhook cria a linha já paga. Ninguém faz `update`. Agora os três gatilhos são `after insert or update`, e as funções só leem o status anterior na alteração. No fluxo normal nada muda (a inclusão pendente não lança nada), e nada duplica: o lançamento é único por `origem_automatica` e a nota por `(origem, origem_id)`. O upsert do webhook dispara o gatilho de inclusão só quando a linha é nova. Trava: `cobrancaQueNascePaga.guarda.test.ts`.
2. **A trava do sandbox não valia para o aviso cuja organização não se resolvia**, e a consulta que falhava também a desligava. A organização agora sai de tudo o que o aviso alcança: a assinatura, a referência (inclusive `metodo:` e `plano:`, pelo aluno) e a cobrança que já existe no banco com aquele id de pagamento. O aviso do sandbox precisa achar organização, e todas as que ele alcança têm de estar em trial; o de produção não toca nenhuma em trial (`ambienteDoAviso`, no novo `asaas-webhook/fluxo.ts`). As consultas passam por `exigir()`: a que falha deixa o aviso sem processar, com o erro, em vez de liberar.
3. **A carteira de recebimento mudava sem duas etapas e sem rastro.** A carteira é para onde o split manda a parte da academia em toda cobrança futura. Agora a **troca** (não a primeira vinculação, do onboarding) pede as duas etapas; a carteira e a linha de auditoria (`organizacao.carteira_trocada`, com a de antes e a nova) gravam juntas em `definir_carteira_recebimento()`; e os Super Admins recebem o e-mail do remetente de alertas, com só o fim das carteiras. O e-mail que falha não desfaz a troca, que já está na auditoria. **O efeito na nota:** a chave guardada para a nota é da conta antiga, e o `nfse-emitir` não conferia isso, então a nota sairia no CNPJ de quem já não recebe o dinheiro. Agora a rodada confere a carteira da chave antes de emitir nota nova (`impedimentoDaCarteira`); a nota espera na fila com o motivo, e as que já saíram pela conta antiga continuam acompanhadas e canceladas com a chave dela.
4. **Salvar a configuração fiscal desligava a emissão em silêncio.** A função gravava `emissao_ativa: false` antes de conferir o cadastro no Asaas e só depois religava. Como a fila não retroage, o pagamento confirmado nesse intervalo, ou depois de uma conferência que falhasse, ficava sem nota. Agora o interruptor só muda depois da conferência (`decidirEmissao`, no novo `asaas-fiscal-academia/fluxo.ts`): continua ligado se o cadastro confere, desliga se não confere, e a tela diz "Emissão automática desligada" com o motivo. Se o Asaas não responde, nada muda.
5. **A conferência diária contava como corrigido o que o webhook ignorou.** Ela decidia pelo 200 da resposta, e o webhook responde 200 também ao aviso repetido, ao ignorado e ao que deu erro interno. Agora lê o desfecho que o webhook grava em `asaas_webhook_events` e o status da cobrança depois (`correcaoAplicada`): corrigiu só com o aviso processado, sem erro, com um desfecho que mexe na cobrança, e com o status do Asaas no banco. Cada divergência leva o `desfecho` no registro, e o webhook que não responde vira falha da conferência (aviso do Vigia), em vez de derrubar a varredura inteira.
6. **Taxa de implantação: a falha parcial não se corrigia, e duas chamadas ao mesmo tempo criavam dois parcelamentos.** A emissão agora começa por uma reserva no banco (`reservar_taxa_implantacao`, status `emitindo`, única por academia junto com a `emitida`), antes de qualquer chamada ao Asaas. A reserva vale por três minutos: a chamada que termina mal a encurta, e a que morre no meio a deixa vencer; a próxima tentativa a assume e procura a taxa pela referência antes de criar. As parcelas entram em `cobrancas_b2b` antes de a taxa passar a `emitida`, sem regravar as que já estão lá. Para a taxa que já constava como emitida com parcela faltando, a ficha da Visão Master oferece **Registrar as parcelas que faltam**, que só procura no Asaas e nunca emite outra.
7. **CPF gravado com máscara.** Três funções gravam o CPF como foi digitado; a catraca procura só os dígitos, e o índice único é sobre o texto. O banco agora guarda só os dígitos (`trg_cpf_sem_mascara`, em `profiles.cpf` e em `acessos_catraca_logs.cpf_consultado`), sem mexer nas funções. Trava: `cpfSemMascara.guarda.test.ts` falha em código novo que compara CPF (filtro do supabase-js, `===`, ou SQL de migration nova) sem tirar a máscara do outro lado.

**Defeitos que só apareceram fazendo.**

- **A ficha prometia um botão que não existia.** A mensagem da falha parcial da taxa dizia "emita de novo", mas com a taxa gravada como emitida o formulário nem aparecia. Por isso o botão **Registrar as parcelas que faltam**.
- **A tela fiscal também usava a chave da conta antiga.** Depois de uma troca de carteira, o cadastro fiscal enviado pela tela iria para a outra empresa, e a tela não oferecia trocar a chave, porque o passo 1 some depois de conectado. Agora `asaas-fiscal-academia` confere a carteira da chave em toda ação, e o passo 1 volta a aparecer, com o motivo.
- **"Atualizada" não quer dizer que mudou.** O gatilho de transição (`trg_transicao_cobranca`) recusa em silêncio o aviso que rebaixaria uma cobrança paga, e o webhook ainda grava `mensalidade_atualizada`. Contar só pelo desfecho repetiria o defeito 5 por outro caminho; daí a leitura do status depois.
- **Tirar tudo o que não é dígito deixaria lixo passar.** "abc" viraria CPF vazio, que a constraint aceita. Sai só a máscara (ponto, traço, barra e espaço); o resto fica como veio, para a validação recusar. Pela mesma razão, `cpf_consultado` mantém os marcadores `remoto` e `id:`.
- **`organizations.cnpj_cpf` ficou de fora de propósito.** É o documento da empresa, ninguém procura por ele, e o CNPJ alfanumérico da Receita tem letras.

**Conferido no repositório:** 1.041 testes do app, 53 deles novos (a trava do ambiente do webhook, o desfecho da conferência, a reserva da taxa, a troca da carteira, o interruptor da nota, as duas guardas novas e a ficha da taxa); seis estouraram o prazo de 5 s numa máquina carregada e passaram rodando sozinhos com prazo maior, e nenhum deles é de arquivo desta rodada. `npm run check` sem erro, com as 55 funções no `deno check`. As guardas novas trazem casos de código com o defeito, que elas acusam ("o detector detecta"). **Falta**, e fica com o responsável: as quatro migrations em transação desfeita no banco, `npm run sandbox:implantacao` e a corrente real pelas funções publicadas.

## O Asaas como prestador e o formato BaaS (06/10/2026)

O Asaas respondeu que o modelo da ArkeFit é BaaS: criamos cobranças pelas academias, guardamos a chave da conta delas e mandamos o dinheiro por split. Abrir a conta da academia pela conta da ArkeFit também é BaaS. Desde 28/11/2025 o BaaS segue a Resolução Conjunta BCB/CMN nº 16/2025 (adequação até 31/12/2026). Os pontos que pesam aqui:

- **Art. 14:** o prestador (o Asaas) aparece identificado, de forma visível, nas telas, nos contratos, nos documentos e nos instrumentos de pagamento. O white label acabou.
- **Art. 8:** pelas cláusulas obrigatórias, a tomadora (a ArkeFit) não cobra em nome próprio tarifa ou comissão pelos serviços do prestador, nem recebe em conta própria valores dos serviços prestados aos clientes. Ela também precisa de procedimento de atendimento e avisa o prestador antes de contratar terceiro que trate os dados.
- **Art. 16:** o prestador acompanha a qualidade do atendimento da tomadora.
- **Titularidade:** a conta é do cliente final, na instituição prestadora. KYC e prevenção à lavagem ficam com o Asaas.

**Decisão do responsável.** A ArkeFit vai passar pela homologação do BaaS, no modelo A ("Direto Tomador"). Até lá, a academia abre a própria conta no Asaas e a conecta pela carteira e pela chave, o caminho recomendado desde 05/10. O sistema fica pronto para o formato BaaS, de modo que ligar seja configuração, e não reescrita. Com tudo desligado, a produção se comporta como antes, com uma diferença: a identificação do Asaas, que é condição da homologação e já entra ligada. Migrations `20261390010000` a `20261392010000`.

### 1. O Asaas identificado em toda tela, recibo e e-mail de pagamento

O componente é `<PrestadorPagamentos />` (`src/components/pagamento/PrestadorPagamentos.tsx`), e as regras do Playbook do Asaas estão em `src/lib/prestadorPagamentos.ts`:

- O selo oficial, com o id individual da ArkeFit, vem direto do endereço do Asaas e nunca é copiado. Nada de `referrerPolicy`, porque o Asaas confere pelo `Referer` que o selo carregou. O tamanho de referência é 160 × 48, com link para asaas.com. No tema claro vai o positivo; no escuro, o negativo branco.
- Ao lado do selo vai o texto: "Pagamentos processados pelo Asaas (Asaas Gestão Financeira Instituição de Pagamento S.A., CNPJ 19.540.550/0001-21), instituição de pagamento autorizada pelo Banco Central." Se a imagem não carrega, ela sai da tela e o texto fica de pé sozinho.
- Junto vem o atendimento do Asaas ao cliente final (Playbook, p. 16): 0800 009 0037 (pessoa jurídica; também por mensagem) e contato@asaas.com.br.

**Onde o selo entrou:**

| Quem vê | Telas |
| --- | --- |
| Aluno | os pagamentos da academia (`PagamentosAcademia`); o cadastro do cartão (`CartaoAssinatura`, no diálogo); a tela de bloqueio com a fatura (`AlunoBillingGate`); o cartão do Método no Perfil (`AlunoPerfil`) |
| Gestão | o Financeiro inteiro, no topo, valendo para todas as abas, inclusive Notas fiscais e a conexão da chave Asaas; Organização → Pagamentos e → Assinaturas; o recibo impresso (`ReciboComprovanteDialog`); a matrícula no plano (diálogo da ficha); as cobranças avulsas; a adesão ao Método (`AdminAlunos`); a conta de recebimentos (`EtapaRecebimentos`, conectada, a conectar e a abertura BaaS); a tela de bloqueio B2B; a cobrança em aberto que o assistente da Central de Ajuda mostra |
| Visão Master | a conta das cobranças da academia, na ficha da organização |
| E-mails | os do Bruno sobre a conta de recebimentos (o passo Recebimentos, a conta aprovada e a conta recusada) e os do encerramento da academia, à gestão e aos alunos, que falam das cobranças |

As guardas: `prestadorPagamentos.guarda` falha se uma tela da lista perder o componente. Ela também falha se uma tela nova chamar uma função de cobrança (`asaas-*`, `academia-criar-matricula`) ou mostrar o link de uma fatura sem o selo. Fica de fora a tela que sempre aparece dentro de outra que já mostra o selo (`DENTRO_DE`, que a própria guarda confere). Ficam de fora também as telas internas da Visão Master (`INTERNAS`). A cobrança B2B está fora da detecção, porque nela a ArkeFit cobra a própria mensalidade, como cliente do Asaas; mesmo assim, a tela de bloqueio B2B mostra o selo. A guarda confere ainda o texto, o CNPJ, as URLs com o id, a ausência de `referrerPolicy`, a imagem fora do repositório e o bloco nos e-mails.

A página de vendas não mostra cobrança e por isso fica sem o selo. A pergunta "Como recebo as mensalidades?" passou a dizer que o Asaas é a instituição de pagamento que processa, e que o ArkeFit é a plataforma de tecnologia.

### 2. A subconta pela ArkeFit atrás do interruptor (BaaS)

- **O interruptor:** `asaas_subcontas_baas` em `plataforma_config`, com faixa de 0 a 1 e valor 0, editável em Visão Master → Configurações. A gestão pergunta por `asaas_subcontas_baas_ligadas()`, porque não lê `plataforma_config`.
- **Desligado:**
  - "Abrir pela ArkeFit" some da etapa Recebimentos, e `asaas-conta-academia` recusa `criar` e `documentos` com 409 e a mensagem da conta própria.
  - A exceção é a organização em `trial`, que fala com o sandbox: nela o caminho aparece, para tirar o print da tela de abertura, pedido no formulário de habilitação, sem ligar nada em produção.
  - O sandbox pode recusar a subconta. A recusa fica na tela, num bloco de erro com a mensagem do Asaas e o atalho para a conta própria, e não num aviso que some.
- **Ligado, antes de abrir:**
  - A tela diz que a conta de pagamento é aberta e mantida pelo Asaas, em nome da academia, e é dela.
  - Ela pede o aceite dos [Termos de Uso do Asaas](https://central.ajuda.asaas.com/hc/pt-br/articles/32096847160859-Termos-e-Condi%C3%A7%C3%B5es-de-Uso). É o endereço que o rodapé do site do Asaas liga, conferido em 06/10/2026. O item 5.1.3 dos Termos pede que a subconta esteja ciente deles e concorde.
  - Quem aceita é o titular: a função recusa quem não é da gestão (inclusive a ArkeFit) e o perfil simulado.
  - O aceite vai para `aceites_termos_asaas`, só com quem, quando e o endereço, antes da chamada ao Asaas.
- **Ligado, depois de abrir (o formato BaaS):**
  - A academia não vai ao painel do Asaas mandar documento. A tela lista os grupos que o Asaas pede (`GET /myAccount/documents`, com a chave da subconta), cada um com a situação e o botão "Enviar no Asaas", que abre o `onboardingUrl` em outra aba.
  - Só link `https` vira botão. Grupo sem link mostra "Fale com a ArkeFit"; é o envio pela API, que fica para quando aparecer o caso.
  - O Asaas pede 15 segundos depois da abertura antes de consultar, e a lista vazia diz isso.
- **A subconta que já existe** (uma, de 03/10) segue igual com o interruptor desligado: a situação, a nota fiscal, a saída do aluno e o e-mail do Asaas para os documentos.
- **Bruno e a Central de Ajuda:** o roteiro do Bruno já não oferecia a abertura pela ArkeFit. Os artigos da gestão deixaram de oferecê-la; os da Visão Master descrevem o interruptor.
- **A guarda:** `subcontaBaas.guarda` confere que a tela e a função decidem igual, para toda combinação de interruptor e status. Ela também falha:
  - se uma tela pedir `criar` sem `caminhosDaConta`;
  - se "Abrir pela ArkeFit" aparecer fora dela;
  - se a função abrir a conta antes de conferir o interruptor, o aceite, o perfil simulado e de gravar o aceite;
  - se o roteiro do Bruno ou um artigo da gestão oferecer o caminho;
  - se o interruptor nascer sem faixa ou ligado.

### 3. Cobrança na conta da academia, por academia, desligada

`organizations.cobranca_conta_academia`. Só a ArkeFit, com as duas etapas, liga e desliga, pela ficha da organização ("Conta das cobranças"), e a mudança fica na auditoria. Nem a ArkeFit muda a coluna direto pela API: `proteger_colunas_organizacao` recusa fora de `definir_cobranca_conta_academia()`.

- **Com o modo ligado:**
  - A mensalidade (`plano:`) e a avulsa (`avulsa:`) **novas** saem da conta da academia, com a chave do cofre (a da nota fiscal), conferida contra o ambiente e contra a carteira de hoje.
  - Não há split nem taxa de processamento: o Asaas cobra a tarifa direto da academia. Isso fica travado no banco: na conta da academia, `valor_repasse_arke = 0` e o líquido é o valor inteiro.
  - O Método (`metodo:`) continua na conta da ArkeFit, com split para a academia, porque é serviço da ArkeFit.
- **A conta mora na linha:** `conta_asaas` na matrícula e na avulsa. O modo vale para a cobrança nova. Cancelar, pausar, retomar, mudar o valor, ligar o cartão, reemitir, encerrar na saída do aluno e no encerramento da academia, e conferir: tudo vai à conta gravada. A coluna não muda depois de criada, e só a função (`service_role`) cria na conta da academia (`trg_conta_asaas_fixa`).
- **Clientes por conta:** o id do cliente na conta da academia mora em `asaas_clientes_academia`. A coluna `asaas_customer_id` da matrícula fica sendo só o da conta da ArkeFit.
- **O webhook da conta da academia:**
  - Ligar registra pela API, na conta da academia, o webhook para `asaas-webhook?org=<id>`, com um token sorteado dentro das regras do Asaas. O banco guarda só o SHA-256 (`asaas_webhook_academia`); o token em claro só vai ao Asaas.
  - Registrar de novo atualiza o mesmo webhook. Desligar deixa o webhook e o hash, porque o estorno de cobrança antiga ainda chega por ele.
  - Com `org`, o `asaas-webhook` aceita só o token daquela academia, e não o segredo da ArkeFit.
  - Ele só grava cobrança com referência `plano:`/`avulsa:` daquela academia e que mora na conta dela. O aviso que alcança o Método, o B2B, outra academia ou cobrança da conta da ArkeFit termina como `fora_da_conta_da_academia:*`, sem efeito.
  - A cobrança que a academia faz por fora do ARKE, na conta dela, nem é gravada.
- **Conciliação:** `asaas-reconciliar` confere também a conta de cada academia com webhook registrado em produção, com a chave do cofre: as listagens, a vencida uma a uma e as assinaturas órfãs de lá. Academia sem chave vira falha da conferência. O reenvio vai ao webhook com o segredo da ArkeFit, como sempre.
- **Ligar e desligar:**
  - Ligar é recusado enquanto houver assinatura `plano:` viva na conta da ArkeFit para aquela academia, e a ficha diz quantas. Não se migra assinatura.
  - Desligar é recusado com assinatura viva ou avulsa em aberto na conta da academia.
- **Nota fiscal:** a regra de hoje usa `valor_liquido_academia`, o líquido do split. No modo, esse valor é o valor inteiro, então a nota da mensalidade e da avulsa sai pelo que entrou na conta da academia. A tarifa do Asaas é despesa dela.
  - Com o modo ligado, o cliente da nota é o mesmo da fatura, e a nota não desliga mais os avisos dele.
- **Receita, lançamentos, bloqueio e inadimplência:** não mudam, porque vêm de `mensalidades` e `cobrancas_avulsas`.

### 4. A avaliação do atendimento

O formulário de habilitação pergunta se a empresa avalia a qualidade do atendimento de forma regular, e o art. 16 põe o Asaas para acompanhar. O ARKE não tinha nada disso.

- O atendimento com uma pessoa do outro lado é o chamado de suporte (`chamados_suporte`): a equipe da academia pergunta à Central de Ajuda, o assistente não resolve e a ArkeFit responde e encerra com o desfecho.
- Encerrado o chamado, quem o abriu vê "Como foi o atendimento?", de 1 a 5 estrelas, com um comentário opcional, uma vez.
- A gravação passa por `avaliar_atendimento()`. Ela recusa:
  - quem não abriu o chamado (para essa pessoa, o chamado "não existe");
  - o chamado aberto;
  - o encerrado sem uma pessoa;
  - a nota fora de 1 a 5;
  - a segunda avaliação;
  - o perfil simulado.
- A Visão Master → Suporte mostra a média, o volume dos últimos 30 dias, quantos chamados encerrados foram avaliados, as notas 1 e 2 e as dez mais recentes. Os números vêm de `get_superadmin_avaliacoes_atendimento()`, que só a ArkeFit lê.
- O aluno não abre chamado com a ArkeFit: o pedido de ajuda dele vai à academia, pela fila dela.

### 5. A nomenclatura (Playbook, p. 5)

**A varredura** passou pelo app, pela página de vendas (`src/pages/public`), pelos artigos e pelos e-mails, procurando "Pay", "Payments", "Bank", "Wallet", "Financeira" e "Instituição de Pagamento" referidos à ArkeFit, e textos que digam que a ArkeFit mexe no dinheiro.

**O que se achou:**

- Nenhum "Pay", "Payments", "Bank" ou "Financeira" que se refira à ArkeFit.
- "Wallet" aparece só como o nome do campo do Asaas ("Wallet ID") e como nome de ícone.
- "Instituição de pagamento" aparece só referida ao Asaas.

**O que foi corrigido:**

- **Organização → Pagamentos.** "Split de Pagamento (Asaas)" virou "Conta de recebimentos (Asaas)". Antes o texto dizia que o repasse à ARKE "é retido na origem"; agora diz que o Asaas divide cada cobrança. "Taxa de split aplicada por plano" virou "Divisão do Método por nível", e "ARKE retém" virou "parte da ArkeFit".
- **Adesão ao Método.** O aviso "Configure a wallet do Asaas" virou "Configure a conta de recebimentos". "Split automático" virou "divisão automática".
- **Cartão.** "nosso processador de pagamento" virou "que processa o pagamento".
- **Artigos.** "Todas as cobranças saem pelo ARKE" virou "criadas pelo ARKE e processadas pelo Asaas", com o bloco "Quem atende o quê". No app do aluno, o número do cartão "vai direto para o Asaas".
- **Página de vendas.** A pergunta "Como recebo as mensalidades?" agora nomeia o Asaas como instituição de pagamento e o ArkeFit como plataforma de tecnologia.

**O que ficou:**

- **Na Visão Master,** "Retida automaticamente via split" (Configurações → taxa de processamento). É tela interna, mas acompanha a proposta das taxas abaixo.
- **"Pendência financeira com a ArkeFit".** É o bloqueio B2B, a dívida da academia com a ArkeFit, e não apresenta a ArkeFit como instituição financeira.

### Defeitos que só apareceram fazendo

- **A nota fiscal calaria a fatura.** `garantirCliente` (`nfse-emitir`) cria e atualiza o aluno na conta da academia com `notificationDisabled: true`, porque até aqui a academia não cobrava nada ali. Com a cobrança na conta da academia, é o mesmo cliente que recebe a fatura: a primeira nota desligaria os avisos de cobrança do aluno. A nota agora deixa os avisos ligados quando a academia cobra na própria conta, e a cobrança reativa o cliente achado com os avisos desligados.
- **O aluno que volta seria cobrado como "Pessoa anonimizada".** Na conta da academia, a saída só anonimiza o cliente, e não o remove (as notas dela ficam ali). A matrícula seguinte acharia esse cliente pelo CPF e cobraria um cadastro sem nome e sem avisos. A reativação devolve o nome e o celular de hoje e liga os avisos. Ela não apaga nada da academia.
- **O token da academia alcançava o B2B e o Método.** A primeira versão do escopo conferia só a organização. Com o token da academia, bastaria um aviso forjado com o id da assinatura B2B dela, ou de uma assinatura do Método de um aluno dela, e uma referência `plano:` de um aluno dela, para marcar como paga a mensalidade dela com a ArkeFit ou liberar o Método. O escopo agora recusa o aviso que toca o Método, o B2B ou cobrança da conta da ArkeFit.
- **A matrícula não tinha `fluxo.ts`.** As chamadas ao Asaas moravam no `index.ts` e o sandbox não chegava nelas. Agora estão em `academia-criar-matricula/fluxo.ts`, e o cliente vem do mesmo `obterOuCriarCustomer` da avulsa.
- **Select montado em tempo de execução quebra o `deno check`.** O tipo do PostgREST lê a lista de colunas como texto literal. A conta da linha passou a ser lida numa consulta à parte.
- **Um módulo com `npm:` importado por um teste do app quebra o `tsc`.** A regra da conta ficou dividida: `contaCobranca.ts` com as funções puras, e `contaDaAcademia.ts` com o que lê o cofre e o Asaas.

### Proposta: os textos legais

A cláusula-modelo do Asaas (Playbook, p. 11), adaptada à ArkeFit, foi **aprovada** e entra nas versões novas dos Termos de Uso e do Contrato da Academia, no PR do responsável (migrations `20261386` e `20261387`). Esta frente não mexeu em `src/content/legal` nem em `documentosLegais.ts`.

O Playbook pede que a tomadora não altere nem crie documentos legais relacionados ao processamento financeiro de pagamentos. Na prática:

- os nossos textos não regulam o serviço de pagamento: liquidação, prazos de saque, estorno, chargeback e tarifas do Asaas;
- eles remetem aos Termos do Asaas;
- eles falam só do que é da ArkeFit: a tecnologia, o Método, a licença, os dados.

A cláusula de hoje que mais esbarra nisso é a da retenção ("Do valor de cada cobrança é retido... o repasse da ArkeFit").

**Continua como proposta (precisa da aprovação do responsável): o recebimento com a cobrança na conta da academia e com a subconta BaaS.** O texto substituiria, no Contrato da Academia, o item "A Academia recebe as mensalidades...":

> **Recebimentos.** Os serviços de pagamento usados pela Academia na plataforma, inclusive a conta de pagamento, o processamento das cobranças e as transferências, são prestados pelo Asaas Gestão Financeira Instituição de Pagamento S.A. (CNPJ 19.540.550/0001-21), na conta de pagamento da Academia, que é dela e é mantida pelo Asaas nos termos do contrato entre a Academia e o Asaas. A ArkeFit integra essa conta à plataforma e não recebe, em conta própria, valores dos serviços que a Academia presta aos seus alunos.
>
> (a) **Cobranças da Academia.** As mensalidades e as cobranças avulsas dos alunos são emitidas pela plataforma na conta Asaas da Academia, pelo valor integral. As tarifas do serviço de pagamento são cobradas pelo Asaas diretamente da Academia; a ArkeFit não cobra tarifa nem comissão sobre elas.
>
> (b) **Método ARKE.** O Método é serviço da ArkeFit ao aluno, cobrado pela ArkeFit na conta Asaas dela. No momento do pagamento, o Asaas transfere à Academia a parte indicada no painel, pela entrega presencial do Método.
>
> (c) **Remuneração da ArkeFit.** A ArkeFit é remunerada pela licença da plataforma (mensalidade e taxa de implantação) e pelo Método ARKE.
>
> (d) **Conta aberta pela plataforma.** Quando a Academia escolher abrir a conta de pagamento pela plataforma, a conta é aberta e mantida pelo Asaas em nome da Academia, que aceita os Termos de Uso do Asaas antes da abertura e envia os documentos ao Asaas pelo canal que ele indicar. A ArkeFit não guarda documento nem dado bancário da Academia.

A responsabilidade fiscal (item seguinte do contrato) pede um ajuste de uma palavra: "a ArkeFit, pelo que recebe" no lugar de "pelo repasse que retém".

**Enquanto o modo estiver desligado,** a mensalidade e a avulsa da academia passam pela conta da ArkeFit, com a taxa de processamento retida no split. É exatamente o que o art. 8 tira da tomadora. O caminho de adequação é ligar a cobrança na conta da academia, academia a academia, antes do fim da homologação. A outra saída depende do que o Asaas aceitar no fluxo de homologação, que avalia a remuneração da tecnologia: renomear a taxa como remuneração da plataforma.

**As taxas na tela, como pagamento por tecnologia e serviço (proposta).** O Asaas disse que a remuneração da tecnologia e eventual margem sobre o serviço financeiro se avaliam na homologação. O Playbook permite cobrar pelo produto, desde que fique claro que a operação financeira é do Asaas.

- **Na prévia da cobrança da academia (modo desligado), hoje:** "O aluno paga R$ 100,00 · a academia recebe R$ 96,52 (taxa de processamento de R$ 3,48)". A proposta:

  > "O aluno paga R$ 100,00 · a academia recebe R$ 96,52 · **uso da plataforma ArkeFit** (emissão, conferência, bloqueio automático e nota fiscal): R$ 3,48. O pagamento é processado pelo Asaas."

  Em Configurações, "Taxa de processamento" passaria a "Tarifa de uso da plataforma por cobrança", com o texto: "remuneração da ArkeFit pela tecnologia de cobrança; não é tarifa do serviço de pagamento, que é do Asaas".

- **No Método, hoje:** "Aluno paga R$ 119,00 · parte da ArkeFit R$ 49,05 (repasse R$ 45,00 + taxa R$ 4,05) · Academia recebe R$ 69,95". A proposta:

  > "Aluno paga R$ 119,00 pelo **Método ARKE, serviço da ArkeFit** · a academia recebe R$ 69,95 pela entrega presencial · a ArkeFit fica com R$ 49,05 pelo acompanhamento (mentor, nutricionista, jornada) e pela operação da cobrança."

  Assim o dinheiro aparece como preço do serviço e da tecnologia, e não como taxa sobre o serviço financeiro.

- **No modo ligado** não há o que propor: a prévia já diz "a cobrança sai da conta Asaas da academia, que recebe o valor inteiro. A tarifa do Asaas é cobrada pelo Asaas, direto da academia."

### Conferido

**Conferido no repositório:**

- 1.243 testes do app, em 167 arquivos, todos passando. Nove arquivos de teste são novos: as guardas `prestadorPagamentos` e `subcontaBaas`, os fluxos da conta da academia, o webhook da academia, os documentos BaaS, o selo, a etapa Recebimentos e a avaliação. A guarda do webhook ganhou dois casos.
- `npm run check` sem erro, com as 56 funções no `deno check`.
- As três migrations, aplicadas num Postgres local (PGlite) sobre um esqueleto das tabelas que elas tocam, e aplicadas de novo, para provar que são idempotentes: 53 verificações, cada caso em transação desfeita.
- Um defeito plantado por parte, 15 no total, e o teste certo falhou nos 15:
  - o selo tirado de uma tela;
  - o `referrerPolicy`;
  - o prestador nos e-mails;
  - o interruptor na função e o interruptor na tela;
  - o aceite;
  - a taxa e o split na conta da academia;
  - o Método fora da conta da ArkeFit;
  - o escopo do webhook;
  - o segredo da ArkeFit no webhook da academia;
  - a conta na conferência;
  - o link dos documentos;
  - as duas travas das migrations.

**No banco de produção, em transação desfeita** (06/10, as três migrations): 29 casos.
- **O interruptor:** fica em 0 e recusa 2 e 0,5 (23514).
- **Ligar o modo:** com uma assinatura viva na conta da ArkeFit, é recusado (P0001). Sem ela, liga, grava o webhook e a auditoria. Com hash fora do formato, é recusado (22023).
- **Desligar:** com avulsa em aberto na conta da academia, é recusado (P0001). Sem ela, desliga, e o webhook fica.
- **Nem a `service_role` burla:** repasse maior que zero na conta da academia dá 23514, e trocar a conta de uma matrícula dá 42501.
- **A gestora:** não liga o modo direto, não cria avulsa na conta da academia e não troca a conta das matrículas (42501). Lê a situação da própria academia; o gestor de outra academia, não (42501). Ninguém da gestão lê `asaas_webhook_academia`.
- **A avaliação:** só quem abriu o chamado avalia, uma vez (23505 na segunda), com o chamado encerrado (22023 se aberto), nota de 1 a 5 (22023 com 6). Outra pessoa não acha o chamado (P0002), e a gestão não lê os números da Visão Master (42501).
- **As funções reescritas:** `proteger_colunas_organizacao` e `faixa_plataforma_config`, comparadas com as de produção, só ganharam a trava do modo e a faixa do interruptor.

**No sandbox do Asaas** (06/10):
- `sandbox:conta-academia`: 29 de 29; `sandbox:nfse`: 14 de 14; `sandbox:anonimizar`: 14 de 14.
- Dois defeitos do próprio cenário apareceram e foram corrigidos:
  - **A varredura conferia depois da pausa.** Pausar apaga a cobrança pendente, então a conferência agora vem antes.
  - **O "erro desconhecido".** O sandbox às vezes responde "Ocorreu um erro desconhecido. Por favor, tente novamente." à mudança de valor e ao cancelamento, e o mesmo pedido passa em seguida. Foram 3 de 3 rodadas do cenário e 1 de 7 tentativas isoladas, com e sem webhook desligado na conta. A tela mostra essa frase do Asaas, e a gestão repete; o cenário repete uma vez.
- **Não rodam agora:** `sandbox:avulsa` e `sandbox:ciclo` abrem uma subconta para receber o split, e o sandbox passou a recusar ("O limite de uso do teste controlado para criação de subcontas foi atingido [...] é necessário concluir a homologação regulatória"). O caminho sem split deles está coberto pelo cenário da conta da academia.
- **`sandbox:cartao`:** falha igual na main, sem esta frente. O Asaas responde 500 `unknow.error` na troca do tipo de cobrança para cartão. Ligar o cartão na assinatura da conta da academia passou no cenário novo.

### Fica com o responsável

1. ~~As três migrations em transação desfeita~~ (feito em 06/10, acima). Depois de aplicadas, `supabase gen types` para conferir que o `types.ts` editado à mão bate com o gerado.
2. A publicação das funções, nesta ordem: `asaas-webhook` e `asaas-reconciliar` primeiro, depois as que criam e mexem em cobrança, e por fim `asaas-conta-academia`.
3. ~~Os cenários do sandbox~~ (feito em 06/10, acima).
4. O print da tela de abertura da subconta, na academia de homologação (trial).
5. A aprovação da proposta de texto do recebimento e da redação das taxas na tela.
