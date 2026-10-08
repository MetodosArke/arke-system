[Webhooks](/superadmin/webhooks) é onde se confere se o dinheiro e as rotinas estão andando.

## Eventos do Asaas

Todo aviso que o Asaas entrega, com o que ele **efetivamente fez no banco**: pagamento confirmado, cobrança criada, atraso, estorno. Os filtros separam **com erro** e **sem efeito** (aviso que não encontrou nada correspondente no ARKE).

- **Com erro**: investigue. Um aviso de pagamento confirmado que falhou pode deixar um aluno bloqueado depois de pagar.
- **Sem efeito**: comum em evento de teste ou de conta antiga; vira problema quando é pagamento de cliente.

A situação das chaves (`ASAAS_API_KEY`, `ASAAS_WEBHOOK_SECRET`) aparece no topo.

Com a **cobrança na conta da academia** ligada para uma academia, os avisos da conta Asaas dela chegam por um webhook próprio, registrado pela ficha da organização, com um token só dela (o banco guarda só o hash). Esse aviso só mexe na mensalidade e na avulsa daquela academia que nasceram na conta dela; o que tentar mexer em outra coisa aparece como **Conta da academia: …**, sem efeito. A cobrança que a academia faz por fora do ARKE, na conta dela, nem é gravada.

## Conferência diária com o Asaas

Toda madrugada, o ARKE confere cada cobrança em aberto com o Asaas e corrige o que divergir, reenviando o aviso ao próprio webhook: é assim que um pagamento confirmado cujo aviso se perdeu é recuperado. A mesma conferência lista as **assinaturas órfãs**: ativas no Asaas, com referência do ARKE, sem registro no banco. Órfã não se corrige sozinha, porque pode ser de outro plano ou valor: ela aparece na faixa vermelha e no Vigia, para uma pessoa decidir.

A conferência passa também pela conta Asaas de cada academia que cobra na própria conta (a que tem o webhook registrado), com a chave dela: a mensalidade e a avulsa de lá, e as assinaturas órfãs de lá. Academia sem a chave conectada vira falha da conferência, porque a cobrança dela não está sendo conferida.

## Rotinas agendadas

Cada rotina (ativação, escalonamento de prazos, avanço de fases, lembretes, conferência com o Asaas, alertas) com a situação: **ok**, **falhou**, **parou de rodar**, **nunca rodou** ou **desativada**.

- **Parou de rodar** é a mais traiçoeira: não dá erro, só silêncio. O ARKE compara a última execução com o intervalo prometido pelo agendamento.
- Rotina que falhou ou parou gera e-mail para os Super Admins, com lembrete a cada 24 horas e aviso quando volta ao normal.
- **Nunca rodou** é o estado de toda rotina nova até a primeira janela, e não gera alarme.

## Quem vê o quê

O nível **Suporte** da equipe da ArkeFit abre esta tela pelas **rotinas**: ele vê a saúde de cada uma e recebe a faixa de aviso no alto da Visão Master. Os eventos e a conferência com o Asaas são do dinheiro, e ficam com o sócio.
