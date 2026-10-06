As cobranças do aluno são criadas pelo ARKE e processadas pelo **Asaas** (Asaas Gestão Financeira Instituição de Pagamento S.A., CNPJ 19.540.550/0001-21), instituição de pagamento autorizada pelo Banco Central. A parte da academia cai direto na conta Asaas dela. O aluno escolhe PIX, boleto ou cartão na fatura, e vê tudo no app, em **Perfil → Pagamentos da academia**. Toda tela de pagamento mostra o selo do Asaas e o atendimento dele.

## Quem atende o quê

- **O pagamento em si** (a fatura, o PIX, o boleto, o cartão, a conta Asaas da academia): o atendimento do Asaas, **0800 009 0037** (pessoa jurídica; também por mensagem) e **contato@asaas.com.br**.
- **O ARKE** (a matrícula, a ficha, o bloqueio, as telas): o suporte da ArkeFit, pelo botão **Falar com o suporte** ou pela [Central de Ajuda](ajuda:assistente-academia).

![Na ficha: o plano da academia com as mensalidades, as cobranças avulsas e o endereço.](/ajuda/telas/ficha-plano.jpg)

## Matricular num plano

Na ficha do aluno, bloco **Plano da Academia**, clique em **Matricular** (só a gestão e a recepção matriculam e cobram):

1. escolha o plano;
2. se o valor for diferente do plano, informe o valor combinado;
3. se houver, informe a **taxa de matrícula**, que sai numa fatura à parte vencendo hoje.

A primeira mensalidade vence **no dia da matrícula**, e as seguintes no mesmo dia dos meses seguintes. Se a taxa de matrícula falhar, a matrícula continua valendo, e a tela diz onde emitir a taxa de novo.

## Cartão automático

Com o cartão cadastrado, a mensalidade é cobrada todo mês sem o aluno precisar pagar a fatura. O aluno cadastra no app (Perfil → Pagamentos), ou a recepção cadastra na ficha, com o aluno presente. O ARKE guarda só os 4 últimos dígitos e a bandeira.

No dia da matrícula, a primeira mensalidade é paga pela fatura; o cartão passa a valer a partir do dia seguinte. Se o cartão for recusado numa cobrança do mês, o aluno não perde o acesso na hora: abre uma tarefa de cobrança na fila, com o link da fatura.

## Pausar, retomar, mudar o valor ou cancelar o plano

No bloco Plano da Academia, gestor e recepção têm:

- **Pausar**: a mensalidade para de ser emitida. A do mês que o aluno não vai usar é retirada; a que já venceu continua valendo, porque é de um período usado.
- **Retomar**: volta a cobrar.
- **Alterar valor**: vale para a próxima mensalidade e para a que já foi emitida e ainda não venceu.
- **Cancelar**: encerra a matrícula no plano, com o motivo registrado. As mensalidades em aberto deixam de ser cobráveis, então cobre antes o que houver para receber. Sem outra matrícula ativa ou pausada, a catraca deixa de liberar o aluno na hora, e a digital e o rosto dele saem dos equipamentos depois de 48 horas; numa troca de plano, faça a matrícula nova nesse prazo e a digital fica.

Ao pausar o aluno (situação **pausado**), o ARKE pergunta se é para pausar também a mensalidade do plano. Desmarque se a academia cobra durante o trancamento.

O cancelamento do plano é feito pela academia; o aluno não cancela o plano pelo app, porque o contrato é com ela.

## Cobrança avulsa

Para o que não é mensalidade (avaliação física, personal, diária, produto), use o bloco **Cobranças avulsas** da ficha, em **Nova cobrança**. A tela mostra, antes de emitir, quanto a academia recebe. O valor mínimo é R$ 5,00, exigência do Asaas.

Se a emissão não se confirmar por falha de conexão, a cobrança aparece com **Tentar de novo**, que reaproveita a que já existir no Asaas em vez de duplicar.

## Cobrança na conta da academia

Por padrão, a mensalidade e a avulsa saem da conta Asaas da ArkeFit, com a divisão automática: a parte da academia vai para a conta dela, e a taxa de processamento fica com a ArkeFit. Quando a equipe da ArkeFit liga, na ficha da academia, a **cobrança na conta da academia**, a mensalidade e a avulsa **novas** saem da conta Asaas da própria academia, sem divisão e sem a taxa de processamento: a academia recebe o valor inteiro, e a tarifa do Asaas é cobrada pelo Asaas, direto da academia. A prévia na tela diz isso antes de emitir.

- O que já existia continua onde nasceu: uma mensalidade criada antes continua sendo cobrada, pausada e cancelada na conta de antes.
- O Método ARKE continua saindo da conta da ArkeFit, porque é um serviço da ArkeFit.
- Para isso, a chave da conta Asaas da academia precisa estar conectada em **Financeiro → Notas fiscais**. Sem ela, a cobrança não sai, e a tela diz o que falta.
- A receita, o bloqueio e a inadimplência funcionam do mesmo jeito.

## Mensalidade atrasada

Mensalidade vencida sem pagamento marca o aluno como **inadimplente**, com os 5 dias de tolerância, e abre tarefa de cobrança para a recepção. O pagamento libera sozinho. Cobrança avulsa atrasada abre tarefa, mas não bloqueia o aluno.

> Segunda via: o aluno encontra a fatura em aberto no app, com o botão **Pagar**. Na ficha, **Copiar link** manda a mesma fatura pelo WhatsApp.
