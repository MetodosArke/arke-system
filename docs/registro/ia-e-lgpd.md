# IA e LGPD

O Sentinela, o consentimento de IA, os documentos legais, a IA no Brasil, a dieta por PDF e o aluno menor de idade.

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

## Importação de dieta por PDF, de volta e no Brasil (25/09/2026)

Decisão do responsável: **a importação tem de existir, porque a maioria das nutricionistas monta a dieta em PDF**. Ela tinha saído na Fase 1 por mandar o arquivo ao Google Gemini, fora do Brasil e da Política. Voltou pela mesma porta do Sentinela, o Amazon Bedrock em São Paulo (`_shared/ia.ts`), com a tela antiga restaurada em `AdminDietas` (modelo na biblioteca, ou publicação direto no aluno).

- **O arquivo não sai do aparelho.** `src/lib/textoDoPdf.ts` extrai o texto com o pdf.js (build "legacy", carregado só nessa hora) e só o texto vai para `importar-dieta-pdf`. A função tira as linhas de identificação que reconhece (`Paciente:`, `Nome:`, CPF, e-mail, telefone), chama o modelo com temperatura zero e não grava nada: quem salva é a tela, depois da revisão.
- **O modelo inventa, então tudo volta conferido.** Testado antes de construir: com um PDF escaneado, sem texto, o Claude 3 Haiku devolveu uma dieta inteira que não existia no documento. Por isso `fluxo.ts` recusa texto insuficiente antes de chamar o modelo, e `conferirNoOriginal` exige que cada alimento, cada número de quantidade e cada substituição apareçam no texto original. O item que não bate chega marcado "confira"; se passar de 30% dos itens, a leitura inteira é descartada. Na publicação direto no aluno, que vira versão travada, o botão só libera com a confirmação de que os itens marcados foram conferidos. `importarDietaPdf.test.ts` usa a dieta inventada de verdade como caso de recusa.
- **Número colado na unidade descartava a leitura inteira (achado em 28/09/2026).** O plano de teste escrevia "150g de frango" e "arroz integral 100g"; o modelo copiou igual, mas a conferência procurava o "150" e só achava o "150g", marcava os dois itens como inventados, e 2 de 5 passava do limite de 30%. `normalizar` agora separa número de unidade dos dois lados, e passou a usar NFKD para "½" bater com "1/2"; a dieta inventada continua recusada. Pelo caminho, a instrução do modelo passou a pedir o nome completo com o preparo ("frango grelhado", e não "frango") e a quantidade separada, com exemplos: sem isso ele encurtava o nome, e com a instrução sem exemplo punha a quantidade dentro do nome.
- **A falha no aparelho deixou de ser muda.** A tela respondia "protegido por senha ou corrompido" para qualquer erro da leitura no navegador, e o motivo real se perdia; no celular, a importação falhou sem chegar ao servidor e não havia como saber por quê. `motivoDaFalhaDoPdf` (`src/lib/falhaDoPdf.ts`, fora do módulo baixado na hora, que é o que pode ter sumido) separa aba aberta desde antes de uma publicação, senha, arquivo inválido e o resto, e o que não é do PDF vai para o Sentry com o nome do erro. A leitura foi conferida no motor do Safari de iPhone, no Chrome de Android e no computador.
- **PDF escaneado não é lido**, e a tela diz o porquê e o que fazer (exportar o PDF do programa de dietas, ou digitar). Ler imagem exigiria mandar a página como foto ao modelo e perderia a conferência contra o texto. **Decisão do responsável (25/09/2026): ler escaneado só entra se houver pedido real** de nutricionista; até lá ficam a importação do PDF com texto e a entrada manual.
- **Conferido pela função publicada:** aluno com 403 e sem sessão com 401; o PDF comum virou 5 refeições e 14 itens, sem nada para conferir; um PDF de 2 páginas em tabela, no formato dos programas de nutrição, virou 6 refeições e 17 itens com substituições, horários e orientações; o escaneado e um documento que não é dieta foram recusados.
- **A Política acompanhou (versão 2026-09-25):** a leitura é transcrição e não análise sobre o aluno, sai sem as linhas de identificação, é processada no Brasil, o conteúdo não fica registrado na conta do provedor, e a base legal é a do acompanhamento (consentimento para dados de saúde). Na mesma versão entrou o contato pelo site, com guarda de 12 meses sem andamento, cumprida pela rotina `arke-retencao-contatos-site` (`limpar_leads_site_antigos()`, que mantém o contato fechado), criada antes da Política para a promessa já nascer verdadeira. O responsável aprovou o texto como estava, em 25/09/2026; tirar a marca de minuta não muda o hash, então ninguém precisa aceitar de novo.

## Aluno menor de idade: a data de nascimento e o aceite do responsável (06/10/2026)

Achado da auditoria de prontidão. A Política de Privacidade (art. 14) e os Termos de Uso prometiam o consentimento de ao menos um dos pais ou do responsável para o aluno menor, e o sistema não tinha nada disso: nenhuma regra de idade, a data de nascimento não era pedida em matrícula nenhuma (nenhum aluno no banco tem a data), e o próprio menor dava o consentimento de saúde, o de biometria e o de IA. **Decisão do responsável:** "Pedir a data de nascimento. O menor se matricula e treina normalmente, mas saúde, biometria e IA só liberam com o aceite do responsável, por um link enviado ao e-mail dele."

**A data de nascimento** (`20261350010000`). Obrigatória no link de matrícula e no cadastro pela academia (`matricula-publica` e `convidar-membro` recusam sem ela, com a mensagem em português); na importação é opcional, e a data que falta ou que não dá para ler (`lerDataDaPlanilha`: dd/mm/aaaa, aaaa-mm-dd, série do Excel) vira idade desconhecida, sem derrubar a linha. A coluna continua aceitando nulo por causa da importação; quem garante a validade é o gatilho `validar_data_nascimento` (nem no futuro, nem antes de 1900). O aluno sem data, que hoje são todos, informa uma vez no app, por `informar_data_nascimento()`, que só grava onde falta e recusa a sessão simulada: a data decide quem precisa do responsável, e quem simula não declara pela pessoa. A gestão e a recepção preenchem e corrigem na ficha; **trocar uma data que já existia vai para a auditoria**, porque muda quem precisa do aceite. A anonimização já apaga a data (`anonimizar_dados_do_aluno`, `20261339010000`); o aceite do responsável fica, como prova da autorização, igual ao termo da digital.

**A conta da idade** é a mesma nos três lugares (`idade_em()` no banco, `idadeEm()` no app, o espelho em `_shared/nascimento.ts`), com o "hoje" de Brasília. Quem nasceu em 29/02 faz 18 anos em **01/03** nos anos comuns (Código Civil, art. 132, § 3º); `data + interval '18 years'` daria 28/02, um dia antes, e foi por isso que a conta é por ano, mês e dia. A ficha do aluno calculava a idade com `new Date("aaaa-mm-dd")`, a data pura lida em UTC; passou a usar a mesma conta.

**O aceite do responsável** (`20261351010000`). O aluno, em Perfil → Privacidade, ou a recepção, no termo impresso da digital, informa nome e e-mail do responsável. `responsavel-pedido` chama `criar_pedido_responsavel()` **com a sessão de quem pede**, para o banco conferir quem é (o aluno pede tudo; a gestão e a recepção, só a biometria), se a sessão é simulada, se o aluno é menor, e que o e-mail não é o de login do próprio aluno. O pedido nasce **sem token**; só depois a função gera 32 bytes aleatórios, grava o SHA-256 com a service role e manda o link pelo Resend (prazo, chave de idempotência, freio por pessoa, por aluno e no total). O token nunca vai ao banco nem volta à tela: quem pede não consegue abrir o link e aceitar por ele. E-mail que não sai cancela o pedido, para a tela não dizer "enviado" de um link que ninguém recebeu. Pedido novo cancela o aberto que pede o mesmo. O link vale 7 dias.

**A página do link** (`/#/responsavel/<token>`, `responsavel-aceite`, `verify_jwt = false`) mostra o primeiro nome do aluno, a academia e, para cada item, **os textos que o aluno lê no app**, nas mesmas versões. Nenhum texto jurídico novo: o de IA saiu de dentro de `SentinelaAnamnese.tsx` para `lib/consentimentoIA.ts` sem mudar uma palavra, e `lib/textosConsentimento.ts` junta os três termos que já existiam; o cabeçalho só diz que quem marca autoriza como responsável legal e que "meu" e "minha" são os dados do aluno. O responsável marca cada item (nenhum também é resposta, e fecha o pedido). O aceite grava, por propósito (saúde, biometria, IA da anamnese, IA do chat), nome, e-mail, versão e **hash do texto, que é o do servidor e não o do navegador**: a tabela `_shared/responsavel.ts` é conferida contra o texto do app por `textosConsentimento.test.ts`, e a versão contra a vigente no banco. Versão diferente com a página aberta é recusada, para a pessoa reler. Abrir a página não aceita nada (o robô que abre links de e-mail só consulta). O banco recusa o aceite **do próprio aluno** (quando o link é aberto logado na conta dele) e o da sessão simulada.

**A trava** (`20261352010000`), por gatilho nas três tabelas, como a da sessão simulada: vale para a tela, a RPC e qualquer caminho novo. Para o menor sem o aceite vigente daquele propósito, e para a idade desconhecida, recusa a **concessão** em `aluno_consentimento_ia`, `aluno_consentimento_biometrico` (pelo app e pelo termo assinado) e nas colunas de consentimento da anamnese. A foto do rosto e o cadastro no equipamento exigem o consentimento biométrico, então ficam travados junto. Retirar nunca é travado. O aceite do responsável **libera o aluno a consentir; não consente por ele**: quem liga cada autorização no app continua sendo o aluno.

**Retirar o aceite** (`revogar_aceite_responsavel`): pelo aluno, pela equipe da academia (é a ela que o responsável pede, na ficha) ou pela ArkeFit. O consentimento que dependia dele cai pelo caminho de sempre: a biometria por `revogar_consentimento_biometrico` (apaga dos equipamentos), a IA revogada (o gatilho apaga o que foi gerado), e a saúde perde a versão do termo (a data fica, como prova), o que leva o aluno do Método de volta à tela de consentimento. Não existe exclusão automática da anamnese hoje, e a função não inventou uma.

**As telas.** Perfil → Privacidade ganhou o bloco do responsável (a data, o que foi autorizado, o pedido em aberto e o formulário), e os interruptores de IA e da digital só ligam quando liberados, com a dica de por quê; desligar segue sempre possível. No onboarding do Método e na reconfirmação do termo de saúde, a caixa de consentimento dá lugar ao pedido da data ou do responsável (`PortaoConsentimento`; no `Onboarding.tsx`, só o embrulho da caixa). Na ficha, em Dados, a data, o selo **Menor de idade**, os aceites com **Retirar** e o pedido aberto. O termo impresso do menor sai com o nome (o do aceite, quando já houver) e a assinatura do responsável, e o registro do termo espera o aceite pelo link, que a recepção envia do próprio bloco. O token do link sai do endereço que vai ao Sentry. Central de Ajuda: artigos novos `menores-de-idade` (equipe) e `app-menor-de-idade` (aluno), e os do cadastro, da importação, da ficha, da biometria e da privacidade atualizados.

**Defeitos do caminho.**
- O primeiro desenho tinha a RPC do pedido recebendo o hash do token, e qualquer aluno logado poderia chamá-la direto com um token que ele mesmo inventou, e aceitar como "responsável" sem e-mail nenhum. O pedido passou a nascer sem token, e só a service role grava o hash.
- O aviso de IA vivia em JSX, com o negrito do parecer (item 3.5): para o hash ler o mesmo texto corrido sem perder o destaque, virou uma lista de trechos com a marca de destaque.
- A leitura da versão vigente nas migrations, no teste, usava uma expressão regular que varria arquivos grandes com retrocesso e estourava o prazo do teste; virou a busca da definição e a leitura de 600 caracteres a partir dela.
- Na volta sobre a main, a guarda da saída do aluno (`saidaDoAluno.guarda`, da rodada 1 da auditoria) acusou as duas tabelas novas com `aluno_id`. Ficam depois da anonimização, com o motivo escrito na guarda: o aceite é a prova da autorização, como o termo da digital, e o pedido é o registro do caminho do consentimento; o link para de valer com o aluno anonimizado.
- A regra de alteração da anamnese deixa a equipe gravar as colunas de consentimento de saúde, que são do aluno. A trava fecha isso para o menor e para a idade desconhecida; para o adulto, o buraco é anterior e segue registrado como pendência.

**Pendências para o responsável:** (1) o consentimento dado **antes** desta regra por quem só depois se revelar menor não é retirado sozinho: retirar apagaria a digital dos equipamentos sem aviso; a trava vale para o que se grava daqui em diante. (2) No Método, o menor sem o aceite fica no acolhimento (a anamnese é dado de saúde), então "treina normalmente" vale por inteiro só no Free. (3) PAR-Q e atestado, que a academia guarda, não dependem do aceite: têm outra base legal e não passam por consentimento.

**Conferido:** (1) **o banco, numa instância local** (PGlite, o Postgres em WebAssembly), sobre um esqueleto com as tabelas, as funções e os gatilhos de consentimento e de sessão simulada copiados das migrations reais: as três migrations rodaram duas vezes seguidas (idempotentes) e **23 cenários em transação desfeita** passaram — idade e 29/02, data inválida, auditoria da troca, a data informada uma vez e recusada na sessão simulada; a trava nos três consentimentos para o menor e para a idade desconhecida, inclusive pelo upsert do onboarding e pela equipe; revogar livre e reativar travado; o pedido pelo aluno e pela recepção e as recusas (professor, outra academia, sessão simulada, adulto, sem data, e-mail do próprio aluno, nome incompleto); o hash do token ilegível pela API; a página aberta, inexistente e vencida; o aceite liberando só o propósito aceito; nenhum item marcado; as recusas de versão velha, item fora do pedido, o próprio aluno, sessão simulada e hash ruim; os privilégios de anon e authenticated em 12 funções; a retirada derrubando IA, biometria e saúde; texto novo invalidando o aceite; 18 anos completos. (2) **4 defeitos plantados** nas travas (idade desconhecida passando, o aluno aceitando por si, a recepção pedindo saúde, reativar sem trava), os 4 pegos. (3) O app: 927 testes em 125 arquivos (`npx vitest run`), com os novos de idade e trava (`menorDeIdade`, 22), de textos e hashes (`textosConsentimento`, 8), do termo, do mapa de colunas, do Sentry e as guardas; a primeira rodada sobre a main nova acusou 1, a guarda da saída do aluno (abaixo), que passou depois de corrigida; `npm run check` sem erro (28 avisos, todos de arquivos anteriores), com as 55 funções no `deno check` e nenhuma vulnerabilidade alta. **Falta, porque esta frente não toca produção:** os mesmos cenários no banco de verdade em transação desfeita, a corrente real pelas funções publicadas (o e-mail pelo Resend, o link e o aceite, com conta e academia temporárias) e a tela no computador e no celular.

**A corrente real, depois do deploy (06/10/2026):** 7 verificações pelas funções publicadas, com uma aluna temporária de 15 anos na academia de homologação, apagada no fim.
- Antes do aceite, autorizar a IA foi recusado.
- O pedido ao responsável foi gravado, e o e-mail saiu de verdade, para o endereço de teste do Resend.
- A página pública consultou o pedido sem login, e o responsável aceitou a IA da anamnese. O mesmo link não aceitou de novo.
- Com o aceite, a aluna autorizou a IA, e a digital continuou travada.
- **Também no banco, em transação desfeita:** 17 casos das três migrations, todos como esperado.
- **Os alunos já cadastrados:** a demonstração e a conta do teste automático ganharam uma data de nascimento adulta antes da trava. Os 2 alunos da academia do Jean informam a data no app quando forem autorizar.

## Política de Privacidade, versão de 06/10/2026

Decisão D2 do responsável, saída da auditoria de prontidão: a versão nova sai antes do primeiro cliente, porque hoje ninguém precisa aceitar de novo de verdade. Texto aprovado por ele no workspace em 06/10, como estava.

O que muda:
- **O assistente da equipe da academia** entra na lista de suboperadores e na transferência internacional. Ele roda na infraestrutura global da AWS e recebe a dúvida sem CPF, e-mail, telefone e sem os nomes cadastrados. A tela passou a orientar a equipe a não escrever nome nem dado de saúde de aluno.
- **Google Fonts e YouTube** entram na lista de suboperadores.
- **A seção 4:** o resumo da anamnese vale também no plano gratuito, com autorização, lido pela equipe da academia.
- **O Sentry** identifica só por código interno.
- **O hash de IP** do contato pelo site fica com o pedido.
- **A seção 11** descreve o consentimento do responsável pelo menor, que entrou no ar no mesmo dia.

O Contrato remete à lista de suboperadores da Política, então não muda. O novo aceite que a plataforma pede vale como o aviso que ele promete às academias.

A versão entra no banco pela migration `20261354010000`, aplicada depois de o texto estar no ar.

## Política 2026-10-06.2: o memorando do advogado

Em 06/10/2026, o responsável enviou o memorando de adequação regulatória do advogado. Dois itens viraram texto da Política, na redação dele, como estava:
- **Seção 6:** a transferência internacional se apoia no art. 33, II, com os DPAs dos provedores em conformidade com as Cláusulas-Padrão da ANPD. Para a frase ser verdadeira, os provedores precisam adotar as cláusulas. O pedido a Vercel, Sentry, Resend e AWS segue como pendência do responsável no workspace.
- **Seção 7:** os registros de acesso ficam 6 meses (Marco Civil, art. 15) e são apagados depois, "inexistindo ordem judicial em contrário". A ordem judicial ganhou lugar no banco (`registros_acesso_preservacoes`, migration `20261381`), e a rotina não apaga os registros de quem tem ordem vigente.

O terceiro item do memorando (CREF e CRN) não virou texto. Ele descreve a ArkeFit como só tecnologia, com a prescrição toda da academia. No Método ARKE é o contrário: a prescrição é da equipe da ArkeFit, por profissionais com CREF e CRN, como dizem o Contrato (cláusulas 2, 6.1 e 8) e a Política (seção 4). O ponto voltou ao responsável com os fatos, para o advogado reavaliar.

**Conferido em transação desfeita:** com uma ordem vigente, a rotina apagou o registro antigo de quem não tinha ordem e guardou o de quem tinha. A equipe não lê as ordens.

## CREF e CRN: o modelo híbrido, e os Termos de 06/10/2026

Com os fatos do Método em mãos, o advogado reviu o item 3 do memorando (registrado pelo responsável no workspace em 06/10/2026). A ArkeFit opera num modelo híbrido:
- **Plano Free:** a ArkeFit só fornece o software. A prescrição e o acompanhamento são da academia e dos profissionais dela.
- **Método ARKE (Integrado e Elite):** a ArkeFit presta o acompanhamento diretamente. A equipe de mentoria assume o aluno, e o sistema isola a anamnese e a dieta da visão da academia.
- **Hoje,** a validade e a responsabilidade técnica das prescrições do Método vêm dos registros de pessoa física dos especialistas da equipe no CREF e no CRN. Por isso, "Exigir CREF e CRN para prescrever" fica ligado antes do primeiro aluno de verdade no Método.
- **No médio prazo, depois da captação:** o CNPJ ganha as CNAEs secundárias de instrução esportiva e de nutrição, e a ArkeFit se registra como pessoa jurídica nos dois conselhos, com os especialistas como responsáveis técnicos.

Os Termos de Uso diziam que a prescrição era "da equipe indicada" no Método, "não pela plataforma". A versão 2026-10-06 diz quem prescreve em cada plano e que a ArkeFit responde pelo que a sua equipe prescreve no Método, como já diziam o Contrato e a Política. A versão entra no banco pela migration `20261383`, depois de o texto estar no ar.

## Rodada 3 da conformidade: o Asaas, a simulação e os dados do aluno (06/10/2026)

Achados médios de conformidade da auditoria de prontidão de 05/10.

**O cliente no Asaas é anonimizado na saída do aluno.** A anonimização apagava a pessoa do banco e deixava o cadastro dela no Asaas como estava: na conta da ArkeFit, nome, CPF e celular (matrícula, Método, avulsa); na conta da academia, também e-mail e endereço (a nota fiscal).
- `_shared/clienteAsaas.ts` troca o nome por "Pessoa anonimizada", apaga e-mail, telefones, e-mails adicionais, endereço, empresa e observações, e desliga os avisos do Asaas. Confere a resposta: campo que o Asaas manteve é falha.
- **Fica o CPF**, e as cobranças e as notas não são tocadas. O CPF liga os pagamentos já feitos a quem pagou, e o Asaas, como instituição de pagamento, guarda o pagador pelo prazo legal. A nota emitida é documento fiscal.
- **Na conta da ArkeFit** o cliente também é removido (`DELETE /customers`). O Asaas não apaga nada nisso: marca `deleted`, guarda as cobranças pagas e pode restaurar. Sem a remoção, quem voltasse com o mesmo CPF seria cobrado como "Pessoa anonimizada", porque a matrícula, o Método e a avulsa reaproveitam o cliente achado pelo CPF sem atualizar o cadastro. **Na conta da academia** o cliente só é anonimizado: as notas ficam onde estão, e a próxima nota atualiza o cadastro.
- **Quem tem outro vínculo vivo:** a conta da ArkeFit fica intocada, porque o cliente dali é um só por CPF e pode ser o da assinatura da outra academia. Na conta da academia sai só o cliente com a referência deste aluno.
- Cada busca confere o que voltou contra o filtro. Filtro que o Asaas não aplica devolve a conta inteira (`?cpfCnpj=` vazio já fez isso), e anonimizar "o que voltou" apagaria o cadastro de outras pessoas.
- **Ligado em `anonimizar-aluno` e `excluir-aluno`** (`_shared/saidaAsaas.ts`), depois de encerrar as cobranças e antes do banco, enquanto o CPF ainda está no perfil. **A saída não espera o Asaas:** se ele falha, a anonimização segue, e a pendência fica em `asaas_saida_pendente` (migration `20261377`), sem CPF, nome nem e-mail. A rotina `arke-saida-asaas` (`retentar-saida-asaas`, de hora em hora) tenta de novo; já sem o CPF, ela acha o cliente pela referência com que ele foi criado, o id de cada matrícula da pessoa. A linha sai quando dá certo. O aviso ao gestor diz que o cadastro de lá sai na próxima tentativa.
- `npm run sandbox:anonimizar` exercita o módulo contra o sandbox do Asaas, com uma cobrança paga. Rodou em 06/10, com as 14 verificações passando: o Asaas limpa o campo enviado vazio, o CPF e a cobrança paga ficam, e a busca não devolve o cliente removido.

**O aviso do Asaas é guardado no mínimo** (migration `20261375`). O `asaas-webhook` gravava o aviso inteiro, e ele ficava 90 dias assim. O aviso de cobrança traz o `creditCardToken` (com ele a conta da ArkeFit cobra o cartão de novo), os links do boleto e do comprovante, o nosso número, o Pix e o split, e a Política diz que a plataforma guarda só a situação, os 4 últimos dígitos e a bandeira.
- O gatilho `trg_minimizar_aviso_asaas` reduz o aviso, na gravação, ao que o webhook lê, mais os 4 dígitos e a bandeira. Vale para o webhook (que é de outra frente e não mudou) e para o aviso que a conferência diária reenvia.
- O que já estava guardado foi reduzido na migration.
- O resumo, que tira também o link da fatura, a descrição e as datas do pagamento, passou de 90 para 30 dias. O reprocessamento do Vigia reenvia o aviso guardado, mas só dos últimos 7 dias e só o não processado; o resumo só toca o processado.
- `avisoAsaas.guarda` cobra que todo campo que o webhook lê sobreviva à redução: senão o aviso reprocessado chegaria sem ele, e o erro só apareceria no reprocessamento.

**A simulação guarda o id da pessoa, e não o e-mail** (migration `20261376`). `impersonar-perfil` gravava o e-mail da pessoa simulada na trilha de auditoria (`detalhes.email_alvo`). A trilha não tem prazo, e a anonimização troca o e-mail de login justamente para desligar a conta do endereço da pessoa: o registro religava as duas coisas. A função deixou de mandar o e-mail (a pessoa já está no `entidade_id`). Um gatilho tira o `email_alvo` de todo registro de simulação, por qualquer caminho, inclusive da função antiga antes do deploy. Os registros que existiam perderam o e-mail.

**O aluno baixa os próprios dados.** O acesso e a portabilidade (art. 18, II e V) dependiam de a academia montar o arquivo, e a exportação dela não levava anamnese, treinos nem mensagens.
- Em Perfil → Privacidade, **Baixar os meus dados** gera um JSON com cadastro, anamnese, PAR-Q, avaliações, treinos e o registro deles, dietas e a adesão, presenças e check-ins, mensagens (equipe e mentor), autorizações (IA, digital, documentos, contrato, responsável) e pagamentos, de todas as academias em que a pessoa tem matrícula.
- Tudo é lido com a sessão da própria pessoa, pelo RLS dela, sem service role, em páginas e em lotes de ids. O arquivo tem o que ela já pode ver, nem mais nem menos. O que o RLS não mostra a ela (cada passagem na catraca, o histórico de fases) fica de fora, e o arquivo diz como pedir.
- Dos pagamentos sai a divisão entre a academia e a ArkeFit e a taxa do gateway: são do negócio delas, não dados do aluno.
- Leitura que falha não entrega arquivo pela metade.
- **Na sessão simulada não baixa.** A aba diz antes (`emPerfilSimulado`), e o banco confirma na hora (`sessao_simulada()`), porque a marca da aba pode faltar.

**Defeitos do caminho.**
- O primeiro desenho da anonimização no Asaas travava a saída (502) quando o Asaas falhava, como faz o encerramento das cobranças. A decisão do responsável foi a contrária: o direito da pessoa não espera o gateway. Com isso, a nova tentativa acontece depois de o banco apagar o CPF, e a busca passou a ir também pela referência de cada matrícula da pessoa.
- Na nova tentativa de uma exclusão, o aluno já não existe, e `pessoa_tem_outro_vinculo` responderia "não" para quem tinha outro vínculo. A pendência guarda a resposta da hora da saída.
- Em `jsdom`, o erro de prazo do `fetch` não é `instanceof Error`; a mensagem passou a usar só o nome do erro.

**Conferido:** (1) **o banco, numa instância local** (PGlite) com as tabelas reais copiadas das migrations: as três migrations (`20261375`, `20261376`, `20261377`) rodaram duas vezes seguidas, e **39 casos** passaram — a redução tira o token, os links, o nosso número e o split e guarda os 4 dígitos, a bandeira e todo campo que o webhook lê; o aviso novo e o upsert do webhook já gravam reduzido; o aviso antigo foi reduzido e o resumo antigo ficou; a limpeza resume o processado com 31 dias, guarda o de 20 e o não processado, e apaga o de 13 meses; o e-mail da simulação saiu dos registros antigos, não entra no novo nem volta por alteração, e outra ação não é tocada; a pendência do Asaas conta a tentativa, não tem coluna de dado pessoal, só o Super Admin com as duas etapas a lê, e a rotina ficou agendada uma vez; anon e authenticated não executam nenhuma função nova. (2) `npx vitest run`: 1.176 testes, todos passando, com os novos de `clienteAsaas` (12, contra um Asaas de mentira), `meusDados` e `BaixarMeusDados` (8), `avisoAsaas.guarda` (5) e as travas novas em `perfilSimulado.guarda` e `saidaDoAluno.guarda`; `npm run check` sem erro, com o `deno check` das 56 funções. (3) **Defeitos plantados**, um por achado, todos pegos: a busca no Asaas adotando o que voltou sem conferir o filtro (`clienteAsaas`), a saída voltando a travar quando o Asaas falha (`saidaDoAluno.guarda`), a redução sem o link da fatura (`avisoAsaas.guarda` e 3 casos do banco local), o e-mail de volta na simulação (`perfilSimulado.guarda`) e o download sem perguntar ao banco se a sessão é simulada (`BaixarMeusDados`). (4) **No banco de produção, em transação desfeita:**
- o aviso cheio sai sem o token, sem os links e sem o nosso número, com "8829" e a bandeira, e mantém o link da fatura;
- dos 116 avisos guardados, nenhum ficou com dado de cartão ou link, e os 115 com cobrança ainda têm tudo o que o webhook lê;
- a gravação nova e o `on conflict` gravam reduzido;
- a limpeza resume o processado de 31 dias e guarda o de 29 dias e o não processado;
- a única diferença da função de limpeza para a de produção é o prazo, de 90 para 30 dias;
- as 25 simulações com e-mail ficaram sem ele, a nova entra sem ele e outra ação não é tocada;
- a pendência conta 2 tentativas, e a rotina fica agendada uma vez;
- a gestora não grava, não chama a função e não lê nada;
- nenhuma função nova executa para anon ou authenticated.

(5) `npm run sandbox:anonimizar`: as 14 verificações passaram.

(6) **Pela corrente real**, depois do deploy (06/10):
- `anonimizar-aluno` e `excluir-aluno`, chamadas por uma gestora temporária da homologação (que está em teste e por isso usa o sandbox), deixaram o cliente de cada aluna no sandbox removido, com "Pessoa anonimizada", sem e-mail e sem telefone, e com o CPF;
- a resposta trouxe `cadastro_no_asaas: "anonimizado"`, e nenhuma pendência ficou;
- a rotina `arke-saida-asaas`, disparada pelo mesmo comando do cron, respondeu 200 e marcou a execução.

(7) **A tela**, no celular: o arquivo de **Baixar os meus dados** (`meus-dados-arkefit-<data>.json`) chegou com as partes cadastro, saúde, avaliações, treinos, dietas, presenças, mensagens, autorizações e pagamentos, só da própria pessoa e sem a divisão do repasse.

**Pendências.** (1) O encerramento da academia (`eliminar_organizacao`) apaga os alunos sem passar pela anonimização no Asaas: fica para a próxima rodada, com a mesma função. (2) ~~`npm run sandbox:anonimizar` antes do deploy~~: rodou em 06/10, e as 14 verificações passaram.
