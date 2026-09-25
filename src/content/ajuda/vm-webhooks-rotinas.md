[Webhooks](/superadmin/webhooks) é onde se confere se o dinheiro e as rotinas estão andando.

## Eventos do Asaas

Todo aviso que o Asaas entrega, com o que ele **efetivamente fez no banco**: pagamento confirmado, cobrança criada, atraso, estorno. Os filtros separam **com erro** e **sem efeito** (aviso que não encontrou nada correspondente no ARKE).

- **Com erro**: investigue. Um aviso de pagamento confirmado que falhou pode deixar um aluno bloqueado depois de pagar.
- **Sem efeito**: comum em evento de teste ou de conta antiga; vira problema quando é pagamento de cliente.

A situação das chaves (`ASAAS_API_KEY`, `ASAAS_WEBHOOK_SECRET`) aparece no topo.

## Conferência diária com o Asaas

Toda madrugada, o ARKE confere cada cobrança em aberto com o Asaas e corrige o que divergir, reenviando o aviso ao próprio webhook: é assim que um pagamento confirmado cujo aviso se perdeu é recuperado. A mesma conferência lista as **assinaturas órfãs**: ativas no Asaas, com referência do ARKE, sem registro no banco. Órfã não se corrige sozinha, porque pode ser de outro plano ou valor: ela aparece na faixa vermelha e no Vigia, para uma pessoa decidir.

## Rotinas agendadas

Cada rotina (ativação, escalonamento de prazos, avanço de fases, lembretes, conferência com o Asaas, alertas) com a situação: **ok**, **falhou**, **parou de rodar**, **nunca rodou** ou **desativada**.

- **Parou de rodar** é a mais traiçoeira: não dá erro, só silêncio. O ARKE compara a última execução com o intervalo prometido pelo agendamento.
- Rotina que falhou ou parou gera e-mail para os Super Admins, com lembrete a cada 24 horas e aviso quando volta ao normal.
- **Nunca rodou** é o estado de toda rotina nova até a primeira janela, e não gera alarme.
