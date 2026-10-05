# Fuso e datas

Por que o banco e o app contam o dia em Brasília.

## Fuso do Banco: o defeito que a corrente de cobrança revelou (23/09/2026)

Exercitando a cobrança na homologação, um aluno com cobrança vencendo **hoje** apareceu como inadimplente. A causa não estava na cobrança: **o banco está em UTC**, então entre 21h e meia-noite de Brasília `current_date` já é o dia seguinte, e tudo que decide por data decide três horas adiantado.

O alcance é muito maior que a cobrança — **26 funções** do schema `public` comparam com `current_date` e **nove colunas `date`** têm `CURRENT_DATE` como default. O pior não é o financeiro:

- `registro_treino.data`, `checkins.data`, `registro_habito.data` — **quem treina às 22h tem o treino gravado como sendo de amanhã**, todo dia, no horário de pico da academia. Desalinha o calendário, a meta semanal, o "treinar hoje" da Próxima Ação e a automação de "2 treinos previstos sem registro";
- `aluno_inadimplente_b2c` / `organizacao_inadimplente_b2b` — cortam o acesso de quem tem cobrança vencendo hoje, três horas antes da hora, e encurtam as tolerâncias de 5 e 7 dias;
- `exigir_atestado_para_treinar` — trava o treino no próprio dia da validade;
- receita e lançamentos — na virada do mês, a noite do dia 1º conta no mês seguinte, e `marcar_lancamentos_atrasados` atrasa quem está em dia.

**O remédio é a raiz, não as 26 funções**, porque o defeito não está em nenhuma delas: está na premissa de que `current_date` é a data do negócio. `alter database postgres set timezone = 'America/Sao_Paulo'` acerta as 26, os nove defaults e toda função futura — que de outro modo nasceria errada de novo. Foi exatamente assim que `presencas.dia` acabou sendo o **único** lugar do schema com `America/Sao_Paulo` escrito à mão: alguém tropeçou nisto antes e remendou um ponto só.

Conferido antes de propor, porque as três dúvidas naturais têm resposta objetiva:

- **`pg_cron` não se move.** Ele agenda pelo GUC próprio `cron.timezone`, que está em `GMT` e é independente de `ALTER DATABASE`. As 12 rotinas seguem nos mesmos horários UTC documentados.
- **Nada muda de sentido no armazenamento.** `timestamptz` guarda em UTC e o fuso da sessão muda só a leitura; o schema **não tem nenhuma coluna `timestamp without time zone`**, que é o tipo que mudaria.
- **O ajuste alcança quem importa.** Nenhum papel (`authenticator`, `authenticated`, `anon`, `postgres`…) sobrescreve `TimeZone` em `pg_db_role_setting`, então vale para PostgREST e para as edge functions, não só para quem se conecta pelo psql.

A migration está em `supabase/migrations/20261221010000_fuso_brasilia.sql`. Vale para sessões novas.

**Aplicada em 23/09/2026 — e o app tinha o mesmo defeito.** Depois do `alter database`, `current_date` passou a ser a data de Brasília e o PostgREST a devolver `-03:00` já na primeira leitura (o pool pegou na hora, sem esperar reciclagem); `cron.timezone` seguiu em `GMT`, como previsto. O aluno que aparecia bloqueado com cobrança vencendo hoje deixou de aparecer.

Mas a correção do banco **revelou a metade que faltava**: o frontend calculava a data com `new Date().toISOString().slice(0, 10)` em 12 lugares, e `toISOString()` converte para UTC. Enquanto os dois erravam juntos ninguém notava; com o banco certo, eles passariam a **discordar três horas por noite** — o aluno registra o treino às 22h, o banco grava hoje, a tela pergunta por amanhã e responde "você ainda não treinou hoje". As edge functions tinham o mesmo problema, e o mais caro estava em `asaas-webhook`: `data_pagamento` gravado em UTC põe o pagamento das 22h do último dia do mês no fechamento do mês seguinte, o que vai para o contador.

Havia **três grafias** convivendo, e a do meio é a mais traiçoeira porque quase acerta:

| Grafia | O que devolve | Veredito |
|---|---|---|
| `new Date().toISOString().slice(0, 10)` | data em UTC | errada sempre, das 21h à meia-noite |
| `getTime() - offset * 60_000` | data **do aparelho** | certa no Brasil com relógio certo; erra para quem viaja ou tem o fuso trocado |
| `- 3 * 3600_000` / `- 3 * 60 * 60 * 1000` | Brasília | valor certo, motivo escrito em lugar nenhum, e some no horário de verão |

O fuso é fixo em São Paulo, e **não o do aparelho**, porque a data que importa é a da academia: aluno viajando veria uma semana de treinos diferente da que a academia e o banco veem. Isso mora agora em `src/lib/dataBrasilia.ts` (`dataBrasilia`, `hojeBrasilia`, `diaBrasilia`, `inicioDoMesBrasilia`) e no espelho em Deno `supabase/functions/_shared/data.ts` — duplicado pelo motivo de sempre, edge function não importa do bundle do app. As 27 ocorrências do app e as 12 das edge functions passaram a usá-los.

`src/lib/dataBrasilia.guarda.test.ts` varre **`src/` e `supabase/functions/`** e falha nas três grafias, verificada quebrando um arquivo de propósito. É a mesma classe do vínculo duplo: parece certo, e por isso volta a cada tela nova.

**Conferido depois do deploy**, porque deploy não é prova: as quatro edge functions tocadas respondem 401 (o módulo sobe e o handler roda) e uma cobrança confirmada no sandbox gravou `data_pagamento = 2026-09-22`, a data de Brasília, ao lado da linha anterior que tinha `2026-09-23` — o antes e o depois na mesma tabela. **Nenhum dado real foi afetado**: o projeto novo só tem a organização de homologação.
