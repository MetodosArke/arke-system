Este manual é para o técnico que instala o Gateway Local na academia. Imprima ou salve em PDF pelo botão no alto da página.

## O que é

O Gateway Local é o programa da ArkeFit que liga as catracas ao ARKE. Ele roda num computador Windows **dentro da rede da academia**, sempre ligado, e:

- recebe cada identificação da catraca (digital, cartão ou CPF digitado) e pergunta à nuvem se o aluno pode entrar;
- guarda no disco o cadastro dos alunos e decide sozinho quando a internet cai, subindo os acessos depois;
- recebe ordens da nuvem: sincronizar, liberar a catraca, cadastrar e apagar aluno no equipamento.

Quem conecta é sempre o Gateway e a catraca: **não é preciso abrir porta na internet da academia**, só na rede interna.

## Antes de ir

- Computador Windows 10 ou 11, ligado o dia todo, com IP fixo na rede das catracas.
- O **token do dispositivo**: o gestor cadastra a catraca em **Catracas → Novo dispositivo** e copia o token na hora. **Ele aparece uma vez só**; se perder, o gestor gera outro em **Gerar token novo**.
- O modelo, o IP e a senha de administrador de cada catraca.
- Marcas atendidas hoje: **Control iD** (modo online, também como leitor numa catraca de outra marca), **Topdata** (linha Inner com a ponte `ArkeInnerBridge`, e leitores faciais da linha Easy e da Fit 4 Facial), **Toletus** (placas LiteNet2 e LiteNet3) e **Intelbras** (terminais da linha Bio-T, no Modo Online). Henry e Dimep são integradas na implantação do primeiro cliente de cada marca; o Gateway se recusa a subir com elas configuradas.

## Instalação

1. Execute `arkefit-gateway-setup.exe` no computador. Se o Windows mostrar o aviso do SmartScreen, clique em "Mais informações" e em "Executar assim mesmo".
2. O programa fica em `C:\Program Files\ArkeFit Gateway` e sobe sozinho quando o Windows liga.
3. Copie `config.example.json` para `config.json` na mesma pasta e preencha (abaixo).
4. Reinicie o Gateway pelo ícone na bandeja do Windows, ou reinicie o computador.

## O config.json

```
{
  "token_api_local": "TOKEN COPIADO EM CATRACAS",
  "supabase_url": "https://lzyxqjibkfblrrjboylp.supabase.co",
  "modelo_catraca": "controlid",
  "tempo_timeout_ms": 1000,
  "confirmacao_giro": "decisao",
  "controlid_equipamentos": [
    {
      "nome": "Catraca da entrada",
      "ip": "192.168.0.50",
      "porta": 80,
      "usuario": "admin",
      "senha": "SENHA DO EQUIPAMENTO",
      "sentido_entrada": "clockwise"
    }
  ]
}
```

- `token_api_local`: o token do dispositivo, copiado em Catracas quando foi gerado.
- `modelo_catraca`: `controlid`, `topdata`, `topdata_facial` (linha Easy) ou `toletus`.
- `tempo_timeout_ms`: deixe `1000`. Abaixo de 500 o Gateway cai em contingência quase sempre.
- `controlid_equipamentos`: uma linha por Control iD. Com ela, a recepção cadastra aluno, digital e cartão pelo ARKE. O `nome` é o que a recepção vê para escolher o leitor. `sentido_entrada` é o lado da borboleta que é a entrada; confira girando. `liberacao` diz como ele libera (abaixo). O Gateway reconhece cada equipamento pelo `ip`, então o IP tem de ser fixo.
- `confirmacao_giro`: deixe `decisao`. Só use `catra_event` na iDBlock com o Monitor configurado (abaixo).
- `equipamentos_permitidos`: os IPs dos equipamentos que não estão em `controlid_equipamentos` nem em `intelbras_equipamentos`, como a Control iD única sem gestão remota. **Com qualquer uma dessas listas, o Gateway só atende os IPs delas** (e o próprio computador): um aparelho qualquer da rede da academia não consegue se passar pela catraca. Sem lista nenhuma, o Gateway atende qualquer aparelho e avisa isso no log ao subir.

**A senha do equipamento fica só neste arquivo**, no computador da academia. Para a nuvem vai apenas o nome de cada catraca.

## Control iD

1. No equipamento, ative o **modo online (Pro)**, com o servidor apontando para o IP do computador do Gateway e a porta **4571**.
2. Libere a porta 4571 no firewall do Windows (entrada, rede privada).
3. Só na iDBlock, para contar presença apenas quando a pessoa gira: configure o **Monitor** com o IP do Gateway, a porta 4571 e o caminho `api/notifications`, e troque `confirmacao_giro` para `catra_event`.

### Leitor Control iD numa catraca de outra marca

Cada modelo libera de um jeito. Diga qual em `"liberacao"`, no equipamento:

- `catraca` (o padrão): iDBlock e iDBlock Next, que giram a própria borboleta.
- `rele`: iDAccess, iDFit, iDBox, e o leitor ligado à catraca de outra marca pelo contato seco. Ponha também `"rele": 1` ou `2`, o relé que você ligou.
- `secbox`: iDFlex, iDAccess Pro e iDAccess Nano, pelo módulo SecBox.

O iDFace libera pelo relé ou pelo SecBox, conforme a ligação. Sem a lista de equipamentos (um leitor só, sem gestão remota), use `"controlid_liberacao"` e `"controlid_rele"` no começo do arquivo. O leitor não avisa o giro, e o Gateway não espera por ele: a presença conta na liberação.

## Topdata

A Topdata só conversa pela biblioteca oficial dela, então entra uma ponte (`ArkeInnerBridge.exe`) entre a catraca e o Gateway:

1. Rode o instalador do **SDK Inner Acesso** como administrador.
2. Ative o **.NET Framework 3.5** em Recursos do Windows.
3. Registre o componente de escuta num Prompt de Comando **como administrador**:

```
"C:\Windows\Microsoft.NET\Framework\v2.0.50727\RegAsm.exe" "C:\Windows\SysWOW64\Inner.dll" /codebase
```

4. Libere a porta **3570** no firewall.
5. Na catraca, aponte o IP do servidor para o computador, porta 3570, e anote o número do Inner.
6. Preencha `ponte.config.json` e confira com `ArkeInnerBridge.exe --verificar-dll`: cada linha deve sair `ok`.
7. No `config.json` do Gateway, `"modelo_catraca": "topdata"`.

Sem o registro do passo 3 a ponte mostra "erro GPF" (código 8), e explica o comando. Com a ponte desligada, **a catraca não libera ninguém**: é proposital.

Use a ponte e o Gateway da **versão 1.9 ou mais nova**: até a 1.8, o display da Topdata mostrava o primeiro nome do aluno e o motivo da negativa. Hoje mostra "Bem-vindo!" ou "ACESSO NEGADO" com uma frase curta. Leitor de **código de barras ou QR** (`tipo_leitor` 0, 5 ou 7 no `ponte.config.json`) não identifica aluno: a leitura é negada. Para cartão, use um leitor de proximidade.

## Toletus

Na Toletus o sentido é o contrário das outras marcas: a placa LiteNet2 espera na porta **7878** e quem se conecta a ela é o Gateway. Não há porta para abrir no computador.

1. Dê **IP fixo** à placa, pelo Gerenciador Toletus ou pelo menu da catraca.
2. Configure o controle da placa como **entrada controlada, saída livre**. Se a saída também exige identificação, use controlada nos dois sentidos e ponha `"liberar": "ambos"` no `config.json`.
3. **Feche o Gerenciador Toletus** e qualquer outro sistema ligado à placa: ela aceita um computador por vez.
4. No `config.json`, `"modelo_catraca": "toletus"` e `"catraca_ip"` com o IP da placa. Com mais de uma catraca, use a lista:

```
"toletus_equipamentos": [
  { "nome": "Catraca da entrada", "ip": "192.168.0.60" },
  { "nome": "Catraca dos fundos", "ip": "192.168.0.61" }
]
```

5. Cartão: passe o cartão na catraca. Como ele ainda não é de ninguém, aparece em **Catracas → Últimos acessos** com o **número lido**, que é o que vai na ficha do aluno.
6. Catraca com **leitor de digital** (LiteNet2): ponha `"leitor_digital": true` na placa, ou `"toletus_leitor_digital": true` com uma placa só. A ficha do aluno passa a ter **Cadastrar digital**: com o aluno na frente do leitor, ele põe o mesmo dedo três vezes, o display da catraca acompanha, e a digital é copiada para os leitores das outras catracas. Quando o aluno sai ou retira a autorização, a digital sai de todos os leitores sozinha.

```
"toletus_equipamentos": [
  { "nome": "Catraca da entrada", "ip": "192.168.0.60", "leitor_digital": true },
  { "nome": "Catraca dos fundos", "ip": "192.168.0.61", "leitor_digital": true }
]
```

Na Toletus cada aluno tem **um número só**: o do cartão ou o da digital. Vincular o cartão a quem tinha digital troca o número, e a digital antiga sai dos leitores.

Com o Gateway desligado, a entrada controlada **não libera ninguém**: a placa não guarda lista de alunos e só abre quando o Gateway manda. O display mostra "Bem-vindo!" ao liberar e, ao negar, uma frase curta como "Fale c/ recepcao", sem expor o motivo para a fila. No teclado vale só o **CPF**: o número do aluno no equipamento é curto e sequencial, e a catraca não tem senha para conferir, então outro número digitado é negado com "Digite o CPF". Pela mesma razão, **código de barras é negado** com "Acesso negado" (Gateway 1.9).

### Placa LiteNet3

A LiteNet3, mais nova, faz o contrário da LiteNet2: o Gateway avisa a placa do endereço dele e **a placa se conecta ao Gateway**.

1. Dê **IP fixo** à placa e libere a porta **7880** no firewall do Windows do computador (entrada, rede privada).
2. Na lista do `config.json`, marque a placa como LiteNet3. O número de série é opcional; com ele, outra placa no mesmo IP é recusada:

```
"toletus_equipamentos": [
  { "nome": "Catraca da entrada", "ip": "192.168.0.60", "placa": "litenet3", "serial": "00000042" }
]
```

3. Com uma catraca só, basta `"toletus_placa": "litenet3"` e o `catraca_ip`.

Na LiteNet3 a academia usa **cartão ou o CPF no teclado**. Código de barras é negado, como na LiteNet2: o número do aluno no equipamento é curto e sequencial, e um código impresso com ele entraria no lugar do aluno. A placa com leitor de digital manda a imagem do dedo para o computador comparar, e o ARKE não compara digital fora do equipamento: a catraca nega com "Use o cartao".

## Leitores faciais da Topdata

O leitor facial se conecta ao Gateway, como a Control iD. Ele aparece em dois tipos de catraca:

- **Linha Easy** (Fit Easy, Revolution Easy, Box Easy): o leitor pergunta ao Gateway a cada rosto. No `config.json`, `"modelo_catraca": "topdata_facial"`.
- **Fit 4 Facial**: a placa Inner decide, pela ponte de sempre (seção Topdata), e o leitor só reconhece o rosto. Fica `"modelo_catraca": "topdata"`, com a lista dos leitores.

1. No leitor, em **Configurações → Rede → Servidor**: "Req. Servidor" = Sim, o **IP do computador** e a porta **7792**.
2. Libere a porta **7792** no firewall do Windows.
3. Anote no `config.json` o número de série e a **senha de gerenciamento** do menu do leitor (a senha serve para a recepção abrir a catraca pela tela):

```
"topdata_faciais": [
  { "nome": "Catraca da entrada", "ip": "192.168.0.70", "sn": "AYSH01090913", "senha": "SENHA DO MENU" }
]
```

Ao conectar, o Gateway põe o leitor da linha Easy em **"só online"**: com o Gateway desligado, o leitor não libera ninguém. Ele também desliga no leitor a foto de cada acesso e a de desconhecido. A recepção cadastra o aluno nos leitores pela ficha, em **Acesso pela catraca**, e quem sai da academia é apagado de todos sozinho. O rosto entra pela câmera do leitor, pelo botão **Cadastrar rosto** da ficha, ou pela foto que o aluno manda no app, uma vez só.

## Intelbras

Os terminais da linha Bio-T (faciais SS 3530, SS 3540, SS 5530 e a geração nova; os de digital SS 3430 e SS 5430) chamam o Gateway a cada acesso, no **Modo Online**, na mesma porta **4571** da Control iD. Os SS 1530 e SS 1540 não têm o Modo Online.

1. Deixe o IP do terminal fixo e anote o usuário e a senha da interface web dele.
2. Na interface web do terminal, em **Publicidade → Feedback**, escolha **Personalizado**: é o que faz a mensagem do Gateway aparecer no display.
3. No `config.json`, `"modelo_catraca": "intelbras"` e a lista dos terminais:

```
"intelbras_equipamentos": [
  { "nome": "Catraca da entrada", "ip": "192.168.0.60", "senha": "SENHA DO TERMINAL" }
]
```

Ao subir, o Gateway acerta a hora do terminal, aponta o servidor de eventos para este computador e liga o Modo Online sozinho. Ponha `"rosto": false` nos terminais de digital e `"canal": 2` se a catraca está no segundo relé.

**Sem o Gateway, o terminal decide sozinho e libera quem está cadastrado nele.** Por isso o Gateway bloqueia no terminal quem a academia barrou e desbloqueia quem volta: a Intelbras confirmou que o terminal não libera o usuário bloqueado, nem sem o Gateway. Use a versão 1.8.1 ou mais nova. A saída passa sempre, sem consulta. A recepção cadastra e apaga o aluno pela ficha, e o rosto entra pela foto que o aluno manda no app; digital e cartão continuam no próprio terminal.

## Conferir antes de ir embora

- Em **Catracas**, o Gateway aparece **No ar**, com a versão.
- Um aluno em dia passa e aparece nos **Últimos acessos**, e a presença aparece na ficha dele.
- Um aluno pausado é barrado, com o motivo.
- Com o cabo de rede do computador desligado por um minuto, o estado vai para **Contingência**, a catraca continua funcionando e, ao religar, os acessos sobem.
- **Liberar catraca** pela tela abre a catraca.

## Diagnóstico no próprio computador

- `http://127.0.0.1:4570/status` mostra o estado, a versão, os acessos guardados e o último erro.
- O ícone na bandeja: verde (no ar), amarelo (contingência), vermelho (sem nuvem e sem cadastro local).

Ensaio sem catraca: `npm run emular:controlid` faz o papel da Control iD, `npm run emular:toletus` o da placa Toletus e `npm run emular:intelbras` o do terminal Intelbras, para testar rede, cadastro e liberação antes de o equipamento chegar.

> Dúvida na instalação: fale com o suporte da ArkeFit antes de mexer na rede da academia.
