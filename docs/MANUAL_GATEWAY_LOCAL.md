# Manual do ARKE® Gateway Local

> Pacote: `packages/gateway` · Executa **dentro da rede local da academia** (não na nuvem)
> Público-alvo: equipe técnica/suporte responsável por instalar e manter o middleware que conecta a catraca física ao ArkeFit.

## Sumário

1. [O que é e como funciona](#1-o-que-é-e-como-funciona)
2. [Instalação](#2-instalação)
3. [Configuração](#3-configuração)
4. [Contingência Offline](#4-contingência-offline)
5. [Diagnóstico e suporte](#5-diagnóstico-e-suporte)
6. [Limitações conhecidas](#6-limitações-conhecidas)
7. [Control iD: configurar o equipamento e ensaiar sem hardware](#7-control-id-configurar-o-equipamento-e-ensaiar-sem-hardware)

---

## 1. O que é e como funciona

O ARKE Gateway Local é um middleware Node.js/TypeScript que roda num computador **dentro da rede local da academia** (nunca na nuvem) e faz a ponte de baixa latência entre a catraca física e a plataforma ArkeFit no Supabase:

```
Catraca física (TCP) ⇄ ARKE Gateway Local ⇄ Supabase Edge Functions
                              │
                        cache offline
                        (NeDB, em disco)
```

Fluxo de uma leitura de credencial:

1. O driver da catraca (`src/drivers/`) recebe a leitura (hoje só CPF é validado pela nuvem — outros tipos de credencial são capturados mas ainda negados com mensagem clara).
2. O `GatewayService` chama `POST /functions/v1/catraca-validar-acesso` com timeout estrito (`tempo_timeout_ms`, padrão 300ms).
3. Se a nuvem responde a tempo: libera/nega conforme a resposta — o próprio Edge Function já grava o log em `acessos_catraca_logs`.
4. Se a nuvem falhar ou estourar o timeout (**modo contingência**): o Gateway consulta o cache local e decide liberar/negar por conta própria — ver [Contingência Offline](#4-contingência-offline).
5. Um ícone na bandeja do sistema (Windows) mostra o status: 🟢 online · 🟡 contingência (usando cache local) · 🔴 desconectado (sem nuvem e sem cache).

## 2. Instalação

### 2.1 Pelo instalador com assistente (recomendado)

1. Execute **`arkefit-gateway-setup.exe`** no computador Windows conectado à catraca.
2. O assistente instala o binário em **`%ProgramFiles%\ArkeFit Gateway`**, junto com um `config.example.json` (só na primeira instalação — não sobrescreve um `config.json` já existente).
3. São criados dois atalhos: um no Menu Iniciar e um em **inicialização do Windows** (`userstartup`) — assim o Gateway sobe sozinho como serviço de bandeja toda vez que o computador liga.
4. Ao final, o assistente já pergunta se você quer iniciar o Gateway imediatamente.

### 2.2 Build manual (para quem gera o instalador)

O `arkefit-gateway-setup.exe` é compilado a partir do código-fonte (`packages/gateway`) com:

```powershell
npm run build:exe        # gera dist-exe/arkefit-gateway.exe (via @yao-pkg/pkg, cross-compile p/ Windows)
iscc scripts\gateway-installer.iss   # exige Inno Setup, só compila em Windows
```

### 2.3 Rodando sem instalar (desenvolvimento/homologação)

```bash
cd packages/gateway
npm install
cp config.example.json config.json   # depois edite — ver seção 3
npm run dev                           # modo desenvolvimento (tsx, sem build)
```

Para testar o fluxo completo sem hardware físico, use `"modelo_catraca": "mock"` no `config.json` — o `MockDriver` é totalmente funcional e simula leituras de CPF.

## 3. Configuração

Todos os parâmetros vivem em `config.json`, na mesma pasta do executável (`%ProgramFiles%\ArkeFit Gateway\config.json` numa instalação padrão):

| Campo | Descrição |
|---|---|
| `organization_id` | UUID da organização (informativo — a autenticação real é pelo `token_api_local`) |
| `token_api_local` | **O `device_token`** copiado da tela `/admin/catracas` no painel web (botão "Copiar" ao lado do dispositivo cadastrado) |
| `supabase_url` | URL do projeto Supabase (ex.: `https://SEU-PROJETO.supabase.co`) |
| `catraca_ip` / `catraca_porta` | Endereço IP e porta da catraca física na rede local |
| `modelo_catraca` | `controlid` \| `topdata` \| `mock`. `henry` e `dimep` são **recusados na partida**, com mensagem: a integração dessas marcas é feita na implantação do primeiro cliente de cada uma |
| `tempo_timeout_ms` | Timeout da validação na nuvem antes de cair para o cache local (padrão `1000`). Medido: a validação leva ~400 ms normalmente e até 4 s na partida a frio. **Abaixo de ~500 ms o Gateway cai em contingência em quase todo acesso** |
| `sincronizar_alunos_intervalo_ms` | Intervalo entre sincronizações do cache local de alunos (padrão `300000` = 5 min) |
| `escuta_host` / `escuta_porta` | Onde o Gateway **escuta** o equipamento (padrão `0.0.0.0:4571`). A Control iD disca para o Gateway, não o contrário: esta porta precisa estar aberta na rede da academia |
| `confirmacao_giro` | `decisao` (padrão): o acesso liberado já conta presença. `catra_event`: só conta quando a catraca confirma o giro — exige o Monitor configurado (seção 7) e **só existe na iDBlock** |
| `timeout_giro_ms` | Quanto esperar a confirmação de giro (padrão `30000`). Sem confirmação no prazo, conta presença |
| `topdata_leitor_entrada` | Topdata: qual leitor físico é a entrada, `1` ou `2` (padrão `1`). Tem de bater com `leitor_entrada` da ponte |
| `controlid_equipamentos` | Control iD que o Gateway **administra** (versão 1.0): lista de `{ "nome", "ip", "porta": 80, "usuario": "admin", "senha", "sentido_entrada": "clockwise" }`, um por catraca. Com ela, a recepção cadastra aluno, digital e cartão pelo ARKE e a remoção do aluno é automática. Vazia: cadastro manual no equipamento, como antes. O `nome` é o que a recepção vê para escolher o leitor; `sentido_entrada` é o lado da borboleta que é a entrada, e só a montagem física responde |

> **A senha do equipamento fica só no `config.json`**, na máquina da academia. Para a nuvem vai apenas o nome de cada equipamento.

> **Onde conseguir o `token_api_local`**: no painel web, gestor ou admin_arke acessa `/admin/catracas`, cadastra (ou já tem cadastrado) o dispositivo, e clica em "Copiar" ao lado dele. Se o token precisar ser trocado (vazamento, troca de equipamento), um SuperAdmin pode resetá-lo em `/superadmin` (ação "Resetar Token do Gateway Local") — isso invalida o token antigo imediatamente, exigindo atualizar o `config.json` local com o novo valor.

Depois de editar `config.json`, reinicie o Gateway (ou reinicie o computador, já que ele sobe automaticamente).

## 4. Contingência Offline

O Gateway nunca deixa a catraca "cega" mesmo sem internet — dois mecanismos de cache local em disco, usando **NeDB** (banco de arquivo único, sem servidor):

### 4.1 Cache de alunos (`alunos-cache.db`)

- Populado periodicamente (a cada `sincronizar_alunos_intervalo_ms`, padrão 5 min) chamando a Edge Function **`catraca-sincronizar-alunos`**, autenticada pelo mesmo `token_api_local` da catraca.
- **A primeira sincronização traz a lista inteira; as seguintes, só a diferença** desde a anterior (desde 23/09/2026). A nuvem devolve quem mudou (cadastro, CPF, situação, ou a tolerância de 5 dias do inadimplente que venceu sem ninguém editar nada), quem saiu, e o **hash dos ids** que o cache deve ter. O Gateway aplica a diferença, confere o hash e, se não bater — aluno excluído, que não deixa linha para aparecer na diferença, ou qualquer divergência não prevista —, pede a lista inteira na mesma rodada.
- O marco da última sincronização fica **só em memória**: Gateway reiniciado começa pela lista inteira, que é o estado seguro. Marco com mais de 7 dias também recebe a lista inteira.
- Por que isso importa: com a lista inteira a cada 5 minutos, a sincronização era quase todo o tráfego da plataforma (~75 KB por rodada numa academia de 500 alunos, ~630 MB/mês). A rodada sem mudança passou a ter ~130 bytes.
- Quando a nuvem está fora do ar (timeout ou erro), o Gateway consulta esse cache local por CPF para decidir liberar (aluno em dia) ou negar (inadimplente/não encontrado) — sem depender da internet.

### 4.2 Fila de logs pendentes (`logs-pendentes.db`)

- Toda liberação/negação decidida **em modo contingência** (sem conseguir falar com a nuvem no momento) é enfileirada aqui, com `sincronizado: false`.
- Assim que a conexão com a nuvem volta, o Gateway envia os logs pendentes **em lote** para a Edge Function **`catraca-sincronizar-logs-offline`**, que os insere em `acessos_catraca_logs` — nenhum acesso registrado offline é perdido.
- Depois do envio confirmado, os registros são marcados `sincronizado: true` (e podem ser limpos periodicamente).

### 4.3 Estados da bandeja do sistema

| Ícone | Estado | Significado |
|---|---|---|
| 🟢 | Online | Nuvem respondendo dentro do timeout — validação em tempo real |
| 🟡 | Contingência | Nuvem indisponível/lenta — decidindo pelo cache local, enfileirando logs |
| 🔴 | Desconectado | Sem nuvem **e** sem cache local utilizável — catraca não consegue validar |

## 5. Diagnóstico e suporte

O Gateway expõe um servidor HTTP local de diagnóstico (Fastify, porta **4570**, **só em `127.0.0.1`** — nunca exposto fora da máquina):

- `GET http://127.0.0.1:4570/health` → `{ ok: true }` (confirma que o processo está de pé).
- `GET http://127.0.0.1:4570/status` → estado (online/contingência/desconectado), versão, acessos guardados na fila offline, alunos no cadastro local, última sincronização, último erro e os equipamentos que deram sinal desde que o Gateway subiu.
- `GET http://IP:4571/health` → sonda da porta do equipamento, alcançável pela rede da academia.

**Remotamente, pela Visão Master e pela tela Catracas:** o Gateway 1.0 reporta o mesmo estado à nuvem a cada ~20 s, e de lá dá para pedir **sincronizar agora**, **enviar acessos guardados**, **diagnóstico** (com teste de login em cada Control iD configurada) e **liberar a catraca** com motivo registrado. Gateway sem sinal por 15 minutos, no horário configurado, gera e-mail para a ArkeFit.

## 6. Limitações conhecidas

Leia antes de colocar em produção:

1. **Por fabricante.** **Control iD:** implementada e testada sem hardware (seção 7); falta a bancada. **Topdata:** ponte .NET implementada (`packages/ponte-topdata`) e provada com o Inner simulado contra o gateway e a nuvem reais; falta a bancada. Instalação e roteiro em `docs/PONTE_TOPDATA.md` — inclusive o registro da `Inner.dll` como administrador, sem o qual a DLL devolve "erro GPF". **Henry e Dimep:** sem documentação de integração dos fabricantes — a conexão é definida na implantação.
2. **Cartão só cadastrado pelo ARKE.** O cartão cadastrado pelo ARKE fica no equipamento ligado ao número do aluno e chega como identificação, igual à digital. Cartão que ninguém cadastrou chega com o valor bruto e é negado — adivinhar a quem pertence seria pior que negar. **QR Code na catraca é negado**: o QR do ARKE é o do check-in na recepção, lido pelo celular do aluno.
3. **Cadastro no equipamento.** Com `controlid_equipamentos` configurado, o ARKE cria o aluno em todas as Control iD da academia, cadastra digital e cartão com o aluno na frente do leitor (e copia para as outras catracas), e apaga tudo quando o aluno retira a autorização, é excluído ou anonimizado. **Sem gestão remota** (Topdata, ou Control iD sem credencial no config) o cadastro continua manual, e a remoção vira **tarefa para a recepção**, com desfecho obrigatório — apagar no equipamento é obrigação legal, não opcional.
4. **A bandeja do sistema exige um ambiente com GUI** (Windows/desktop Linux/macOS) — em servidores/CI sem display, ela é desativada automaticamente (com aviso no log), sem derrubar o serviço.

## 7. Control iD: configurar o equipamento e ensaiar sem hardware

### 7.1 Modo online

No equipamento, ative o **modo online (Pro)** apontando o servidor para o IP da máquina do Gateway e a `escuta_porta` (padrão `4571`). A catraca passa a enviar cada identificação ao Gateway e a girar conforme a resposta. Se o Gateway sair do ar, ela entra em contingência e o chama a cada minuto em `device_is_alive.fcgi`; responder é o que a traz de volta.

### 7.2 Monitor (só iDBlock): confirmação de giro

"Liberado" não é "entrou": a pessoa pode ser liberada e desistir na frente da borboleta. A iDBlock informa o desfecho pelo **Monitor**. Configure no equipamento (via `set_configuration.fcgi` ou interface web):

| Parâmetro do Monitor | Valor |
|---|---|
| `hostname` | IP da máquina do Gateway |
| `port` | a `escuta_porta` do Gateway |
| `path` | `api/notifications` |

E no `config.json` do Gateway, `"confirmacao_giro": "catra_event"`. A partir daí, a presença do aluno só é registrada quando a catraca confirma o giro; a desistência não conta. Sem o Monitor configurado, **mantenha `decisao`** — com `catra_event` e sem Monitor, toda entrada esperaria 30 s e seria contada sem confirmação.

### 7.3 Ensaio sem catraca: o emulador

A Control iD não tem emulador oficial, e não precisa: o equipamento fala HTTP documentado. O script `scripts/emulador-controlid.mjs` envia exatamente o que a catraca envia e mostra o que o Gateway respondeu, com o tempo de resposta:

```
npm run emular:controlid -- --gateway http://IP-DO-GATEWAY:4571 --usuario 12
npm run emular:controlid -- --usuario 12 --giro desiste
npm run emular:controlid -- --vivo
```

Use na instalação, antes de haver catraca na parede: confirma que o Gateway está alcançável pela rede, que o aluno com aquele `identificador_catraca` é liberado ou negado conforme a situação dele, e que a presença aparece no ARKE. Rodado de outra máquina da rede, também confirma que a `escuta_porta` está aberta.

**Ensaio da gestão remota.** `npm run emular:controlid -- --servir 8081` faz o papel da API de gestão do equipamento (login `admin`/`admin`). Aponte um item de `controlid_equipamentos` para `127.0.0.1:8081` e, pelo ARKE, cadastre o aluno no equipamento, a digital e o cartão, libere a catraca e retire a autorização do aluno: cada chamada aparece no terminal do emulador, com o estado do "equipamento" depois de cada mudança. Foi assim que a corrente inteira foi provada em 23/09/2026 (22 verificações, com o Gateway, a função publicada e o banco reais).

**O que só a bancada responde:** o sentido de giro da borboleta como foi montada, o tempo real de acionamento, a leitura da digital, variações de firmware — e se o `uuid` do aviso de giro é o mesmo da identificação que o originou (o Gateway tem um plano B para quando não é, válido para uma borboleta por vez).
