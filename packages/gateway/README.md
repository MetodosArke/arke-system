# ARKE® Gateway Local 1.0

Programa Node.js/TypeScript que roda **no computador da recepção da academia**
e liga a catraca física à plataforma ArkeFit no Supabase. Decide o acesso em
menos de um segundo, continua decidindo quando a internet cai, e recebe ordens
da nuvem (cadastrar a digital do aluno, liberar a catraca, apagar o aluno do
equipamento).

```
Catraca Control iD ──HTTP──▶ ┐
                              │  ARKE Gateway Local  ◀──── escuta longa ────▶  catraca-comandos
Catraca Topdata ─▶ ponte .NET ┘   (porta 4571)               (telemetria, ordens, resultados)
                                     │
                                     ├──▶ catraca-validar-acesso       (cada leitura)
                                     ├──▶ catraca-confirmar-giro       (girou / desistiu)
                                     ├──▶ catraca-sincronizar-alunos   (cadastro local, por diferença)
                                     └──▶ catraca-sincronizar-logs-offline (o que foi decidido sem internet)
                                     │
                               cache offline (NeDB, em disco)
```

**Quem disca é o equipamento.** A Control iD faz `POST` a cada leitura e
espera a decisão na resposta da mesma requisição; a Topdata fala com a ponte
`ArkeInnerBridge`, que fala com o Gateway. O Gateway não abre conexão para a
catraca para decidir acesso — só para administrá-la (cadastro e remoção).

## Equipamentos

| Marca | Situação na 1.0 |
|---|---|
| **Control iD** (modo Pro) | Decisão de acesso, confirmação de giro pelo Monitor (iDBlock), contingência, **gestão remota**: cadastro do aluno, da digital e do cartão pelo ARKE, cópia entre as catracas da academia, remoção e liberação remota. |
| **Topdata** (Inner, via EasyInner.dll) | Decisão de acesso, giro, contingência e bilhetes, pela ponte `packages/ponte-topdata` — ver `docs/PONTE_TOPDATA.md`. Sem gestão remota: o cadastro no equipamento é feito nele. |
| **Henry, Dimep** | Sem integração. Os fabricantes não publicam documentação e não há equipamento para bancada: a conexão é feita na implantação do primeiro cliente de cada marca. O Gateway **se recusa a subir** com elas, com mensagem explicando. |
| `mock` | Driver de desenvolvimento, sem hardware. |

## Como funciona

1. **Leitura.** O equipamento identifica o aluno (digital, cartão ou CPF no
   teclado) e manda o número do usuário dele — nunca a digital.
2. **Decisão na nuvem**, dentro de `tempo_timeout_ms` (padrão 1000 ms,
   medido: mediana de 405 ms). A regra é a mesma do app: pausado e
   inadimplente fora da tolerância são barrados.
3. **Contingência.** Nuvem fora ou lenta: decide pelo cadastro local, marca
   o ícone em amarelo e guarda o acesso para subir depois.
4. **Giro.** Liberado não é "entrou": com o Monitor da iDBlock
   (`confirmacao_giro: "catra_event"`) a presença só conta quando a borboleta
   gira; desistência não conta.
5. **Sincronização por diferença** a cada 5 minutos, conferida por hash; se
   divergir, pede a lista inteira na mesma rodada.
6. **Canal de comandos (1.0).** Uma chamada fica pendurada em
   `catraca-comandos` esperando ordem (até 25 s) e volta assim que ela existe
   — a ordem chega em ~1 s, sem abrir porta na rede da academia. Cada chamada
   leva a telemetria (versão, estado, fila offline, equipamentos vistos) e os
   resultados das ordens executadas. É por ela que a Visão Master sabe, em
   ~20 s, que um Gateway caiu.

## Configuração

```bash
cp config.example.json config.json
```

| Campo | Descrição |
|---|---|
| `organization_id` | UUID da organização (informativo — quem autentica é o token) |
| `token_api_local` | O `device_token` do dispositivo, copiado em **Catracas** no painel |
| `supabase_url` | URL do projeto Supabase |
| `modelo_catraca` | `controlid` \| `topdata` \| `mock` (`henry` e `dimep` são recusados) |
| `catraca_ip` / `catraca_porta` | Endereço de referência do equipamento |
| `escuta_host` / `escuta_porta` | Onde o Gateway escuta o equipamento (padrão `0.0.0.0:4571`, alcançável na rede da academia) |
| `tempo_timeout_ms` | Tempo da validação na nuvem antes da contingência (padrão `1000`) |
| `sincronizar_alunos_intervalo_ms` | Intervalo da sincronização do cadastro local (padrão 5 min) |
| `confirmacao_giro` | `decisao` (padrão) ou `catra_event` (só iDBlock com Monitor configurado) |
| `timeout_giro_ms` | Quanto esperar o aviso de giro (padrão 30 s) |
| `topdata_leitor_entrada` | Topdata: qual leitor é a entrada (1 ou 2) |
| `controlid_equipamentos` | Lista de Control iD para gestão remota: `nome`, `ip`, `porta` (80), `usuario` (`admin`), `senha`, `sentido_entrada` (`clockwise`\|`anticlockwise`). Vazia: sem gestão remota, cadastro manual no equipamento. |

**A senha do equipamento fica só neste arquivo, na máquina da academia.** Para
a nuvem vai o nome de cada equipamento (para a recepção escolher o leitor),
nunca IP nem senha.

## Uso

```bash
npm install
npm run dev              # desenvolvimento (tsx, sem build)
npm run check            # verificação de tipos (src + tests)
npm test                 # testes (vitest)
npm run build            # compila para dist/
npm run build:exe        # executável Windows (pkg) — o instalador usa scripts/gateway-installer.iss (Inno Setup)
npm run emular:controlid -- --usuario 12            # faz o papel da catraca contra um Gateway rodando
npm run emular:controlid -- --servir 8081           # faz o papel da API de gestão do equipamento
```

O emulador serve de ensaio de instalação: confirma que o Gateway está
alcançável, que o aluno é liberado e que a presença aparece no ARKE — e, com
`--servir`, que cadastro, digital, cartão, liberação e remoção chegam ao
"equipamento" — antes de haver catraca na parede.

Diagnóstico local (só da própria máquina): `http://127.0.0.1:4570/status`.
Sonda da porta do equipamento, alcançável pela rede: `http://IP:4571/health`.

## Dado biométrico

- A digital é comparada **dentro do equipamento**. Para decidir acesso, o que
  trafega é o número do usuário.
- O cadastro remoto devolve as imagens da digital lida; o Gateway lê só o
  "deu certo" e descarta o resto. O template atravessa a memória do Gateway
  para ser copiado às outras catracas da academia, pela rede local, sem ser
  guardado, registrado em log ou enviado à nuvem.
- Cadastrar a digital exige a autorização do **próprio aluno**, dada no app
  (conferida no banco). Retirar a autorização, excluir ou anonimizar o aluno
  gera a ordem de apagá-lo de todas as catracas; onde não há gestão remota,
  vira tarefa com desfecho obrigatório para a recepção.

## Testes

`npm test` — 112 testes, sem rede e sem hardware:

- decisão online e contingência (libera em dia, nega inadimplente e pausado,
  cache vazio), fila offline e reenvio;
- receptores Control iD e Topdata com os payloads da documentação, giro,
  desistência, bilhetes, rotas da ponte presas à própria máquina;
- sincronização por diferença, hash e concorrência;
- gestão remota contra um equipamento Control iD falso (ordem de remoção,
  cópia entre equipamentos, sessão vencida, senha errada, desistência do
  aluno no leitor);
- canal de comandos (fila única do equipamento, liberação que não espera
  cadastro, resultado reentregue depois de queda de rede, telemetria);
- configuração (Henry e Dimep recusados) e versão igual à do `package.json`.

## O que só a bancada responde

Sentido de giro da borboleta montada, tempo real de acionamento, leitura de
digital em dedo de academia, variação de firmware, o formato exato de cada
erro do equipamento e o tempo do cadastro remoto. O ensaio com o emulador
prova a conversa; a primeira instalação prova o equipamento.
