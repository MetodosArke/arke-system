## Configurações

Em [Configurações](/superadmin/configuracoes) ficam os números que valem para a plataforma inteira:

- **Operação da cobrança** (a antiga taxa de processamento): percentual, valor fixo e **mínimo por cobrança** (hoje 2,99% + R$ 0,49, mínimo R$ 1,99). Compõe o preço do Método ARKE, que é serviço da ArkeFit: somada ao repasse negociado, cobre a operação da cobrança na conta da ArkeFit, onde o Asaas cobra a tarifa dele. Não é tarifa sobre o pagamento do aluno. A mensalidade e a avulsa da academia saem da conta dela, sem esta parcela; só a academia que ainda cobra mensalidade pela conta da ArkeFit a tem na mensalidade, até a passagem. Mudar vale para cobranças novas; assinaturas já criadas guardam a divisão do dia em que nasceram.
- **Capacidade do banco**: o limite em MB contra o qual o ARKE avisa quando o banco enche (70% e 85%). Depois de cada mudança de plano do Supabase, atualize com o disco contratado.
- **Taxa de implantação de referência**: o valor que vem preenchido na ficha de cada academia nova.
- **Preços B2B** de tabela de cada plano, com o limite de alunos. Limite vazio é plano sem teto. A academia recebe o limite do plano quando entra nele; mudar o limite aqui vale para quem entrar depois. O Starter saiu de venda em 01/10/2026 e não tem mais preço de tabela.
- **Método ARKE — atacado de referência**: por nível (Integrado e Elite), quanto a ArkeFit fica de cada aluno e o preço sugerido ao aluno, com a divisão ao lado. É o ponto de partida da negociação, não o repasse que vale na cobrança: esse é o de cada academia, em **Repasse do Método** na ficha da organização, onde o botão **Aplicar a tabela de referência** copia esta tabela. Mudar aqui não altera o que já foi negociado nem assinatura já criada; o varejo sugerido preenche a precificação das academias criadas depois.
- **Conta Asaas aberta pela ArkeFit (BaaS)**: o interruptor da subconta. Para o Asaas, abrir a conta da academia pela conta da ArkeFit é BaaS, com homologação. **Desligado** (o padrão), a academia abre a própria conta no Asaas e informa a carteira; a abertura pela ArkeFit só aparece para organização em trial (sandbox), para a homologação, e a função recusa nas outras. **Ligado**, a etapa Recebimentos oferece a abertura, com o aceite dos Termos de Uso do Asaas pela gestão (quem, quando e o endereço dos termos ficam guardados) e, depois, os documentos que o Asaas pede, cada um com o link do Asaas para enviar. As subcontas já abertas seguem funcionando nas duas posições. Desde 13/10/2026 a ArkeFit não abre subcontas: toda academia usa a conta própria no Asaas, e o interruptor fica desligado.
- **Textos da plataforma**, como o canal de suporte (WhatsApp e e-mail) que aparece no botão "Falar com o suporte" das academias. Sem canal preenchido, o botão não aparece.
- **Contatos da página de vendas**: o e-mail que recebe cada pedido de demonstração. Veja [Pipeline comercial](ajuda:vm-comercial).

## Acervo Global

Em [Acervo Global](/superadmin/acervo), a ArkeFit mantém os exercícios que todas as academias veem: nome, grupos musculares, equipamento, séries sugeridas, vídeo e imagem de execução. As academias não editam o acervo global; cadastram os próprios.

## Profissionais

Em [Profissionais](/superadmin/profissionais), os personal trainers e nutricionistas **autônomos**, cada um com o próprio painel. O passo a passo está em [Profissionais autônomos](ajuda:vm-profissionais).

## Auditoria

A [Auditoria](/superadmin/auditoria) registra as ações sensíveis: quem fez, quando, sobre o quê e o motivo. Entram ali exclusões, liberações remotas de catraca, consultas de acessos, mudanças no Vigia, emissões de taxa de implantação, trocas da carteira de recebimento de uma academia, trocas do e-mail, do nome e do papel de alguém da equipe (a do papel também quando é feita direto pela API, marcada `pela_api`), encerramentos e aprovações. A rotina que apaga a matrícula pelo link que não confirmou o e-mail em 7 dias também registra cada exclusão ali, só com a academia, sem dado da pessoa. A troca de carteira também chega por e-mail aos Super Admins, porque muda para onde vai o dinheiro da academia. É a resposta para "quem fez isso?" meses depois.

**Toda mudança nesta página fica lá também**, como **Configuração da plataforma alterada**: a chave, o valor de antes e o de depois, e quem mudou. Quando a mudança não veio de uma pessoa (uma rotina ou uma atualização do sistema), aparece **servidor** no lugar do e-mail.

### Exportar o período

Para atender a um pedido de auditoria (o do Asaas, por exemplo), use **Exportar o período** no alto da [Auditoria](/superadmin/auditoria): escolha as datas (até 366 dias) e baixe um CSV com três tipos de registro, marcados na coluna `registro`:

- `acao_sensivel`: as ações da trilha, com quem fez, quando, o quê e os detalhes;
- `acesso`: os registros de acesso do Marco Civil, por pessoa e por dia, com o IP e a primeira e a última hora (guardados por 6 meses);
- `entrada_que_falhou`: as tentativas de entrar que deram erro (senha errada, e-mail não confirmado), com a conta quando o e-mail é de alguém, e o IP só cifrado; nunca a senha. Também ficam 6 meses.

Só o sócio exporta, com as duas etapas, e cada exportação entra na própria Auditoria como **Trilha de auditoria exportada**. O arquivo tem dado pessoal: mande só o que o pedido inclui, pelo meio combinado com o auditor, e apague a cópia do computador depois.
