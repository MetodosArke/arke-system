# Produto e princípios

A visão do sistema, a stack e os princípios, como estavam no CLAUDE.md até 05/10/2026. As regras vigentes, resumidas, estão no CLAUDE.md.

## Visão Geral do Sistema
O ARKE é uma plataforma SaaS B2B/B2C para academias, studios e personal trainers que combina software de acompanhamento com uma metodologia ativa de atendimento, treino e nutrição (M.A.P.A.®, R.O.T.A.®, APEX® e LEGADO®) para reduzir o churn evitável e incrementar a receita das academias parceiras[span_51](start_span)[span_51](end_span)[span_52](start_span)[span_52](end_span).

## Arquitetura e Stack
- **Frontend:** React + TypeScript, Vite, TailwindCSS, Shadcn/UI, Lucide React[span_53](start_span)[span_53](end_span).
- **Backend & Banco de Dados:** Supabase (Auth, PostgreSQL, Row Level Security - RLS, Storage, Edge Functions)[span_54](start_span)[span_54](end_span).
- **Hospedagem:** Vercel[span_55](start_span)[span_55](end_span).
- **Mapa de toda a infraestrutura** (serviços, domínios, DNS, nomes dos segredos e onde cada um mora, sem nenhum valor): `docs/INFRAESTRUTURA.md`. O repositório é público; o arquivo não leva segredo, login nem caminho de máquina. Cada troca de serviço, domínio ou chave o atualiza no mesmo PR.

## Princípios de Engenharia e Regras Estritas
1. **Multitenancy em Primeiro Lugar:** Toda e qualquer tabela do banco (alunos, treinos, dietas, agendamentos, tarefas) deve conter a coluna `organization_id` (ou `academia_id`) e ter políticas de RLS ativas desde o primeiro script SQL[span_56](start_span)[span_56](end_span).
2. **Construção em Camadas:** Não introduzir integrações de hardware (catracas) ou agregadores (Gympass) antes que o núcleo de Auth, RLS e a Metodologia ARKE estejam 100% validados[span_57](start_span)[span_57](end_span).
3. **Sem Dados Mockados em Produção:** O sistema deve consumir estritamente dados em tempo real do Supabase ou exibir empty states claros.
4. **Ciclo Completo de Atendimento:** Uma pendência só é encerrada quando há um desfecho registrado (*Motivo → Responsável → Prazo → Ação → Desfecho → Próxima Checagem*)[span_58](start_span)[span_58](end_span).

## UX do Aluno & Diretrizes de Retenção Humanizada
- **Home Focada em Ação:** Prioridade para *Próxima Ação*, *Progresso Semanal*, *Próximo Evento de Acompanhamento* e *Botão de Ajuda*[span_59](start_span)[span_59](end_span). Dicas e gráficos ficam em segundo plano[span_60](start_span)[span_60](end_span).

  > Implementação: `src/lib/proximaAcao.ts` (`definirProximaAcao`) decide o único bloco de topo da home do aluno, na ordem *ficha ainda não publicada* → *treinar hoje* → *check-in do dia* → *hidratação* → *em dia*. É função pura justamente para a regra ficar testável sem subir Supabase. "Em dia" é desfecho legítimo: sem ele a tela inventaria pendência só para ter o que mostrar, e quando a ficha ainda não saiu o card não oferece botão — a bola está com a academia, e mandar o aluno procurar algo que não existe seria pior do que dizer a verdade. Abaixo dela vêm Progresso Semanal, Próximo Evento, o check-in (`#check-in-do-dia`) e o registro de alerta; atalhos de navegação, água (`#diario-agua`) e pontuação de engajamento ficam no segundo plano, como manda a diretriz.
- **Perguntas Construtivas:** Substituição de "Como está sua dedicação?" por "Como está sendo seguir seu plano?" (opções: Funcionando bem / Preciso de ajuste / Com dificuldade / Quero falar com alguém)[span_61](start_span)[span_61](end_span).
- **Gamificação Positiva (Fim da Punição):** Registros de dor, pedidos de ajuda ou faltas justificadas (viagem/trabalho) NÃO tiram pontos do aluno[span_62](start_span)[span_62](end_span). Rankings corporais (gordura/músculo) são proibidos nos painéis gerais, restritos apenas à evolução individual e privada do aluno[span_63](start_span)[span_63](end_span).
- **Constância vs. Adesão:** Aluno com meta de 2 treinos/semana que cumpre ambos tem 100% de constância; não deve ser penalizado em relação a quem treina 6 vezes[span_64](start_span)[span_64](end_span).

## Rodada 3 do app: erro não é vazio, data pura e acessibilidade (06/10/2026)

Achados médios da auditoria de prontidão de 05/10, na parte do app.

**Erro de consulta não é estado vazio.** Fora da Visão Master e das páginas públicas, quase nenhuma tela tratava o erro da consulta. Num soluço de rede, a lista de alunos dizia "Nenhum aluno cadastrado ainda." e o treino do aluno, "Nenhum treino publicado ainda.". O gestor achava que tinha perdido a base e importava de novo; o aluno achava que a academia tinha apagado o treino. Isso contraria o princípio "dado real ou estado vazio claro": vazio só é verdade quando a consulta respondeu.
- `<ErroAoCarregar>` (`src/components/ErroAoCarregar.tsx`) diz o que não carregou, que nada foi apagado, e oferece **Tentar de novo**.
- Entrou em 42 lugares de 26 telas e componentes. **Gestão:** lista de alunos, painel inicial (os diálogos de avaliação e retorno), financeiro (lançamentos, equipe, comissões), retenção, equipe, catracas (dispositivos, parceiros, acessos), conferência dos parceiros, comunicados, acompanhamento ARKE, cobranças avulsas, notas fiscais, avaliação física, planos, desafios, prescrição de treino e de dieta (modelos, exercícios, a ficha carregada, o histórico). **Aluno:** treino, dieta, evolução, agenda, pagamentos, desafios, competições, o chat com a equipe e com o mentor, o feed.
- Com a lista já carregada, um erro de atualização não troca a lista pelo aviso: o dado anterior é real.
- O treino, a dieta e o chat engoliam o erro da própria leitura (`const { data } = await ...` sem conferir), e o erro virava "nenhum". Agora o erro sobe.
- `estadoVazio.guarda.test.ts` lê cada `useQuery` com estado vazio e cobra que a desestruturação tome o `error` (ou `isError`) e o use. As 16 telas que ainda não tratam estão listadas com o motivo (a ficha do aluno, que outra frente mexia; a Visão Master; a implantação), e a lista só diminui: o teste falha se uma delas for consertada sem sair da lista.

**Três brechas que as guardas deixavam passar.**
- `ConferenciaParceiros` pedia `.limit(2000)`: a API para em mil, com status 200, e o repasse do Wellhub e do TotalPass era conferido contra um número cortado. Passou a ler em páginas. `paginar.guarda` ganhou a regra 3: nenhum `.limit()` passa de mil, no app e nas funções, com a constante do arquivo resolvida.
- `ControleDieta` lia `new Date(a.data)`: a data pura vira meia-noite em UTC, 21h da véspera em Brasília, e o domingo caía antes do começo da semana e sumia do resumo. `DesafiosPainel` comparava `new Date(d.data_fim) >= new Date()`, e o desafio aparecia encerrado desde as 21h da véspera. Os dois comparam texto com texto (`semanaBrasilia()`, nova, e `hojeBrasilia()`). `dataBrasilia.guarda` recusa `new Date()` sobre coluna `date`; a lista das colunas sai das próprias migrations, então coluna nova entra sozinha.

**Acessibilidade.**
- **Contraste.** O dourado da marca como texto dava 2,06:1 sobre o fundo claro. O botão continua com o dourado (#D9A520, e o amarelo #FFC700 no escuro); o texto (`text-primary`) lê um token próprio, `--primary-texto`, o mesmo dourado mais fechado (#89650B). Pelo `textColor` do Tailwind, `bg-primary`, `border-primary` e o anel não mudam. O mesmo para `text-destructive` (no escuro, o vermelho do botão dava 2,97:1 sobre o card), `text-success` e `text-warning`. O cinza do texto secundário foi de 45% para 38% de luminosidade no claro, e de 50% para 56% no escuro. O texto sobre o dourado do hover passou de branco para escuro. O logotipo não é texto: ele fica no dourado da marca (`text-marca`).
- **Antes e depois** (texto pequeno pede 4,5:1):

  | Par | Antes | Depois |
  |---|---|---|
  | claro: `text-primary` sobre o fundo / o card / o muted | 2,06 / 2,25 / 1,94 | 4,91 / 5,34 / 4,61 |
  | claro: `muted-foreground` sobre o fundo / o card / o muted | 4,23 / 4,60 / 3,97 | 5,50 / 5,99 / 5,17 |
  | claro: `accent-foreground` sobre `accent` | 3,04 | 6,40 |
  | claro: `text-destructive` sobre o fundo; branco sobre o botão | 4,50; 4,90 | 5,14; 5,60 |
  | escuro: `text-destructive` sobre o card / o fundo / o muted | 2,97 / 3,18 / 2,73 | 5,59 / 5,97 / 5,14 |
  | escuro: `muted-foreground` sobre o muted / o card | 4,30 / 4,68 | 5,24 / 5,69 |

- **A cor da academia.** A academia que troca a cor do app ganhava só o tom do botão (3:1). Como texto, a cor precisa de 4,5:1: `tomParaTexto()` escurece no claro e clareia no escuro até chegar lá, e a marca ganha o `--primary-texto` dela. A prévia da tela de marca mostra o link nesse tom.
- **Zoom.** `user-scalable=no` impedia ampliar a tela. Saiu. Para o iPhone não ampliar sozinho ao tocar num campo, a caixa de texto (`Textarea`) passou a 16px no celular, como o `Input` já era.
- **Rótulos.** O detector da auditoria por expressão regular se perdia no `>` de `onClick={() => ...}`; o novo usa o compilador do TypeScript. Achou 37 botões só de ícone sem nome; 36 ganharam `aria-label` (o menu e o recolher do menu, o tema no painel e na tela de entrar, o enviar do chat e do comentário, os meses e os dias do calendário, editar e excluir nos painéis, o descanso do treino, o fechar do aviso de instalação, entre outros), e o 37º estava no `Register.tsx`, que saiu da main nesta rodada.
- **Carregando.** Os spinners de tela inteira (a raiz, a rota protegida, o vínculo do aluno, o convite) não se anunciavam. `<CarregandoTela />` tem `role="status"`.
- `acessibilidade.guarda.test.ts` confere as contas de contraste lendo `index.css`, o `textColor`, o zoom, os rótulos (com o compilador) e os spinners.

**Defeitos do caminho.**
- As guardas novas pegaram os comentários do próprio conserto: "o `.limit(2000)` que havia aqui" e "lida com `new Date(a.data)`" casavam com o padrão. Os comentários foram reescritos.
- A primeira versão da tela mostrava o aviso de erro mesmo com a lista anterior na tela, numa atualização em segundo plano que falhava. O aviso passou a aparecer só sem dado.
- A cor da academia sobrescreve `--primary` na hora: sem o `--primary-texto` dela, o texto ficaria no dourado da ArkeFit numa academia de marca azul. A conta entrou em `marcaAcademia.ts`, com teste.
- Ler e montar a árvore de cerca de 300 telas passa dos 5 s numa máquina lenta: a guarda filtra antes as telas que têm botão ou spinner e ganhou prazo de 60 s.
- Na volta sobre a main, o `Register.tsx` tinha saído (a outra frente), e a guarda de rótulos acusou a exceção que sobrou; a tela de entrar ganhou os dois rótulos que faltavam.

**Conferido:** `npx vitest run`: 1.176 testes em 158 arquivos, todos passando (46 novos: as guardas de estado vazio, de acessibilidade e as brechas, `semanaBrasilia`, o tom de texto da marca, o componente de erro e o erro nas cobranças avulsas). `npm run check` sem erro (27 avisos, de arquivos anteriores), com as 56 funções no `deno check` e nenhuma vulnerabilidade alta. **Defeitos plantados**, um por achado, no código e nunca no banco, todos pegos pelo teste certo: a lista de alunos sem tomar o erro (`estadoVazio.guarda`); o `.limit(2000)` de volta (`paginar.guarda`) e a data pura em UTC no resumo da dieta (`dataBrasilia.guarda`); o cinza em 45%, o `user-scalable=no`, o tema sem rótulo e o carregando sem `role` (`acessibilidade.guarda`, 4 testes). **Falta, porque esta frente não toca produção:** a tela no computador e no celular, nos dois temas e com a cor de uma academia.
