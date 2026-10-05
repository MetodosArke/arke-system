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
8. [Toletus: o Gateway disca para a placa](#8-toletus-o-gateway-disca-para-a-placa)
9. [Leitores faciais da Topdata](#9-leitores-faciais-da-topdata)
10. [Cadastro do rosto (versão 1.3)](#10-cadastro-do-rosto-versão-13)
11. [Intelbras: o Modo Online (versão 1.5)](#11-intelbras-o-modo-online-versão-15)

A seção 7.4 trata do leitor Control iD numa catraca de outra marca (versão 1.4).

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
| `token_api_local` | O token do dispositivo, mostrado uma vez na tela `/admin/catracas` quando a gestão cadastra a catraca ou gera um token novo |
| `supabase_url` | URL do projeto Supabase (ex.: `https://SEU-PROJETO.supabase.co`) |
| `catraca_ip` / `catraca_porta` | Endereço IP e porta da catraca física na rede local |
| `modelo_catraca` | `controlid` \| `topdata` \| `topdata_facial` \| `toletus` \| `intelbras` \| `mock`. `intelbras` é a linha Bio-T no Modo Online (seção 11). `topdata` é a linha Inner, pela ponte; `topdata_facial` é a linha Easy, em que o leitor facial decide com a resposta do Gateway (seção 9). `henry` e `dimep` são **recusados na partida**, com mensagem: a integração dessas marcas é feita na implantação do primeiro cliente de cada uma |
| `tempo_timeout_ms` | Timeout da validação na nuvem antes de cair para o cache local (padrão `1000`). Medido: a validação leva ~400 ms normalmente e até 4 s na partida a frio. **Abaixo de ~500 ms o Gateway cai em contingência em quase todo acesso** |
| `sincronizar_alunos_intervalo_ms` | Intervalo entre sincronizações do cache local de alunos (padrão `300000` = 5 min) |
| `escuta_host` / `escuta_porta` | Onde o Gateway **escuta** o equipamento (padrão `0.0.0.0:4571`). A Control iD disca para o Gateway, não o contrário: esta porta precisa estar aberta na rede da academia |
| `confirmacao_giro` | `decisao` (padrão): o acesso liberado já conta presença. `catra_event`: só conta quando a catraca confirma o giro — exige o Monitor configurado (seção 7) e **só existe na iDBlock** |
| `timeout_giro_ms` | Quanto esperar a confirmação de giro (padrão `30000`). Sem confirmação no prazo, conta presença |
| `topdata_leitor_entrada` | Topdata: qual leitor físico é a entrada, `1` ou `2` (padrão `1`). Tem de bater com `leitor_entrada` da ponte |
| `toletus_equipamentos` | Placas Toletus (versão 1.1; LiteNet3 na 1.2): lista de `{ "nome", "ip", "liberar": "entrada", "placa": "litenet2" }`, uma por catraca. Na LiteNet2 o Gateway **disca** para a `porta` (7878); na LiteNet3 a placa disca para o Gateway, e `serial` é opcional (sem ele, o Gateway descobre pelo IP). Vazia com o modelo `toletus`: uma placa só, em `catraca_ip`, do tipo de `toletus_placa` (`catraca_porta` não entra). `liberar: "ambos"` é para catraca em que a saída também exige identificação. Na LiteNet2 com leitor de digital, `"leitor_digital": true` (versão 1.6; com uma placa só, `toletus_leitor_digital`): a ficha do aluno passa a cadastrar a digital. Ver seção 8 |
| `toletus_litenet3_porta` / `toletus_litenet3_endereco` | LiteNet3: a porta onde as placas discam (padrão `7880`, **aberta no firewall** do computador) e, se preciso, o endereço deste computador que elas devem discar. Vazio: o Gateway escolhe a interface que alcança cada placa |
| `intelbras_equipamentos` | Terminais Intelbras (versão 1.5): lista de `{ "nome", "ip", "porta": 80, "usuario": "admin", "senha", "canal": 1, "rosto": true }`. Com ela, o Gateway configura o Modo Online em cada terminal ao subir, cadastra e apaga o aluno, abre a porta e desativa no terminal quem a academia barrou. `intelbras_endereco` força o endereço deste computador que os terminais chamam; `intelbras_configurar: false` deixa a configuração à mão. Ver seção 11 |
| `topdata_faciais` | Leitores faciais da Topdata (versão 1.2): lista de `{ "nome", "ip", "sn", "senha", "porta_http": 80 }`. `sn` é o número de série (opcional: sem ele, o leitor é reconhecido pelo IP); `senha` é a de gerenciamento do menu do leitor, para a abertura remota. Vazia com o modelo `topdata_facial`: um leitor só, em `catraca_ip`. Ver seção 9 |
| `topdata_facial_porta` | Onde os leitores faciais discam (padrão `7792`, a do menu do leitor; **aberta no firewall**) |
| `controlid_equipamentos` | Control iD que o Gateway **administra** (versão 1.0): lista de `{ "nome", "ip", "porta": 80, "usuario": "admin", "senha", "sentido_entrada": "clockwise" }`, um por catraca. Com ela, a recepção cadastra aluno, digital e cartão pelo ARKE e a remoção do aluno é automática. Vazia: cadastro manual no equipamento, como antes. O `nome` é o que a recepção vê para escolher o leitor; `sentido_entrada` é o lado da borboleta que é a entrada, e só a montagem física responde. `"rosto": true` nos equipamentos com reconhecimento facial (iDFace): só nesses a ficha cadastra o rosto (seção 10). `"liberacao"` diz como o equipamento libera a passagem, e `"rele"` qual relé fecha (seção 7.4). O Gateway reconhece cada equipamento pelo `ip` de quem chama, então o IP tem de ser fixo |
| `controlid_liberacao`, `controlid_sentido_entrada`, `controlid_rele` | Como libera a Control iD que **não** está em `controlid_equipamentos` (academia com um equipamento só, sem gestão remota): `catraca` (padrão), `rele` ou `secbox`; o lado da borboleta que é a entrada (`clockwise`, padrão, ou `anticlockwise`); e o relé (1, padrão, ou 2). Seção 7.4 |

> **A senha do equipamento fica só no `config.json`**, na máquina da academia. Para a nuvem vai apenas o nome de cada equipamento.

> **Onde conseguir o `token_api_local`**: no painel web, a gestão acessa `/admin/catracas` e cadastra o dispositivo; o token aparece **uma vez**, na hora. O banco guarda só o hash dele. Se o token se perdeu ou vazou, a gestão clica em **Gerar token novo** na catraca: o antigo para de valer na hora, e é preciso atualizar o `config.json` local com o novo. A ArkeFit também pode invalidar todos os tokens da academia em `/superadmin` ("Invalidar token do Gateway Local"), e aí a gestão gera os novos.

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

1. **Por fabricante.** **Control iD:** implementada e testada sem hardware (seção 7); falta a bancada. **Topdata:** ponte .NET implementada (`packages/ponte-topdata`) e provada com o Inner simulado contra o gateway e a nuvem reais; falta a bancada. Instalação e roteiro em `docs/PONTE_TOPDATA.md` — inclusive o registro da `Inner.dll` como administrador, sem o qual a DLL devolve "erro GPF". **Toletus (LiteNet2 e LiteNet3):** conector pela documentação pública do fabricante, provado com os emuladores contra o Gateway e a nuvem reais (seção 8); falta a bancada. **Topdata facial:** conector pela página de comandos do portal de integradores, provado com o emulador contra o Gateway e a nuvem reais (seção 9); falta a bancada (Kit Integrador da Topdata). **Henry e Dimep:** sem documentação de integração dos fabricantes — a conexão é definida na implantação.
2. **Cartão só cadastrado pelo ARKE.** O cartão cadastrado pelo ARKE fica no equipamento ligado ao número do aluno e chega como identificação, igual à digital. Cartão que ninguém cadastrou chega com o valor bruto e é negado — adivinhar a quem pertence seria pior que negar. **QR Code na catraca é negado**: o QR do ARKE é o do check-in na recepção, lido pelo celular do aluno.
3. **Cadastro no equipamento.** Com `controlid_equipamentos` configurado, o ARKE cria o aluno em todas as Control iD da academia, cadastra digital e cartão com o aluno na frente do leitor (e copia para as outras catracas), e apaga tudo quando o aluno retira a autorização, é excluído ou anonimizado. Com `topdata_faciais`, o ARKE cria e apaga o aluno em todos os leitores faciais da academia, com o mesmo número. Com `leitor_digital` nas placas Toletus LiteNet2, o ARKE cadastra a digital no leitor da catraca com o aluno na frente, copia para os leitores das outras catracas e apaga de todos quando o aluno sai (seção 8.4). **Sem gestão remota** (Topdata Inner, Toletus sem `leitor_digital`, ou Control iD sem credencial no config) o cadastro continua manual, e a remoção vira **tarefa para a recepção**, com desfecho obrigatório — apagar no equipamento é obrigação legal, não opcional.
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

### 7.4 Leitor Control iD numa catraca de outra marca (versão 1.4)

Cada modelo libera de um jeito, e o Gateway responde do jeito daquele equipamento:

| `liberacao` | Modelos | O que o Gateway manda |
|---|---|---|
| `catraca` (padrão) | iDBlock e iDBlock Next | `catra`, no sentido de entrada (`sentido_entrada`) |
| `rele` | iDAccess, iDFit, iDBox, e o leitor que libera a catraca de outra marca pelo contato seco | `door`, no relé configurado (`rele`, 1 ou 2) |
| `secbox` | iDFlex, iDAccess Pro, iDAccess Nano | `sec_box`, no módulo SecBox (id 65793) |

O **iDFace** não aparece em nenhuma lista da documentação da Control iD: libera pelo relé ou pelo SecBox, conforme a instalação. Escolha o que o técnico ligou à catraca.

O equipamento é reconhecido pelo **IP** de quem chama: o listado em `controlid_equipamentos` leva a configuração dele, e o resto leva a padrão (`controlid_liberacao`, `controlid_sentido_entrada`, `controlid_rele`). Por isso o IP de cada equipamento tem de ser fixo.

**Giro:** só a catraca da Control iD avisa o giro (seção 7.2). Leitor que libera pelo relé ou pelo SecBox não avisa nada, e o Gateway não espera por ele, mesmo com `confirmacao_giro` em `catra_event`: a presença conta na liberação. Com uma iDBlock e um leitor na mesma academia, os dois funcionam com a mesma configuração.

**Liberação remota:** pela ficha ou pela tela Catracas, a catraca da Control iD gira no sentido pedido; o leitor dá um pulso no relé ou no SecBox, sem sentido, porque o lado é decidido pela montagem da catraca de outra marca.

**Até a versão 1.3**, a resposta à identificação era sempre a da catraca e no sentido horário, mesmo com outro `sentido_entrada` configurado (ele só valia na liberação remota). Leitor numa catraca de outra marca não liberava nada.

**O que só a bancada responde:** o sentido de giro da borboleta como foi montada, o tempo real de acionamento, a leitura da digital, variações de firmware — e se o `uuid` do aviso de giro é o mesmo da identificação que o originou (o Gateway tem um plano B para quando não é, válido para uma borboleta por vez).

## 8. Toletus: o Gateway disca para a placa

A placa **Toletus LiteNet2** (catracas da Toletus, antiga Actuar) inverte o sentido das outras marcas: ela é o servidor, na porta **7878**, e quem se conecta é o Gateway. O protocolo é aberto: o fabricante publica o manual de comandos e os pacotes de integração em github.com/Toletus. Pacotes de 20 bytes por TCP, sem DLL e sem ponte.

### 8.1 Na placa

1. **IP fixo**, pelo Gerenciador Toletus ou pelo menu da catraca.
2. **Entrada controlada, saída livre** no modo de controle. Se a saída também exige identificação, controlada nos dois sentidos e `"liberar": "ambos"` no `config.json`.
3. **Feche o Gerenciador Toletus** e qualquer outro sistema ligado à placa: ela aceita um computador por vez.

Não há porta para abrir no computador do Gateway: a conexão sai dele.

### 8.2 O que acontece em cada leitura

| A placa avisa | O Gateway faz |
|---|---|
| Cartão, código de barras ou teclado | No teclado vale só o **CPF** (11 dígitos): os números do equipamento são pequenos e sequenciais, e quem digitasse "12" entraria como o aluno 12, porque a catraca não tem senha para conferir. Outro número digitado é negado com "Digite o CPF", sem ir à nuvem (desde a versão 1.6). Cartão e código de barras são o `identificador_catraca` do aluno; o número do cartão vale sem os zeros à esquerda |
| Digital reconhecida | O número do usuário no leitor é o `identificador_catraca` |
| — | Decide (nuvem, ou cache na queda de internet) e manda **liberar** com "Bem-vindo!" no display, ou **nega** com uma frase curta ("Fale c/ recepcao", "Nao cadastrado") e toque de erro. O motivo completo fica no registro, não no display público |
| Passagem | Giro confirmado: vira presença |
| Tempo esgotado sem passagem | Desistência: não vira presença |

Sem o Gateway, **a entrada controlada não libera ninguém**: a placa não guarda lista de alunos e só abre por ordem. É a regra do ARKE sem precisar configurar nada.

A conexão se mantém sozinha: o Gateway pergunta o id da placa a cada 10 s (o firmware não responde ao keepalive do TCP, e o pacote oficial da Toletus aprendeu isso em produção), reabre a conexão se a placa ficar 35 s calada e reconecta quando ela cai, com espera crescente até 5 s. Placa que cai com um giro aberto fecha o acesso como "sem confirmação", que conta presença, pela mesma regra do prazo.

### 8.3 Cartão: o número que vai na ficha

O número do cartão é vinculado à mão na ficha do aluno: o Gateway não tem o que cadastrar, porque o número vem do próprio cartão. Para descobrir o número que o leitor dá a um cartão, passe o cartão na catraca: como ainda não é de ninguém, ele aparece em **Catracas → Últimos acessos** como "Número lido". O número impresso no cartão pode ser outro. Com o leitor de digital configurado, o campo **Cartão** fica no bloco do Gateway, na ficha.

Cada aluno tem **um número só**: o do cartão ou o da digital. Vincular o cartão a quem já tinha digital troca o número, e a digital do número antigo sai dos leitores sozinha.

### 8.4 Digital pelo ARKE: o leitor SM25 (versão 1.6)

As catracas LiteNet2 com digital têm o leitor **SM25** (fabricado pela CAMA), e a placa o expõe na porta **7879** do mesmo IP. O protocolo é o do manual do fabricante do leitor, que a própria Toletus publica junto com o pacote de integração dela. Com `"leitor_digital": true` na placa (ou `"toletus_leitor_digital": true` com uma placa só), o Gateway anuncia o cadastro da digital, e a ficha do aluno passa a ter **Cadastrar digital**, como na Control iD:

```json
"toletus_equipamentos": [
  { "nome": "Catraca da entrada", "ip": "192.168.0.60", "leitor_digital": true },
  { "nome": "Catraca dos fundos", "ip": "192.168.0.61", "leitor_digital": true }
]
```

- **O número.** A digital fica no leitor sob um número, e é esse número que a placa manda quando reconhece o dedo. "Cadastrar no equipamento" na Toletus só reserva o número do aluno: a placa não guarda cadastro. O leitor guarda números de até 2 bytes e **3.000 digitais**. Por isso a nuvem dá o número por um **contador da academia**, que só sobe e não conta os números de cartão (de até dez dígitos) vinculados à mão.
- **O cadastro.** Com o aluno na frente do leitor escolhido, ele põe o mesmo dedo três vezes. O display da catraca acompanha ("Ponha o dedo 1/3", "Tire o dedo", "Digital salva"). Leitura ruim não encerra: o leitor pede de novo. Sem dedo por 90 s, o Gateway cancela o cadastro no leitor e a ficha diz por quê. O tempo de espera de cada toque vai a 60 s, como o software da Toletus grava (o de fábrica, 5 s, não dá tempo de explicar ao aluno).
- **Recadastro.** O leitor só cadastra em número vazio. O Gateway lê a digital anterior, apaga, cadastra a nova e, se a nova não sair, **devolve a anterior** ao leitor: o aluno nunca fica sem entrar por um recadastro que falhou.
- **Digital repetida.** O leitor recusa o dedo que já está em outro número, e a ficha mostra qual. O mesmo dedo não vale para dois alunos.
- **As outras catracas.** Cada leitor guarda as próprias digitais. Depois do cadastro, o Gateway lê o registro da digital (498 bytes) e grava nos leitores das outras catracas com `leitor_digital`. O registro atravessa só a memória do Gateway e é zerado em seguida; não vai para log, resultado nem nuvem. Cópia que falha volta na ficha com o nome da catraca, sem desfazer o cadastro.
- **Durante o cadastro**, a digital que a placa reconhecer no leitor daquela catraca é ignorada: o dedo é o de quem está cadastrando, e liberar ali contaria uma presença que ninguém fez. Cartão e teclado seguem valendo.
- **A saída do aluno.** Retirar a autorização, excluir ou anonimizar o aluno, ou trocar o número dele na ficha apaga a digital daquele número em todos os leitores. Número vazio conta como apagado. Leitor fora do ar falha a ordem, que volta a ser tentada.
- **A conexão** com o leitor abre para cada operação e fecha no fim, como o Toletus Hub faz: a placa usa o mesmo leitor para reconhecer quem chega à catraca. O **Diagnóstico** testa cada leitor.

**O que só a bancada responde:** se a placa deixa o leitor livre para o cadastro enquanto o Gateway está conectado na 7879 (o Toletus Hub faz exatamente isso), se ela reconhece o dedo durante o cadastro, a capacidade exata do leitor montado e o tempo real de cada toque.

### 8.5 Ensaio sem catraca

`npm run emular:toletus` abre a porta 7878 e faz o papel da placa: espera o Gateway conectar e manda as leituras que você digitar (`c 123` cartão, `t 52998224725` teclado, `b 42` digital, `g desiste` para a próxima liberação não passar). Ele mostra o que o Gateway mandou: liberação com a mensagem do display, negativa, ou aviso do cadastro da digital. No `config.json` de ensaio, `"modelo_catraca": "toletus"` e `"catraca_ip": "127.0.0.1"`.

Com `--leitor`, ele faz também o leitor de digital, na porta 7879 (`--porta-leitor` muda): `d 1` põe o dedo 1 no leitor, `d -` tira, `i` faz a placa reconhecer o dedo posto e `l` lista as digitais guardadas. O mesmo dedo gera sempre a mesma digital, e é assim que o leitor emulado percebe a repetida. Corrente provada em 03/10/2026 com o Gateway compilado, duas placas emuladas com leitor, as funções publicadas e o banco: 23 verificações, do número reservado à digital apagada dos dois leitores.

Foi assim que a corrente foi provada em 02/10/2026, com o Gateway compilado, as funções publicadas e o banco reais (27 verificações): cartão liberado virando presença, pausada e cartão desconhecido negados com o registro certo, CPF no teclado, digital com desistência sem presença, liberação remota pela tela, e a placa caindo e voltando.

**O que só a bancada responde:** o número que um cartão de verdade produz no leitor, o tempo de liberação configurado na placa, o sentido de giro da catraca montada e o leitor de digital com um dedo de verdade (seção 8.4).

### 8.6 LiteNet3: a placa disca para o Gateway

A placa **LiteNet3**, mais nova, fala outro protocolo: JSON por WebSocket, com a placa como cliente. O Gateway manda à placa, por UDP na porta 7878 dela, o endereço onde está escutando (`ws://IP-do-computador:7880`); a placa guarda o endereço e disca, apresentando o número de série. O anúncio se repete enquanto a placa não conecta, então uma placa trocada ou reiniciada volta sozinha.

1. **IP fixo** na placa e, no `config.json`, `"placa": "litenet3"` na lista (ou `"toletus_placa": "litenet3"` com uma placa só).
2. **Libere a porta 7880** (TCP) no firewall do Windows do computador do Gateway: aqui, ao contrário da LiteNet2, a conexão chega até ele.
3. Opcional: anote o **número de série** da placa em `serial`. Com ele, uma placa diferente no mesmo IP é recusada.

Placa que não está no `config.json` é recusada na porta, antes de abrir a conexão. A decisão, o giro e o display seguem a seção 8.2, com uma diferença: a LiteNet3 com leitor de digital **manda a imagem do dedo** para o servidor comparar. O ARKE não compara digital fora do equipamento, por desenho, então nega com "Use o cartao" e não guarda nada. Na LiteNet3, a academia usa cartão, código de barras ou teclado.

Ensaio: `npm run emular:litenet3` escuta o UDP 7878, recebe o endereço, disca e manda as leituras que você digitar (`c`, `q`, `t`, `x` para um pedaço da imagem da digital, `g desiste`). Corrente provada em 02/10/2026 com o Gateway compilado, as funções publicadas e o banco reais: anúncio e conexão, cartão virando presença, negativas, digital recusada sem ir à nuvem, desistência, liberação remota e a placa reiniciando.

**O que só a bancada responde, além do da 8.5:** o valor exato da mensagem temporária do display (o pacote oficial só documenta "clear"), se o aviso de passagem traz contadores ou só a marca do sentido (o Gateway lê os dois jeitos) e o que a placa faz quando não tem servidor nenhum.

## 9. Leitores faciais da Topdata

Os leitores faciais da Topdata (F4, T4 e T4-50k) falam JSON por WebSocket, e **quem disca é o leitor**, para o servidor configurado no menu dele. Eles aparecem em dois papéis:

| Catraca | Modelo no `config.json` | Quem decide |
|---|---|---|
| **Linha Easy** (Fit Easy, Revolution Easy, Box Easy) | `topdata_facial` | O leitor pergunta ao Gateway a cada rosto (`sendlog`) e libera com a resposta |
| **Fit 4 Facial** (placa Inner com leitor facial) | `topdata`, com a ponte e a lista `topdata_faciais` | A placa Inner, pela ponte de sempre. O leitor só reconhece e passa o número do aluno à placa |

Nos dois, o leitor só reconhece quem está cadastrado nele. O Gateway cria e apaga o aluno em **todos** os leitores da academia, com o mesmo número do ARKE, pelas ordens da ficha do aluno.

### 9.1 No leitor

1. **Configurações → Rede → Servidor:** "Req. Servidor" = Sim, o **IP do computador do Gateway** e a porta **7792**.
2. **Libere a porta 7792** (TCP) no firewall do Windows do computador do Gateway.
3. Anote o **número de série** e a **senha de gerenciamento** do menu em `topdata_faciais` (a senha é para a abertura remota; fica só no `config.json`).

A cada conexão, o Gateway põe o leitor da linha Easy em **"só online"** e recusando desconhecido: sem o Gateway, o leitor nega todo mundo, e isso não depende de o instalador lembrar. O da Fit 4 Facial fica em "só offline", porque quem decide é a placa Inner, e duas decisões para o mesmo acesso seriam erradas. Com a senha configurada, o Gateway também **desliga a foto em cada acesso e a foto de desconhecido** no leitor: ele guardaria o rosto de cada pessoa que passa na frente da catraca, aluno ou não.

### 9.2 O que acontece em cada rosto (linha Easy)

| O leitor avisa | O Gateway responde |
|---|---|
| Rosto de alguém cadastrado | Decide (nuvem, ou cache na queda de internet) e responde com "Bem-vindo!" ou uma negativa curta, como no display da Toletus. A tela do leitor é pública |
| Rosto desconhecido | Nega com "Nao cadastrado", **sem ir à nuvem**. A foto que o leitor manda junto é descartada na leitura da mensagem: não vai para log, nem para a nuvem |
| Registros guardados enquanto estava sem servidor | Responde "recebido", sem liberar nada. No modo "só online" o leitor negou todos, então não há presença a recuperar |
| Cadastro feito no menu do próprio leitor | Responde e avisa no log: quem foi cadastrado por fora não tem o número no ARKE e não é reconhecido como aluno |

A linha Easy **não confirma o giro** (a própria Topdata diz isso no portal): a presença conta pela liberação, como na Control iD sem o Monitor.

### 9.3 Ensaio sem catraca

`npm run emular:facial-topdata -- --http 8080 --senha 1234` disca para a porta 7792, apresenta-se, guarda os usuários que o Gateway cadastra e manda os rostos que você digitar (`r 12` rosto do usuário 12, `d` desconhecido, `h` histórico). Com `--http`, faz também o papel da API HTTP do leitor. Corrente provada em 02/10/2026 com o Gateway compilado, as funções publicadas e o banco reais: modo só online e fotos desligadas, cadastro da aluna pela ficha chegando ao leitor com o número dela, rosto liberado virando presença, negativas, desconhecido e histórico sem ir à nuvem, abertura remota e a aluna excluída saindo do leitor.

**O que só a bancada responde:** quanto tempo o leitor espera a resposta, o que ele faz com o histórico ao reconectar, a ligação da Fit 4 Facial com a placa Inner (o número que a placa lê) e a captura do rosto. O cadastro do rosto pelo ARKE está na seção 10.

## 10. Cadastro do rosto (versão 1.3)

O rosto entra de dois jeitos, decididos pelo responsável em 02/10/2026, e sempre com a autorização do próprio aluno (a mesma da digital, no texto que fala de digital e rosto):

| Caminho | Quem dispara | O que o Gateway faz |
|---|---|---|
| **Câmera do equipamento** | A recepção, na ficha do aluno (**Cadastrar rosto**), com o aluno na frente do leitor | Control iD: `remote_enroll` de rosto, com contagem regressiva. Topdata: `adduser` e `checkregstatus` pela API HTTP do leitor (exige a senha do menu no config). A foto capturada é copiada aos outros leitores faciais da academia, pela rede local |
| **Foto pelo app** | O próprio aluno, em **Perfil → Privacidade**, **uma vez só**: trocar depois é com a recepção, pela câmera. Tentativa que falhou não conta | A foto chega junto com a ordem, só na entrega. O Gateway confere que é JPEG (até 300 KB), entrega a todos os leitores faciais e zera a memória |

**Onde a foto passa, e por quanto tempo.** A foto do app sai do celular já reduzida (480x640, até 150 KB). Na nuvem, mora numa tabela que nenhum papel lê pela API, nem a equipe nem o aluno, e é apagada assim que a ordem fecha, ou em 24 horas no máximo. A ordem guarda só o número da foto. No Gateway, nenhuma foto vai para log, para o resultado da ordem ou para a nuvem. Na Control iD, o Gateway configura `keep_user_image = 0`: o equipamento gera o modelo do rosto e apaga a foto. Retirar a autorização, excluir ou anonimizar o aluno apaga o rosto de todos os leitores, como a digital.

**Antes do texto novo da autorização entrar no ar, nada disso funciona**: o banco recusa os dois caminhos, porque a autorização vigente só fala de digital. A ficha mostra o botão desativado com o motivo, e o app não mostra o envio de foto.

**Na Control iD**, marque `"rosto": true` nos equipamentos faciais em `controlid_equipamentos`. **Na Topdata**, todo leitor facial recebe a foto do app; a câmera só nos que têm a senha do menu no config.

Corrente provada em 02/10/2026 com o Gateway compilado, dois leitores Topdata emulados (`npm run emular:facial-topdata`, um com a API HTTP, outro sem), a função `catraca-comandos` publicada e o banco: a foto saiu da tabela de passagem, chegou aos dois leitores e sumiu do banco; a câmera de um leitor capturou e o Gateway copiou para o outro; foto que já tinha saído virou erro claro; o rosto cadastrado liberou a aluna, e a exclusão a apagou dos leitores.

**O que só a bancada responde:** a qualidade do reconhecimento com a foto tirada no celular, o tempo da câmera de cadastro em cada firmware e se a Topdata guarda a foto de cadastro (a API dela tem a pasta `/photos/`, e não há configuração documentada para não guardar).

## 11. Intelbras: o Modo Online (versão 1.5)

Os terminais da linha Bio-T da Intelbras (faciais SS 3530, SS 3540, SS 5530 e a geração nova SS 3531 a SS 7542; os de digital SS 3430 e SS 5430) chamam o Gateway a cada acesso, no **Modo Online**: o terminal faz `POST /notification` com o evento e espera a decisão, e chama `GET /keepalive` a cada 10 s. Os dois caminhos ficam na mesma `escuta_porta` da Control iD. Os SS 1530 e SS 1540 não têm o Modo Online e ficam fora.

No `config.json`:

```json
"modelo_catraca": "intelbras",
"intelbras_equipamentos": [
  { "nome": "Catraca da entrada", "ip": "192.168.0.60", "porta": 80, "usuario": "admin", "senha": "SENHA_DO_TERMINAL", "canal": 1, "rosto": true }
]
```

- **O Gateway configura o terminal sozinho ao subir** (`intelbras_configurar`, padrão `true`): acerta a hora (e de novo a cada 6 h), aponta o servidor de eventos para o próprio computador e liga o Modo Online, com keepalive de 10 s e 5 s para a decisão. O endereço deste computador é descoberto pela rede que alcança cada terminal; com várias redes, ponha `"intelbras_endereco"`.
- **Na interface web do terminal, um passo à mão:** em Publicidade → Feedback, escolha **Personalizado**. É o que faz a mensagem do Gateway aparecer no display.
- **O terminal é reconhecido pelo IP**, que tem de ser fixo. A senha fica só neste arquivo; os comandos usam autenticação Digest.
- `canal` é o relé que libera a passagem; `rosto: false` nos terminais de digital (SS 3430, SS 5430).

**O que acontece em cada acesso:**

- o terminal reconhece o rosto ou a digital de quem está cadastrado nele e manda o número; cartão que ele não conhece vem com o número lido, e vale como o número do aluno, como na Toletus;
- o Gateway decide com a nuvem, ou com o cadastro local se a internet cair, e responde em até 1 s, dentro dos 5 s do terminal;
- o display mostra "Bem-vindo!" ou uma negativa curta, sem o nome e sem falar de dinheiro;
- **a foto da pessoa que vem em cada acesso é descartada na leitura**, sem log, disco ou nuvem;
- **a saída passa sem consulta**: barrar a saída prenderia lá dentro quem está barrado na entrada;
- sem confirmação de giro: a presença conta na liberação (a Intelbras só avisa a passagem com catraca da própria marca);
- os registros que o terminal guardou enquanto estava sem o Gateway chegam juntos quando ele volta, e as entradas aceitas viram presença na hora em que aconteceram.

**Sem o Gateway, o terminal decide sozinho**, e a documentação diz que libera todo usuário cadastrado nele, 24 horas. Por isso o Gateway **desativa no terminal** (`UserType` 5) quem a academia barrou (pausado, inadimplente fora da tolerância) e reativa quem volta, a cada sincronização. O terminal recusa sozinho o usuário desativado; se ele respeita isso também no modo sem servidor é a pergunta enviada à Intelbras e item de bancada. Com o computador do Gateway ligado, a decisão é sempre da nuvem. "Sem conexão" é o computador do Gateway desligado ou fora da rede, não a internet: sem internet, o Gateway segue respondendo pelo cadastro local.

**Gestão pela ficha do aluno:** cadastrar o aluno em todos os terminais (já desativado, se ele estiver barrado), apagar o aluno e o rosto, abrir a porta a pedido da recepção e entregar a foto do rosto que o aluno mandou pelo app. A Intelbras aceita foto em JPEG de até 100 KB, de 150x300 a 600x1200, e o app já reduz a foto para isso. Ficam no próprio terminal: o cadastro da digital (a captura remota só existe no SS 3430), do cartão (a API não captura cartão) e o do rosto pela câmera do terminal (existe na API e entra depois da bancada).

**Ensaio sem terminal:** `npm run emular:intelbras -- --http 8090 --senha SENHA` faz o papel do terminal: a API dos comandos, com Digest, e o Modo Online depois que o Gateway o configura. Comandos: `r 42` (rosto do usuário 42), `b 42` (digital), `c 12AB` (cartão sem usuário), `s 42` (saída), `h 42` (registro guardado de uma hora atrás), `u` (usuários do terminal). Corrente provada em 03/10/2026 com o Gateway compilado, o emulador, as funções publicadas e o banco: 23 verificações.

**O que só a bancada responde:** se o terminal sem o Gateway respeita o usuário desativado, o tempo real de resposta, o relé ligado à catraca, o formato do número do cartão em cada leitor e se a foto de cada acesso pode ser desligada no Modo Online do SS 5530.
