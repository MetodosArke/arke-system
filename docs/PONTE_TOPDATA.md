# Ponte Topdata (`ArkeInnerBridge`) — especificação

Componente que falta para a integração Topdata funcionar em campo. Esta é a especificação dele; o lado do ARKE já está implementado e testado em `packages/gateway/src/receptores/topdata.ts`.

## Por que existe uma ponte

A Topdata não expõe protocolo de fio. A integração sancionada é a biblioteca **`EasyInner.dll`**, e o manual oficial do SDK Inner Acesso é explícito sobre três características que decidem a arquitetura:

| Característica | Onde está no manual | Consequência |
|---|---|---|
| DLL **Windows 32 bits (x86)**, exige .NET Framework 3.5 | §1.2, §1.3.3 | processo precisa ser x86 |
| **Bloqueante** — `ReceberDadosOnLine()` pausa a thread até evento ou timeout | §2.1, §4.3.1 | não pode rodar no event loop do Node |
| **Não thread-safe** — acesso serializado numa única thread | §2.1, §6.2 | uma thread dedicada, sempre |

O Gateway Local é um executável Node. Uma chamada bloqueante via FFI congelaria o event loop e, com ele, o receptor HTTP da Control iD, o servidor de diagnóstico e os timers de sincronização — o gateway inteiro pararia a cada leitura de cartão. Somando x86 obrigatório e empacotamento de módulo nativo com `pkg`, seriam três brigas simultâneas com a stack.

O próprio manual indica a saída (§1.2.1):

> "Se você precisar de uma API REST para seu próprio sistema […] você terá que desenvolver essa API em cima da EasyInner.dll. Ou seja, sua API REST seria uma camada intermediária que traduz requisições web para chamadas da EasyInner.dll e vice-versa."

A ponte é essa camada. **Ela não conhece regra de negócio** — quem decide acesso continua sendo o gateway, que consulta adimplência na nuvem e tem o cache de contingência.

## Desenho

```
  catraca Topdata ──TCP 3570──▶ ArkeInnerBridge (.NET, x86)
                                        │  HTTP localhost
                                        ▼
                                 Gateway Local (Node)
                                        │  HTTPS
                                        ▼
                              catraca-validar-acesso (Supabase)
```

A catraca disca para a ponte — a mesma inversão que a Control iD já obrigou a corrigir. Por isso a Topdata entra como mais um cliente do modelo de escuta que já existe, **sem tocar** em `GatewayService`, no cache offline nem na fila de logs.

## Responsabilidades da ponte

1. **Possuir a DLL** numa única thread dedicada, rodando a máquina de estados documentada no manual (§2.1.2): conectar → configurar offline → configurar mudança automática → configurar online → coletar bilhetes → polling.
2. **Configurar o equipamento** — `ConfigurarInnerOnline()`, `ConfigurarLeitor1/2()`, `ConfigurarTipoLeitor()`, `EnviarConfiguracoes()`.
3. **Manter o online vivo** — `PingOnline()` em intervalo menor que o tempo de `HabilitarMudancaOnLineOffLine(2, tempo)`. Sem isso a catraca cai para offline sozinha.
4. **Traduzir eventos** para o gateway e **traduzir a decisão** de volta em chamada da DLL.
5. **Coletar bilhetes offline** (`ColetarBilhete()`) ao reconectar e repassá-los, para que acesso decidido pela catraca durante queda não se perca.

## Contrato com o gateway

### `POST /topdata/evento`

A ponte envia a cada evento relevante vindo de `ReceberDadosOnLine()`.

```json
{ "inner": 1, "origem": 2, "valor": "000123" }
```

`origem` são os códigos da tabela do manual (§4.3.2), transcritos em `ORIGEM_TOPDATA`:

| Código | Significado | O que a ponte faz com a resposta |
|---|---|---|
| 1 | teclado | libera/nega |
| 2 | leitor 1 | libera/nega |
| 3 | leitor 2 | libera/nega |
| 5 | fim do tempo de acionamento (não girou) | só registra |
| 6 | giro confirmado | só registra |
| 12 | sensor biométrico | libera/nega |
| 21 | QR Code | libera/nega |

Resposta:

```json
{ "liberar": true, "sentido": "entrada", "nome": "Jean Ramos", "motivo": "Acesso liberado." }
```

- `liberar: true` → a ponte chama `LiberarCatracaEntrada()`, `LiberarCatracaSaida()` ou `LiberarCatracaDoisSentidos()` conforme `sentido`, e passa ao estado de monitorar o giro.
- `liberar: false` → `EnviarMensagemTemporariaOnLine()` com `motivo` e `AcionarBipLongo()`.
- `motivo: "giro_confirmado"` ou `"giro_nao_ocorreu"` → eventos de encerramento de ciclo, não são negativa de acesso. Exibir "negado" aqui mostraria erro para quem já passou.

**Como `valor` é interpretado**: 11 dígitos vindos do teclado viram CPF; todo o resto vira `identificador_catraca`. Biometria devolve o número do usuário **dentro do equipamento** — a digital é comparada lá, igual à Control iD, e nenhum dado biométrico trafega.

### `POST /topdata/ponte-viva`

```json
{ "inners": [1, 2] }
```

Sinal de vida da própria ponte, não o `PingOnline` da catraca. Serve para o diagnóstico distinguir **catraca parada** de **ponte caída**, que exigem providências diferentes.

## O que só a bancada resolve

Isto está documentado para não virar surpresa na instalação:

- **Qual leitor é a entrada** — depende de como a catraca foi montada. Configurável em `leitorDeEntrada`; o padrão assume Leitor 1 = entrada.
- **Tempo de acionamento** — `ConfigurarAcionamento1/2()` define por quanto tempo o relé fica acionado; curto demais gera `Origem 5` com gente ainda passando.
- **Tipo e dígitos do leitor** — `ConfigurarTipoLeitor()` e `InserirQuantidadeDigitovariavel()` precisam bater com o leitor físico.
- **Linha 3 vs Linha 4** — placa Inner Acesso é mais limitada que Controle Catraca (§5.1). `ReceberVersaoFirmware()` identifica: código 14 = Inner Acesso, 16 = Controle Catraca.
- **Leitura em dedo de academia** — mão suada, calosidade de barra, dedo ressecado de magnésio. Nenhuma documentação prevê isso.

## Limite de escala

O manual (§1.1, §6.7) registra limite prático de **~30 equipamentos por instância da DLL**. Acima disso, múltiplas instâncias da ponte, cada uma numa porta. Para academia isso não é restrição real — é limite de rede, não de unidade.

## Pendências antes de escrever a ponte

1. **Baixar a SDK** no portal do integrador (instalador registra a DLL) e os exemplos em C#.
2. **Cadastro de integrador** junto à Topdata — exigido para suporte (§8.2).
3. **Kit Integrador**, solicitado ao suporte técnico (§8.3): simula a catraca em bancada, sem hardware. É o caminho para validar a ponte antes de existir academia.
