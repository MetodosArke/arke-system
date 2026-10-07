## Configurações

Em [Configurações](/superadmin/configuracoes) ficam os números que valem para a plataforma inteira:

- **Taxa de processamento**: percentual, valor fixo e **mínimo por cobrança** (hoje 2,99% + R$ 0,49, mínimo R$ 1,99). É a estimativa da taxa do Asaas usada para montar a divisão de cada cobrança. Mudar vale para cobranças novas; assinaturas já criadas guardam a divisão do dia em que nasceram.
- **Capacidade do banco**: o limite em MB contra o qual o ARKE avisa quando o banco enche (70% e 85%). Depois de cada mudança de plano do Supabase, atualize com o disco contratado.
- **Taxa de implantação de referência**: o valor que vem preenchido na ficha de cada academia nova.
- **Preços B2B** de tabela de cada plano, com o limite de alunos. Limite vazio é plano sem teto. A academia recebe o limite do plano quando entra nele; mudar o limite aqui vale para quem entrar depois. O Starter saiu de venda em 01/10/2026 e não tem mais preço de tabela.
- **Método ARKE — atacado de referência**: por nível (Integrado e Elite), quanto a ArkeFit fica de cada aluno e o preço sugerido ao aluno, com a divisão ao lado. É o ponto de partida da negociação, não o repasse que vale na cobrança: esse é o de cada academia, em **Repasse do Método** na ficha da organização, onde o botão **Aplicar a tabela de referência** copia esta tabela. Mudar aqui não altera o que já foi negociado nem assinatura já criada; o varejo sugerido preenche a precificação das academias criadas depois.
- **Conta Asaas aberta pela ArkeFit (BaaS)**: o interruptor da subconta. Para o Asaas, abrir a conta da academia pela conta da ArkeFit é BaaS, com homologação. **Desligado** (o padrão), a academia abre a própria conta no Asaas e informa a carteira; a abertura pela ArkeFit só aparece para organização em trial (sandbox), para a homologação, e a função recusa nas outras. **Ligado**, a etapa Recebimentos oferece a abertura, com o aceite dos Termos de Uso do Asaas pela gestão (quem, quando e o endereço dos termos ficam guardados) e, depois, os documentos que o Asaas pede, cada um com o link do Asaas para enviar. As subcontas já abertas seguem funcionando nas duas posições. Ligue só depois da homologação do BaaS.
- **Textos da plataforma**, como o canal de suporte (WhatsApp e e-mail) que aparece no botão "Falar com o suporte" das academias. Sem canal preenchido, o botão não aparece.
- **Contatos da página de vendas**: o e-mail que recebe cada pedido de demonstração. Veja [Pipeline comercial](ajuda:vm-comercial).

## Acervo Global

Em [Acervo Global](/superadmin/acervo), a ArkeFit mantém os exercícios que todas as academias veem: nome, grupos musculares, equipamento, séries sugeridas, vídeo e imagem de execução. As academias não editam o acervo global; cadastram os próprios.

## Profissionais

Em [Profissionais](/superadmin/profissionais), os personal trainers e nutricionistas **autônomos**, cada um com o próprio painel. O passo a passo está em [Profissionais autônomos](ajuda:vm-profissionais).

## Auditoria

A [Auditoria](/superadmin/auditoria) registra as ações sensíveis: quem fez, quando, sobre o quê e o motivo. Entram ali exclusões, liberações remotas de catraca, consultas de acessos, mudanças no Vigia, emissões de taxa de implantação, trocas da carteira de recebimento de uma academia, trocas do e-mail, do nome e do papel de alguém da equipe (a do papel também quando é feita direto pela API, marcada `pela_api`), encerramentos e aprovações. A rotina que apaga a matrícula pelo link que não confirmou o e-mail em 7 dias também registra cada exclusão ali, só com a academia, sem dado da pessoa. A troca de carteira também chega por e-mail aos Super Admins, porque muda para onde vai o dinheiro da academia. É a resposta para "quem fez isso?" meses depois.
