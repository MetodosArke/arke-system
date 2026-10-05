# Operação

Automações e rotinas, proteção, testes de ponta a ponta, Sentry e rascunhos.

## Rastreamento de Erro (Sentry): a configuração é a política de privacidade

Sem rastreamento, um erro de JavaScript numa tela deixa o aluno travado e ninguém fica sabendo — o defeito só aparece quando alguém liga para a academia. Com várias academias em produção isso deixa de ser sustentável, então o Sentry entrou em `src/lib/monitoramento.ts`, ligado em três pontos: a subida do app (`main.tsx`), o `ErrorBoundary` (que antes só fazia `console.error`, inútil para quem não tem DevTools aberto) e o `AuthContext`, que carimba os eventos.

**O módulo é, na maior parte, uma lista do que não enviar, e isso é deliberado.** O ARKE carrega dado pessoal sensível pela LGPD (art. 5º, II) — anamnese, dobras, dores relatadas, histórico clínico. Um SDK de monitoramento no padrão manda muito mais do que se imagina para um terceiro, e a diferença entre ferramenta de operação e vazamento contínuo mora inteira na configuração:

- **Session Replay fica desligado.** É o item mais perigoso: numa tela de avaliação física o replay gravaria peso, dobras e queixas do aluno e mandaria para fora. Nenhuma máscara compensa; o recurso não entra.
- **Breadcrumb de console sai**, porque o app registra objeto de erro do Supabase no console e esses objetos carregam trecho da consulta que falhou.
- **Query string é cortada** de URLs e breadcrumbs — é onde vazam ids e o que a pessoa digitou em busca. **Corpo, cookies e cabeçalhos de requisição nunca são anexados.**
- **`sendDefaultPii: false` é explícito**, mesmo sendo o padrão: é o tipo de coisa que não pode mudar por descuido numa atualização de SDK.
- Uma limpeza em profundidade troca por `[removido]` o valor de qualquer chave que pareça sensível, **mantendo a chave** — saber que havia um campo `cpf` ajuda a entender o erro; saber qual CPF não ajuda e é o problema.

**O que é enviado de identificação:** `organization_id` e `user_id`, ambos UUID. São pseudônimos, e sem eles não dá para responder "esse erro atinge uma academia ou todas", que é a pergunta que justifica ter monitoramento. Nome, e-mail e CPF não vão nunca.

Sem `VITE_SENTRY_DSN` o monitoramento simplesmente não sobe — é assim que se roda em desenvolvimento e é assim que se desliga em produção sem deploy de código. A variável está configurada na Vercel só para `production`, apontando para a org `arkefit`, projeto `javascript-react`. **Fica no plano gratuito** (decisão do responsável, 28/09/2026): o resto da plataforma já é vigiado sem ele, e ele sai da lista de upgrades antes do primeiro cliente.

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

## CLAUDE.md enxuto e o registro por assunto (decisão de 04/10/2026)

O CLAUDE.md tinha chegado a 372 mil caracteres, com 86 seções de diário, e entrava inteiro em toda sessão e em todo subagente: cada linha custava em toda conversa e disputava atenção com a tarefa. Agora:
- **O CLAUDE.md tem uns 14 mil caracteres**, com as regras vigentes, as decisões em vigor, as armadilhas que já custaram caro (cada uma com a trava que a segura), o mapa e os comandos de prova.
- **O diário veio para `docs/registro/`**, um arquivo por assunto. O texto veio sem mudança: um script dividiu seção por seção e conferiu que cada uma foi para exatamente um arquivo.
- **`packages/gateway/` e `supabase/functions/` têm o próprio CLAUDE.md**, que só entra quando se trabalha nelas.

Entrega nova vai numa seção do arquivo do assunto, no mesmo PR. O CLAUDE.md só muda quando muda uma regra, o mapa ou um comando.

## `deno check` no CI (05/10/2026)

O deploy das edge functions empacota com esbuild, que não confere tipo nem escopo. Já passaram assim um `ReferenceError` em três funções (23/09) e um `.catch` em consulta do PostgREST, que não é uma Promise (03/10 e 05/10). O `deno check` pega os dois, mas só rodava quando alguém lembrava.

- **`npm run check` agora roda o `deno check` das 52 funções** (`npm run check:funcoes`, `scripts/checar-funcoes.mjs`). Ele entra pelo `check`, que o CI já roda, e não por um passo novo no workflow, porque o token destas sessões não altera `.github/workflows`.
- **O Deno é dependência do projeto** (`deno` 2.9.6, fixado). Assim o CI e a máquina usam a mesma versão.
- **`--no-config`:** sem ele, o Deno acharia o `package.json` da raiz e resolveria os `npm:` das funções pelo `node_modules` do app.
- **`--no-lock`:** as versões já vêm fixadas em cada import, e um lock seria mais um arquivo para manter.
- **Os 10 erros que ele achou na primeira rodada foram corrigidos.** Dois eram defeito de verdade (ver *prazo em toda chamada* em [cobranca.md](cobranca.md)); o resto era tipo.
- **O jsdom não tem `AbortSignal.timeout`**, e os testes que importam código das funções quebrariam com os prazos novos. `src/test/setup.ts` traz um substituto.

**Conferido:** o `.catch` plantado de volta em `criar-organizacao-superadmin` fez o `check` falhar com TS2551; sem ele, as 52 passam.

## Auditoria de dependências no `check` (05/10/2026)

O `npm run check` passou a rodar `npm run auditar`: o `npm audit` do app e do Gateway, **só das dependências de produção** e **só alto e crítico**. Uma vulnerabilidade nova que vai para o navegador ou para o Gateway passa a reprovar o CI.

O que a primeira rodada achou, e o que foi feito:
- **`xlsx` 0.18.5** tinha poluição de protótipo e expressão regular lenta. É ele que lê a planilha que a academia envia na importação. A SheetJS não publica mais no npm, então a versão 0.20.3 vem do endereço oficial dela (`cdn.sheetjs.com`). Com isso, o `npm audit` deixa de enxergar o `xlsx`, e uma versão nova dele tem de ser conferida à mão.
- **`dompurify`**, que vem pelo `jspdf`, foi atualizado na mesma versão maior.
- **`tailwindcss-animate` passou para as dependências de desenvolvimento.** Ele só roda no build, e entre as de produção arrastava o Tailwind e o `chokidar` para a contagem.
- **Ficou, com motivo:**
  - **React Router 6**: o aviso é de endereço externo em `<Link>` e `navigate()`. Nenhuma navegação do app usa endereço vindo de fora; todas saem do próprio código ou do catálogo da Central de Ajuda, que o teste confere. A correção só existe na versão 7, que é troca de versão maior e fica registrada no workspace.
  - **Vite, Vitest, esbuild e Tailwind 3**: só desenvolvimento e build. Os avisos são do servidor de desenvolvimento, que não vai para produção. A correção também é troca de versão maior.

## Saúde da plataforma, erro das funções no Sentry e cabeçalhos de segurança (05/10/2026)

Rodada B. Os três tratam do mesmo problema: saber que algo quebrou antes de uma academia ligar.

- **Monitor de fora.** O alerta de rotinas e o Vigia rodam dentro do Supabase. Se o banco ou o pg_cron param, quem avisaria parou junto.
  - A função pública `saude` (`verify_jwt` desligado) lê `saude_plataforma()`, que só a service role chama.
  - Ela responde 200 só quando o banco responde, alguma rotina do pg_cron terminou bem nos últimos 15 minutos e o alerta de rotinas rodou nas últimas 2 h 15 min. Fora isso, responde 503.
  - Devolve só três booleanos e guarda a resposta 30 s por instância.
  - Quem chama é o **monitor de disponibilidade do Sentry**, de minuto em minuto, com 3 falhas seguidas para acusar. Ele foi criado pela API, sem conta nova em outro serviço, mas **está desligado**: o plano gratuito pede saldo de uso avulso para ligá-lo, e essa decisão é do responsável. **Superado em 05/10/2026:** quem chama é o UptimeRobot, no plano gratuito, de 5 em 5 minutos, junto com o site e o app (decisão do responsável; detalhes em `docs/INFRAESTRUTURA.md`). O do Sentry segue desligado. Conferido: os três monitores criados pela API v3 deram verde na primeira checagem, avisando o e-mail comercial.
- **Erro das funções no Sentry** (projeto `edge-functions`, segredo `SENTRY_DSN_FUNCOES`). As 53 funções passaram a entrar por `servir` (`_shared/servir.ts`) em vez de `Deno.serve`:
  - O erro não tratado vira 500 com corpo JSON, e não mais a página de erro do runtime.
  - O 500, o 502 e o 504 vão ao Sentry, sem SDK (`_shared/sentry.ts`). O 503 fica de fora, porque é a resposta de propósito de recurso desligado.
  - **O que sai é só o nome da função, o status, o tipo e o código do erro, e o rastro.** A mensagem não sai, porque a do banco pode trazer o valor de uma coluna; o corpo da requisição nunca é lido. O teste confere com um erro de chave duplicada com CPF.
  - A mesma falha vai uma vez a cada 5 minutos por instância, para um laço não gastar a cota gratuita.
- **Cabeçalhos de segurança** no `vercel.json`. Valem já: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY` e `Permissions-Policy` (sem microfone, localização, pagamento e USB). O HSTS a Vercel já mandava.
  - **A CSP entrou só observando** (`Content-Security-Policy-Report-Only`), com os relatos indo ao Sentry. Ela libera o script embutido do `index.html` pelo hash.
  - O hash tem de ser do texto com quebra de linha LF, que é como o arquivo sai do git para o build. Calculado com o CRLF da cópia local, ele não batia com o de produção.
  - `cabecalhos.guarda.test.ts` falha se o script mudar sem o hash. Passar a CSP a valer é decisão, depois de alguns dias sem relato.

**Conferido:**
- O guarda do `servir` e do evento: nenhuma função com `Deno.serve`, cada uma com o nome da própria pasta, e o CPF da mensagem fora do evento.
- O guarda dos cabeçalhos, com um caractere mudado no script derrubando o teste.
- As 53 funções no `deno check`.
- `saude_plataforma()` fechada para quem está logado e para o anônimo.
- As 53 funções publicadas, nenhuma respondendo 5xx sem credencial, e a `saude` respondendo 200 em GET e HEAD.
- **A corrente do Sentry**, com uma função temporária que lançava um erro com um número no texto e outra que respondia 502:
  - os dois eventos chegaram com a função, o status, o tipo, o código e o rastro, e sem o texto do erro;
  - a regra de e-mail do projeto disparou;
  - a função foi apagada e os dois eventos foram resolvidos.

## Aviso no celular: lotes, validade e agrupamento por conversa (05/10/2026)

Rodada B. O chat, o comunicado e o resumo semanal mandavam o aviso cada um do seu jeito. Os três tinham os mesmos três problemas:
- **um aviso por vez**: um comunicado para 400 alunos esperava 400 envios em fila;
- **sem validade**: o serviço de push (Google, Apple, Mozilla) guardava o aviso por até quatro semanas, e a mensagem de chat de ontem aparecia dias depois como nova;
- **sem agrupar**: dez mensagens viravam dez avisos empilhados.

Agora todo aviso sai por `enviarAvisos` (`_shared/push.ts`), e as regras moram em `_shared/avisoPush.ts`, sem Deno, testadas no app.

- **Lotes de 25 ao mesmo tempo**, com prazo de 10 s por envio. A inscrição que não existe mais (404, 410, ou 403 de chave VAPID trocada) sai do banco numa consulta só por lote.
- **Validade por tipo de aviso:**
  - chat, 12 horas;
  - resumo semanal, 3 dias;
  - comunicado, até ele expirar, entre 1 hora e 7 dias, ou 3 dias quando não tem data.
- **Agrupamento:**
  - **No aparelho, a etiqueta.** `treino:<aluno>`, `dieta:<dieta>`, `comunicado:<id>` e `resumo:<academia>`. O service worker usa a etiqueta com `renotify`: o aviso novo da mesma conversa substitui o anterior e o celular toca de novo.
  - **No serviço de push, o tópico.** Com o aparelho desligado, só o último aviso da conversa fica guardado.
  - O chat passa `conversa` ao `send-chat-push`. O que não está no formato não agrupa.
- **As leituras das inscrições conferem o erro.** Antes, uma falha virava "nenhum aparelho para avisar". A resposta de erro do `send-chat-push` deixou de ecoar a mensagem do erro.
- `avisoPush.test.ts` falha se outra função voltar a usar o `web-push` direto, ou se o service worker deixar de agrupar.

**Um defeito que só a corrente real mostrou.** O prazo de 10 s ia como a opção `timeout` do `web-push`. No runtime do Supabase, que roda Deno 2.1, essa opção arma o prazo na conexão, e a conexão é reaproveitada. O prazo do envio anterior disparava no meio do seguinte: o aviso chegava ao aparelho e contava como falha. Localmente, com Deno 2.9, não reproduz. Agora o prazo é nosso, por cima da promessa, e o log registra o código do erro e o status da inscrição que saiu do banco.

**Conferido:** 861 testes e a **corrente real**, com 8 verificações. Foi usada uma inscrição de verdade do Chrome no serviço de push do Google, com o `send-chat-push` publicado, o `sw.js` de produção e uma academia temporária apagada no fim:
- o aviso chega com a etiqueta da conversa;
- a segunda mensagem da mesma conversa substitui a primeira, e o aparelho fica com um aviso só;
- o aviso sem conversa não agrupa;
- a inscrição inexistente sai do banco, e a boa continua.

O Chrome sem janela perde a conexão com o serviço do Google e passa a receber 410. A corrente roda com a janela fora da tela.

## O teste de ponta a ponta também no painel do gestor (05/10/2026)

Rodada B. Pela conferência, **o E2E de produção falhava em todo deploy desde 02/10/2026.** Naquele dia, a academia "ARKE Homologação" foi excluída pela Visão Master, e com ela saiu a conta de teste do aluno. A fumaça da matrícula pública e a jornada do aluno não tinham mais onde entrar, e ninguém percebeu, porque o E2E não bloqueia merge.

- **A academia de testes voltou** com um nome que diz para que serve: "ARKE Homologação — testes automáticos" (`homologacao`, em trial até 2030). O CLAUDE.md marca a academia e as contas como permanentes.
- **`scripts/migracao/conta-e2e.mjs` refaz tudo**:
  - com `--criar-organizacao`, recria a academia;
  - monta as duas contas, a do aluno e a da gestora (`e2e-gestor@arkefit.com.br`), com a mesma senha;
  - grava a senha no secret `E2E_SENHA` sem imprimi-la.
- **As duas contas têm a mesma senha porque o workflow só passa `E2E_EMAIL` e `E2E_SENHA`**, e o token destas sessões não altera `.github/workflows`.
- **`e2e/painel-gestor.spec.ts`**: a gestora entra e percorre dez telas (painel, alunos, mensagens, financeiro, catracas, comunicados, retenção, Gestão 360, organização e ajuda). O teste falha com erro de JavaScript, queda na tela de erro ou resposta 5xx do Supabase. O que a CSP acusar fica anotado, sem reprovar. O teste só lê.
- **Um defeito de tela que o teste achou.** Enquanto consultava os documentos pendentes, o aceite mostrava o painel e o trocava pela tela de aceite um instante depois. O painel piscava e disparava as próprias consultas à toa. Agora o aceite mostra só o indicador de carregamento até saber se há documento pendente.

**Conferido:** os 12 testes de ponta a ponta contra produção, com as contas e os secrets recriados: os 9 de fumaça, os 2 da jornada do aluno e o do painel do gestor.
