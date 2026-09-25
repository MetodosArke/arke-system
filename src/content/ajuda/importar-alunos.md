Para trazer a base de alunos do sistema anterior, exporte uma planilha de lá e importe em [Importar Alunos em Massa](/admin/alunos/importar). O botão fica em **Alunos & Prescrições → Importar em massa**.

## Antes de começar

- O arquivo pode ser **.csv** ou **.xlsx**, com até **5 MB** e **2.000 linhas**. Base maior: divida em mais de um arquivo.
- Toda linha precisa de **nome, e-mail e CPF**. O CPF é obrigatório porque a matrícula gera cobrança; linha sem CPF válido não entra, e o motivo aparece na tela.
- Planilhas exportadas do **EVO, Tecnofit, Next Fit e Pacto** já são reconhecidas: o ARKE sugere sozinho qual coluna é o nome, o e-mail, o telefone e a situação. Colunas de outra pessoa, como "Nome da mãe" ou "CPF do responsável", são ignoradas.

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

Cada aluno importado recebe um e-mail para criar a senha. Para quem não viu o e-mail, use o convite único da academia, com QR Code. Veja [Convite de primeiro acesso e guia do aluno](ajuda:primeiro-acesso-aluno).

> Situação que o ARKE não consegue interpretar faz a linha falhar, em vez de adivinhar. "Bloqueado", do EVO, é lido como inadimplente; aluno inativo ou cancelado não é importado.
