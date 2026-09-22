# Decisões pendentes do responsável

Lista viva, preenchida durante as rodadas de ajustes do app original. Cada item traz o contexto, o que ficou no ar enquanto a decisão não vem (sempre o padrão mais seguro, de preferência configurável sem deploy) e a recomendação. É entregue consolidada ao fim de todas as rodadas.

## Conteúdo e configuração (sem código)

### 1. Canal de suporte do botão "falar com o suporte"
- **Contexto:** o onboarding da academia tem o botão em cada etapa.
- **No ar:** o botão só aparece com o canal preenchido em **Visão Master → Configurações → Canal de suporte**. Hoje está vazio, então não aparece.
- **Preciso de:** WhatsApp (com DDI) e/ou e-mail de suporte da ArkeFit — ou você mesmo preenche na tela.

### 2. GIFs dos exercícios do app original
- **Contexto:** o pacote do banco original (`arke-banco-setup.zip`) só tem a estrutura; o próprio LEIA-ME diz "não há dados de usuários". Os GIFs, se existem, estão no **armazenamento** (bucket `exercicio-imagens`) do projeto Supabase antigo, não no SQL.
- **Preciso de:** acesso ao projeto Supabase original (ou uma exportação da pasta `exercicio-imagens`). Com isso eu subo os arquivos e ligo cada GIF ao exercício pelo nome.

### 3. Cabeçalhos de exportação dos sistemas anteriores (EVO, Tecnofit, Next Fit, Pacto)
- **No ar:** a importação reconhece os nomes mais comuns desses sistemas (testado com nomes típicos, não com planilhas reais).
- **Preciso de:** se houver, uma exportação (mesmo só a linha de cabeçalho) de algum deles, para conferir.

### 4. Preço da mensalidade B2B do plano Custom e do profissional autônomo
- **No ar:** Starter R$ 390, Growth R$ 790, Enterprise R$ 1.290 (tabela editável em Visão Master → Configurações). Custom e autônomo **não têm preço de tabela**: a mensalidade só começa depois de a ArkeFit definir o valor na ficha da organização.
- **Preciso de:** preço do autônomo (se houver tabela) — o Custom é negociado caso a caso.

### 5. Valores dos planos modelo da academia
- **No ar:** toda academia nova nasce com Mensal R$ 129,90, Trimestral R$ 359,90 e Anual R$ 1.199,90, **inativos** — a academia confere o valor e ativa.
- **Preciso de:** outros valores de referência, se preferir.

## Produto

### 6. Situação do aluno bloqueia o app
- **No ar (Rodada 3):** aluno marcado como **pausado** ou **inadimplente** pela academia não entra no app (vê uma tela pedindo para falar com a recepção). Só "em dia" entra.
- **Confirmar:** se a academia deve poder deixar o inadimplente usar o app por um período de tolerância.

### 7. Tarefa de ativação (48h sem primeiro acesso) no plano Free
- **No ar:** vale para aluno do Free que entrou por matrícula ou cadastro manual; **não** vale para a base importada, que é ativada em bloco pelo QR Code (400 tarefas de uma vez afogariam a fila).
- **Confirmar.**

### 8. Chat com a nutricionista no Free
- **No ar:** conforme D2, o chat do Free é só com os professores; o da nutricionista é do Método ("breve lançamento"). A dieta da nutricionista da academia aparece normalmente no Free.
- **Confirmar** — é o ponto em que uma academia com nutricionista própria pode estranhar.

### 9. Quando ligar a venda do Método ARKE
- **No ar:** o app anuncia "Método ARKE — breve lançamento"; a adesão pela academia fica desligada (`VITE_METODO_ARKE_VENDA`). Ligar = pôr `true` na Vercel e fazer um deploy. Depende também da decisão sobre CPF dos alunos (hoje não coletado, e o Asaas exige CPF para cobrar).

### 10. Ordem das próximas rodadas
- **Proposta:** Rodada 5 = páginas legais (termos, privacidade, contrato de tratamento de dados) + contrato de matrícula e PAR-Q com assinatura digital. Rodada 6 = check-in por QR Code, comunicados em massa, exportação de relatórios e multiunidade.

### 11. Funil de vendas, NFS-e e WhatsApp
- **Contexto:** os três têm custo ou configuração por academia e aumentam o escopo. Nenhum foi iniciado.
- **Preciso de:** quais entram antes do lançamento.

## Operação

### 12. Conta Asaas da Tietê Fitness
- **No ar:** a Tietê é organização de homologação (trial), com carteira placeholder. Quando ela virar cliente de verdade: tirar do trial (Visão Master), fazer o onboarding (a conta Asaas pode ser aberta pelo próprio ARKE agora) e concluir — a mensalidade B2B nasce nessa hora.
