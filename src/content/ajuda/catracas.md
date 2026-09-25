A catraca decide quem entra pela mesma regra do app: aluno **em dia** passa; **pausado** é barrado; **inadimplente** passa durante os 5 dias de tolerância e é barrado depois. Quem gira a catraca ganha presença no ARKE, como quem faz check-in por QR Code.

A tela [Catracas](/admin/catracas) mostra o estado de cada equipamento e os últimos acessos, ao vivo.

## Como funciona

No computador da recepção roda o **Gateway Local**, um programa da ArkeFit que fica entre a catraca e o ARKE. A catraca pergunta ao Gateway, o Gateway pergunta à nuvem, e a resposta volta em menos de um segundo. A instalação é feita por um técnico; veja [Instalação do Gateway Local](ajuda:gateway-local-tecnico).

## Os estados do Gateway

- **No ar**: tudo normal.
- **Contingência**: a internet da academia está falhando. A catraca continua funcionando, decidindo pelo cadastro guardado no computador, e os acessos sobem quando a conexão voltar. Nenhuma entrada se perde.
- **Sem sinal**: o computador do Gateway está desligado, sem internet ou com o programa parado. Confira se o computador está ligado e conectado. Se passar de 10 minutos no horário de funcionamento, o gestor recebe um e-mail avisando.
- **Nunca conectou**: o Gateway ainda não foi instalado ou configurado.

## Ações pela tela

Com o Gateway na versão 1.0, gestor e recepção podem, pelo ARKE:

- **Sincronizar agora**: manda o cadastro de alunos atualizado para o computador na hora, em vez de esperar a próxima rodada automática.
- **Enviar acessos guardados**: sobe o que ficou guardado durante uma queda de internet.
- **Diagnóstico**: confere o Gateway e os equipamentos.
- **Liberar catraca**: abre a catraca a distância, com **motivo obrigatório**. A liberação fica registrada e **não conta presença** para ninguém.

## Por que um aluno foi barrado?

Os **Últimos acessos** mostram cada tentativa e o motivo: pausado, inadimplente, não encontrado. Para liberar o aluno de verdade, resolva a situação dele na ficha; a catraca segue a situação, e a mudança chega ao equipamento na próxima sincronização (ou na hora, com **Sincronizar agora**).

## Visitantes de Wellhub e TotalPass

Com um parceiro ligado em [Integrações](/admin/configuracoes/integracoes), a tela mostra o **Check-in de visitante**, e a **Conferência de parceiros** conta os check-ins do mês para conferir com o repasse de cada parceiro.

> O QR Code do ARKE é o da recepção, lido pelo celular do aluno. Mostrar QR Code na catraca não libera ninguém.
