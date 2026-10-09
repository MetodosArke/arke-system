# Agentes

Letícia, Bruno, Lucas, o Pipeline comercial e o Vigia.

## Letícia: o agente comercial (semana 1 do plano dos agentes, 28/09/2026)

O plano dos agentes, versão 3, está no workspace da ArkeFit. A ordem é esta: Letícia (comercial), Bruno (implantação) e Lucas (assistente), um por semana; Camila (retenção) e Financeiro vêm depois. Todos rodam sozinhos em rotina agendada, menos o Lucas, que responde quando alguém pergunta.

A Letícia responde o contato da página de vendas por e-mail em minutos e leva à demonstração com o Jean. **O objetivo é vender a reunião, não o plano.** Migration `20261298010000_agente_comercial.sql`, edge function `agente-comercial`, rotina `arke-agente-comercial` de 5 em 5 minutos, com o token do alerta de rotinas.

- **O e-mail é texto nosso; a IA escreve só o espelho.** O que a ArkeFit faz (um texto por assunto: evasão, inadimplência, catraca, atendimento, troca de sistema), o convite e o link da agenda são fixos, em `fluxo.ts`. A IA, o Claude 3 Haiku em São Paulo pela mesma porta do Sentinela, escreve uma ou duas frases sobre o que a academia contou. `espelhoAceito` recusa número, "R$", "%", pergunta, link, preço, plano, promessa, solução e qualquer menção à ArkeFit. Recusado ou fora do ar, o e-mail sai sem o espelho. É a regra "nenhuma IA escreve número" em forma de código. No teste real, a mensagem que só pedia preço saiu sem espelho, como deve, e a de inadimplência também saiu sem ele.
- **Ao modelo vão só a mensagem, a faixa de alunos e o sistema atual**, com e-mails e telefones digitados na mensagem trocados por marcadores (`tirarContatos`). Nome, e-mail e telefone do formulário não vão. *Ampliado em 07/10/2026: a mensagem sai também sem a assinatura do fim e com o nome do contato trocado por "[nome]", e o espelho com nome de pessoa ou despedida é recusado (ver "A frente E" em [seguranca-e-acesso.md](seguranca-e-acesso.md)).*
- **Quando sai.** A primeira sai na hora, de dia ou de noite, só para contatos criados depois de ela ser ligada e há menos de 24 h; assim, ligá-la não dispara e-mail para quem já foi atendido por gente. Os lembretes saem no 2º e no 5º dia depois da primeira, só em dia útil, das 9h às 19h de Brasília. A regra mora em `leads_para_agente_comercial()`, num lugar só.
- **Para quando** o status do contato sai de "novo", a pessoa clica em "não quero mais receber" (`/contato/parar?t=`, que pede um clique para o antivírus do e-mail não descadastrar ninguém, e o cabeçalho List-Unsubscribe de um clique) ou o endereço não existe (422 do Resend).
- **Não sai duas vezes.** A mensagem é reservada no banco antes do envio (`unique (lead_id, etapa)`). Uma reserva de mais de 15 minutos é de rodada que caiu, e o envio leva uma chave de idempotência no Resend.
- **Dois interruptores:** `agente_comercial_ativo`, que só a ArkeFit liga, em Visão Master → Pipeline comercial (antes Contatos do site), por `definir_agente_comercial()`, que exige o link da agenda e fica na Auditoria; e `agente_comercial_ia`, que liga a frase da IA. Sem ele, o e-mail sai só com o texto fixo. Quem ligou o segundo foi a migration da Política 2026-09-28.2 (`20261300010000`), que descreve a resposta automática e foi aprovada pelo responsável no workspace, como estava.
- **Assinatura.** O e-mail sai assinado por "Equipe comercial ArkeFit" (`agente_comercial_assinatura`), e não pela Letícia: assinar por uma pessoa que não existe faria a academia achar que falou com ela. *Desde 07/10/2026, a assinatura configurada que não começa por "Equipe" volta à padrão, na Letícia e no Bruno (`assinaturaDeEquipe`).*

**Conferido:** 14 casos em transação revertida (quem está devido, reserva única, lembrete só em horário útil, sem 2º lembrete antes do 1º, status e pedido de parar interrompendo, falha voltando à fila, endereço inválido parando, reserva velha liberada, desligada sem envio, papel exigido, privilégios), 36 testes do `fluxo.ts` e dois envios reais para a caixa de teste do Resend pela função publicada, com a primeira resposta e os dois lembretes nas quatro categorias. Pela tela, 24 verificações, com o painel, o andamento por contato e a página pública, no computador e no celular. Tudo o que o teste criou foi apagado, e a Letícia ficou desligada.

## Bruno: o agente de implantação (semana 2 do plano dos agentes, 03/10/2026)

Leva a academia do primeiro acesso ao painel até a primeira entrada de um aluno. Edge function `agente-implantacao`, rotina `arke-agente-implantacao` de hora em hora (aos 20 minutos), com o token do alerta de rotinas. Migrations `20261315010000_agente_implantacao.sql` e `20261316010000_agente_implantacao_relogio.sql`. **Sem IA:** modelos fixos, assinados por "Equipe de implantação ArkeFit". Substituiu o lembrete de onboarding de 3 em 3 dias, que saiu inteiro (função, rotina, token do Vault, colunas e funções do banco).

- **Nove etapas** (`implantacao_etapas`): as seis da configuração, lidas de `onboarding_etapas_interno` sem cópia; **liberar o app**; **primeira entrada** (qualquer presença: catraca com o Gateway ou check-in por QR; no autônomo, que não tem nenhum dos dois, o **primeiro aluno no app**); e o **lançamento**. Fora da sequência, sem travar nada: a **evasão dos 6 meses anteriores** e a **aprovação do Asaas**.
- **O que ele faz**, um e-mail por rodada, pela prioridade: o kit de lançamento; o próximo passo quando a etapa muda (o primeiro contato é a boas-vindas), com o link da tela e do artigo; o aviso da conta Asaas aprovada ou recusada; o lembrete da etapa parada a cada 3 dias úteis, até dois; e o pedido da evasão anterior (quando os alunos chegam do sistema antigo, e uma vez mais depois da liberação). **Só em dia útil, das 9h às 19h, no máximo dois por dia por academia.** Confere a aprovação do Asaas uma vez por dia, com a chave da subconta e o `ambienteAsaas`.
- **O kit só sai depois da primeira entrada real**: chamar todos os alunos antes de a entrada funcionar faria o aluno chegar à catraca e não passar. Leva o convite de primeiro acesso, o link de entrada com a marca, a matrícula e uma mensagem pronta. Com ele a implantação termina.
- **1 dia útil parada na mesma etapa** (o fim de semana não conta; feriado conta, porque o erro é uma ligação a mais): abre um chamado em `implantacao_chamados` e avisa os Super Admins. A conta Asaas recusada também. Um aberto por academia, e a mesma etapa só volta a chamar depois da próxima checagem registrada no desfecho (desfecho sem próxima checagem encerra o assunto daquela etapa) — o ciclo completo de atendimento.
- **Tudo registrado** em `implantacao_mensagens`, com o motivo, reservado antes do envio (duas rodadas não mandam a mesma mensagem) e com chave de idempotência no Resend. A gestão vê o registro no painel: é a prova de que o serviço está acontecendo.
- **Um relógio só.** As datas que o agente grava (início da etapa, reserva, envio) vêm do relógio da função, e não do `now()` do banco. A corrente de teste simula a semana pelo corpo `agora`, e com dois relógios o teto do dia e o chamado eram medidos contra datas trocadas: foi a corrente que achou.
- **Telas:** a página da configuração virou **Implantação da academia** (`/admin/onboarding`), com o andamento das nove etapas, a liberação, a primeira entrada, o kit dentro do painel, o quadro da evasão anterior (`salvar_evasao_anterior`, só a gestão; a janela são os 6 meses antes do mês de criação da academia) e o registro do assistente. O cartão da tela inicial acompanha até a primeira entrada. **Visão Master → Implantação** (`/superadmin/implantacao`): o interruptor (`definir_agente_implantacao`, auditado), cada academia com o andamento e há quantos dias úteis está parada, e o chamado com **Registrar a ligação**. O "1 dia útil" da tela (`src/lib/implantacao.ts`) espelha o do agente, e o teste confere os dois hora a hora em duas semanas.

**Conferido:** 44 casos da migration em transação desfeita (etapas, quem o agente acompanha, encerramento e trial de fora, relógio da etapa, reserva, chamado e próxima checagem, quem lê e quem grava, evasão com janela e limites, a ArkeFit só com as duas etapas, o lembrete antigo fora); 20 testes do `fluxo.ts` e do espelho, com nove defeitos plantados, os nove pegos; e a **corrente real**, 21 verificações com a função publicada, o banco e o Resend, numa academia temporária com a semana simulada de sábado a sexta: nada no fim de semana, a boas-vindas entregue, o teto do dia, o chamado só depois de 1 dia útil e o aviso aos Super Admins, o pedido da evasão, o aviso da conta aprovada, o kit depois da primeira entrada e a implantação terminando. **O agente ficou desligado:** ligar é um clique em Visão Master → Implantação.

## Lucas: o assistente da academia (semana 3 do plano dos agentes, 03/10/2026)

O único agente que não roda em rotina: responde quando alguém da equipe pergunta, no alto da Central de Ajuda do painel (`AssistenteAcademia`). Edge function `assistente-academia`, migration `20261318010000_assistente_academia.sql`. Na tela e nos e-mails ele é "o assistente", e não "Lucas", pelo mesmo motivo da assinatura da Letícia.

- **A resposta vem da Central de Ajuda.** A função leva uma cópia dos artigos em `artigos.json`, um trecho por seção (`indice.ts`), e busca neles (`fluxo.ts`: raiz de cinco letras, peso do título, no máximo dois trechos por artigo, só os artigos que o papel de quem pergunta lê). `src/lib/assistenteAcademia.test.ts` monta o índice de novo e compara: **artigo mudado sem `npm run ajuda:indice` falha no CI**, e depois de atualizar é preciso publicar a função.
- **A situação na hora** (`assistente_contexto()`, com a identidade de quem pergunta, só a equipe daquela academia): as catracas com a situação do Gateway; o aluno pelo nome digitado no campo próprio (cada palavra, sem acento, em qualquer ordem), com situação, app e catraca; a cobrança em aberto só para gestão e recepção; e, para a gestão, a etapa que falta da implantação. **Os botões chamam a mesma rota da tela**, com a permissão de quem clica: sincronizar a catraca, abrir a ficha, abrir a fatura, copiar o link de ativação.
- **A pergunta não é guardada.** `assistente_perguntas` tem só o assunto, os artigos sugeridos e a resposta a "Isso resolveu?", que é o que mede o assistente. O texto só fica quando vira **chamado** (`chamados_suporte`), com o ciclo completo: prazo de 8 horas úteis (`prazo_util`), responsável, ação, desfecho obrigatório e próxima checagem, encerrado só pela ArkeFit (`concluir_chamado_suporte`). A ArkeFit recebe o chamado por e-mail, com a resposta indo para quem perguntou, e trabalha a fila em **Visão Master → Suporte**, com os números do assistente (`get_superadmin_assistente_numeros`). A academia acompanha os chamados dela, com o desfecho, embaixo do assistente.
- **Dois interruptores**, como na Letícia: `assistente_ativo` e `assistente_ia`. Com a IA, o modelo escreve um texto curto a partir dos trechos e da situação sem nome (`resumoSituacao`), com a trava de número inventado (`diagnosticoAceito`). Na primeira avaliação, com o Claude 3 Haiku em São Paulo, ela ficou desligada: em 10 perguntas típicas o modelo acertou 2, errou 2 (confundiu os estados da catraca e inventou uma regra da pausa) e teve as outras 6 barradas pela trava.
- **A IA com o modelo do Vigia, fora do Brasil (decisão do responsável, 03/10/2026).** Não há modelo moderno invocável em São Paulo, e o responsável escolheu a qualidade. `consultarAssistente` (`_shared/ia.ts`) usa `MODELO_ASSISTENTE = MODELO_VIGIA`, pelo perfil `global.`, e é a única porta do assistente até o modelo. Como a pergunta é texto livre e sai do país, **ela sai sem identificação**: a porta monta a entrada por `montarEntrada` (`_shared/assistenteEntrada.ts`), que tira primeiro CPF, e-mail e telefone e depois o nome de quem está na academia, alunos e equipe, vindo de `nomes_para_anonimizar()` (só a service role; migration `20261319010000_assistente_sem_nomes.sql`). A ordem importa: tirar o nome antes desfazia o e-mail, e o teste pegou ("bruna@x.com" virava "[nome]@x.com"). Palavra comum que também é sobrenome ("dias", "campos", "clara") só sai com a inicial maiúscula. Sem a lista de nomes, a pergunta não vai ao modelo. O campo "É sobre um aluno?" nunca foi ao modelo, e o artigo passou a dizer à equipe para usá-lo em vez de escrever o nome. `iaNoBrasil.guarda.test.ts` ganhou as travas desta exceção: a porta monta a entrada limpa antes do envio, a limpeza tira contatos e depois nomes, e só `assistente-academia` usa a porta, com a lista do banco. O Sentinela, a dieta em PDF e a Letícia continuam em São Paulo. **A Política não ganhou versão por isto**, por decisão do responsável (o que sai não tem dado sensível nem identificação); a linha do assistente entra na próxima versão que a Política tiver por outro motivo.
  **Conferido:** a avaliação, com o código real e o modelo novo, deu **12 de 12 respostas aceitáveis e nenhuma errada** (as 10 perguntas da primeira avaliação e duas com a situação na hora: a catraca sem sinal e uma aluna inadimplente citada pelo nome, que saiu como "[nome]"); 8 casos da migration em transação desfeita; os testes do índice, da busca e da limpeza; e três defeitos plantados (limpeza sem os nomes, porta mandando a pergunta crua, função sem a lista), os três pegos. E a **corrente real**, 11 verificações pela função publicada numa academia temporária: a resposta escrita para a gestão e para o professor; uma pergunta com o nome da aluna e o do professor, cuja resposta seguiu a situação (pausada) **sem trazer nenhum dos nomes**, que o modelo não recebeu; a aluna com 403; a lista de nomes recusada pela API à gestora (42501) e sem login; e a IA desligada sem chamar o modelo. **Ligada depois disso** (`20261320010000_assistente_ia_ligada.sql`). O custo medido é de uns 1.250 tokens de entrada e 105 de saída por pergunta, perto de US$ 0,005.
- **A avaliação achou um defeito do artigo, não só do modelo:** "Sem sinal" juntava o computador desligado (a catraca não libera ninguém) e a falta de internet (a catraca segue pelo cadastro guardado). O artigo das catracas passou a separar os dois.
- **Freio:** 40 perguntas por pessoa e 150 por academia em 24 horas; 5 chamados por pessoa por dia.

**Conferido:** 34 casos da migration em transação desfeita; 14 testes do índice, da busca e da IA, com três defeitos plantados, os três pegos; a corrente real, 20 verificações pela função publicada com uma academia temporária (quem pode, os cartões da gestão e do professor, o chamado com o e-mail entregue, a IA respondendo quando ligada por um instante, desligado e freio); e 15 pela tela, no computador e no celular, da pergunta ao desfecho visto pela academia.

## Pipeline comercial: o CRM da ArkeFit (30/09/2026)

"Contatos do site" virou **Visão Master → Pipeline comercial** (`/superadmin/comercial`; o endereço antigo redireciona). O mesmo quadro recebe os pedidos de demonstração do site, que chegam sozinhos, e os contatos que a equipe anota à mão. Migration `20261301010000_crm_comercial.sql`.

- **Tabela `leads_comerciais`** (era `leads_site`; as mensagens da Letícia, `leads_comerciais_mensagens`). `origem` é o canal: `site`, `whatsapp`, `telefone`, `indicacao`, `prospeccao`. A UTM do site, que a coluna guardava antes, foi para `origem_detalhe`, que na indicação guarda quem indicou e na prospecção guarda onde o contato foi achado. Na prospecção a fonte é obrigatória, porque o primeiro e-mail conta à academia de onde veio o contato dela. `observacao` virou `observacoes_vendedor`, que nunca vai para e-mail nem para a IA. `mensagem` é o que a academia contou e o único texto que pode ir ao modelo.
- **Etapas**: `novo`, `qualificacao`, `demonstracao`, `negociacao`, `ganho`, `perdido`. Perdido exige `motivo_perda`, e sair de perdido limpa o motivo. `status_desde` marca quanto tempo o cartão está na etapa.
- **Contato mínimo**: o nome da academia e um jeito de falar com ela (telefone ou e-mail). O nome da pessoa é opcional, porque na prospecção muitas vezes não se sabe.
- **As regras moram no banco** (`proteger_lead_comercial`), para qualquer caminho. Contato `site` só entra pelo formulário (`lead-site`, sem usuário), porque é isso que faz a Letícia responder sozinha. O canal site não se troca, e o que a academia escreveu no site não se edita. Os privilégios são por coluna: token, acionamento e parada da Letícia, IP e aviso não se escrevem pela API. A inclusão e a exclusão ganharam regra própria, só da ArkeFit, com as duas etapas.
- **Letícia** (`leads_para_agente_comercial`, ainda a única regra de envio): só fala com contatos em **Novos**. O site continua automático. Os outros canais recebem e-mail só depois de `acionar_agente_comercial()` (botão no cartão, auditado): a primeira mensagem sai em horário útil e em até 3 dias do acionamento. Isso depende de `agente_comercial_outras_origens`, que nasce desligado e é ligado pela migration da Política que descrever esses canais. É o mesmo desenho do `agente_comercial_ia`. O e-mail muda com o canal (`fluxo.ts`: `abertura`, `motivoDoEmail`). A frase da IA entra só onde a academia contou algo: site, WhatsApp e telefone (`usaEspelho`). Na indicação e na prospecção o e-mail é só texto nosso. O interesse escolhido na ficha define o assunto e vale mais que o palpite da IA.
- **Guarda de 12 meses** para todos os canais (`limpar_leads_comerciais_antigos`, rotina `arke-retencao-leads-comerciais`). Ganho fica.
- **Política 2026-09-30** (`20261302010000`, aplicada depois do deploy): descreve os canais além do site e liga `agente_comercial_outras_origens`. Texto aprovado pelo responsável no chat, como proposto no workspace. Os canais de quem procurou a ArkeFit ficam em procedimentos preliminares a pedido (art. 7º, V). Indicação e prospecção ficam em legítimo interesse (art. 7º, IX), limitado ao contato profissional que a academia publicou, com a origem no primeiro e-mail.
- **Tela** (`src/components/superadmin/comercial/`): quadro com arrastar e soltar (`@dnd-kit/core`). O arrasto começa depois de mexer o mouse alguns pixels, ou com o dedo parado um instante no celular. O menu **Mover para** de cada cartão é o caminho pelo teclado e o mais fácil no celular. A ficha lateral adiciona e edita, e avisa o duplicado pelo e-mail ou pelos últimos 10 dígitos do telefone (na edição, só se o contato mudou). As regras da tela estão em `src/lib/crmComercial.ts`, com teste. A cor de cada canal passou pelo validador de paleta nos dois temas, vai num ponto, e o nome está sempre escrito. A Visão Master libera a largura toda para esta tela (`TELAS_LARGAS`): na coluna central das outras, o quadro mostrava três colunas e meia.

**Conferido:** 35 casos da migration em transação revertida, com o Super Admin verificado e sem a verificação, gestor de academia, as travas do canal site, fonte, perdido e privilégios, as recusas do acionamento na ordem e o que fica devido à Letícia antes e depois. Ao testar, apareceu um defeito: a trava da fonte aceitava vazio, porque uma checagem que dá nulo passa. E 45 verificações pela tela, no computador e no celular, com o banco real. Durante o teste, a rotina de verdade da Letícia mandou o primeiro e-mail de uma prospecção acionada e um lembrete de site, para a caixa de teste do Resend, com a abertura e o rodapé certos. Tudo o que o teste criou foi apagado, e a configuração da Letícia voltou a como estava.

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

### Nível 3: avisar uma pessoa (05/10/2026)

Rodada B. Dois problemas que o Vigia não via, e que nenhuma ação automática resolve: o Asaas parar de mandar avisos, e uma cobrança com a conta que não fecha. Os dois ganharam o **nível 3**, que não tem ferramenta: vai direto para uma pessoa, pelo mesmo e-mail de "precisa de uma pessoa". Migration `20261329010000_vigia_nivel3_financeiro.sql`.

- **A trava do nível é do banco.** O nível 3 só fica em `avisar`, `sombra` ou `desligada`, e só ele não tem ferramenta. Nível 1 continua sem pedir aprovação, e nível 2 sem agir sozinho.
- **`webhook_calado`**, por dois sinais:
  - **Silêncio.** São 5 cobranças ou mais vencendo nos últimos 3 dias, em academias fora da homologação, sem nenhum aviso do Asaas em 72 horas. Os reenvios da conferência e do Vigia não contam como aviso. A primeira versão acusava em 24 horas e com qualquer cobrança, e erraria todo fim de semana: o Asaas só marca o boleto vencido no sábado como vencido no dia útil seguinte, então um fim de semana calado é normal.
  - **Correções.** A conferência diária corrige o que o webhook perdeu. Se ela corrigir 3 ou mais numa rodada, ou pelo menos 1 em duas rodadas seguidas, os avisos estão se perdendo. Uma correção isolada é o caso para o qual a conferência existe, e não acusa.
- **`conta_nao_fecha`** (`conferir_contas_financeiras()`, nos últimos 35 dias, agrupada por academia e tabela). Ela acusa:
  - **valor diferente de repasse mais líquido**, em `pagamentos`, `mensalidades`, `cobrancas_avulsas` e `cobrancas_b2b`;
  - **cobrança paga sem o lançamento automático**, passadas 2 horas;
  - **cobrança paga sem nota fiscal**, com a emissão ligada. `organizacao_fiscal.emissao_ativa_desde`, carimbada por gatilho, faz ligar a nota não acusar o que foi pago antes;
  - **valor diferente no Asaas e no banco**, que a conferência diária passou a anotar (ver [cobranca.md](cobranca.md)).
- **Tela e resumo:** "Avisa uma pessoa" na lista de modos, e o resumo diário diz "avisou uma pessoa" (ou "teria avisado", em sombra).

**Conferido:** 23 casos em transação desfeita, com a migration. Os casos:
- as travas de nível;
- o silêncio com 4 e com 5 cobranças, e o reenvio da conferência não contando como aviso;
- as correções numa rodada e em duas;
- o valor do Asaas com os dois números na descrição;
- a conta acertada parando de acusar, e a paga sem lançamento acusando só a que ficou sem;
- a nota antes e depois de ligada;
- a ocorrência indo ao e-mail sem nenhuma ação executada;
- as funções novas fora do PostgREST.

Também os testes de `vigia.ts` e do resumo com o nível 3. Em produção, a migration foi aplicada, as duas regras estão avisando, nada é acusado hoje, e a conferência real já grava `valores`.

## Medidor de uso e avaliação repetível das IAs (05/10/2026)

Rodada B. Quatro IAs entram: a Letícia, o assistente da academia, a leitura de dieta em PDF e o Vigia. O Sentinela segue congelado e fica de fora. Antes, não havia como responder três perguntas: quanto cada IA custa, quantas vezes a trava descarta o que o modelo escreveu, e se um ajuste no roteiro deixou a IA melhor ou pior.

**O medidor.** Cada chamada vira uma linha em `ia_chamadas` (migration `20261333010000`), gravada por `registrarUsoIA` (`_shared/usoIA.ts`). A linha guarda:
- o resultado: `ok`, `recusada_trava` ou `indisponivel`;
- o modelo, os tokens e a latência, que as portas de `_shared/ia.ts` passaram a devolver (`uso`);
- a academia, quando há uma.

**Nenhum texto entra no medidor**, nem a pergunta nem a resposta; o teste confere que a tabela não tem coluna de texto livre. Só a service role grava. A ArkeFit lê por `get_superadmin_uso_ia()`, na tela **Visão Master → Uso das IAs**. A tela mostra, por IA:
- as chamadas, a taxa de recusa (destacada a partir de 20%) e os indisponíveis;
- os tokens;
- o custo estimado, pela tabela `ia_precos` (preço público da AWS, em dólar);
- a latência média e a máxima.

As linhas saem em 13 meses, na limpeza diária. `usoIA.test.ts` falha se uma função que chama o modelo não registrar o uso, fora as duas do Sentinela.

**O que é "recusada pela trava" em cada IA:**
- Letícia: espelho com número, preço, promessa ou link (`espelhoRecusado`; espelho vazio não conta).
- Assistente: resposta com número que não está na Central.
- Dieta: leitura que não montou, ou alimento que não está no PDF.
- Vigia: quadro que não passou na validação, ou resposta fora do catálogo.

**A avaliação** (`npm run avaliar:ia`, com `-- --vigia` para o Vigia pelo simulado). Os casos são inventados (`scripts/avaliacao-ia/casos.mjs`) e passam pelo mesmo código de produção: o roteiro, a porta de IA e a trava. Cada caso diz o que conta como acerto:
- **Assistente.** Na dúvida que a Central cobre, acerta quem acha o artigo e responde com o que está nele. Na dúvida que ela não cobre, **dizer que não encontrou vale ponto**, porque inventar resposta é o pior erro.
- **Registro.** O resultado vai para `docs/avaliacoes-ia/<data>.json`, com a assinatura do roteiro e do modelo de cada IA. Nos casos que erram, vai também o começo da resposta.
- **Trava.** `avaliacaoIA.guarda.test.ts` falha quando o roteiro ou o modelo de uma IA muda sem avaliação nova.

**A primeira avaliação, de 05/10/2026:**
- Letícia: 7 de 7. Numa rodada anterior, a trava recusou um espelho; a temperatura de 0,3 dá essa variação.
- Assistente: 12 de 13. Respondeu "não encontrei" nas três dúvidas de fora. O erro foi "como aviso todos os alunos que vamos fechar no feriado", em que a busca não liga "aviso" a "comunicado". *Corrigido em 09/10/2026, no artigo (ver "Lucas: a busca acha o comunicado e o desfecho").*
- Dieta: 3 de 3, inclusive recusar um contrato de locação.
- Vigia: 12 de 13. O erro foi a falha de cadastro no equipamento lida como nuvem, o mesmo de setembro.

**O que a avaliação achou e já mudou:**
- **A busca do assistente não ligava o verbo conjugado ao substantivo.** "Como pauso ele" não achava o artigo da situação do aluno. As raízes passaram a incluir as quatro primeiras letras das palavras de cinco ou mais. Num conjunto de 28 perguntas, a busca foi de 26 para 27, sem perder nenhuma.
- **O Claude 3 Haiku de São Paulo devolve 429 com poucas chamadas seguidas**, pela cota da conta. A avaliação passou a tentar de novo com espera crescente.
- **O cenário "banco cheio" do simulado do Vigia tinha parado de rodar** com a faixa de `plataforma_config` (mínimo de 100 MB, sem casas). Agora o gatilho da faixa é desligado só dentro da transação do cenário.

**Conferido:**
- O guarda da avaliação, com uma palavra mudada no roteiro da Letícia derrubando o teste.
- Os testes do medidor e da recusa da Letícia.
- A **corrente real**, com uma gestora temporária: o assistente e a leitura de dieta publicados gravaram modelo, academia, tokens (1.338 e 97; 599 e 286) e latência, e nenhum texto.
- As funções que importam `_shared/ia.ts` foram publicadas, inclusive as duas do Sentinela, para o código publicado bater com o repositório. O comportamento do Sentinela não mudou: a porta só passou a devolver o uso, que ele ignora.

## Vigia: ação aprovada sempre com desfecho (06/10/2026)

Achado médio da auditoria de prontidão de 05/10. A aprovação reserva a decisão (`vigia_preparar_aprovacao`) e só depois executa; o desfecho chega por `vigia_concluir_acao`. Quando o Asaas ou o webhook estourava o prazo, o `fetch` lançava, o `catch` de `vigia-aprovar` só respondia 500, e a ação ficava em "executando" para sempre. A nova aprovação era recusada como "já decidida".

- **Toda saída depois da reserva registra o desfecho** (`vigia-aprovar/fluxo.ts`, `executarComDesfecho`). A exceção vira "erro" com uma frase que não repete a mensagem crua, que pode trazer endereço, e diz para conferir antes de agir de novo. O registro é tentado duas vezes.
- **O reenvio dos avisos ao webhook** conta como não processado o aviso que estoura o prazo, e segue para os outros.
- **A função morta no meio** (limite de tempo do runtime) é o que o código não alcança. A cada passada do Vigia, a ação que passou de 15 minutos sem desfecho é fechada como erro, com a Auditoria de sempre (`vigia_fechar_acoes_sem_desfecho`, `20261374010000`). A rotina `arke-vigia` chama as duas, nessa ordem.
- `asaas-assinatura-ciclo/fluxo.ts` não mudou: o `fetch` sem `try` lá é usado por outras funções, que têm o próprio tratamento, e a proteção ficou em quem reserva a decisão.

**Conferido:** `vigiaAprovar` (6 testes): o prazo esgotado e a exceção qualquer registram erro, o resultado normal registra com o comando, o registro que falha é tentado de novo. Defeito plantado: o `catch` relançando a exceção derrubou 2 testes. No banco de produção, em transação desfeita: das duas ações em "executando", a de 16 minutos fechou como erro e a de 5 seguiu executando, e a rotina `arke-vigia` passou a fechar as presas antes de varrer. **Falta,** pela corrente real, a aprovação de `cancelar_assinatura_orfa` com o Asaas fora do prazo (no sandbox) terminando como erro, e não presa.

## Lucas: a busca acha o comunicado e o desfecho (09/10/2026)

A avaliação de 09/10 com o Claude Sonnet 5.5, que não foi adotado, mostrou dois casos em que a busca do assistente não entregava ao modelo o trecho certo da Central de Ajuda. O Sonnet 4.6 completava um deles por conta própria; o outro errava nos dois modelos. Os dois eram defeito do artigo, e não do modelo nem da conta da busca.

- **"Como encerro um atendimento da fila?"** O artigo vinha, mas com a introdução e "De onde vêm as tarefas", e sem a seção que ensina a registrar o desfecho. A busca põe o título do artigo em todas as seções dele, e a seção se chamava só "Como atender": a palavra "atender" já estava no título do artigo ("Atendimento: a fila e o desfecho") e não somava nada, e "encerrar" só aparecia no corpo. Na escolha dos dois trechos do artigo, ela ficava em terceiro. **Conserto:** a seção passou a "Como atender e encerrar", que é o que ela ensina.
- **"Como aviso todos os alunos que vamos fechar no feriado?"** O artigo não vinha. Ele se chamava só "Comunicados" e dizia "avisam todo mundo de uma vez: feriado", sem "aviso" nem "fechar". O "fechar" da pergunta bate com "Financeiro e fechamento do mês", no título, e o título pesa em toda seção: o financeiro ocupava as primeiras posições. **Conserto:** o título passou a "Comunicados: avisos para alunos e equipe", e a introdução diz "mandam um aviso para todos de uma vez, alunos, equipe ou os dois: a academia vai fechar no feriado, o horário mudou, vai ter evento ou manutenção". O artigo fala do jeito que a gestão pergunta.
- **A conta da busca ficou como estava.** Antes do artigo, foi tentado dar peso ao título da seção na escolha dos trechos de cada artigo, sem mexer na ordem dos artigos. O desfecho passava, mas a escolha das seções mudou em 26 de 55 perguntas, e "Como registro o desfecho de uma tarefa?" perdeu a seção que responde. Foi desfeito.
- **Conjunto de 55 perguntas da gestão** (as 10 da avaliação com artigo e 45 do dia a dia, uma ou mais por artigo): o artigo certo é achado em 55, eram 53, e vem em primeiro em 52, eram 50. Nenhuma outra pergunta mudou de artigo. A única mudança fora dos dois artigos é o terceiro trecho de "Como encerro o contrato com a ArkeFit?", que agora é a seção da fila; o artigo do encerramento segue em primeiro. `assistenteAcademia.test.ts` ganhou as duas perguntas.
- **A regra do "não encontrei" da avaliação contava um acerto como erro.** Na primeira rodada, o imposto de renda saiu como erro com a resposta "Isso não é algo que a Central de Ajuda do ArkeFit cobre", que é dizer que não encontrou. A busca entrega a esse caso os mesmos trechos de antes, e a variação é do modelo, com a temperatura de 0,2. A regra passou a aceitar "não é algo que a Central…", e a avaliação rodou de novo, inteira.
- **A avaliação grava quem respondeu.** Cada caso leva o modelo que de fato respondeu (a API da Anthropic, `claude-sonnet-4-6`, ou a reserva na AWS, `global.anthropic.claude-sonnet-4-6`), e o Vigia leva também os tokens, além da latência. Só os scripts mudaram; nada da troca de modelo do ramo do Sonnet 5.5 entrou.

**Conferido:**
- A avaliação do assistente pelo caminho de produção (a API da Anthropic, `IA_ANTHROPIC_AGENTES` com o assistente): **13 de 13**, eram 12, e os 13 casos respondidos por `claude-sonnet-4-6`. Latência máxima de 5,6 s; em média, 1.299 tokens de entrada e 97 de saída. A primeira rodada deu 12 de 13, pelo imposto de renda acima.
- Dois defeitos plantados: com o artigo antigo dos comunicados, o teste falhou (o financeiro em primeiro); com a seção antiga da fila, também.
- `npm run check`: 0 erros, 57 funções no `deno check`. `npx vitest run`: 198 arquivos e 1.584 testes; um deles (`provaDoConsentimento.guarda`) passou do prazo de 5 s com a máquina carregada e passou sozinho.
- **Depois do merge,** publicar `assistente-academia`, que leva o índice novo.
