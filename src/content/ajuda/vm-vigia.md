O [Vigia](/superadmin/vigia) cuida da saúde técnica da plataforma: Gateways de catraca, rotinas agendadas, conferência com o Asaas, avisos de pagamento e capacidade do banco. Ele **não lê dado de aluno**.

## Como trabalha

A cada 5 minutos, o Vigia confere a plataforma com as suas regras.

- **Nível 1** (corrige sozinho): sincronizar Gateway atrasado, reenviar acessos guardados, pedir diagnóstico de Gateway em contingência prolongada, reenviar remoção de digital quando o Gateway volta, rodar de novo uma rotina repetível que falhou, repetir a conferência com o Asaas.
- **Nível 2** (pede aprovação): rotina que fala com academias, assinatura órfã no Asaas, aviso do Asaas não processado.

Antes de agir, ele espera um pouco: o que some sozinho não precisava de ação, e isso fica contado em **Sumiram antes**. Tentativas têm limite; esgotadas, o caso vai **para uma pessoa**, por e-mail. O **freio** segura a mesma ação em muitos alvos de uma vez, porque aí a causa é comum (a nuvem, um fornecedor) e agir em cada alvo seria tratar sintoma.

## Aguardando aprovação

Os pedidos de nível 2 aparecem no topo, com **Aprovar** e **Dispensar**. Aprovar executa na hora e fica na Auditoria. Um aviso por e-mail sai quando algo novo espera aprovação.

## Análise por IA

Quando o quadro de problemas muda, uma IA olha o conjunto e sugere a causa provável e as ações. Ela é **conselheira**: o diagnóstico fica visível, e as ações dela sempre pedem aprovação. O que vai para a IA são só tipos de problema, contagens e apelidos (A1, G1), nunca nome, e-mail ou mensagem de erro.

## Resumo diário

Às 8h sai um e-mail para os Super Admins com o que o Vigia viu e fez nas últimas 24 horas, mesmo num dia sem nada: "rodou e não viu nada" é diferente de "parou".

## Regras e interruptor

A tabela **Regras** mostra cada regra, o modo, quantas vezes detectou, agiu, sumiu antes e foi para uma pessoa. O modo de cada regra muda pela tela, com uma trava: nível 1 nunca pede aprovação e nível 2 nunca age sozinho sem mudança de código. O Vigia inteiro pode ser desligado pelo interruptor, e isso fica registrado.
