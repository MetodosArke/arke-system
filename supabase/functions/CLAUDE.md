# Edge functions — regras desta pasta

Funções em Deno, publicadas no projeto `lzyxqjibkfblrrjboylp`. O repositório e o projeto publicado têm exatamente as mesmas funções: função sem código versionado, ou código sem deploy, vira armadilha.

## Antes de publicar

- **O `verify_jwt` de cada função mora em `supabase/config.toml`.** Função pública (webhook, matrícula, primeiro acesso, cron) é declarada lá. Sem a declaração, o Supabase exige JWT, e o cron leva 401.
- **Deploy não é prova.** O empacotador não faz análise de escopo: uma variável fora do bloco passa no deploy e quebra na primeira chamada. O `deno check` de todas as funções roda no `npm run check` (`npm run check:funcoes`); depois do deploy, faça uma chamada autenticada de verdade.
- **Toda chamada externa tem prazo:** `signal: AbortSignal.timeout(...)` em cada `fetch`. `prazoChamadas.guarda.test.ts` cobra.
- **Tipos:** `SupabaseClient` de `npm:@supabase/supabase-js@2`, e não `ReturnType<typeof createClient>`, que o `deno check` recusa.
- **Função que chama o modelo registra o uso** (`registrarUsoIA`, `_shared/usoIA.ts`), sem texto nenhum: `usoIA.test.ts` cobra. O Sentinela fica de fora enquanto estiver congelado.
- Código testável fica num `fluxo.ts` sem Deno nem Supabase, para o teste do app e o sandbox exercitarem o código real, e não uma cópia.

## Erros e logs

- **Toda função entra por `servir("<nome da pasta>", ...)`** (`_shared/servir.ts`), e não por `Deno.serve`. O erro não tratado vira 500 com JSON, e o 500, 502 e 504 vão ao Sentry só com o nome, o status, o tipo e o código. O 503 fica de fora, porque é a resposta de propósito de recurso desligado. `servir.guarda.test.ts` cobra.

- **O supabase-js não lança erro: ele devolve o erro.** Confira o `error` de toda leitura e gravação. No webhook do Asaas, tudo passa por `exigir()`; gravação que falha deixa o aviso sem processar.
- **Log leva só status HTTP e código de erro.** Nunca o corpo, que pode trazer número de cartão, dado de saúde, prompt ou resposta de IA.
- Falha nossa e pedido inválido são respostas diferentes: com o banco fora do ar, a resposta não diz "link expirado".
- **Link de tela do app** em e-mail ou aviso vai com o `#` do HashRouter: `linkDoApp(SITE_URL, rota)` (`_shared/linkDoApp.ts`). Variável de ambiente nova entra em `docs/INFRAESTRUTURA.md` no mesmo PR. `linksDoApp.guarda.test.ts` cobra as duas.

## Quem chama

- Papel da ArkeFit só vale com `verificada(claims)` (as duas etapas), junto da checagem do papel. A gestão, nas ações sensíveis, usa a mesma `verificada`.
- **Vínculo duplo:** filtre `organization_members` por `user_id` **e** `organization_id`; quem está em duas academias quebra o `.maybeSingle()`.
- Para mexer na conta de outra pessoa (e-mail, link de senha), use `alvoSoNaAcademia`. Para cobrar, use `podeCobrarNaAcademia` (`_shared/papelCobranca.ts`).
- Freio por chamada: `dentroDoFreio` (`_shared/freio.ts`), com falha aberta.

## Os módulos de `_shared`

- `asaas.ts` (`ambienteAsaas`): o único que lê a chave do Asaas. Organização em `trial` vai ao sandbox, e chave de produção no lugar do sandbox é recusada.
- `ia.ts`: o Bedrock em São Paulo, com a região fixa e o prazo em toda chamada. Ver `iaNoBrasil.guarda.test.ts`.
- `data.ts`: a data de Brasília, espelho de `src/lib/dataBrasilia.ts`.
- `paginar.ts`: espelho de `src/lib/paginar.ts`.
- `captcha.ts`: o Turnstile. Token recusado é recusado com qualquer status HTTP.
- `tokenCatraca.ts`: o hash do token do Gateway, a mesma conta de `hash_token_catraca()`.
- `responsavel.ts`: o aceite do responsável do aluno menor (`responsavel-pedido` e `responsavel-aceite`): o token do link e o hash dele, e a versão e o hash de cada texto, conferidos contra o app por `textosConsentimento.test.ts`.
- `nascimento.ts`: a data de nascimento e a idade, espelho de `src/lib/menorDeIdade.ts`.
- `encerrarCobrancas.ts`: a saída do aluno cancela o que está vivo no Asaas.
- `clienteAsaas.ts`: a saída do aluno anonimiza o cliente dele no Asaas (na conta da ArkeFit, anonimiza e remove; na da academia, só anonimiza); o CPF e as cobranças ficam. Quem chama lê o CPF antes de `anonimizar_dados_do_aluno`.
- `arquivosDoAluno.ts`: apaga a pasta do aluno nos buckets privados, depois do banco.
- `verificacao.ts`, `alvoNaAcademia.ts`, `papelCobranca.ts`, `freio.ts`, `execucao.ts` e `vapid.ts`: um pedaço de regra cada.

## Asaas e envios

- **Idempotência:** confira o banco antes do gateway, e procure pela `externalReference` (`metodo:`, `plano:`, `b2b:`, `avulsa:`, `nfse:`) antes de criar. Mensagem e e-mail são reservados no banco antes do envio.
- E-mail que uma rotina pode mandar de novo (os agentes, os avisos) vai ao Resend com chave de idempotência. A função chamada por cron autentica com o token do Vault e registra o desfecho por `_shared/execucao.ts`; sem isso, o alerta de rotinas não vê a função que falha com o cron em dia.
