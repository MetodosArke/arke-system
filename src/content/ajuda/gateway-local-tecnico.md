Este manual é para o técnico que instala o Gateway Local na academia. Imprima ou salve em PDF pelo botão no alto da página.

## O que é

O Gateway Local é o programa da ArkeFit que liga as catracas ao ARKE. Ele roda num computador Windows **dentro da rede da academia**, sempre ligado, e:

- recebe cada identificação da catraca (digital, cartão ou CPF digitado) e pergunta à nuvem se o aluno pode entrar;
- guarda no disco o cadastro dos alunos e decide sozinho quando a internet cai, subindo os acessos depois;
- recebe ordens da nuvem: sincronizar, liberar a catraca, cadastrar e apagar aluno no equipamento.

Quem conecta é sempre o Gateway e a catraca: **não é preciso abrir porta na internet da academia**, só na rede interna.

## Antes de ir

- Computador Windows 10 ou 11, ligado o dia todo, com IP fixo na rede das catracas.
- O **token do dispositivo**: o gestor cadastra a catraca em **Catracas → Novo dispositivo** e copia o token.
- O modelo, o IP e a senha de administrador de cada catraca.
- Marcas atendidas hoje: **Control iD** (modo online) e **Topdata** (com a ponte `ArkeInnerBridge`). Henry e Dimep são integradas na implantação do primeiro cliente de cada marca; o Gateway se recusa a subir com elas configuradas.

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

- `token_api_local`: o token do dispositivo, copiado em Catracas.
- `modelo_catraca`: `controlid` ou `topdata`.
- `tempo_timeout_ms`: deixe `1000`. Abaixo de 500 o Gateway cai em contingência quase sempre.
- `controlid_equipamentos`: uma linha por Control iD. Com ela, a recepção cadastra aluno, digital e cartão pelo ARKE. O `nome` é o que a recepção vê para escolher o leitor. `sentido_entrada` é o lado da borboleta que é a entrada; confira girando.
- `confirmacao_giro`: deixe `decisao`. Só use `catra_event` na iDBlock com o Monitor configurado (abaixo).

**A senha do equipamento fica só neste arquivo**, no computador da academia. Para a nuvem vai apenas o nome de cada catraca.

## Control iD

1. No equipamento, ative o **modo online (Pro)**, com o servidor apontando para o IP do computador do Gateway e a porta **4571**.
2. Libere a porta 4571 no firewall do Windows (entrada, rede privada).
3. Só na iDBlock, para contar presença apenas quando a pessoa gira: configure o **Monitor** com o IP do Gateway, a porta 4571 e o caminho `api/notifications`, e troque `confirmacao_giro` para `catra_event`.

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

## Conferir antes de ir embora

- Em **Catracas**, o Gateway aparece **No ar**, com a versão.
- Um aluno em dia passa e aparece nos **Últimos acessos**, e a presença aparece na ficha dele.
- Um aluno pausado é barrado, com o motivo.
- Com o cabo de rede do computador desligado por um minuto, o estado vai para **Contingência**, a catraca continua funcionando e, ao religar, os acessos sobem.
- **Liberar catraca** pela tela abre a catraca.

## Diagnóstico no próprio computador

- `http://127.0.0.1:4570/status` mostra o estado, a versão, os acessos guardados e o último erro.
- O ícone na bandeja: verde (no ar), amarelo (contingência), vermelho (sem nuvem e sem cadastro local).

Ensaio sem catraca: `npm run emular:controlid` faz o papel da Control iD, para testar rede e cadastro antes de o equipamento chegar.

> Dúvida na instalação: fale com o suporte da ArkeFit antes de mexer na rede da academia.
