# Método ARKE e o Mentor

O ecossistema do Método: sensores, avanço de fases, a fila e o console do mentor, a operação da célula e o painel do profissional autônomo.

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


**O aviso no celular nunca saiu (achado em 25/09/2026).** `briefing-semanal` passava ao web-push um `VAPID_PUBLIC_KEY` lido do ambiente, e esse segredo não existe no projeto. As outras funções derivam a chave pública da privada. Com a chave vazia, o web-push recusava, e o `catch` que existe para inscrição expirada engolia o erro: o e-mail saía, o push nunca. Hoje a derivação mora em `_shared/vapid.ts` (`chavePublicaVapid`), e `vapid.guarda.test.ts` confere o par de chaves e barra qualquer função que volte a ler `VAPID_PUBLIC_KEY`.

## Operação da Célula e Prova de Valor (Fase 6 do Ecossistema, 23/09/2026)

Duas perguntas que o produto não sabia responder, e que decidem se o BPO se sustenta: **a ArkeFit está cumprindo o que prometeu?** e **a academia está vendo o serviço acontecer?**

**O SLA nascia em horas de relógio, e por isso não media nada.** `now() + interval '4 hours'`: tarefa aberta às 19h de sexta vencia às 23h de sexta, com a célula fechada — o painel acusaria atraso de quem não tinha como agir, e a mesma conta perdoaria a tarefa aberta segunda às 9h. Errado nos dois sentidos, o que é pior do que não medir. `prazo_util()` e `horas_uteis_entre()` contam só expediente: **seg–sex 08–20, sáb 08–12**, no fuso de Brasília — que é o do banco desde a migration do fuso, e é por isso que as duas são `stable` e não `immutable`. Na verificação, uma tarefa de **10 dias corridos** saiu como **45,6 horas úteis**.

**A correção é um gatilho, não treze.** Pela mesma razão do fuso: o defeito não está em nenhum gerador, está na premissa de que hora de relógio é hora de trabalho. `trg_ultimo_sla_util_mentor` reescreve o prazo de toda tarefa `dono = 'arkefit'` a partir de `sla_mentor_horas(prioridade)` — crítica 2h, alta 4h, média 8h, baixa 24h, **úteis**, num lugar só. Tarefa da academia fica como está: o expediente dela não é o nosso, e inventar um horário comercial para ela seria medir contra promessa que ninguém fez.

> **A ordem dos gatilhos é carga estrutural.** O Postgres dispara em ordem alfabética, e este precisa ser o **último** `before insert` de `tarefas`: `trg_definir_dono_da_tarefa` decide o dono e `trg_tarefas_bump_prioridade_elite` sobe a prioridade — os dois valores de que o cálculo depende. Daí o prefixo `trg_ultimo_`. Um gatilho novo chamado `trg_validar_*` passaria a rodar depois e o SLA sairia errado **sem dar erro nenhum**: a inserção funciona, o painel enche, só o prazo está errado. `src/lib/ordemGatilhosTarefas.guarda.test.ts` lê as migrations e falha se aparecer um nome que ordene depois.

**`tarefas.concluida_em`, carimbado por gatilho.** Sem ela o tempo de resposta sairia de `updated_at`, que é a **última edição** e não a resolução: bastaria corrigir um desfecho uma semana depois para a tarefa aparecer como resolvida em uma semana. Reabrir limpa o carimbo, senão a mesma tarefa contaria duas vezes.

**O painel da ArkeFit** (Visão Master → Mentoria → *Operação*) responde três coisas, e **cada indicador diz na tela como é calculado**: cumprimento do SLA e vencidos agora; **carga por mentor**, porque uma célula de serviço quebra por uma pessoa segurando tudo e isso não aparece no total; e **capacidade** — alunos sob acompanhamento, alunos por mentor e **chamados por aluno/mês**, que é o número que dimensiona a célula quando a base crescer. O denominador da capacidade é o aluno do Método, não o aluno com tarefa aberta: quem não deu trabalho neste mês continua sendo carga, é dele que virá a próxima. O tempo até a resposta é rotulado como **latência, não esforço** — um chamado resolvido em 3h pode ter dado 10 minutos de trabalho, e confundir os dois dimensionaria a equipe errado. Para isso o console do Mentor passou a gravar `responsavel_id`: sem ele a carga aparece distribuída por ninguém.

**A academia vê o resultado, nunca a fila** (`/admin/acompanhamento`, *Acompanhamento ARKE* no menu). O modelo tira o acompanhamento digital das costas dela — o que, do lado de quem paga, é indistinguível de não estar recebendo nada. E a fila é invisível por desenho (Fase 4), então sem prestação de contas explícita o serviço não aparece e o cliente cancela achando que não tinha nada. O RLS **força** o desenho certo em vez de deixá-lo opcional: a leitura de `tarefas` exige `dono = 'academia'`, então `get_valor_mentor_organizacao` e `get_atendimentos_mentor_organizacao` são `security definer` e entregam contagens e **desfechos** — o mesmo texto que o mentor teve de escrever para encerrar. "42 atendimentos" qualquer um escreve; o desfecho é a prova. O conteúdo da conversa aluno↔mentor continua fora, e a tela **diz isso em voz alta** em vez de deixar a academia descobrir sozinha e achar que é falha do produto.

Conferido em **29 verificações**: 13 de horas úteis (incluindo sexta 19h → sábado 11h, sábado 11h → segunda 11h, domingo inteiro fora, e ida-e-volta entre as duas funções), 9 do gatilho e do carimbo (prazo da ArkeFit reescrito, prazo da academia intacto, Elite com prioridade já bumpada valendo, editar depois não move `concluida_em`, reabrir limpa) e 7 de acesso e números com identidades reais — gestor leva **403** na operação da ArkeFit, gestor de outra academia leva **403** nos dados desta, e a fila do Mentor continua devolvendo **0 linhas** na leitura direta pela academia.

## Método ARKE: o mentor assume o aluno (fases 1 e 2, 28/09/2026)

Até aqui o aluno do Método era, para o banco, igual a qualquer outro: a equipe da academia publicava treino e dieta para ele, lia a anamnese e mexia nas metas e na fase. O mentor só encerrava chamado. O modelo de negócio é outro, e o responsável o descreveu assim: **o aluno do Free é da academia; quando ele compra o Método, treino, dieta, anamnese, metas e jornada passam a ser do mentor da ArkeFit**, e a academia fica com cadastro, dados pessoais, biometria, mensalidade, situação, atestado e PAR-Q. Plano completo, com as 7 fases e as 7 decisões, no documento *Método ARKE — o mentor assume o aluno*. Decisões que entram aqui: a academia **vê o treino** do Método (é ela quem orienta no salão), mas não a dieta nem a anamnese; a **avaliação física** continua medida pela academia, quando o mentor pedir; atestado e PAR-Q não mudam.

**A regra mora no banco** (`20261292010000_metodo_dono_e_equipe.sql`), porque vale para qualquer caminho — tela, edge function, importação:

- **`equipe_arkefit`**: quem da ArkeFit atende o Método, com **CREF** (treino) e **CRN** (dieta). Tabela da plataforma, sem `organization_id`, como `plataforma_config`. Só o Super Admin escreve, por `salvar_equipe_arkefit()` (auditada), na tela **Visão Master → Equipe ArkeFit**. `pode_prescrever_treino_metodo()` e `pode_prescrever_dieta_metodo()` não têm parâmetro de propósito: respondem só sobre quem chama, e não servem para sondar quem tem registro.
- **`treinos.dono` e `dietas.dono`** (`academia` | `arkefit`) e `prescritor_registro`, preenchidos pelo gatilho `definir_dono_da_prescricao()`. Para aluno do Método, só publica quem é da equipe, está ativo e tem o registro certo — **inclusive pela `service_role`**, que ignora RLS: sem `auth.uid()`, o gatilho recusa. Foi por isso que `publicar-treino-boas-vindas` passou a pular o aluno do Método; antes ela publicaria o modelo genérico da academia por cima do mentor.
- **RLS**: inclusão, alteração e exclusão em `treinos`, `dietas` e `anamnese_acolhimento` separam os dois mundos (`aluno_no_metodo()`, que roda com a permissão de quem pergunta e por isso não revela aluno de outra academia). A equipe da ArkeFit passou a ler aluno, check-in, avaliação, registro de treino, adesão à dieta e calendário **só do aluno do Método**. `anamnese_acolhimento` tinha uma regra `FOR ALL`; virou uma por operação, como manda a regra do projeto.
- **Metas e fase**: `proteger_metas_do_metodo()` recusa a academia mexendo em objetivo e metas do aluno do Método; `mover_fase_jornada` e `liberar_progressao_aluno` só aceitam a ArkeFit para ele.

**Um defeito que só apareceu fazendo.** A passagem M.A.P.A.® → B.A.S.E.® ao publicar a primeira prescrição (`avancar_fase_apos_publicacao`) rodava com a permissão de quem publica e fazia UPDATE em `alunos`. A ArkeFit não tem regra de alteração em `alunos`, então com o mentor publicando o UPDATE afetaria **zero linhas, sem erro** — o mesmo silêncio do `primeiro_acesso_em`. Virou `security definer`.

**Na tela da academia:** a ficha mostra **Acompanhado pelo mentor da ArkeFit**, some com os botões de prescrever, mostra metas e fase só para leitura, a dieta como "acompanhada pela nutricionista da ArkeFit", o treino com "Prescrito pela ArkeFit", e esconde o resumo do Sentinela. Em Prescrever Treinos e Dietas o aluno do Método aparece desabilitado, com o motivo. O acolhimento M.A.P.A.® deixou de publicar o treino genérico: a tarefa do acolhimento vai para a fila do mentor, e a home diz que a ficha está sendo preparada.

**Conferido em 26 casos** em transação revertida, com identidades reais da homologação e o Super Admin sem o papel antigo de Admin ARKE (que já lia tudo): gestor lê o treino do Método e não a anamnese nem a dieta, e é recusado ao publicar, mexer nas metas e mover a fase; o Free segue igual; Super Admin sem registro é recusado; com CREF publica o treino (`arkefit`, com o registro gravado) e o aluno em M.A.P.A.® passa a B.A.S.E.®; sem CRN a dieta é recusada, com CRN passa, e a academia não a vê; o aluno vê a própria dieta e a própria anamnese; e sem usuário o gatilho recusa aluno do Método e aceita o Free.

## Método ARKE: o console do mentor (fase 3, 28/09/2026)

A fase 1 deu ao mentor a posse do acompanhamento; esta dá a ele onde trabalhar. A Mentoria da Visão Master deixou de ser só fila de chamados: a primeira aba é a **carteira**, e cada aluno abre uma **ficha** (`/superadmin/mentoria/aluno/:id`) com visão geral, acolhimento, treino, dieta, evolução e conversa. Migration `20261293010000_metodo_console_mentor.sql`.

**O CREF e o CRN deixaram de ser obrigatórios por enquanto** (decisão do responsável, para não travar o desenvolvimento). O cadastro continua, e o registro continua gravado na prescrição quando existe, mas a exigência depende de `plataforma_config.exigir_registro_metodo` (0 hoje), lido por `registro_metodo_exigido()`. **Sem a linha, exige**: esquecer a configuração não pode abrir a porta. Religar é o interruptor em **Visão Master → Equipe ArkeFit**, sem migration — e é o passo combinado para quando o console estiver testado.

- **Biblioteca do Método**: `modelos_treino` e `modelos_dieta` ganharam `biblioteca` (`academia` | `metodo`). O modelo do Método não tem organização, e uma restrição amarra as duas coisas. Moram nas mesmas tabelas de propósito: `publicar_treino` e `publicar_dieta` servem aos dois lados sem uma segunda cópia do snapshot. A condição entrou na regra FOR ALL que cada tabela já tinha; a academia não enxerga a biblioteca do Método.
- **Carteira**: `alunos.mentor_id` e `mentor_desde`. Só a ArkeFit troca (`trg_proteger_mentor_do_aluno`), por `atribuir_mentor_aluno()`. `get_carteira_mentor()` devolve os alunos do Método com os sinais de atenção já calculados (`atencao`: acolhimento pendente, sem treino, sem dieta, dor, chamado atrasado, mensagem, treino vencendo, sem mentor), o que trava primeiro. Os rótulos e filtros da tela moram em `src/lib/carteiraMentor.ts`.
- **Metas**: `definir_metas_aluno_metodo()`. A ArkeFit não tem regra de alteração em `alunos` — a tabela é o cadastro da academia —, então as metas do aluno do Método passam por essa função.
- **Ficha**: `get_ficha_mentor()` devolve tudo numa chamada (aluno, anamnese, treino e dieta ativos, check-ins, treinos registrados, adesão, avaliações, chamados) e recusa aluno do Free: esse é da academia.
- **Um editor só para os dois lados.** As telas de treino e dieta viraram `PrescricaoTreino` e `PrescricaoDieta` (`src/components/prescricao/`), com um `escopo`: a academia trabalha com a biblioteca e os alunos dela; o mentor, com a biblioteca do Método e o aluno fixo da ficha. `AdminTreinos` e `AdminDietas` são só o invólucro da academia. Duas cópias do editor divergiriam na primeira correção feita num lado só.
- **Importação de dieta por PDF para a ArkeFit**: `importar-dieta-pdf` aceita, além de gestor e nutricionista, quem o banco reconhece por `equipe_metodo()`, perguntado com a sessão de quem chama — lá o papel da ArkeFit só vale com a verificação em duas etapas.

**Conferido:** 23 casos em transação revertida (exigência desligada e ligada, sem configuração exigindo, biblioteca invisível para a academia, carteira, metas e ficha recusadas ao gestor e ao aluno); 15 na corrente real com um Super Admin temporário verificado em duas etapas (sem as duas etapas a carteira e o PDF recusam; o mentor assume o aluno, define metas, monta um modelo do Método e publica, e a academia vê o treino mas não a biblioteca; tudo desfeito no fim); e as telas num navegador, no computador e no celular, sem exceção nem erro do Supabase.

## Método ARKE: a conversa e o que o aluno vê (fases 4 e 5, 28/09/2026)

Com o mentor dono do acompanhamento, o aluno do Método fala de treino e dieta com ele, e não com a academia. O app já trancava o canal antigo do lado do aluno; faltavam o banco, a caixa da academia e o aluno saber quem o acompanha. Migration `20261295010000_metodo_conversa_aluno.sql`.

- **O canal antigo não aceita mensagem nova, de nenhum lado**: `recusar_conversa_de_prescricao_no_metodo()` (gatilho em `mensagens_treino` e `mensagens_dieta`) recusa o aluno do Método e a equipe da academia. O histórico continua legível: é o registro do que já foi orientado. Na ficha da academia, os botões de chat ficam desativados com o motivo.
- **A Caixa de Mensagens da academia não lista o aluno do Método** (`get_caixa_mensagens`): uma mensagem antiga não lida ficaria lá para sempre, pedindo resposta que a academia não pode dar. A ordem por plano saiu junto, porque o Método não está mais na caixa.
- **No app**: o canal **Meu Mentor ARKE** (`CanalMentor`, `src/components/aluno/MeuMentor.tsx`) aparece no treino **e** na dieta, com o nome de quem acompanha; o treino e a dieta dizem quem prescreveu e o registro (`PrescritoPor`). Os dois vêm de `get_meu_acompanhamento()`, porque o aluno não lê `profiles` de outras pessoas nem a equipe da ArkeFit, e não deve.
- **Um defeito antigo no caminho: a meta semanal do aluno nunca gravava.** O calendário fazia UPDATE direto em `alunos`, onde o aluno só tem leitura, e o PostgREST respondia sucesso com zero linhas — o mesmo silêncio do `primeiro_acesso_em`. Virou `atualizar_meta_semanal_aluno()`, no desenho da meta de água: vale para todos os cadastros da pessoa e recusa o aluno do Método, cuja meta é do mentor. A tela ganhou a mensagem de erro que não tinha.

**Conferido:** 12 casos em transação revertida, incluindo a prova do defeito (o UPDATE direto do aluno afetou 0 linhas; a função gravou) e as duas pontas do canal recusadas para o Método e abertas para o Free; e o app do aluno do Método num navegador, com o canal do mentor no treino e na dieta, o histórico só leitura e a meta sem edição.

## Método ARKE: a passagem de bastão (fase 6, 28/09/2026)

Entrar ou sair do Método muda quem cuida do aluno, e até aqui não avisava ninguém. Dois gatilhos em `alunos` (`20261296010000_metodo_passagem.sql`), valendo para qualquer caminho que mude `metodo_arke_status` — adesão pela academia, cancelamento da assinatura, fim do trial:

- **Entrada**: tarefa da ArkeFit para dar as boas-vindas e acompanhar o acolhimento. A academia não recebe tarefa: é ela quem registra a adesão, e a ficha já diz o que passa à ArkeFit — tarefa só para avisar viraria ruído na fila.
- **Saída** (decisão 5): o aluno sai da carteira (`mentor_id` limpo **antes** de gravar, porque a academia que cancela não pode mexer no mentor e a mudança dentro do próprio UPDATE não passa por aquela trava), os chamados abertos da ArkeFit se encerram com desfecho, e a academia recebe tarefa de prioridade alta para assumir. O último treino e a última dieta do mentor **não são desativados**: seguem valendo até a academia publicar os dela, e o aluno não fica sem ficha. As tarefas nascem **depois** de gravar, porque o dono delas sai do plano do aluno e precisa enxergar o plano novo.

Conferido em 8 casos em transação revertida, com o gestor cancelando o Método de verdade. **Os textos do Contrato e da Política desta fase dependem de aprovação do responsável no chat** e entram numa versão própria.

## O painel do profissional autônomo (fase 7 do plano do Método, 28/09/2026)

O personal e a nutricionista que usam o ArkeFit como negócio próprio são o gestor de uma organização de uma pessoa só (`tipo = profissional_autonomo`, especialidade em `especialidade_profissional`). O painel deles tinha só atendimento, mensagens, alunos e a prescrição; agora funciona como o de uma academia pequena. Migration `20261294010000_profissional_autonomo.sql`.

- **Menu**: funil de vendas, prescrição da especialidade, comunicados e, em **Meu negócio**, Financeiro, Resumo da semana e a tela Organização (perfil, pagamentos, meus planos, contrato de matrícula e **Parceria**). Ficam de fora catraca, check-in por QR, equipe, o Método ARKE (Precificação, Assinaturas, Acompanhamento ARKE) e, no Financeiro, Folha e Comissões. Vendas e dinheiro são só do dono do painel.
- **Conta Asaas com CPF**: `montarSubconta` aceita CPF com o nome completo (em `razao_social`) e `organizations.responsavel_nascimento`, que o Asaas exige para pessoa física; com CNPJ segue igual. A configuração inicial pede CNPJ **ou** CPF ao autônomo e o nome completo quando é CPF. **O sandbox não confirmou a abertura com CPF**: ele está no limite de subcontas, e testar depende de excluir as antigas (ação do responsável). **Confirmada em produção em 03/10/2026**: a primeira subconta da ArkeFit foi aberta com CPF, pelo painel de personal do Jean, e ficou aguardando a aprovação do Asaas (`PENDING`). A nota fiscal automática exige CNPJ (MEI serve), e a tela diz isso a quem tem CPF.
- **Configuração inicial**: a etapa de equipe vira **Parceria (opcional)** e já nasce concluída para o autônomo (`onboarding_etapas_interno`).
- **Cada um prescreve a sua parte, no banco**: `definir_dono_da_prescricao()` recusa, numa organização de autônomo, treino de quem não é personal e dieta de quem não é nutricionista (`papel_prescreve_no_autonomo`: o dono pela especialidade, o parceiro pelo papel). Rotina sem usuário passa, como antes. Na academia nada muda. O espelho da tela é `src/lib/prescricaoPermitida.ts` (`podePrescrever`), usado pelo menu, pela ficha e pelas telas de prescrição.
- **Parceria (decisão 6)**: `convidar_parceiro_autonomo()` vincula quem já tem conta no ArkeFit à organização, com o papel complementar (o personal chama nutricionista; a nutricionista, personal). Quem não tem conta é cadastrado pela `cadastrar-membro-equipe`, com senha temporária. O parceiro vê o painel no seletor de unidade, a ficha completa (a dieta passou a mostrar as refeições na ficha) e prescreve só a parte dele. `encerrar_parceria_autonomo()` tira o acesso; o que ele prescreveu continua valendo. *(Superado em 06/10/2026: a conta que já existe entra pendente e só vale depois que a pessoa define a senha pelo link do e-mail, e ninguém recebe senha temporária; ver* Auditoria de prontidão: as sobras de banco e de funções*, em seguranca-e-acesso.md.)*

**Conferido:** 15 casos em transação revertida (etapas da configuração com CPF, personal não publica dieta, parceira nutricionista publica dieta e não treino, convite de e-mail sem conta devolve P0002, parceria encerrada tira o acesso, academia inalterada) e 22 verificações pela tela, com um personal e uma nutricionista temporários fazendo a parceria pelo painel, apagados no fim.

### A gestão dos profissionais pela Visão Master (03/10/2026)

**O convite de quem já tinha conta falhava e deixava painel vazio para trás.** O Jean criou o próprio painel de personal com o e-mail da conta que já tinha. O Auth recusa convidar quem existe, e o desfazer quebrava: a consulta do PostgREST não é uma Promise e não tem `.catch`, então o `delete` nem rodava. Ficaram duas organizações sem ninguém dentro, como já tinha acontecido com outras duas em setembro. Agora `convidar-profissional-autonomo`:

- liga a conta existente como gestora, achada por `conta_por_email()` (só a service role), e manda pelo Resend o aviso "Seu painel está pronto" (`email.ts`), com o link de criar a senha para quem nunca entrou;
- aceita um painel por pessoa: o segundo é recusado com o nome do primeiro;
- espera o `delete` ao desfazer.

Tem três ações: `criar`; `responsavel`, que põe responsável no painel sem ninguém ou troca quem nunca entrou (e-mail errado no convite); e `reenviar`. Quem já entra no painel não é trocado por aqui: o caminho é alterar o e-mail de login dele.

- **A ficha do profissional** (Visão Master → Profissionais, `ProfissionalAutonomoSheet`): editar o painel e o responsável (`atualizar_profissional_autonomo`, auditada; a especialidade fica presa enquanto houver parceria ativa, porque o parceiro foi convidado para a outra parte), o acesso (definir, trocar, reenviar, copiar o link de ativação, alterar o e-mail de login), alunos e parceria, implantação, a mensalidade do ArkeFit e a saída. `gerar-link-ativacao` passou a aceitar o Super Admin, e não só o papel antigo de Admin ARKE.
- **O painel que nunca virou cliente sai direto**, além da homologação: `organizacao_nunca_usada()` (sem contrato aceito, sem aluno, sem cobrança da ArkeFit, sem conta de recebimento), conferida em `superadmin-suporte-tenant`. O resto sai pelo encerramento.
- **A lista dizia "Ativou a conta" de quem nunca entrou**, porque o perfil nasce `active` no próprio convite. O convite pendente passou a vir do último acesso.

Migration `20261317010000_profissionais_autonomos_gestao.sql`; regras da tela em `src/lib/profissionaisAutonomos.ts`; artigo *Profissionais autônomos* na Central de Ajuda. **Conferido:** 29 casos em transação desfeita; 25 na corrente real, pelas funções publicadas e com um Super Admin verificado em duas etapas (inclusive o convite que falha no meio sem deixar painel e os sete e-mails entregues); e 24 pela tela, no computador e no celular. Três defeitos plantados de propósito, os três pegos.

## Progressão da Jornada do Aluno

> **Atualizado em 23/09/2026:** o fluxo de sucesso passou a avançar sozinho — ver *Avanço Automático de Fases*. O que segue descreve a passagem manual, que continua valendo por cima.

As cinco fases — M.A.P.A.® → B.A.S.E.® → R.O.T.A.® → A.P.E.X.® → L.E.G.A.D.O.® — **são movidas pela equipe**, manualmente, no bloco *Fase da Jornada* da ficha do aluno. A decisão foi não automatizar: quem convive com o aluno é quem sabe se ele mudou de fase, e um gatilho erraria justamente nos casos que mais importam.

`mover_fase_jornada(_aluno_id, _fase, _observacao)` faz o movimento e registra autor, data e motivo em `aluno_fase_historico` — a fase orienta o atendimento, então uma mudança sem autor não se explica depois. Restrita à equipe da academia ou à ArkeFit; o próprio aluno não move a sua fase. Mover para a fase em que o aluno já está é aceito mas não gera linha no histórico.

A única transição automática que permanece é M.A.P.A.® → B.A.S.E.®, ao publicar a primeira prescrição, e ela passou a exigir **anamnese concluída**. Antes avançava sem olhar o acolhimento, o que produzia aluno marcado como tendo passado pelo M.A.P.A.® sem ter passado. As demais fases esperam a equipe.
