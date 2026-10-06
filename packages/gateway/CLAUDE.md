# Gateway Local — regras desta pasta

O Gateway Local é o programa que roda no computador da recepção, entre as catracas e a nuvem do ArkeFit. O registro de cada versão e o porquê de cada regra estão em [`docs/registro/catracas.md`](../../docs/registro/catracas.md).

## Como ele conversa

- **Leia o manual do fabricante antes de escrever o driver: quem disca muda de marca para marca.**
  - Control iD e Intelbras chamam o receptor HTTP (porta 4571).
  - A Topdata (linha Inner) chama pela ponte .NET (`packages/ponte-topdata`).
  - Os leitores faciais da Topdata e a Toletus LiteNet3 discam por WebSocket.
  - Na Toletus LiteNet2, quem disca é o Gateway.
- **A decisão é da nuvem** (`validarCredencial`), pela mesma regra do app. O prazo é medido: o padrão é 1000 ms.
- **Espera que dobra a cada falha passa por `comVariacao`** (metade fixa, metade sorteada), senão os Gateways que caíram juntos voltam juntos. `espera.guarda.test.ts` cobra.
- **Contingência:** decide pelo cache local e trava na dúvida. Acesso decidido offline sobe depois (`registrarAcessoOffline`), e nenhuma entrada se perde.
- **A fila offline anda:** cada registro sobe com o `id_local`, e a nuvem diz o que aceitou e o que recusou de vez; os dois saem da fila. O que já subiu sai do computador em 30 dias (`limparAntigos`).
- **O computador da recepção guarda o mínimo:** o cache só tem os alunos atuais e não guarda o nome, e todo arquivo do NeDB é reescrito (`compactarArquivo`) depois de apagar, senão a linha apagada continua no disco.
- **Leitura que vale como aluno** (`core/credencial.ts`): no teclado só o CPF; código de barras e QR não valem nada; cartão e biometria são o número do equipamento.
- **Liberado não é entrou.** O giro fica `pendente`, depois `confirmado`, `desistencia` ou `sem_confirmacao`. Desistência não vira presença; a presença nasce no banco, por gatilho.
- **Canal de comandos** (`catraca-comandos`, escuta longa):
  - a nuvem só pede o que o Gateway anuncia em `capacidades`;
  - as ordens do equipamento rodam uma de cada vez, e as rápidas (liberar, sincronizar) não esperam;
  - resultado que não foi entregue volta para a frente da fila.

## O que nunca sai daqui

- A senha de cada equipamento fica só no `config.json`. Para a nuvem vai só o nome.
- Digital, rosto e foto passam só pela memória (por exemplo, na cópia entre catracas) e são descartados. Nunca vão para log, resultado de comando ou nuvem.
- **O display é público:** "Bem-vindo!" ou "Aluno", nunca o nome. A negativa é curta e não fala de dinheiro, e o motivo fica nos Últimos acessos. A frase é uma só para todas as marcas (`mensagemDoDisplay`, em `core/display.ts`), inclusive a que a ponte Topdata escreve. `catracaPublica.guarda.test.ts`, no app, cobra.

## Quem fala com ele

- O receptor atende só os IPs de `controlid_equipamentos`, `intelbras_equipamentos` e `equipamentos_permitidos`, além da própria máquina (`src/server/origemEquipamento.ts`). Sem lista nenhuma, atende qualquer aparelho e avisa no log.
- As rotas `/topdata/*` atendem só a própria máquina.
- O token do Gateway é um UUID no `config.json`; a nuvem guarda só o hash dele.
- Henry e Dimep: o Gateway se recusa a subir. Marca nova entra com documentação ou com equipamento de bancada.

## Prova

- `npm test` e `npm run check`. O `tsconfig.check.json` olha os testes também.
- **Emuladores** (`npm run emular:*`): escritos do material do fabricante, **sem importar o Gateway**, senão provam só que o código concorda consigo mesmo.
- Defeito plantado de propósito em toda mudança de protocolo, para ver o teste falhar.
- O `vitest.config.ts` tem PostCSS próprio e vazio: sem ele, o Vitest acha a configuração do app na raiz e não sobe no CI.
- **Versão nova:** `src/versao.ts`, o `package.json` e as duas primeiras linhas de versão do `package-lock.json`, juntos (`versao.test.ts`). A Visão Master mostra a versão de cada academia e marca a que está abaixo da mínima (Configurações).
- **Corrente real:** o Gateway compilado, o emulador, as funções publicadas e o banco, numa academia temporária apagada no fim.
