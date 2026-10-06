# Catracas e Gateway Local

Do desenho de quem disca até cada versão do Gateway.

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

## Toletus: o Gateway que disca (02/10/2026)

A Toletus (antiga Actuar) aparece em quatro concorrentes, e é a única marca com protocolo **aberto**: o manual de comandos e os pacotes de integração estão em github.com/Toletus, sem cadastro. Placa **LiteNet2**, porta TCP **7878**, pacotes fixos de 20 bytes (`0x53` | comando em little-endian | 16 bytes de dados | `0xC3`). Gateway **1.1.0**.

- **O sentido é o oposto das outras marcas:** a placa é o servidor e quem disca é o Gateway (`src/conectores/toletus/`). O driver fica inerte (`ReceptorDriver`, com a frase de log certa), e o conector usa o mesmo caminho de decisão dos receptores: `validarCredencial` esperando o giro, `registrarAcessoOffline` na contingência, `concluirGiro` no aviso.
- **Sem o Gateway, a catraca trava.** A placa não guarda lista de alunos: na direção controlada ela só abre por ordem. É a regra do ARKE sem configuração nenhuma, o oposto da Intelbras, que no estado offline libera todo cadastrado.
- **Giro de verdade:** a placa avisa a passagem (0x0304, com a direção) e o tempo esgotado (0x0305). Liberação que não chega à placa fecha como **desistência**: a borboleta não abriu, e contar presença seria inventar uma entrada. Placa que cai com giro aberto fecha como sem confirmação, pela regra do prazo. Passagem sem liberação nossa (saída livre) não vira nada.
- **A conexão é nossa responsabilidade inteira.** Sem keepalive do TCP: o firmware não responde às sondas, e o pacote oficial aprendeu em produção que a conexão ociosa caía em ~25 s. O sinal de vida é perguntar o id da placa a cada 10 s; placa calada por 35 s tem a conexão reaberta (o pacote oficial só percebe a queda quando o envio falha); reconexão com espera crescente até 5 s. **Uma decisão por vez em cada placa**: duas leituras seguidas chegam antes da primeira decisão, e sem a fila o aviso de passagem fecharia o acesso errado.
- **O montador de pacotes realinha.** O TCP não respeita a fronteira de 20 bytes; o pacote oficial remonta, mas um byte perdido o desalinha para sempre. O nosso anda um byte até achar prefixo e sufixo.
- **Display público:** "Bem-vindo!", sem o nome; negativas em frases de até 16 caracteres que não falam de dinheiro para a fila ler (`mensagemDoDisplay`). O motivo completo fica no registro.
- **Gestão remota por capacidade.** `GestaoEquipamentos.capacidades()`: a Control iD aceita tudo, a Toletus só `liberar_catraca` (a placa não guarda usuário; as digitais ficam no leitor SM25, cadastradas pela ficha desde a 1.6.0). A telemetria só lista como `controlid-gestao` quem **cadastra**, porque é essa a lista "gestão remota" da tela, em que a recepção escolhe o leitor. A ficha mostra o campo manual do número, como na Topdata.
- **Cartão:** o número vale sem os zeros à esquerda. Para a recepção descobrir o número que o leitor dá a um cartão, **Catracas → Últimos acessos** mostra "Número lido" no cartão não cadastrado (`numeroNaoCadastrado`, em `src/lib/gateway.ts`). Só o que veio como `id:`; CPF digitado não aparece.
- **Achado de passagem: a verificação de tipos do Gateway nunca olhou os testes.** `tsconfig.check.json` listava `tests`, mas herdava do `tsconfig.json` a exclusão dela. Um teste com o equipamento falso desatualizado passava na verificação e só quebrava na execução. Corrigido, com zero erro nos testes existentes.

**Conferido:** 43 testes novos (155 no Gateway): o protocolo byte a byte contra o manual, o montador com pacote partido, colado e com lixo, e o conector contra uma placa falsa por TCP. Seis defeitos plantados de propósito (montador sem realinhar, passagem como desistência, sem fila por placa, placa calada não detectada, liberação perdida contando presença, direção trocada), os seis pegos. E a **corrente real**: Gateway compilado, emulador da placa (`npm run emular:toletus`, escrito do manual sem importar o código do Gateway), funções publicadas e banco, numa academia temporária apagada no fim — 27 verificações, da telemetria com o firmware à reconexão depois de a placa cair.

**Fora, e por quê:** a bancada (o número que um cartão de verdade produz, o tempo de liberação da placa, o sentido de giro, o leitor de digital) e o **cadastro remoto da digital**, que é o protocolo do leitor SM25 na porta 7879 (entrou na versão 1.6.0; ver *Gateway 1.6.0*). A **placa LiteNet3** entrou na versão 1.2.0 (seção seguinte).

## Gateway 1.2.0: Toletus LiteNet3 e leitores faciais da Topdata (02/10/2026)

Duas marcas que **discam para o Gateway por WebSocket**. A biblioteca `ws` entrou no Gateway por isso (servidor WebSocket; o Node só traz o cliente).

**Toletus LiteNet3** (`src/conectores/toletus/litenet3/`), pelo pacote oficial `LiteNet3-IntegrationPackage` e pela API do Toletus Hub. JSON em vez de bytes, e o sentido da LiteNet2 invertido: o Gateway manda por UDP à porta 7878 da placa o endereço onde escuta (`toletus_litenet3_porta`, 7880), e a placa disca com os cabeçalhos `x-api-key` e `Serial`. A chave é fixa no firmware e pública no pacote, então **quem a placa é decide o serial**: placa que não está no config é recusada na porta, antes do WebSocket. Keepalive de 15 s com 10 s para o pong (o pacote oficial: "o ESP32 exige"). A mesma decisão, giro e display da LiteNet2, pelo mesmo `ConectorToletus`, agora com `PlacaConectavel` para as duas placas. **A LiteNet3 com leitor de digital manda a IMAGEM do dedo** para o servidor comparar; o ARKE não compara digital fora do equipamento, então nega com "Use o cartao" e descarta. Ali a academia usa cartão, código ou teclado.

**Leitores faciais da Topdata** (`src/conectores/topdataFacial/`), pela página "Comandos do Leitor Facial" do portal de integradores. O leitor disca para a porta 7792 do menu e se apresenta com `reg`; leitor fora de `topdata_faciais` recebe "não". Dois papéis:

- **linha Easy** (modelo novo `topdata_facial`): o leitor pergunta a cada rosto (`sendlog`) e libera com `access`. A cada conexão o Gateway o põe em **`server_verify` 1 ("só online") e `stranger_lock` 0**: sem o Gateway ele nega, e isso não depende de o instalador lembrar. Sem confirmação de giro (a Topdata diz que o `sendlog` é o único retorno), então a presença conta pela liberação;
- **Fit 4 Facial** (modelo `topdata` com a lista): a placa Inner decide pela ponte; o leitor fica em "só offline" e recebe o aluno com `card` = identificador, que é o que a placa lê. Online, ele esperaria a nossa resposta antes e o acesso seria decidido duas vezes.

O que a implementação garante, e onde: a **foto do rosto desconhecido** que vem no `sendlog` é descartada na leitura da mensagem (`interpretarMensagem`), sem log e sem nuvem, e desconhecido nem vai à nuvem; com a senha do menu, o Gateway desliga `use_logphoto` e `stranger_photo` pela API HTTP do leitor; `sendlog` com mais de um registro ou de mais de 2 minutos atrás é **histórico**, respondido com `access: false` — responder "liberado" a um registro antigo poderia abrir a catraca para ninguém; a resposta ao `sendlog` sai **sempre**, negando na dúvida, porque o leitor fica esperando. Ordens vão **uma de cada vez por leitor**: a resposta não tem número de pedido, só o `ret`. Gestão remota: cadastrar e apagar o aluno em todos os leitores (falha em um falha a ordem, para ela continuar pendente), e abrir a catraca pela API HTTP (`opendoor`, só com a senha no config). A ficha do aluno passou a mostrar só os botões que o Gateway anuncia: o leitor facial não cadastra digital nem cartão.

**Um defeito que a corrente real achou: excluir a academia falhava.** Apagar a organização apaga os alunos em cascata, e o gatilho de cada aluno agendava a remoção nos Gateways que removem sozinhos; a ordem nascia apontando para a academia já apagada e a chave estrangeira derrubava a exclusão inteira — a eliminação do encerramento é o mesmo DELETE, e falharia igual. `agendar_remocao_equipamento()` não agenda para academia que não existe mais (`20261309010000_catracas_gateway_1_2.sql`, que também tirou dos textos da nuvem o "gestão remota só na Control iD"). Até aqui nenhuma academia tinha Gateway com remoção remota, por isso nunca tinha aparecido.

**Conferido:** 50 testes novos (205 no Gateway), com oito defeitos plantados de propósito, os oito pegos; e a **corrente real**, dois Gateways compilados ao mesmo tempo com os emuladores novos (`npm run emular:litenet3`, `npm run emular:facial-topdata`, escritos do material dos fabricantes sem importar o Gateway), funções publicadas e banco, numa academia temporária apagada no fim: 43 verificações, do anúncio UDP e do `reg` à aluna cadastrada pela ficha chegando ao leitor, liberada, virando presença e, excluída, saindo do leitor.

**Fora, e por quê:** a bancada — na LiteNet3, o valor exato da mensagem temporária (o pacote só documenta "clear"), se a passagem traz contadores ou a marca do sentido (lemos os dois) e o que a placa faz sem servidor; no facial, o tempo que o leitor espera a resposta, o histórico ao reconectar e a ligação Wiegand da Fit 4 Facial. E o **cadastro do rosto pelo ARKE** (câmera do leitor e foto enviada pelo app, decisões do responsável de 02/10/2026: consentimento único para digital e rosto, e foto pelo app), que depende do texto novo da autorização e é a etapa seguinte.

## Cadastro do rosto: câmera do equipamento e foto pelo app (Gateway 1.3.0, 02/10/2026)

Decisões do responsável de 02/10/2026: **um consentimento só para digital e rosto**, e o rosto entra **pela câmera do equipamento ou por foto enviada pelo próprio aluno no app** — e, pelo app, **uma vez só**: trocar depois é com a academia, "pra não virar bagunça". Migrations `20261310010000_cadastro_rosto.sql` e `20261311010000_rosto_uma_vez_pelo_app.sql`.

- **Duas ordens novas ao Gateway.** `cadastrar_rosto` é botão da ficha (recepção, com o aluno na frente): `remote_enroll` de rosto na Control iD; `adduser`/`checkregstatus` pela API HTTP do leitor Topdata. `enviar_foto_rosto` nasce de `enviar_foto_rosto()`, que **só o próprio aluno chama** — a equipe é recusada, como no consentimento. A foto capturada pela câmera atravessa a memória do Gateway para ser copiada aos outros leitores faciais.
- **A foto do app tem caminho curto e vigiado.** Mora em `fotos_rosto_pendentes`, com RLS ligada e **nenhuma regra**: nem a equipe nem o aluno leem pela API. A ordem guarda só `foto_id`; a foto vai junto **só na entrega**, montada por `catraca-comandos` com a service role. Sai quando nenhuma ordem aberta a usa (`limpar_fotos_rosto_sem_uso()`, chamada na conclusão, na expiração, na revogação e em cada entrega) e em 24 h no máximo. **Sem Storage, de propósito:** o banco apaga uma linha sozinho; um arquivo exige a API do Storage numa função. No Gateway, a foto é conferida (JPEG de verdade, até 300 KB), entregue e zerada; nenhuma foto vai para log, resultado ou nuvem. Na Control iD, `keep_user_image = 0`: o equipamento gera o modelo do rosto e apaga a foto.
- **Uma vez só pelo app** (`aluno_pode_enviar_foto_rosto()`): com ordem de rosto concluída ou a caminho — foto do app ou câmera da academia —, o app deixa de oferecer o envio e o banco recusa, mandando falar com a recepção. Tentativa que falhou ou expirou não conta, para uma foto ruim não trancar o aluno fora. Vale também depois de retirar e dar de novo a autorização.
- **Freios no envio:** cinco tentativas por dia, só aluno em dia (a mesma regra do app), e academia sem leitor facial recebe a frase que explica.
- **O rosto só entra com um texto que fala de rosto.** `aluno_consentiu_rosto()` exige a autorização vigente **e** `versao_consentimento_biometrico() >= versao_consentimento_rosto()` ('2026-10-03'). Hoje a versão vigente é a de 23/09, que só fala de digital: **os dois caminhos estão inertes por construção** até o texto novo ser aprovado e publicado. A ficha mostra o botão desativado com o motivo; o app não mostra o envio de foto (`get_cadastro_rosto()` diz `texto_cobre_rosto`).
- **Ficha e app.** Na ficha, **Cadastrar rosto** só aparece com Gateway que anuncia a capacidade, e a lista de leitores para o rosto vem da telemetria (`rosto: true` em cada equipamento de gestão; na Control iD, `"rosto": true` no config; na Topdata, os leitores com a senha do menu). No app, **Meu rosto na catraca** (`FotoRostoCatraca`): a foto é reduzida no próprio aparelho (`prepararFotoRosto`, 480x640 e até 150 KB), fica só na memória da tela e mostra a situação do último envio.
- **Achado de passagem:** três funções da catraca respondiam **500** a token malformado (a consulta quebrava no banco), dizendo "falha do servidor" a quem só copiou o token errado. Agora 401, como token desconhecido.

**Conferido:** 26 casos de banco com as migrations em transação desfeita e pessoas reais de teste (hoje nada entra; com o texto novo simulado na transação, só a aluna envia; ninguém lê a foto pela API; a foto sai ao concluir, ao retirar a autorização e em 24 h; a segunda foto é recusada a caminho e depois do cadastro, inclusive o feito pela câmera da academia, e liberada depois de uma falha; a sexta tentativa do dia é freada; excluir a academia leva as fotos); 221 testes no Gateway, com oito defeitos plantados de propósito, os oito pegos; e a **corrente real**, 19 verificações com o Gateway compilado, dois leitores Topdata emulados, `catraca-comandos` publicada e o banco: foto da tabela aos dois leitores e fora do banco, câmera de um leitor copiada ao outro, foto já apagada virando erro claro, rosto liberando a aluna e a exclusão apagando-a dos leitores.

**O texto novo destravou o rosto (`20261312010000`, aplicada depois do deploy).** A autorização passou à versão `2026-10-03`, um texto só para digital e rosto, no app e no termo impresso (`src/lib/termoBiometria.ts`): os dois ficam só nos equipamentos, o ARKE guarda só o número, a foto do app passa pela plataforma só para chegar aos equipamentos e sai ao chegar ou em 24 h, e tudo sai dos equipamentos ao retirar a autorização ou deixar a academia. A Política foi para `2026-10-03` (seções 2, 3 e 7) dizendo o mesmo, sem prometer nada sobre o que o equipamento guarda por dentro: só o que a ArkeFit controla. Texto-base aprovado pelo responsável no chat em 02/10/2026. Quem autorizou sob o texto de 23/09 é perguntado de novo, e a digital já cadastrada fica no equipamento até a pessoa confirmar ou retirar. As telas (app e ficha) e os artigos *Sua digital e seu rosto na catraca* e *Digital, rosto e cartão na catraca* acompanharam.

**No site (decisão do responsável, 03/10/2026):** com as duas placas da Toletus e o rosto prontos, a página de vendas passou a anunciar Control iD, Topdata e Toletus, com digital, cartão e, nos modelos com leitor facial, o rosto. O modelo exato é conferido na implantação, como já valia para as outras marcas.

## Gateway 1.4.0: leitor Control iD numa catraca de outra marca (03/10/2026)

Fim da fase 1 do plano das catracas. Os leitores da Control iD (iDAccess, iDFit, iDBox, iDFlex, iDAccess Pro e Nano, iDFace) vão em catraca de outra marca, ligados ao contato de liberação dela, e **cada modelo libera de um jeito** (documentação "Abertura remota de porta e catraca" e "Eventos de identificação online"): a iDBlock gira a borboleta (`catra`, com o sentido), o leitor fecha o relé (`door`) e o iDFlex e o iDAccess Pro e Nano acionam o módulo SecBox (`sec_box`, id 65793). O iDFace não está em nenhuma das listas e usa relé ou SecBox conforme a instalação, por isso o jeito é configuração, e não palpite pelo modelo.

- **Por equipamento, pelo IP.** `controlid_equipamentos` ganhou `liberacao` (`catraca` | `rele` | `secbox`) e `rele` (1 ou 2), e o receptor reconhece quem chamou pelo IP (`resolverComoLiberar`, com o IPv4 dentro de IPv6 tratado). O equipamento fora da lista leva a padrão do config (`controlid_liberacao`, `controlid_sentido_entrada`, `controlid_rele`), que serve à academia com um leitor só e sem gestão remota. A ação mora num lugar só (`acoesDeLiberacao`), para a resposta à identificação e a liberação remota não divergirem; na remota, o SecBox vai com o motivo "comando web" e o relé dá o pulso sem sentido, porque o lado é da montagem da catraca de outra marca.
- **Leitor não espera giro.** Só a catraca da Control iD avisa o giro pelo Monitor; com `confirmacao_giro` em `catra_event`, o leitor ficaria 30 s esperando um aviso que nunca vem. O receptor espera giro só de quem libera como catraca, então uma academia com iDBlock e leitor convive com a mesma configuração.
- **Defeito de passagem: o sentido de entrada não valia na resposta à identificação.** O receptor respondia sempre `allow=clockwise`; `sentido_entrada` só chegava à liberação remota. Uma iDBlock montada com a entrada no sentido anti-horário liberaria o lado errado. Agora vale nos dois.
- O emulador (`npm run emular:controlid`) reconhece a liberação por relé e SecBox e não manda giro para leitor.

**Conferido:** 11 testes novos (cada jeito de liberar, o IP em IPv6, a padrão do config, negado sem ação, só a catraca esperando giro, a liberação remota de cada um, a configuração), 232 no Gateway, com quatro defeitos plantados de propósito, os quatro pegos; e a **corrente real**, 10 verificações com o Gateway compilado, o emulador, as funções publicadas e o banco, numa academia temporária apagada no fim: o leitor liberou pelo relé 2, não esperou giro e a presença nasceu na hora; a aluna pausada foi negada sem ação; e a mesma máquina, listada como iDBlock com entrada anti-horária, liberou nesse sentido e fechou o acesso com o giro confirmado. **Fora, e por quê:** a bancada — o tempo do pulso do relé que a catraca de outra marca aceita e o SecBox de verdade.

## Gateway 1.5.0: Intelbras no Modo Online (03/10/2026)

Fase 3 do plano das catracas. A Intelbras aparece em três concorrentes, e a documentação de integração está em mãos desde 02/10: a coleção de chamadas do portal, o site antigo da API e os exemplos oficiais em github.com/integracaoca. Os terminais da linha Bio-T (faciais SS 3530, SS 3540, SS 5530 e a geração nova SS 3531 a SS 7542; os de digital SS 3430 e SS 5430) chamam o Gateway a cada acesso no **Modo Online**; os SS 1530 e SS 1540, de baixo custo, não têm o Modo Online e ficam fora. `src/conectores/intelbras/`.

- **Quem disca é o terminal**, como na Control iD: `POST /notification` a cada tentativa, com o evento em JSON e a foto da pessoa num `multipart/mixed`, esperando `{ message, code: "200", auth: "true" | "false" }`; e `GET /keepalive` a cada 10 s. Os dois caminhos ficam na mesma porta de escuta da Control iD. O display mostra "Bem-vindo!" ou a negativa curta de sempre (`mensagemDoDisplay`), sem nome e sem falar de dinheiro.
- **A foto de cada acesso é descartada na leitura** (`extrairEventos`): só os cabeçalhos da parte de imagem viram texto, e o corpo dela nunca. Não vai para log, disco nem nuvem.
- **A saída passa sem consulta.** Barrar a saída prenderia lá dentro justamente quem está barrado na entrada.
- **Sem confirmação de giro:** a Intelbras só avisa a passagem com catraca da própria marca ("Modo Catraca", pela RS-485); a presença conta na liberação, como no leitor facial da Topdata.
- **Registro guardado sem o Gateway:** quando o terminal volta, manda junto o que decidiu sozinho. Pedido de agora é um evento só, de até 5 minutos atrás pelo relógio do terminal — e o Gateway acerta esse relógio ao subir e a cada 6 h. O resto é histórico: responde sem acionar nada, e as entradas aceitas viram presença na hora em que aconteceram (`registrarBilheteEquipamento`, o caminho dos bilhetes da Topdata).
- **O Gateway configura o terminal sozinho ao subir** (`intelbras_configurar`): hora, servidor de eventos apontando para o próprio computador (o endereço que alcança cada terminal, descoberto pelo mesmo truque de UDP da LiteNet3, ou `intelbras_endereco`) e Modo Online com keepalive de 10 s, 2 s para ele e 5 s para a decisão. Um passo continua à mão, porque a API não o expõe: **Feedback Personalizado** na interface web do terminal, que é o que faz a mensagem aparecer no display.
- **Comandos pela API CGI, com Digest feito à mão** (`cliente.ts`, sobre o `http` do Node, para o caminho assinado ser exatamente o enviado; conferido contra o exemplo da RFC 2617). 400 e 404 voltam como recusa e não como falha, porque a documentação avisa que alguns modelos respondem 404 a todo cadastro recusado.
- **Sem o Gateway o terminal libera quem está cadastrado nele**, e a documentação não traz opção para travar (é a pergunta mandada à Intelbras). A decisão do responsável de 02/10 foi **desativar no terminal quem a academia barrou** (`UserType` 5, que o terminal recusa sozinho) e reativar quem volta. **Corrigido em 05/10/2026, na 1.8.1:** o 5 é usuário de acessibilidade; o bloqueado é o 1 (ver *Gateway 1.8.1*). O espelho roda a cada sincronização do cache (`aoSincronizar`), manda só o que mudou, em lotes de 20, e cai para um por vez quando o lote é recusado por ter um aluno que não está naquele terminal; esse aluno conta como espelhado, e entra com a situação certa quando for cadastrado pela ficha. Terminal fora do ar tenta de novo na próxima rodada. **Com o Gateway no ar, a decisão continua sendo da nuvem**; o espelho é para o computador desligado.
- **Gestão pela ficha:** cadastrar o aluno em todos os terminais já com a situação dele, apagar o rosto e o aluno (nessa ordem, porque a documentação não diz se apagar o usuário leva o rosto), abrir a porta no relé configurado (`canal`) e entregar a foto do rosto do app. Ficam no próprio terminal: a digital (a captura remota só existe no SS 3430), o cartão (a API não captura cartão) e o rosto pela câmera do terminal (existe na API, pelo `captureCmd` com o `snapManager`, e entra depois da bancada).
- **A foto do app passou a sair com até 100 KB e, deitada, em 600x450**, que é o que a Intelbras aceita (JPEG até 100 KB, de 150x300 a 600x1200); cabe também na recomendação da Topdata e na Control iD.
- O emulador (`npm run emular:intelbras`) faz o papel do terminal, escrito da documentação sem importar o Gateway: a API CGI com Digest e o Modo Online depois que o Gateway o configura.

**Conferido:** 24 testes novos (o multipart com CRLF e LF e a foto fora do evento, o cartão sem usuário, o pedido de agora e o histórico, a resposta sem nome nem motivo, o exemplo da RFC 2617, o receptor com saída livre e histórico virando presença, a configuração do terminal, senha errada, troca de nonce, cadastro já com a situação, apagar o rosto antes do aluno, porta, foto acima de 100 KB recusada antes de chamar o terminal, e o espelho mandando só o que mudou, ignorando quem não está no terminal e tentando de novo depois de queda), 256 no Gateway, com sete defeitos plantados de propósito, os sete pegos; e a **corrente real**, 23 verificações com o Gateway compilado, o emulador, as funções publicadas e o banco, numa academia temporária apagada no fim: o terminal configurado e no Modo Online, a ficha vendo o terminal como leitor facial, o cadastro já desativado de quem está pausado, rosto liberado, pausada negada sem o motivo no display, cartão pelo número lido, saída livre e fora do registro, presença na liberação, histórico com a hora em que aconteceu, a reativação ao voltar a em dia, a foto do app chegando ao terminal e saindo do banco, a porta aberta pela recepção e a exclusão apagando rosto e aluno do terminal. **Fora, e por quê:** a bancada e a resposta da Intelbras — se o terminal sem o Gateway respeita o usuário desativado, o tempo real de resposta, o relé ligado à catraca, o formato do número do cartão em cada leitor e se a foto de cada acesso pode ser desligada no Modo Online. **No site, a Intelbras ainda não é anunciada** (ver workspace). **Superado em 05/10/2026:** a Intelbras respondeu que o terminal barra o usuário bloqueado e o fora da validade mesmo sem o Gateway, e o responsável decidiu anunciá-la no site, como as outras marcas, com o modelo conferido na implantação.

## Gateway 1.6.0: a digital da Toletus pela ficha (03/10/2026)

As catracas Toletus LiteNet2 com digital têm o leitor **CAMA-SM25**, e a placa o expõe na porta **7879** do mesmo IP. O protocolo é o do manual do fabricante do leitor, que a Toletus publica junto do pacote dela (`github.com/Toletus/sm25biometricreader-package`). Com `"leitor_digital": true` na placa (`toletus_leitor_digital` com uma placa só), a ficha do aluno cadastra a digital como na Control iD. Migration `20261314010000_toletus_digital.sql`.

- **Só bytes, sem rede** em `src/conectores/toletus/sm25/protocolo.ts`, conferidos contra os exemplos do manual. A sessão (`leitor.ts`) abre uma conexão por operação e fecha no fim, como o Toletus Hub faz: a placa usa o mesmo leitor para reconhecer quem chega.
- **Cadastro:** três toques do mesmo dedo, com o display da catraca acompanhando ("Ponha o dedo 1/3", "Digital salva"). Leitura ruim não encerra. Sem dedo por 90 s, o Gateway cancela o cadastro **no leitor** (FP Cancel); sem isso, ele ficaria esperando um dedo e a catraca sem reconhecer ninguém. O tempo de cada toque vai a 60 s, o valor que o software da Toletus grava.
- **Recadastro devolve a anterior.** O leitor só cadastra em número vazio. A digital anterior é lida antes, e volta ao leitor se a nova não sair: um recadastro que falha não deixa o aluno sem entrar.
- **Cópia entre catracas:** o registro de 498 bytes atravessa só a memória do Gateway e é zerado. Cópia que falha volta em `falhou_em`, sem desfazer o cadastro.
- **Durante o cadastro, a digital reconhecida pela placa daquela catraca é ignorada:** se a placa reconhecer o dedo de quem está cadastrando e o ARKE liberar, a catraca abriria no meio do cadastro e contaria uma presença que ninguém fez. Cartão e teclado seguem valendo.
- **Remoção:** retirar a autorização, excluir, anonimizar ou trocar o número do aluno apaga a digital em todos os leitores. Número vazio conta como apagado.

**Um número só por aluno, e dois defeitos que isso escondia.** Na Toletus e na Intelbras o número do cartão vira o `identificador_catraca`, vinculado à mão. Fazer a digital funcionar de verdade numa academia que mistura cartão e digital revelou:

1. **O número que a nuvem dá explodia.** Era o maior número da academia mais um, então um cartão de dez dígitos vinculado fazia todo aluno novo nascer com dez dígitos, que o leitor (2 bytes, 3.000 digitais) não guarda. Hoje vem de um **contador por academia** (`organizacao_numeracao_catraca`, RLS sem regra, só `proximo_identificador_catraca` mexe). Ele só sobe, pula número já usado, e **todo número pequeno gravado no aluno, por qualquer caminho, o empurra**. O teste pegou um caso: um número digitado à mão e depois trocado voltava a ser dado a outro aluno, e a digital antiga, num equipamento sem remoção remota, abriria a catraca para ele.
2. **Trocar o número deixava a digital antiga no equipamento.** `trg_numero_catraca_alterado` agenda a remoção do número antigo (ou a tarefa, sem gestão remota). Limpar o número não passa por ele: a retirada da autorização e a anonimização já agendam.

**E o teclado aceitava o número de qualquer um.** Na Toletus e na Topdata, número que não fosse CPF digitado no teclado valia como o número do aluno no equipamento — curto e sequencial, e a catraca não tem senha para conferir: digitar "12" era entrar como o aluno 12. No teclado vale só o CPF; o resto é negado com "Digite o CPF", sem ir à nuvem. Nenhuma academia estava no ar.

**E a ficha escondia o campo do cartão.** Com cadastro remoto anunciado, o campo manual sumia, e era por ele que a recepção vinculava o cartão da Intelbras (desde a 1.5) e da Toletus. Hoje o campo **Cartão** fica no bloco do Gateway quando ele não cadastra cartão, avisando que o número substitui o anterior. De passagem, o botão de vincular lia o campo pelo fechamento, o padrão que já mandou formulário velho; passou a receber o valor no `mutate`.

**Conferido:** 16 testes novos (272 no Gateway), com nove defeitos plantados, os nove pegos; 13 casos da migration em transação desfeita; e a **corrente real**, com o Gateway compilado, duas placas emuladas com leitor (`npm run emular:toletus -- --leitor`, escrito do manual do fabricante sem importar o Gateway), as funções publicadas e o banco: 23 verificações, do número reservado e da digital copiada à digital repetida recusada, ao cancelamento por prazo, e à remoção nos dois leitores pela troca do número e pela retirada da autorização.

**Fora, e por quê:** a bancada — se a placa deixa o leitor livre para o cadastro com o Gateway conectado na 7879, se reconhece o dedo durante o cadastro, a capacidade do leitor montado e o tempo real de cada toque. Cartão e digital no mesmo aluno, nas marcas em que o cartão é o número, pedem uma segunda coluna e a busca pelas duas; fica para quando uma academia precisar.

## Gateway 1.7.0: token só como hash e só os equipamentos falam com o receptor (04/10/2026)

A conferência de 04/10/2026 achou três defeitos na fronteira entre a catraca e o resto. Nenhuma academia tinha catraca cadastrada.

**O token do Gateway morava em claro, e toda a equipe o lia.** `organizacao_catracas.device_token` aparecia na tela, e uma regra `FOR ALL` dava leitura, alteração e exclusão a toda a equipe, professor e nutricionista incluídos. Quem tem o token faz tudo o que o Gateway faz:
- consulta quem entra;
- sobe acessos, que viram presença;
- recebe as ordens daquela catraca, inclusive a foto do rosto enviada pelo aluno.

Agora (`20261325010000_token_catraca_hash.sql`):
- **O banco guarda só o SHA-256** (`device_token_hash`). As cinco funções da catraca conferem o hash do token recebido por `_shared/tokenCatraca.ts`, com a mesma conta de `hash_token_catraca()` no banco.
- **O token nasce em `criar_catraca()` e é trocado em `girar_token_catraca()`.** As duas são só da gestão e da ArkeFit (`gere_catracas()`, que pergunta só sobre quem chama; a ArkeFit, com as duas etapas). Cada uma devolve o token **uma vez**, e a tela o mostra numa janela com "Copiar". A troca vai para a Auditoria.
- **A ação de suporte da Visão Master passou a invalidar** os tokens da academia, em vez de gerar outros que ninguém veria. A gestão gera os novos em Catracas.
- **Uma regra por operação.** A equipe lê, porque a recepção opera a tela. A gestão e a ArkeFit alteram e excluem. Ninguém inclui pela API. Pela API mudam só nome, localização, status e o atraso de liberação, por privilégio de coluna: o hash muda só pela função, que audita.
- **O Gateway não muda:** o token continua sendo um UUID no `config.json`.
- **A coluna antiga sai depois do deploy**, em `20261326010000`.

**O receptor atendia qualquer aparelho da rede.** A rede das catracas pode ser a mesma do Wi-Fi dos alunos. Sabendo a rota, qualquer aparelho:
- pedia decisão por número de aluno, e o acesso virava presença de quem não veio;
- fechava o giro de outro acesso pelo aviso do Monitor;
- mandava acesso "histórico" da Intelbras, que vira presença na hora que ele diz.

Agora (`src/server/origemEquipamento.ts`) o receptor atende só os IPs de `controlid_equipamentos`, `intelbras_equipamentos` e da lista nova `equipamentos_permitidos` (a Control iD única, sem gestão remota), além da própria máquina, que roda o emulador na instalação. Os outros levam 403, registrado no log uma vez a cada 10 minutos por IP. A sonda `/health` segue aberta para o técnico, e as rotas da ponte Topdata seguem com a regra delas. **Sem lista nenhuma, o receptor continua aberto**, como até a 1.6, e o Gateway avisa no log ao subir: recusar ali pararia a catraca de quem atualizou sem mexer no config.

**O display da Control iD mostrava o nome do aluno.** A decisão da versão 1.0 é que o display mostra "Aluno". O cadastro no equipamento seguia a decisão, mas a resposta à identificação mandava o nome, inclusive ao lado de "acesso negado": a fila sabia quem estava barrado. Agora a resposta manda "Aluno", e o motivo fica nos Últimos acessos.

`tokenCatraca.guarda.test.ts` trava as regras do token: nenhuma função procura a catraca pelo token em claro, toda função que recebe o token confere o hash, e a tela não lê nem grava o token.

**Conferido:**
- 18 casos da migration em transação desfeita: gestor, professor, recepção, gestor de outra academia, Super Admin com e sem as duas etapas, e anônimo.
- A **corrente real**, com 14 verificações pelas funções publicadas, com sessões de verdade numa academia temporária apagada no fim:
  - o token volta uma vez e não sai em leitura nenhuma;
  - professor e recepção são recusados, e ninguém inclui direto;
  - as cinco funções aceitam o token, em maiúsculas também;
  - token inventado e token torto levam 401;
  - depois da troca, o antigo leva 401 e o novo vale, e a troca fica na Auditoria.
- 280 testes no Gateway, 8 deles novos, com três defeitos plantados (o filtro desligado, a própria máquina recusada, o nome de volta no display), os três pegos.

## Gateway 1.8.0: espera com variação e versão mínima (05/10/2026)

Rodada B.

- **A espera entre tentativas ganhou variação.** Quando a nuvem cai, todos os Gateways falham juntos. A espera que só dobrava os faria voltar juntos, no mesmo segundo, a cada rodada, e a nuvem que acabou de voltar receberia todos de uma vez. Agora `comVariacao` (`src/core/espera.ts`) usa metade fixa e metade sorteada: a parte sorteada espalha as tentativas, e a parte fixa mantém o mínimo. Vale para o canal de comandos e para a reconexão da placa Toletus. `espera.guarda.test.ts` falha em espera que dobra sem `comVariacao`.
- **Versão mínima do Gateway** (`plataforma_textos.gateway_versao_minima`, migration `20261330010000`). Começa em 1.7.0, a versão do token só como hash e do receptor só para os equipamentos. **Nada é bloqueado**: parar a catraca de uma academia por versão seria pior que a versão velha. Onde ela aparece:
  - o canal de comandos devolve a mínima, e o Gateway abaixo dela avisa no log uma vez;
  - **Visão Master → Equipamentos** conta as catracas desatualizadas e marca cada uma;
  - a saúde do Gateway diz à academia que é preciso atualizar.

  A mínima se muda em **Configurações**, e o banco recusa texto fora do formato `1.7.0`. O Gateway sem versão é o anterior à 1.0, abaixo de qualquer mínima. `versaoAbaixoDaMinima`, no app, é espelho de `versaoAbaixo`, do Gateway, e o teste compara as duas.

**Conferido:**
- 288 testes no Gateway, com três defeitos plantados, os três pegos: a reconexão sem variação, a versão comparada como texto (1.10 abaixo de 1.9) e o aviso repetido a cada troca.
- Os testes do espelho no app.
- 3 casos da regra de formato em transação desfeita.
- A **corrente real**, com 6 verificações pela função publicada, numa academia temporária apagada no fim:
  - a versão mínima volta ao Gateway, inclusive com a catraca desativada;
  - a telemetria grava 1.6.0 e depois 1.8.0;
  - nenhuma catraca ficou órfã.

## Gateway 1.8.1: a Intelbras respondeu, e o aluno barrado é bloqueado (05/10/2026)

A Intelbras respondeu às duas perguntas mandadas na 1.5.0.

- **O tipo estava errado.** O espelho gravava `UserType` 5 em quem a academia barrou, pensando que fosse "desativado". O 5 é **usuário de acessibilidade**. Com o computador do Gateway desligado, um aluno pausado ou inadimplente viraria usuário de acessibilidade no terminal e poderia entrar. O bloqueado é o **1**, e a Intelbras confirmou que **usuário bloqueado ou fora da validade não entra, também sem o servidor**. Nenhuma academia usava Intelbras, então ninguém foi afetado. O tipo agora é uma constante com nome (`USUARIO_BLOQUEADO`), e o 5 ficou declarado como `USUARIO_ACESSIBILIDADE`, com o aviso de não usar. O teste confere que o barrado vai com 1 e nunca com 5. O emulador mostra os três tipos pelo nome.
- **A versão mínima subiu para 1.8.1** (migration `20261331010000`), para a Visão Master marcar qualquer Gateway com o espelho antigo.
- **O Modo Online 2.0 fica fora, por desenho.** Na linha mais nova, a Intelbras oferece o "Modo Online 2.0" com detecção facial, em que o servidor recebe o rosto e decide. O ARKE não compara biometria fora do equipamento: o rosto fica no terminal, e o que atravessa a rede é o número do aluno.

**Conferido:**
- 288 testes no Gateway. O tipo antigo plantado de volta derrubou 4.
- O artigo técnico da Central de Ajuda e o manual do Gateway corrigidos.

**Continua para a bancada:** se o terminal no Modo Online consulta o Gateway também para o usuário bloqueado, ou se o recusa antes. No segundo caso, quem volta a ficar em dia espera a sincronização seguinte (até 5 minutos) para passar.

## Gateway 1.9.0: a auditoria de prontidão nas catracas (06/10/2026)

A auditoria de prontidão conferiu a catraca antes da primeira instalação e achou cinco defeitos (achados A6 a A10). Nenhuma academia tinha catraca instalada. Migrations `20261345010000` a `20261347010000`; funções `catraca-validar-acesso`, `catraca-sincronizar-logs-offline` e `catraca-sincronizar-alunos`; Gateway e ponte da Topdata na 1.9.0.

**O display da Topdata Inner mostrava o primeiro nome do aluno e o motivo financeiro.** A regra é antiga ("Bem-vindo!" ou "Aluno", e a negativa não fala de dinheiro), e as outras marcas a seguiam. Na Topdata, a nuvem mandava o nome, o receptor o repassava e a ponte escrevia o primeiro nome no display, com "Mensalidade da academia em atraso" na linha de baixo: a fila sabia quem estava barrado e por quê. Agora:
- a nuvem não manda o nome, e pausado, inadimplente e matrícula encerrada respondem "Procure a recepção." (assim, mesmo o Gateway antigo deixa de escrever o motivo financeiro);
- a frase do display é uma só para todas as marcas (`mensagemDoDisplay`, que saiu da Toletus para `core/display.ts`), e o receptor da Topdata manda só ela;
- a ponte não tem mais onde guardar o nome (`Decisao` sem o campo, e ela não lê `nome` de Gateway antigo): liberado mostra "Bem-vindo!" e o sentido; negado, "ACESSO NEGADO" e a frase curta;
- o Gateway não carrega o nome para lugar nenhum, nem no cache: o texto do cache para o barrado ("Assinatura em atraso") também ia ao display da Topdata, e o registro passou a sair de um resultado explícito, e não da leitura do texto.

**O defeito do caminho:** os testes da ponte cobravam o comportamento errado ("display com o primeiro nome", "nome sem acento no display"). Passaram a cobrar o certo, e um teste novo percorre os desfechos conferindo que nenhuma chamada ao display leva nome ou dinheiro.

**Código de barras e QR viravam o número do aluno.** O número do aluno no equipamento é pequeno e sequencial (o contador por academia da digital e do rosto). Na Toletus (LiteNet2 e LiteNet3) e na Topdata (QR na origem 21, e os leitores 1 e 2 quando o leitor é de código), o texto lido virava esse número, e um código impresso com um número baixo passava como aluno. **Nenhum fluxo do produto usa código na catraca:** o QR do ARKE é o do check-in da recepção (`AdminCheckinQr`), que muda a cada 10 minutos e é lido pelo celular do aluno, sem passar pela catraca; a Control iD já negava QR desde a 1.0. **A escolha foi recusar a origem**, com "Acesso negado" e sem ir à nuvem, como o teclado sem CPF, em vez de criar um código aleatório por aluno: este seria uma credencial nova para emitir, imprimir e revogar, sem ninguém pedindo. Se uma academia precisar, entra como código aleatório por aluno, nunca o número do equipamento. A regra mora em `core/credencial.ts`, para todas as marcas que mandam o valor lido. Na Topdata a origem não diz se o leitor é de cartão ou de código, então a ponte passou a mandar o `tipo_leitor` do config: 0, 5 e 7 são código. No 7 (código e proximidade no mesmo leitor) os dois chegam iguais, e vale a regra mais segura; para cartão, leitor de proximidade. Ponte antiga não manda o tipo e conta como cartão, que era o comportamento de antes: **ponte e Gateway sobem juntos**. Origem que o manual não lista para leitura passou a ser negada.

**Um acesso offline com problema travava a fila daquela catraca.** A função gravava o lote numa instrução só, sem conferir nada: o aluno excluído durante a queda (chave estrangeira), um `cpf_consultado` que não fosse texto, uma data torta, e o lote inteiro falhava. O Gateway só tira da fila o que a nuvem aceita, e reenviava os mesmos 500 a cada 30 s, para sempre. E um `aluno_id` de outra academia era aceito e virava presença com a academia da catraca. Agora cada registro é conferido (`fluxo.ts`, testado pelo app): aluno da academia da catraca, resultado conhecido, credencial em texto, data entre 30 dias atrás e 10 minutos à frente. Os válidos são gravados, e a resposta diz, pelo `id_local` que o Gateway 1.9 manda, o que foi aceito e o que foi recusado de vez; os dois saem da fila, e o que a resposta não citar fica para a próxima. Se o banco recusar uma linha que passou na conferência, a gravação vai linha a linha e a recusada sai. Nuvem antiga responde sem as listas, e o Gateway faz como antes.

**Outro defeito do caminho:** a função apagava tudo o que não fosse dígito da credencial, inclusive o `id:` do número do equipamento, e o acesso por cartão ou digital decidido offline aparecia na Visão Master como acesso por CPF. O `id:` agora fica.

**O computador da recepção guardava demais.** A fila só marcava o que tinha subido e nunca apagava (CPF consultado, aluno e horário), e o cache guardava nome e CPF de todos os alunos, inclusive de quem tinha saído. Agora o que subiu sai depois de 30 dias; o cache não guarda o nome e só tem os alunos atuais (a nuvem tira quem teve a matrícula encerrada, além do excluído e do anonimizado). **E apagar não apagava:** o NeDB só acrescenta linhas, e a linha removida continua no arquivo até ele ser reescrito, o que ele só faz ao abrir. Num computador que ninguém reinicia, o CPF de quem saiu ficaria no disco por semanas. Toda remoção agora reescreve o arquivo (`compactarArquivo`), e os testes leem o arquivo do disco.

**O fim da matrícula não apagava a digital, e o ex-aluno continuava entrando** (`20261345010000`). A Política promete que, quando a matrícula termina, a digital e o rosto saem dos equipamentos e o número sai da plataforma; a remoção só nascia da retirada da autorização, da exclusão, da anonimização, da troca do número e do término da academia, e a catraca olhava só a situação. Agora:
- `matricula_encerrada()`: teve matrícula e não tem mais nenhuma ativa ou pausada. **Quem nunca teve matrícula não conta** (há alunos sem linha nenhuma, de academia que cobra por fora do ARKE);
- a catraca barra com `negado_matricula_encerrada` (antes da situação: para quem saiu, "inadimplente" diria à recepção a coisa errada), e o aluno sai do cadastro do Gateway e do hash, inclusive pela diferença, que passou a olhar a data da matrícula;
- quando a última matrícula viva vira `cancelada`, um gatilho agenda a remoção nos equipamentos, tira o número do aluno e expira as ordens de cadastro e a foto do rosto ainda em aberto (sem isso, um cadastro entregue antes do cancelamento devolveria o número ao aluno).

O pausado continua saindo pela situação, regra que não mudou. **A ordem importa:** `catraca-validar-acesso` é publicada antes da migration, porque a versão anterior só reconhece pausado e inadimplente e responderia "liberado" ao resultado novo. **Troca de plano é cancelar e matricular de novo**, então a digital sai e a recepção cadastra outra vez; a janela de cancelamento e a Central de Ajuda avisam. **Não é retroativo:** quem já tinha a matrícula cancelada passa a ser barrado, mas a remoção nasce só de um cancelamento daqui em diante. E o encerramento da academia, que cancela as matrículas antes do término, passa a ter as remoções agendadas por este gatilho: o número `remocoes_agendadas` do término conta só as que sobraram.

**A digital cadastrada direto no equipamento escapava da autorização** (`20261346010000`). Sem gestão remota, a recepção cadastra no equipamento e vincula o número na ficha, e o vínculo ia direto para o aluno, sem conferir nada. Agora ele passa por `vincular_numero_catraca()`, que pergunta o que o número identifica: **digital ou rosto exigem a autorização do aluno registrada** (app ou termo impresso anexado), e sem ela o banco recusa com a explicação; cartão segue sem depender disso, como foi decidido em 23/09 ("cartão e senha não dependem disso"), porque o cartão na Toletus e na Intelbras é vinculado por esse mesmo caminho. A declaração de quem vincula é o limite do que o ARKE sabe sobre um equipamento que ele não gerencia; por isso a outra metade: **a tarefa de apagar nasce sempre** que um número sai e alguma catraca da academia não apaga sozinha, ou quando a academia não tem catraca cadastrada. Antes, sem gestão remota, ela só nascia se houvesse consentimento registrado — exatamente o que faltava aqui — e a academia sem catraca cadastrada não ganhava nem a tarefa, enquanto a ficha dizia "Abrimos uma tarefa". A ficha agora conta as ordens e as tarefas que o banco de fato agendou e diz só isso (`mensagemDaRemocao`). A gravação direta do número pela API passou a ser recusada (`trg_numero_catraca_so_pela_ficha`): sem isso, a conferência seria só da tela.

`catracaPublica.guarda.test.ts` trava o display (a nuvem sem nome nem motivo financeiro, o Gateway sem nome em resposta nenhuma, a ponte sem campo de nome) e a regra da leitura num lugar só. A versão mínima do Gateway vai a 1.9.0 (`20261347010000`), para aplicar depois de o instalador estar publicado.

**Conferido:**
- Gateway: 307 testes (19 novos), com seis defeitos plantados, os seis pegos: a negativa da Topdata com o texto da nuvem, o código de barras aceito, o registro recusado que não sai da fila, o nome no cache, o cache e a fila sem reescrever o arquivo.
- Ponte: 26 testes (2 novos, 2 reescritos para cobrar o certo); o nome plantado de volta no display e o tipo de leitor não enviado derrubaram 4.
- App: 901 testes, 19 deles novos (`logsOfflineCatraca`, `remocaoCatraca`, `catracaPublica.guarda`); a guarda pegou o motivo financeiro plantado de volta na nuvem. `npm run check` verde, com as 53 funções no `deno check`.
- Migrations: 16 casos em transação desfeita num Postgres local (PGlite), sobre um esqueleto só com as tabelas e funções que elas tocam, copiadas das migrations — **não é o banco de produção** —, e cinco defeitos plantados (o ex-aluno de volta ao cadastro, a tarefa presa ao consentimento, o vínculo sem conferir a autorização, a trava só para o anônimo, a catraca sem barrar o ex-aluno), os cinco pegos.

**Fica para depois de aplicar:** a mesma prova no banco de produção, em transação desfeita; a corrente real (funções publicadas, Gateway compilado e emuladores, numa academia temporária apagada no fim); e a bancada da Topdata (display e leitor de código, itens 10 e 11 do roteiro em `docs/PONTE_TOPDATA.md`).

## Troca de plano sem apagar a digital (06/10/2026)

Decisão do responsável no workspace, com a recomendação: a remoção da digital no fim da matrícula espera 48 horas e é cancelada se uma matrícula nova entrar nesse prazo (migration `20261353010000`). Trocar de plano é cancelar a matrícula e criar outra, e a migration `20261345` apagava a digital no cancelamento: a recepção cadastraria de novo a cada troca.

- **O que continua na hora:**
  - a catraca barra desde o cancelamento (`matricula_encerrada`);
  - o aluno sai do cadastro do Gateway;
  - as ordens de cadastro em aberto e a foto do rosto pendente saem.
- **O que espera:** a remoção física e o número. O cancelamento só põe uma linha em `remocoes_fim_de_matricula`, para daqui a 48 horas.
- **Matrícula nova** (ativa ou pausada) cancela a remoção pendente.
- **A rotina `arke-remocoes-fim-de-matricula`,** de hora em hora, confere o aluno antes de apagar. Se ele voltou a ter matrícula, foi anonimizado (a anonimização já agenda a remoção dela) ou trocou de número, a remoção da fila não vale mais.
- A rotina entrou também no roteiro de reconstrução do banco. A tela de cancelamento e a Central de Ajuda passaram a dizer o prazo.

**Conferido em transação desfeita:**
- **Troca de plano:** no prazo, o número ficou e a catraca barrou; com a matrícula de volta, a remoção foi cancelada e a catraca liberou.
- **Saída de verdade:** depois de 48 horas, a rotina removeu, tirou o número e abriu a tarefa.
- **Anonimizado no prazo:** uma remoção só, e a da fila foi cancelada.

## Aviso de catraca parada por destinatário e check-in de parceiro que abre a catraca (06/10/2026)

Dois achados médios da auditoria de prontidão de 05/10, sem mudança no Gateway.

**"Já avisei" por destinatário** (`20261372010000`). O aviso de catraca parada vai ao gestor de cada academia e à ArkeFit, mas o registro era um só por catraca, gravado pelo envio da ArkeFit:
- o e-mail do gestor falhava e ele ficava como avisado, até o lembrete de 24 horas;
- o da ArkeFit falhava e nada era marcado, e os gestores recebiam o mesmo e-mail a cada 2 minutos.

Agora `alertas_catracas` tem uma linha por catraca e destinatário (`arkefit` ou `gestor`). `catracas_a_avisar()` avalia cada um contra o próprio registro, e `registrar_aviso_catracas()` marca só o destinatário cujo e-mail saiu. Cada aviso traz uma `referencia` (a catraca, a situação e o último "já avisei" ou o início da queda), e a chave de idempotência do e-mail sai dela: se o registro falhar depois do envio, a passada seguinte manda com a mesma chave e o Resend não entrega de novo. O lembrete de 24 horas tem outra referência e sai. Na migração, o que já tinha sido avisado foi copiado para o gestor, para ninguém receber de uma vez o aviso de catraca já avisada. As funções antigas ficam, olhando só a ArkeFit e marcando as duas, para a edge function publicada seguir igual até a nova entrar; saem numa migration depois do deploy.

**O check-in de parceiro abre a catraca** (`20261373010000`). A tela dizia "Catraca liberada!", e `catraca-checkin-parceiro-externo` só gravava o registro; nenhuma ordem saía para o Gateway. A regra passou para `checkin_parceiro_externo()`, chamada com a sessão de quem confirma:
1. confere a equipe da academia (ou a ArkeFit), a catraca ativa e o parceiro habilitado, e registra o check-in, que é o que conta na conferência com o repasse;
2. se o Gateway declarou `liberar_catraca`, está com sinal e quem pede é da gestão ou da recepção (a regra da liberação remota), manda a ordem pelo mesmo canal (`gateway_comandos`), com Auditoria;
3. senão, responde o que fazer: liberar pelo botão da recepção ou no equipamento.

Como grava no registro de acessos e na fila do Gateway por cima do RLS, a função exige a sessão verificada de quem tem o aplicativo autenticador (`sessao_cumpre_duas_etapas`, a regra "duas etapas" de `20261363010000`).

A tela acompanha a ordem (`useComandoGateway().acompanhar`) e só diz que liberou quando o Gateway confirma; ordem que expira ou falha vira o mesmo aviso de liberar à mão. A ordem concluída de um check-in não grava um segundo acesso "liberado pela recepção", porque o check-in já está registrado (`concluir_comando_gateway`). Nos últimos acessos, o rótulo passou de "Liberado (parceiro)" para "Check-in (parceiro)", que é o que o registro prova.

**Conferido:** os testes do aviso (`alertaCatracas`, 3 novos) e do check-in (`checkinParceiro`, 6). Defeito plantado: o envio do aviso sem a chave de idempotência derrubou `alertaCatracas`; o "Catraca liberada!" de volta na tela derrubou `checkinParceiro`. No banco de produção, em transação desfeita:
- o "já avisei" antigo virou dois (ArkeFit e gestor), e o gestor que recuperou não apagou o da ArkeFit;
- o check-in da gestora numa catraca sem ordem remota volta `manual`, e numa com o Gateway no ar volta `enviada`;
- o do professor volta `manual` mesmo com o Gateway no ar, porque abrir é da recepção ou da gestão;
- com o Gateway sem sinal há 10 minutos, volta `manual`;
- a ordem concluída não grava um segundo acesso (`liberado_remoto`);
- a gestora com aplicativo autenticador e a sessão só de senha é recusada (42501).

**Pela corrente real** (`catraca-checkin-parceiro-externo` publicada, academia e conta temporárias, apagadas no fim):
- a catraca sem ordem remota registra e responde `manual`;
- com o Gateway no ar, responde `enviada`, e a ordem `liberar_catraca` entra na fila com o parceiro;
- os dois check-ins ficam registrados;
- o parceiro não habilitado não registra nada.

**Falta** a ponta do Gateway com uma catraca de verdade, que entra com a primeira catraca na bancada.
