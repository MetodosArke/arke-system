A [Visão Geral](/superadmin) é a tela de abertura da Visão Master: a plataforma inteira num lugar só.

![A Visão Geral da Visão Master.](/ajuda/telas/vm-visao-geral.jpg)

## A faixa vermelha

No topo, uma faixa vermelha aparece quando algo precisa de ação: rotina agendada que falhou ou parou de rodar, assinatura órfã no Asaas (alguém sendo cobrado sem registro no ARKE), conferência com o Asaas com erro. Enquanto não houver faixa, não há incêndio.

## Os números

Receita da plataforma no mês, repasse ARKE líquido (já sem a taxa do Asaas), take rate, inadimplência das academias e a carteira de academias por situação.

## Gestão de Tenants

A lista de academias, com busca e filtros por tipo e situação, separada em **Ativos / Trial**, **Inativos / Cancelados** e **Todos**. Cada linha mostra alunos, cobranças atrasadas, plano, situação e a **última atividade** (o check-in ou treino mais recente): academia parada há dias é o primeiro sinal de cancelamento.

O menu de cada academia tem:

- **Editar Informações**: nome, tipo, plano, CNPJ, contato, prazo do trial.
- **Faturamento / Cobranças B2B**: as cobranças da ArkeFit à academia.
- **Resetar Token do Gateway Local**: gera um token novo para as catracas. As catracas param até alguém atualizar o `config.json` no computador da academia: use só em vazamento ou troca de equipamento.
- **Suspender / Ativar acesso do tenant**.
- **Excluir Organização**: só para organizações em **trial**, que são de homologação. Academia cliente sai pelo encerramento; veja [Encerrar uma academia](ajuda:vm-encerramento).

## A ficha da organização

Clique no nome da academia para abrir a ficha: métricas, contato, dados fiscais, **Mensalidade B2B**, **Taxa de implantação**, **Repasse do Método**, **Trial do Método ARKE**, **Encerramento** e a atividade recente. Veja [Implantar uma academia nova](ajuda:vm-nova-academia).

## Simulação de Visão de Perfil

Para ver exatamente o que um gestor, professor ou aluno vê, escolha a pessoa em **Simulação de Visão de Perfil**. A sessão passa a ser a dela, com uma faixa permanente avisando, e **Voltar** devolve você à sua. Ninguém precisa passar senha para isso.

> Simular é entrar na conta de uma pessoa real. Use para suporte e conferência, e só o tempo necessário.
