A tela [Uso das IAs](/superadmin/ia) mostra, para cada IA da plataforma, quanto ela foi chamada, quanto a trava recusou, quanto ficou indisponível, quantos tokens gastou, o custo estimado e quanto demorou. Escolha o período no alto: 7, 30 ou 90 dias.

## As IAs que entram

- **Letícia (comercial):** a frase que espelha o que a academia contou no primeiro e-mail.
- **Assistente da academia:** a resposta escrita no alto da Central de Ajuda do painel.
- **Leitura de dieta em PDF:** a transcrição do plano alimentar para as refeições.
- **Vigia (análise):** o diagnóstico do quadro de problemas.

O Vigia e o assistente respondem pela API da Anthropic, quando estão ligados nela (o interruptor é por agente), e pela AWS quando ela falha, na mesma chamada. A Letícia e a leitura de dieta rodam na AWS, em São Paulo.

O Sentinela (resumo da anamnese e sugestão de resposta do mentor) segue congelado e não entra no medidor.

## Recusada pela trava

Cada IA tem uma trava no nosso código, que confere a resposta antes de ela chegar a alguém:

- a Letícia não pode escrever número, preço, promessa nem link;
- o assistente não pode citar número que não está na Central de Ajuda;
- a dieta não pode ter alimento nem quantidade que não estão no PDF;
- o Vigia só manda o quadro que passa na validação, e só aceita resposta dentro do catálogo de ações.

A resposta recusada não aparece para ninguém: o e-mail sai sem a frase, o assistente mostra só os artigos, a dieta pede para digitar ou tentar outro arquivo. **Uma taxa de recusa alta** (a tela destaca a partir de 20%) quer dizer que o modelo está errando, ou que o roteiro dele precisa de ajuste. É o sinal para rodar a avaliação de novo.

## Custo

O custo é **estimado**, em dólar, pelos tokens de cada chamada e pela tabela pública de preços da AWS ou da API da Anthropic, conforme quem respondeu. A tabela mora no banco (`ia_precos`), com uma linha por modelo: o mesmo Claude Sonnet 4.6 aparece como `global.anthropic.claude-sonnet-4-6` quando a AWS respondeu e como `claude-sonnet-4-6` quando foi a API da Anthropic. Pela API, o custo sai do crédito mensal enquanto houver, mas a tela mostra o valor cheio, para o número valer quando o crédito acabar. Quando um provedor muda o preço, ou uma IA passa a usar outro modelo, a linha precisa ser atualizada; até lá, a tela avisa "modelo sem preço na tabela".

## O que não fica guardado

O medidor guarda só números: nem a pergunta, nem a resposta, nem o texto do PDF. As linhas saem depois de 13 meses.
