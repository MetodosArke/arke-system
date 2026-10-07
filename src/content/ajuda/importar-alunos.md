Para trazer a base de alunos do sistema anterior, exporte uma planilha de lá e importe em [Importar Alunos em Massa](/admin/alunos/importar). O botão fica em **Alunos & Prescrições → Importar em massa**.

![A importação: escolha o arquivo e confira de qual coluna vem cada campo.](/ajuda/telas/importar.jpg)

## Antes de começar

- O arquivo pode ser **.csv** ou **.xlsx**, com até **5 MB** e **2.000 linhas**. Base maior: divida em mais de um arquivo.
- A **data de nascimento** é opcional. Sem ela, ou com uma data que não dá para ler, o aluno fica com idade desconhecida e a informa no app (ou a recepção, na ficha). Veja [Aluno menor de idade e o responsável legal](ajuda:menores-de-idade).
- Toda linha precisa de **nome, e-mail e CPF**. O CPF é obrigatório porque a matrícula gera cobrança; linha sem CPF válido não entra, e o motivo aparece na tela.
- Planilhas exportadas do **EVO, Tecnofit, Next Fit e Pacto** já são reconhecidas: o ARKE sugere sozinho qual coluna é o nome, o e-mail, o telefone e a situação. Colunas de outra pessoa, como "Nome da mãe" ou "CPF do responsável", são ignoradas.
- O ARKE conserta o que as exportações costumam estragar: nome todo em maiúsculas vira "Carlos Eduardo da Silva", CPF que perdeu o zero à esquerda volta a ter 11 dígitos, e o 55 do Brasil sai do celular.
- Plano, datas do contrato e código de cartão ou de catraca não são importados. O plano é criado no ARKE, e o cartão é cadastrado na ficha do aluno.

## Passo a passo

1. Clique na área indicada e escolha o arquivo.
2. Confira o **mapeamento**: para cada coluna da planilha, o campo do ARKE que ela preenche. Mapeie pelo menos Nome e E-mail para seguir. Sobrenome ou DDD em coluna separada podem ser mapeados para "Sobrenome (junta ao nome)" e "DDD (junta ao telefone)".
3. Opcional: a coluna de situação (em dia, inadimplente, pausado), o endereço e até a última avaliação física, se o sistema antigo exportar peso, dobras e perimetria.
4. Inicie a importação. Cada linha mostra o resultado: importada, importada com aviso ou com erro, e o motivo.

## Fechou a aba no meio?

Não tem problema. O ARKE grava o andamento linha a linha. Ao abrir a tela de novo, aparece **Existe uma importação inacabada** com o botão **Retomar importação**, e não é preciso escolher o arquivo de novo.

## Linhas com erro

Corrija o que a tela apontou (e-mail repetido, CPF com dígito errado) e use **Tentar de novo só as que falharam**. Reimportar a planilha inteira devolveria centenas de "já existe" e esconderia os erros de verdade.

## E depois?

A importação **não manda e-mail** aos alunos. Para eles entrarem no app, divulgue o convite único da academia: o QR Code na recepção e o link no grupo e no Instagram. Cada aluno digita o e-mail ou o celular cadastrado e recebe, nessa hora, o próprio link para criar a senha. Assim o e-mail sai quando o aluno pede, espalhado pelos dias, e não centenas de uma vez. Veja [Convite de primeiro acesso e guia do aluno](ajuda:primeiro-acesso-aluno).

Quem já tinha conta no ArkeFit, em outra academia, fica ligado à sua com a mesma conta e a mesma senha, desde que o CPF da planilha seja o da conta. A exceção é quem fez uma matrícula online pelo link de outra academia e ainda não criou a senha pelo e-mail: essa linha falha até a pessoa confirmar (veja [Cadastrar aluno](ajuda:cadastrar-aluno)).

> Situação que o ARKE não consegue interpretar faz a linha falhar, em vez de adivinhar. "Bloqueado", do EVO, é lido como inadimplente; aluno inativo ou cancelado não é importado.
