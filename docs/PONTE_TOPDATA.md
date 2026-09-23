# Ponte Topdata (`ArkeInnerBridge`)

A ponte liga as catracas Topdata ao Gateway Local do ARKE. O código fica em `packages/ponte-topdata/`, e o lado do gateway em `packages/gateway/src/receptores/topdata.ts`.

**Situação em 23/09/2026:** implementada e testada até onde dá para ir sem equipamento. A DLL real da Topdata carrega e é chamada nesta máquina. A corrente inteira foi provada com o Inner simulado: ponte → gateway → nuvem → presença. Falta a bancada com um Inner de verdade, ou com o Kit Integrador (ver o fim deste documento).

## Por que existe uma ponte

A Topdata não expõe protocolo de fio. A integração que ela sanciona é a biblioteca **`EasyInner.dll`**, e o manual oficial do SDK Inner Acesso descreve três características que decidem a arquitetura:

| Característica | Onde está no manual | Consequência |
|---|---|---|
| DLL **Windows 32 bits (x86)**, exige .NET Framework 3.5 | §1.2, §1.3.3 | o processo precisa ser x86 |
| **Bloqueante** | §2.1, §4.3.1 | não pode rodar no event loop do Node |
| **Não thread-safe**: acesso serializado numa única thread | §2.1, §6.2 | uma thread dedicada, sempre |

O Gateway Local é Node. Chamar uma DLL bloqueante via FFI congelaria o event loop, e com ele o receptor da Control iD, o diagnóstico e a sincronização. O próprio manual indica a saída (§1.2.1): uma camada intermediária que traduz requisições web para chamadas da DLL. A ponte é essa camada, e **não conhece regra de negócio**: quem decide o acesso continua sendo o gateway.

```
  catraca Topdata ──TCP 3570──▶ ArkeInnerBridge (.NET, x86) ──HTTP localhost──▶ Gateway Local ──HTTPS──▶ nuvem
```

## O que a primeira execução contra a DLL real encontrou

**O registro que o instalador do SDK não fez.** No modo em que a catraca conecta no computador (TCP com porta fixa, tipo 2), a `EasyInner.dll` não abre a porta sozinha. Ela ativa por COM o `Topdata.Inner.Comunicacao.InnerIPListener`, que mora na `Inner.dll`, um componente .NET 2.0. Um componente .NET só é alcançável por COM depois de registrado com o **RegAsm**, e o registro exige administrador. Sem ele, `AbrirPortaComunicacao` devolve **8, "erro GPF"**, que não diz nada a quem está instalando. O manual lista "DLL não registrada" como primeira causa desse código e afirma que o instalador "geralmente" faz o registro. No computador em que a ponte foi escrita, não tinha feito: as 30 classes COM da `Inner.dll` estavam sem registro.

Duas pistas confirmaram a causa. Com o tipo 1 (porta variável, em que o computador é quem disca), a mesma DLL abre sem erro. E o erro 8 continuou igual com a chamada feita de dentro de uma janela Windows, o que descartou a hipótese de a DLL precisar de fila de mensagens.

Agora a ponte detecta isso: se a abertura devolve 8 e o componente não está registrado, ela mostra o comando exato. O `--verificar-dll` também faz essa conferência.

## Instalação na academia

No computador que vai ficar ligado à rede das catracas, o mesmo do Gateway Local:

1. **SDK Inner Acesso:** rodar o instalador `Instalador DLLs SDK InnerAcesso.exe` **como administrador**. Ele instala a `EasyInner.dll` e as DLLs de apoio em `C:\Windows\SysWOW64`.
2. **.NET Framework 3.5:** no Windows 10/11 ele vem desligado. Ative em *Recursos do Windows* → ".NET Framework 3.5".
3. **Registrar o componente de escuta** num Prompt de Comando **como administrador**:
   ```
   "C:\Windows\Microsoft.NET\Framework\v2.0.50727\RegAsm.exe" "C:\Windows\SysWOW64\Inner.dll" /codebase
   ```
   É o RegAsm **de 32 bits e do .NET 2.0**, porque a `Inner.dll` é x86 e foi compilada para o CLR 2.0.
4. **Firewall:** liberar a entrada TCP na porta **3570** (manual §3.2).
5. **Catraca:** no menu do equipamento, apontar o *IP do servidor* para este computador e a porta para 3570, e anotar o **número do Inner** (manual §3.1.2).
6. **Ponte:** copiar `ArkeInnerBridge.exe` e preencher `ponte.config.json` (modelo em `ponte.config.example.json`).
7. **Conferir antes de ligar:**
   ```
   ArkeInnerBridge.exe --verificar-dll
   ```
   Cada linha deve sair `ok`. Sem equipamento conectado, "Inner N não respondeu" é o esperado.
8. **Gateway:** `modelo_catraca: "topdata"` no `config.json` do gateway. Se a entrada for o leitor 2, ajustar `topdata_leitor_entrada: 2`.

### Configuração (`ponte.config.json`)

| Campo | Padrão | O que é |
|---|---|---|
| `porta` | 3570 | porta em que a catraca conecta |
| `gateway_url` | `http://127.0.0.1:4571` | o receptor do gateway (`escuta_porta`) |
| `timeout_gateway_ms` | 5000 | acima disso a leitura é negada com "SEM SISTEMA" |
| `mudanca_offline_automatica` | `false` | ver *Sem a ponte, a catraca trava* |
| `inners[].numero` | 1 | número configurado no equipamento |
| `inners[].modo` | `entrada_controlada` | `entrada_controlada` (saída livre) ou `entrada_e_saida` |
| `inners[].dois_leitores`, `leitor_entrada` | `false`, 1 | só em `entrada_e_saida` |
| `inners[].invertida` | `false` | catraca montada do lado oposto ao padrão |
| `inners[].tipo_leitor` | 3 (Wiegand) | 0 barras · 1 magnético · 2 Abatrack · 3 Wiegand · 4 smart card · 5 barras serial · 6 Wiegand FC · 7 barras/prox/QR |
| `inners[].digitos_cartao` | 14 | dígitos que o leitor entrega |
| `inners[].teclado`, `digitos_teclado` | `true`, 11 | 11 dígitos para o aluno digitar o CPF |
| `inners[].biometria` | `false` | Inner com módulo biométrico (identificação 1:N no equipamento) |
| `inners[].tempo_acionamento_s` | 5 | quanto tempo o relé fica acionado |
| `inners[].timeout_giro_s` | 20 | quanto esperar o aviso de giro |

## Como funciona

**Máquina de estados** (`src/MaquinaInner.cs`): segue a sequência do manual (§2.1.2) e do exemplo oficial. Conectar → firmware → configuração offline → coleta de bilhetes → mensagens offline → relógio → mudança automática → configuração online → mensagem padrão → formas de entrada → polling. Cada passo faz no máximo uma rodada de chamadas à DLL, e a ponte percorre todas as catracas numa thread só. As regras de configuração (acionamento, leitores, bits de formas de entrada) foram transcritas do exemplo e testadas contra os mesmos números. Com biometria, os bytes coincidem com a enumeração do SDK (100, 101, 103), o que confere a ordem dos bits.

**A consulta ao gateway sai da thread da DLL.** Não é chamada à DLL, e segurar a thread nela congelaria as outras catracas e o `PingOnLine` enquanto a nuvem responde.

**Sem a ponte, a catraca trava.** No exemplo da Topdata, o equipamento que perde o computador cai para o modo offline e **libera qualquer cartão**, registrando o bilhete, sem saber se o aluno está pausado ou inadimplente. Para o ARKE isso é abrir a catraca justamente quando ninguém está olhando. Por isso:

- a mudança automática para offline fica **desligada** por padrão: sem a ponte, a catraca não libera ninguém, a mesma postura da Control iD;
- a configuração offline, que o equipamento guarda e usa se reiniciar sem a ponte, tem **lista de acesso branca e vazia**, que nega todos.

Se uma academia quiser a catraca funcionando com o computador desligado, será preciso gravar a lista de alunos no equipamento e mantê-la sincronizada. É outro trabalho, e fica registrado como decisão.

**Bilhetes.** O que a catraca guardou sozinha (cartão mestre, liberação manual no equipamento) é coletado a cada reconexão. Cada bilhete vai **para o disco no instante da coleta** (`bilhetes-pendentes.jsonl`), porque coletar o tira da memória da catraca, e só sai do arquivo depois de o gateway aceitar. No gateway, o bilhete vira passagem com giro confirmado, na hora em que aconteceu.

**Log:** `ponte.log`, ao lado do executável. **CPF digitado no teclado aparece mascarado** (`CPF ***09`), porque o log fica em disco no computador da recepção.

## Contrato com o gateway

As três rotas só atendem a própria máquina (`127.0.0.1`). O receptor escuta na rede por causa da Control iD, mas sem essa trava qualquer aparelho da rede poderia perguntar "o identificador 123 é de quem?" e colher nomes de alunos.

### `POST /topdata/evento`

```json
{ "inner": 1, "origem": 2, "complemento": 0, "valor": "000123" }
```

`origem` segue o manual (§4.3.2): 1 teclado, 2 leitor 1, 3 leitor 2, 5 fim do tempo de acionamento (não girou), 6 giro confirmado, 12 biometria, 21 QR Code. O exemplo C# do SDK não tem o 21; o manual tem.

Resposta:

```json
{ "liberar": true, "sentido": "entrada", "nome": "Jean Ramos", "motivo": "Acesso liberado." }
```

- **Leitura:** 11 dígitos no teclado viram CPF; o resto vira `identificador_catraca`. A biometria chega como o número do usuário **dentro do equipamento**: a digital é comparada lá, como na Control iD, e nenhum dado biométrico trafega.
- **Giro:** a Topdata sempre avisa, com origem 6 (girou) ou 5 (não girou). Todo acesso liberado fica **esperando o aviso daquele Inner**. Se girou, vira presença; se não girou, vira desistência, que não conta. Se não chega aviso no prazo, o acesso fecha como "sem confirmação", que conta. Quando a ponte não consegue liberar a catraca, ela avisa "não girou", para quem ficou do lado de fora não ganhar presença.
- **Contingência:** acesso decidido pelo cache do gateway vai para a fila offline com o giro pendente, e o aviso o fecha.

### `POST /topdata/bilhetes`

```json
{ "inner": 1, "bilhetes": [{ "tipo": 10, "valor": "777", "ocorrido_em": "2026-09-22T18:45:00-03:00" }] }
```

### `POST /topdata/ponte-viva`

```json
{ "inners": [1, 2], "conectados": [1] }
```

É o sinal de vida da ponte, a cada 30 s. Serve para o diagnóstico distinguir **catraca parada** de **ponte caída**, que pedem providências diferentes.

## Modos de execução

| Comando | Para quê |
|---|---|
| `ArkeInnerBridge.exe` | operação normal |
| `ArkeInnerBridge.exe --verificar-dll` | confere a instalação: DLL, registro do componente, porta escutando e resposta de cada Inner |
| `ArkeInnerBridge.exe --simular` | ensaio sem catraca: um Inner simulado, comandado por texto (`c 777` cartão, `t 12345678909` teclado, `b 12` digital, `desiste`, `bilhete 777`, `cair`/`voltar`, `ajuda`) |

O `--simular` é o equivalente do emulador da Control iD, com um limite que vale dizer: aqui não há protocolo para imitar byte a byte. O que se simula é a resposta de cada chamada da DLL, no formato que o exemplo oficial espera. Isso prova a ponte, o gateway, a nuvem e a presença. **Não prova a DLL nem o equipamento.**

## Build e testes

```
powershell -ExecutionPolicy Bypass -File packages/ponte-topdata/build.ps1
```

O build usa o compilador que já vem no Windows (.NET Framework 4.x), sem Visual Studio. A compilação é sempre `/platform:x86`. O mesmo script roda os 24 testes da ponte, que também rodam no CI (job `ponte-topdata`, runner Windows).

## Conferido em 23/09/2026

- **DLL real:** a `EasyInner.dll` instalada carrega e responde. A abertura da porta no tipo 2 devolveu 8 por falta do registro COM, e a ponte explica isso com o comando certo.
- **24 testes da ponte**, com mutação: desligar a trava do modo offline, o aviso de "não girou" na liberação recusada ou o ping durante a espera do gateway faz o teste correspondente falhar.
- **Gateway:** 11 testes novos do receptor (giro por Inner, desistência, prazo, leitura nova fechando a anterior, contingência registrada, bilhetes, recusa de endereço externo), também com mutação.
- **Corrente real**, com a ponte em `--simular` e o gateway e a nuvem de verdade, 13 verificações:
  - quem girou ganhou presença, e quem desistiu não;
  - o aluno pausado foi barrado;
  - o CPF digitado no teclado liberou e virou presença;
  - o cartão desconhecido foi negado e registrado;
  - o bilhete guardado durante a queda do equipamento subiu, com giro confirmado, depois da reconexão;
  - a ponte reconectou sozinha;
  - o CPF não apareceu inteiro no log.

## Roteiro da bancada

O que só o equipamento responde, na ordem de fazer:

1. `--verificar-dll` com o Inner ligado: **"Inner N respondeu"**. Se não responder, conferir o IP do servidor configurado na catraca, a porta, o firewall e o número do Inner.
2. Subir a ponte e o gateway: no log, **"Inner Acesso firmware x.y.z"** e **"online e aguardando leitura"**. Anotar a linha e o firmware (§5.1: Inner Acesso é mais limitado que Controle Catraca).
3. **Cartão cadastrado** (`identificador_catraca` igual ao número que o leitor entrega): conferir se o valor que aparece no log bate com o cadastrado. Se vier com zeros ou dígitos a mais, ajustar `digitos_cartao`.
4. **Sentido:** a catraca gira para o lado certo? Se não, `invertida: true`. Com dois leitores, conferir qual é a entrada (`leitor_entrada` na ponte e `topdata_leitor_entrada` no gateway).
5. **Giro e desistência:** passar e não passar. No banco, `giro = confirmado` e `giro = desistencia` em `acessos_catraca_logs`.
6. **Tempo de acionamento:** gente passando devagar não pode gerar "não girou". Ajustar `tempo_acionamento_s`.
7. **Ponte desligada:** fechar a ponte e passar um cartão. **A catraca não pode liberar.** Depois, reiniciar a catraca sem a ponte e repetir, porque é aí que vale a lista branca vazia da configuração offline. Se liberar em algum dos dois, é defeito grave: parar e rever `RegrasInner`.
8. **Bilhete:** se o equipamento tiver liberação manual ou cartão mestre, usar com a ponte fora e conferir se o registro sobe ao reconectar. Conferir também se o último caractere descartado do bilhete (herdado do exemplo oficial) está certo para esse leitor.
9. **Biometria** (se houver): o número que chega na origem 12 é o usuário cadastrado no equipamento. Testar com a mão suada, com calo de barra e com magnésio.

## O Kit Integrador

A Topdata oferece um **Kit Integrador** que simula a catraca em bancada, sem hardware de instalação (manual §6.5, §8.3). O pedido é feito pelo **suporte@topdata.com.br**, e o suporte exige cadastro de integrador (§8.2). Com ele, os passos 1 a 6 do roteiro podem ser feitos antes do primeiro cliente.

## Limite de escala

O manual (§1.1, §6.7) registra um limite prático de **~30 equipamentos por instância da DLL**. Acima disso, rodam várias instâncias da ponte, cada uma numa porta. Para academia, esse limite não chega a pesar.
