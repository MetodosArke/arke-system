A catraca decide quem entra pela mesma regra do app: aluno **em dia** passa; **pausado** é barrado; **inadimplente** passa durante os 5 dias de tolerância e é barrado depois. Quem teve a **matrícula encerrada** (a última matrícula do plano cancelada) também é barrado. Quem gira a catraca ganha presença no ARKE, como quem faz check-in por QR Code.

O display da catraca é público: mostra "Bem-vindo!" ao liberar e, ao negar, uma frase curta como "Fale c/ recepcao". Nunca o nome do aluno nem o motivo; o motivo fica nos Últimos acessos.

A tela [Catracas](/admin/catracas) mostra o estado de cada equipamento e os últimos acessos, ao vivo.

## Como funciona

No computador da recepção roda o **Gateway Local**, um programa da ArkeFit que fica entre a catraca e o ARKE. A catraca pergunta ao Gateway, o Gateway pergunta à nuvem, e a resposta volta em menos de um segundo. A instalação é feita por um técnico; veja [Instalação do Gateway Local](ajuda:gateway-local-tecnico).

## O token de cada catraca

Cada catraca tem um **token**, que o Gateway usa para falar com o ARKE. Ele aparece **uma vez só**, quando o gestor cadastra a catraca: copie na hora e entregue ao técnico. O ARKE guarda só uma impressão dele, então ninguém consegue copiá-lo depois.

Se o token se perdeu ou pode ter vazado, o gestor clica em **Gerar token novo** na catraca. O token anterior para de valer na hora, e a catraca fica parada até o novo entrar no `config.json` do Gateway. A troca fica registrada.

Cadastrar, gerar token, ativar e desativar são da gestão. A recepção acompanha a tela e usa as ações abaixo.

## Os estados do Gateway

- **No ar**: tudo normal.
- **Contingência**: a internet da academia está falhando. A catraca continua funcionando, decidindo pelo cadastro guardado no computador, e os acessos sobem quando a conexão voltar. Nenhuma entrada se perde.
- **Sem sinal**: o ARKE parou de receber notícias do Gateway. Se o **computador está desligado ou o programa parado**, a catraca não libera ninguém (os terminais Intelbras liberam só quem está cadastrado e ativo neles). Se o computador está ligado e **só falta internet**, a catraca segue funcionando pelo cadastro guardado, e os acessos sobem quando a internet voltar. Confira primeiro se o computador está ligado e com o programa aberto. Se passar de 10 minutos no horário de funcionamento, o gestor recebe um e-mail avisando.
- **Nunca conectou**: o Gateway ainda não foi instalado ou configurado.

## Ações pela tela

Com o Gateway na versão 1.0, gestor e recepção podem, pelo ARKE:

- **Sincronizar agora**: manda o cadastro de alunos atualizado para o computador na hora, em vez de esperar a próxima rodada automática.
- **Enviar acessos guardados**: sobe o que ficou guardado durante uma queda de internet.
- **Diagnóstico**: confere o Gateway e os equipamentos.
- **Liberar catraca**: abre a catraca a distância, com **motivo obrigatório**. A liberação fica registrada e **não conta presença** para ninguém.

## Por que um aluno foi barrado?

Os **Últimos acessos** mostram cada tentativa e o motivo: pausado, inadimplente, matrícula encerrada, não encontrado. Para liberar o aluno de verdade, resolva a situação dele na ficha (ou faça a matrícula nova); a catraca segue a ficha, e a mudança chega ao equipamento na próxima sincronização (ou na hora, com **Sincronizar agora**).

Quando a matrícula termina, a catraca deixa de liberar o aluno na hora. Depois de 48 horas, a digital e o rosto dele saem dos equipamentos e o número dele sai do ARKE. Numa troca de plano (cancelar e matricular de novo), a matrícula nova feita nesse prazo mantém a digital e o número.

## Visitantes de Wellhub e TotalPass

Com um parceiro ligado em [Integrações](/admin/configuracoes/integracoes), a tela mostra o **Check-in de visitante**, e a **Conferência de parceiros** conta os check-ins do mês para conferir com o repasse de cada parceiro.

> O QR Code do ARKE é o da recepção, lido pelo celular do aluno. Mostrar QR Code ou código de barras na catraca não libera ninguém: o aluno entra com digital, rosto, cartão ou o CPF no teclado.
