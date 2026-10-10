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
- `estadoVazio.guarda.test.ts` lê cada `useQuery` com estado vazio e cobra que a desestruturação tome o `error` (ou `isError`) e o use. As 16 telas que ainda não tratam estão listadas com o motivo (a ficha do aluno, que outra frente mexia; a Visão Master; a implantação), e a lista só diminui: o teste falha se uma delas for consertada sem sair da lista. *Superado em 06/10/2026: as 15 foram tratadas e a lista está vazia; a porta do aceite ficou como exceção declarada (ver "Rodada 3 do app, fechamento", abaixo).*

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

**Conferido:** `npx vitest run`: 1.176 testes em 158 arquivos, todos passando (46 novos: as guardas de estado vazio, de acessibilidade e as brechas, `semanaBrasilia`, o tom de texto da marca, o componente de erro e o erro nas cobranças avulsas). `npm run check` sem erro (27 avisos, de arquivos anteriores), com as 56 funções no `deno check` e nenhuma vulnerabilidade alta. **Defeitos plantados**, um por achado, no código e nunca no banco, todos pegos pelo teste certo: a lista de alunos sem tomar o erro (`estadoVazio.guarda`); o `.limit(2000)` de volta (`paginar.guarda`) e a data pura em UTC no resumo da dieta (`dataBrasilia.guarda`); o cinza em 45%, o `user-scalable=no`, o tema sem rótulo e o carregando sem `role` (`acessibilidade.guarda`, 4 testes). **A tela em produção** (06/10, conta temporária da homologação, apagada no fim):
- no computador, a lista de alunos com o banco sem resposta mostrou "Não foi possível carregar…" e não "nenhum aluno", e **Tentar de novo** carregou a lista quando o banco voltou;
- no celular, a caixa de texto tem 16px, a página não trava a pinça, e o tema escuro e o claro estão legíveis.

Dois defeitos apareceram no caminho e foram corrigidos no fechamento, abaixo: o aviso de erro levava 53 segundos para aparecer, e o e-mail longo passava da borda do Perfil no celular.

## Rodada 3 do app, fechamento: as telas que faltavam, o feed e as cores fixas (06/10/2026)

As três sobras da rodada 3 do app que ficaram listadas nas guardas. As de banco da mesma frente estão em `seguranca-e-acesso.md` ("as últimas sobras de banco").

**1. Erro de consulta não é estado vazio, nas telas que faltavam.** As 16 da lista de `estadoVazio.guarda`: 15 tratadas, e a lista `PENDENTES` está vazia. *Ampliado em 07/10/2026: a guarda passou a pegar o vazio da lista filtrada, e achou mais 5 telas (ver "As sobras da frente B" em [seguranca-e-acesso.md](seguranca-e-acesso.md)).*
- **Gestão:**
  - a ficha do aluno (a ficha inteira, e os planos ao matricular);
  - a ficha do funcionário (a ficha e os horários);
  - as competições (a lista e o ranking de cada uma);
  - a Fila de atendimento (a fila e a anamnese);
  - as assinaturas da Organização;
  - a implantação (os planos e a situação da conta Asaas).
- **Aluno:** o compromisso da semana e os objetivos.
- **Visão Master:** a fila de chamados e a operação do mentor (os números e a carga por mentor), a atividade da organização, a configuração da plataforma, a visão global e as conversas de mentoria.
- **Onde "vazio" levava a uma ação errada, a tela agora não a oferece sem a leitura:**
  - a situação da conta Asaas falhando parecia "sem conta" e convidava a abrir uma segunda;
  - o compromisso da semana falhando dizia "você ainda não definiu" e, ao salvar por cima, apagava as metas da semana;
  - os objetivos falhando ofereciam definir do zero;
  - a fila caída dizia "Nenhuma pendência encontrada", e a equipe achava que estava em dia.
- **A ficha do aluno e a do funcionário engoliam o erro de cada parte** (`const [{ data }] = await Promise.all(...)`): uma leitura que caía virava "sem treino", "sem pendência" ou, na matrícula, o convite para matricular de novo. Agora uma parte que falha derruba a ficha, com **Tentar de novo**; o que o RLS esconde de um papel continua voltando vazio, sem erro. As duas tabelas lidas com `maybeSingle` sem limite (`aluno_assinaturas` e `anamnese_acolhimento`) têm um registro por aluno (`unique (aluno_id)`), então o erro de "mais de uma linha" não aparece por aí.
- **A porta do aceite dos documentos** (`AceiteDocumentosGate`) ficou fora, numa lista própria, `NAO_E_ESTADO_VAZIO`: não é uma lista, é a porta. Com a consulta falhando, ela deixa entrar de propósito (um soluço não tranca a academia inteira fora do app), registra o código do erro e pede o aceite de novo no próximo carregamento. A lista também só diminui.
- De quebra: a etapa de planos da implantação tinha `= []` literal num dado que é dependência de efeito, e carregar ou falhar virava um laço de renders. O vazio passou a ser uma constante fora do componente.

**2. O feed passa de mil posts.** O feed lia com `.limit(limite)`, e cada "Carregar mais" somava 15. Passando de mil, a API devolvia mil com status 200, e o feed parava sem aviso, com o botão na tela. As curtidas e os comentários iam num `.in()` com todos os ids carregados, que passa de 600 e volta 400.
- Agora o feed pagina por cursor (`src/lib/cursorFeed.ts`): cada página traz 15 posts a partir do último da anterior (a data e, para os do mesmo instante, o id), e nenhuma consulta pede mais que 15. O valor vai entre aspas no filtro, porque a data tem `:`, `.` e `+`.
- As curtidas e os comentários vão em lotes de 200 ids (`porLotes`) e em páginas de mil (`todasAsLinhas`).
- O feed passou a filtrar pela academia aberta. Antes, quem está em duas academias via as duas misturadas, e o post novo ia só para a aberta.
- A página seguinte que falha mostra o aviso no fim da lista, sem trocar os posts que já estão na tela.
- `paginar.guarda` ganhou a regra 4: nenhum `.limit()` nem `.range(0, …)` com valor tirado de um `useState`. A janela fixa (`.range(pagina * N, pagina * N + N - 1)`) passa.

**3. Cores fixas de texto pelos tokens de contraste.** `text-amber-600`, `text-red-500`, `text-emerald-600` e parecidas, como texto, não sabem o tema nem o fundo, e davam de 3:1 a 3,8:1. Os tokens `text-destructive`, `text-warning`, `text-success` e `text-primary` leem `--*-texto`, que a guarda confere em 4,5:1 nos dois temas.
- **Em 49 telas:**
  - o vermelho e o rosa viraram `text-destructive`;
  - o âmbar, o laranja e o amarelo viraram `text-warning`;
  - o verde virou `text-success`;
  - o par `text-X-700 dark:text-X-400` virou uma classe só, porque o token muda com o tema.
- **O fundo, a borda e o ícone decorativo ficaram com a cor.** A cor de categoria (as modalidades do calendário; doces, álcool e água no controle da dieta; o acolhimento Elite e a instrução presencial na fila; o "humano" do Vigia) manteve o fundo e a borda, e o texto passou a `text-foreground`. Fica a cor no fundo, que é o que distingue uma da outra.
- **A faixa da simulação** tem fundo âmbar sólido, igual nos dois temas, e o texto passou a preto e branco neutros (9,8:1 e 15:1). O token, que muda com o tema, ficaria ruim sobre um fundo que não muda.
- **A bolha do aluno no chat** mantém o fundo verde, e o texto passou a `text-foreground`.
- `acessibilidade.guarda` ganhou `coresFixasDeTexto()`, com o compilador do TypeScript. A cor fixa de matiz em qualquer texto do arquivo conta, inclusive num mapa de cores fora do JSX. A classe de um ícone (o componente do `lucide-react`, o `<svg>`, o ícone por variável) não conta. A lista de exceções nasceu com as 49 telas e está vazia.

**Defeitos do caminho.**
- O detector de estado vazio contava `if (lista.length === 0) return {};` (dentro de uma consulta) como estado vazio: o `\b` depois de `{}` não casa. Não atrapalhou, porque tratar o erro da tela tira a acusação de qualquer jeito, e ficou como está.
- O detector também não vê a lista filtrada: a Fila de atendimento testava `tarefasFiltradas.length === 0`, e não o dado da consulta, e passava sem tratar o erro. Foi tratada junto; a guarda segue sem pegar esse caso.
**Travas:** `estadoVazio.guarda` (a lista vazia e a exceção da porta), `paginar.guarda` (a regra 4, com o feed de antes como caso) e `acessibilidade.guarda` (a cor fixa de texto, com 8 casos do detector). E `cursorFeed.test.ts`: três posts por segundo, para o desempate pelo id contar, e 1.234 posts lidos em páginas de 15, sem repetir nem pular nenhum.

**Conferido:**
- **3 defeitos plantados, os 3 pegos:**
  - a conversa de mentoria sem tomar o erro (`estadoVazio.guarda`);
  - o feed de antes, de volta como arquivo (`paginar.guarda`, na linha do `.limit(limite)`);
  - `text-amber-700` de volta na etiqueta de anamnese da fila (`acessibilidade.guarda`).
- **Testes:** `npx vitest run` com 1.298 testes em 173 arquivos, todos passando. Desta frente inteira (estas três e as de banco) são 16 novos:
  - 5 em `caixaDeMensagens.guarda`, 3 em `tarefasPorDono.guarda`, 3 em `cursorFeed`, 2 em `acessibilidade.guarda`;
  - 1 em `paginar.guarda`, 1 em `perfilSimulado.guarda` e 1 em `canaisDoPapel`.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 56 funções e nenhuma vulnerabilidade.
- As 43 telas da troca de cor mais simples foram feitas por um agente auxiliar, com as regras acima e a guarda como critério; as 6 que tinham também o estado vazio, e a conferência do conjunto, ficaram nesta frente.
- **Falta, porque esta frente não toca produção:** a tela no computador e no celular. As telas com erro se provocam com o banco sem resposta, como na rodada 3. O feed com mais de mil posts se confere numa academia de homologação. As cores se conferem nos dois temas.

## O treino publicado do zero, sem modelo (09/10/2026)

**O pedido**, tirado de um vídeo de uso: o treinador monta e publica o treino do aluno sem escolher antes um modelo da biblioteca. Até aqui, `publicar_treino` só publicava a partir de um modelo. Para um treino sob medida, o professor criava um modelo, montava, publicava e deixava na biblioteca da academia um modelo de um aluno só. O artigo da Central já dizia "monte do zero", e a tela não deixava.

**A decisão: uma função que publica a partir dos itens, e não um modelo escondido por baixo.** Um modelo "do aluno" criado em silêncio pediria coluna nova, filtro em toda leitura da biblioteca e limpeza. A função nova recebe a lista e grava o mesmo snapshot.

- **Banco (`20261440010000`):** `publicar_treino_do_zero(_aluno_id, _titulo, _itens jsonb, _validade_inicio, _validade_fim)`, com o treino gravado com `modelo_id` nulo.
  - **O snapshot** tem as mesmas chaves, na mesma ordem, do `publicar_treino`, e continua imutável (`trg_treinos_imutavel`).
  - **Cada item vem do acervo**, global ou da academia do aluno, pelo `exercicio_id`, e o banco recusa item sem ele. Nome, grupos, equipamento, vídeo e GIF o banco copia do acervo. Assim o nome e o vínculo nunca divergem, e o app acha os GIFs por modelo pelo id (`useGifsDoAcervo`). Da tela vêm só a divisão (A a J), as séries (1 a 10, com o detalhe série a série), a descrição de execução (vazia: a do acervo) e a observação.
  - **Por que exigir o acervo.** O editor de modelos aceita nome livre, mas o pedido era o treino com GIF. Exercício que ainda não está no acervo se cadastra antes, na aba ao lado.
- **Quem publica.** A função roda com a permissão de quem chama, como `publicar_treino`. O RLS de `treinos` e o gatilho do dono (`definir_dono_da_prescricao`) valem do mesmo jeito. Por cima, ela confere quem chama, mais estrito que o RLS, que deixa qualquer pessoa da equipe incluir:
  - aluno fora do Método: o gestor ou o professor da academia do aluno, ou a ArkeFit com as duas etapas;
  - aluno do Método: `pode_prescrever_treino_metodo()`, a regra de hoje (o Mentor com CREF; o sócio sem CREF só com a exigência desligada).

  A função não tem EXECUTE para `anon` nem para o PUBLIC.
- **Tela (`PrescricaoTreino`, aba Publicar para Aluno):** **Como montar o treino** tem **Usar um modelo** (o caminho de antes, sem mudança) e **Começar do zero**.
  - **`TreinoDoZero`:** divisão, seletor do acervo, séries, como executar e observação, com a lista por divisão e a miniatura pelo GIF escolhido.
  - **A regra pura (`src/lib/treinoDoZero.ts`):** o formato do banco e a conferência antes de mandar.
  - **Rascunho:** a lista fica na sessão (`useRascunho`), e a tela oferece restaurar, nunca sozinha.
  - **O mentor da ArkeFit** tem o mesmo caminho na ficha do aluno do Método, e a chamada está em `CHAMADAS_DA_VISAO_MASTER`.
- **A trava (`treinoDoZero.guarda`)** confere na definição vigente:
  - sem `security definer`;
  - a conferência de quem chama;
  - o acervo só global ou da academia;
  - as chaves do snapshot iguais às de `publicar_treino`;
  - o `revoke` do PUBLIC e do `anon`;
  - que a tela continua chamando os dois caminhos.

**Conferido:**
- **Banco, em transação desfeita, em produção (Ponto Alto):** a função criada e 24 casos, depois desfeitos (a função não ficou, nem treino, exercício ou membro de prova).
  - **O gestor publicou:** `modelo_id` nulo, dono `academia`, título sem espaços, 2 itens na ordem A, B, os 2 com o `exercicio_id`, o nome do acervo, as 14 chaves de `publicar_treino`, o detalhe série a série, a descrição da tela num item e a do acervo no outro.
  - **O snapshot recusou alteração.** O professor publicou.
  - **A recepção e a nutricionista receberam 42501.**
  - **Itens errados, todos 22023:** exercício de outra academia, id que não é id, sem exercício, divisão Z, 0 séries, 2,5 séries, repetições vazias, lista vazia, objeto em vez de lista, item que não é objeto e título vazio.
  - **Exercício próprio da academia:** publicou.
  - **Aluno do Método:**
    - o gestor recebeu 42501;
    - o sócio sem as duas etapas não achou o aluno;
    - o sócio com as duas etapas publicou (dono `arkefit`);
    - o Mentor contratado sem CREF recebeu 42501;
    - com CREF, publicou com o registro gravado.
  - **O `anon` não tem EXECUTE**, e `publicar_treino` pelo modelo seguiu igual (6 itens).
  - **Depois de subir o limite das repetições para 200 caracteres:** 10 séries de "8 a 12" (69 caracteres) publicaram, e 201 caracteres foram recusados.
- **3 defeitos plantados, os 3 pegos pela trava:** a função como `security definer`, a conferência sem o professor e as chaves do snapshot fora de ordem.
- **Testes:** `npx vitest run` com 1.639 testes em 206 arquivos, 14 novos:
  - 5 da regra (`treinoDoZero.test`);
  - 2 da tela (`TreinoDoZero.test`: o item entra pelo acervo com o `exercicio_id` e as séries padrão, e sai pelo botão com o nome);
  - 7 na trava.

  Com o `npm run check` rodando ao mesmo tempo, 1 teste alheio (`SuperAdminEquipamentos`) passou do prazo de 5 s; rodado de novo, passou.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 57 funções e nenhuma vulnerabilidade.
- **Falta, porque esta frente não toca produção:**
  - aplicar a migration;
  - gerar o `types.ts` de novo (a função foi escrita à mão, na ordem do gerador);
  - renovar o `supabase/historico/`;
  - conferir a tela no computador e no celular.


**Em produção, em 09/10:** a migration `20261440010000` foi aplicada antes do merge, porque a tela nova chama a função; o `types.ts` gerado de novo não teve diferença. Na academia de demonstração (Ponto Alto), no computador e no celular, o professor Diego vê "Usar um modelo" e "Começar do zero" em Treinos → Publicar para Aluno. Pela função, ele publicou dois treinos do zero, para a Isabela e para a Marina, com as divisões A e B e 4 exercícios, todos com o `exercicio_id`. No app da Marina, o "Treino do zero — Marina" aparece com os GIFs. Os dois treinos ficaram como histórico da demonstração.

**O texto de Publicar (09/10):** o alto da aba Publicar, no treino e na dieta, dizia "cria uma cópia congelada (snapshot) do modelo", o que não vale para o treino do zero e usa um termo técnico. Passou a dizer que o aluno recebe o treino (ou a dieta) como está na hora de publicar, e que mudar o modelo depois não muda o que ele já recebeu.
## O GIF do exercício com modelo masculino ou feminino (09/10/2026)

O acervo global (105 exercícios, `organization_id` nulo) vai ganhar os GIFs de um pacote que traz cada exercício com um modelo masculino e um feminino. Até aqui cada exercício tinha uma mídia só (`gif_url`, `video_url`), e o app não guarda o sexo de ninguém.

**A decisão: quem vê escolhe o modelo, e o app não coleta sexo.** Perguntar o sexo para escolher um GIF seria coletar dado pessoal sem necessidade, mexer na matrícula e na Política. O que a tela precisa é só de uma preferência de exibição: "Ver os exercícios com modelo masculino ou feminino?". Ela é perguntada na primeira vez que o aluno vê um exercício que tem os dois GIFs, em linha e sem bloquear o treino; **Agora não** deixa o masculino e fica só naquele navegador (não é escolha, então não vai ao banco). A troca fica embaixo do GIF, em qualquer exercício que tenha os dois.

- **Banco (`20261438010000`):** `exercicios_biblioteca.gif_masculino_url` e `gif_feminino_url`, ao lado do `gif_url`, que continua a mídia única. As regras do acervo são por linha e não mudaram: a linha global só a ArkeFit (superadmin, com as duas etapas) grava. A preferência é `profiles.modelo_exercicio` (`masculino` ou `feminino`, nula até escolher, com `check`). A pessoa grava a própria linha pelo RLS de `profiles` que já existia, então não houve função nova; a tela confere a linha devolvida (`exigirGravacao`). A sessão simulada é sessão da própria pessoa e grava normalmente: escolher o modelo não é autorização. A anonimização não limpa a preferência: sem nome nem CPF, ela não identifica ninguém.
- **A regra (`src/lib/modeloExercicio.ts`):** o GIF do modelo escolhido; sem ele, o do outro modelo; sem os dois, o `gif_url`; sem escolha, o masculino. O vídeo segue como antes.
- **De onde o aluno lê os GIFs:** o snapshot do treino congela a prescrição, mas os GIFs por modelo vêm do acervo, pelo `exercicio_id` do snapshot (`useGifsDoAcervo`). Assim, o GIF novo aparece em todas as fichas publicadas sem republicar nenhuma. Ficha publicada antes da rodada 2 do acervo (`20261207010000`, sem `exercicio_id` no snapshot) segue com o `gif_url` do snapshot, e o mesmo vale se a leitura do acervo falhar.
- **Telas:** no aluno, a lista do treino do dia e a execução série a série. Na equipe, o acervo da academia e o da Visão Master mostram a miniatura pelo modelo escolhido e a troca no detalhe; o formulário ganhou **GIFs por modelo** (o `CampoMidia` no modo só imagem). A cópia que a academia faz de um padrão leva os dois GIFs junto. Na prescrição, a busca do acervo tem a troca e a ficha mostra a miniatura pelo `exercicio_id`.

**Conferido:**
- **Banco, em transação desfeita, em produção:** a migration rodou inteira e foi desfeita. O aluno gravou a própria preferência (1 linha) e não gravou a de outra pessoa (0). O `check` recusou `outro`. O aluno leu os dois GIFs do acervo global e não os gravou (0). O gestor de academia também não gravou a linha global (0). O superadmin gravou com as duas etapas (1) e não gravou sem elas (0), e o `anon` ficou sem privilégio.
- **2 defeitos plantados, os 2 pegos:** a regra ignorando a escolha (`modeloExercicio.test`) e uma coluna inexistente na leitura dos GIFs do acervo (`colunasConsultas.guarda`, que também confere as colunas novas escritas no `types.ts`).
- **Testes:** `npx vitest run` com 1.599 testes em 199 arquivos; 8 novos em `modeloExercicio.test`. Na máquina local, carregada, 5 testes de 3 arquivos (`colunasConsultas.guarda`, `subcontaBaas.guarda`, `PublicMatricula`) passaram do prazo de 5 s; rodados de novo, com prazo maior, passaram todos.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 57 funções e nenhuma vulnerabilidade.
- **Falta, porque esta frente não toca produção:** aplicar a migration, gerar o `types.ts` de novo (as colunas foram escritas à mão, na ordem do gerador), subir os GIFs e conferir a tela no computador e no celular.


**Em produção, em 09/10:**
- **De onde vieram os GIFs:** de um pacote de livre uso com 6.304 GIFs (masculino e feminino), numa pasta pública do Google Drive. Um script fez o índice da pasta e baixou só os escolhidos, sem passar pelo disco de ninguém.
- **A associação:** pelo nome em inglês, revisada caso a caso. São 69 exercícios com os dois modelos, 22 só com o masculino e 14 só com o feminino; quando falta um, a tela mostra o outro, em vez de trocar o exercício por uma variação.
- **O arquivo:** cada GIF virou WebP animado de 480 px (de 463 MB para 31 MB no total, média de 182 KB), no bucket público `exercicio-imagens`, em `acervo-global/<exercício>-<m|f>-<hash>.webp`, com cache de um ano.
- **A ordem:** a migration `20261438010000` foi aplicada antes do merge, porque a tela nova lê as colunas; depois, as colunas dos 105 exercícios globais foram preenchidas. O `types.ts` gerado de novo não teve diferença.
- **Conferido** com uma aluna e uma academia temporárias, apagadas no fim, no computador e no celular: a pergunta apareceu, a escolha gravou `feminino`, e o supino (dois modelos) mostrou o feminino, a flexão (só o feminino) o feminino e o voador (só o masculino) o masculino. Os 174 GIFs abrem pelo endereço público.
## Os modelos de treino com vínculo ao acervo, e o GIF nos treinos já publicados (09/10/2026)

**O defeito.** Com os GIFs no acervo, o responsável ainda via exercícios sem GIF. O acervo global estava completo (os 105 exercícios com pelo menos um dos dois modelos); faltava o caminho até ele. Os modelos de treino que toda academia recebe (Adaptação A/B, Hipertrofia A/B, Metabólico) tinham **93 dos 102 itens sem `exercicio_id`**, 31 em cada academia (Ponto Alto, ARKE Homologação e Methodos Vitae). O `publicar_treino` leva o `exercicio_id` do item para o snapshot, e o app lê os GIFs por modelo pelo id: o treino publicado de um modelo sem vínculo ficava sem GIF. Na Ponto Alto, os **1.048 itens dos treinos ativos** estavam assim.

**A causa.** `seed_templates_treino_padrao()` (`20261005010000`, e o backfill `20261007010000` copiado dela) juntava o acervo pelo nome e pelo grupo só para copiar séries, repetições e descanso, e não gravava o vínculo. A junção tinha mais dois defeitos: comparava o grupo antigo do roteiro (`Core`, `Braços`, `Quadríceps`, `Isquiotibiais`) com o do acervo, que desde a rodada 3 (`20261209010000`) é `Abdômen`, `Bíceps`, `Tríceps`, `Pernas`, `Glúteos` — 19 dos 31 itens não achavam o exercício nem para as séries —; e não se limitava ao acervo global, então um exercício próprio de outra academia com o mesmo nome e grupo entraria no modelo da academia nova (e duplicaria o item, se houvesse dois).

**O conserto:**
- **A função (`20261439010000`):** o exercício do modelo é o global de mesmo nome, só quando o nome é único entre os globais, e o item grava o `exercicio_id`. Com o vínculo, copia do acervo o que o prescritor copiaria ao escolher o exercício na tela (grupos, equipamento, vídeo, descrição e GIF).
- **O backfill:** cada item sem vínculo ganha o exercício global de mesmo nome; se o nome se repetir entre os globais, o único de mesmo grupo; sem exatamente um candidato, fica como está. Com o vínculo, os grupos passam a ser os do exercício (a regra da rodada 3) e o vazio de mídia, equipamento e descrição vem do acervo; o que a academia preencheu não muda.
- **O snapshot publicado não muda** (é imutável). Para ele, a tela casa pelo nome na leitura: em `useGifsDoAcervo` (o treino do dia e a execução), o item sem `exercicio_id` usa o exercício **global** de nome exato e único (`exercicioDoAcervo` e `globaisPorNome`, em `src/lib/modeloExercicio.ts`). A leitura vai em lotes de 200 nomes (`porLotes`), só no acervo global. Nome sem par exato, ou repetido entre os globais, fica como antes, com o `gif_url` do snapshot; o item com vínculo nunca casa pelo nome. Na prescrição, a miniatura da ficha segue a mesma regra, com o acervo que a tela já tem.
- **O de-para do acervo** (trocar um nome antigo por um exercício nas fichas da academia) mudava o nome do item do modelo sem o vínculo: agora grava o `exercicio_id` junto.
- **A trava:** `modelosComVinculo.guarda` confere a última definição, nas migrations, de toda função que inclui item de modelo (a lista de colunas leva `exercicio_id`), que a função dos modelos busca só no acervo global e sem comparar o grupo antigo, e que toda gravação do app que muda o nome do item grava o vínculo junto.

**Conferido:**
- **Banco, em transação desfeita, em produção:** a migration rodou inteira e foi desfeita (depois, 93 itens sem vínculo de novo e a função antiga no ar). O backfill vinculou **93** itens; ficaram 0 sem vínculo, 0 vinculados a exercício que não é global, 0 com nome diferente do exercício e 0 com grupo antigo. Uma academia criada na mesma transação recebeu 5 modelos e 31 itens, **31 com vínculo**, 31 com GIF no acervo e 31 com séries, repetições e descanso do acervo. A função segue sem EXECUTE para a API (`{postgres=X/postgres}`).
- **Os treinos já publicados:** os 1.048 itens dos treinos ativos sem `exercicio_id` têm, todos, um único exercício global de nome exato; é o que a tela casa.
- **2 defeitos plantados, os 2 pegos pela trava:** a função sem `exercicio_id` na lista de colunas e o de-para sem o vínculo.
- **Testes:** `npx vitest run` com 1.610 testes em 200 arquivos; 11 novos (8 da regra de casamento em `modeloExercicio.test`: exato, só global, nome repetido, sem par, item com vínculo; e 3 na trava).
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 57 funções e nenhuma vulnerabilidade.
- **Falta, porque esta frente não toca produção:** aplicar a migration, renovar o `supabase/historico/` e conferir a tela no computador e no celular (o treino da Ponto Alto com GIF).


**Em produção, em 09/10:** a migration `20261439010000` foi aplicada antes do merge, e os 102 itens de modelo ficaram com vínculo (0 sem). Na Ponto Alto, o treino da Marina mostrou os GIFs dos 6 exercícios no computador e no celular; antes, nenhum. A imagem só carrega quando chega à tela (`loading="lazy"`), o que poupa dados no celular.

## Quem da equipe escreveu cada mensagem do chat (09/10/2026)

**O defeito**, visto na prova da fila em produção: na Ponto Alto, a gestora Renata e o professor Diego mandaram "Teste" para a aluna Isabela, e o Diego via as duas mensagens como "Você". O `ChatPanel` decidia "Você" pelo `remetente_tipo`: do lado da equipe, toda mensagem `treinador` (ou `nutricionista`) era "minha". O banco já guardava quem enviou (`remetente_id`); a tela não lia.

**A decisão:** a regra foi para `remetenteDaMensagem()` em `src/lib/remetenteDoChat.ts`, que lê o `remetente_id`.
- **Equipe (ficha, diálogo da fila, caixa de Mensagens):** a própria mensagem continua "Você", à direita, na cor primária. A de outra pessoa da equipe fica do mesmo lado (é a academia falando), num balão cinza com borda, e leva o nome completo em cima ("Renata Albuquerque"). O nome sem o papel: o nome já identifica a pessoa, e o papel junto não cabe no rótulo de 10 px sem cortar no celular. A do aluno continua "Aluno".
- **Os nomes** saem de `profiles` por `nomesDosUsuarios()` (`src/lib/perfis.ts`): só `user_id` e `full_name`, em lotes de 200 (`porLotes`), pelo RLS de quem pede, sem `security definer` e sem função nova. Só os ids das outras pessoas da equipe que escreveram são pedidos (`colegasNaConversa()`), numa chave de cache própria (`chat-nomes-da-equipe`).
- **O nome que não volta** (a leitura falhou, ou a pessoa saiu da academia e o RLS não entrega mais o perfil) vira "Equipe da academia", e a conversa segue: o erro dos nomes não troca a conversa por `<ErroAoCarregar>`, porque as mensagens carregaram. A conversa sem carregar continua com o `<ErroAoCarregar>` de antes.
- **Aluno: nada muda.** Ele continua vendo "Treinador(a)" no treino e "Nutricionista" na nutrição. A regra de leitura de `profiles` só entrega o perfil de quem é da equipe a quem é da equipe da mesma academia (`is_org_staff`) ou à ArkeFit; o aluno não é equipe, e o app do aluno não mostra o nome de ninguém da academia (o `PrescritoPor` só nomeia o prescritor da ArkeFit, pelo `useMeuAcompanhamento`). Mostrar o nome ao aluno pediria acesso novo, e esta frente não abre nenhum.
- **Fora desta frente:** a prévia da caixa de Mensagens continua "Você/equipe:" na última mensagem, porque a `get_caixa_mensagens` devolve só o tipo de quem escreveu; trocar pediria migration. O chat do mentor (`ChatMentor`, `mensagens_mentor`) é outro componente e ficou como estava: do lado da ArkeFit, toda mensagem de mentor é "minha" e leva "Mentor ARKE ·".

**Conferido:**
- **Testes:** `npx vitest run` com 1.653 testes em 208 arquivos, 14 novos: 8 da regra (`remetenteDoChat.test`: a própria como "Você", a do colega com o nome, o nome ausente ou em branco no rótulo neutro, sem saber quem lê nada vira "Você", o aluno com a função por canal, e os colegas sem repetir e nunca do lado do aluno) e 6 da tela (`ChatPanel.test`: a conversa da Ponto Alto vista pelo Diego e pela Renata, a leitura dos nomes com erro e vazia, a nutrição, e o aluno sem nenhuma leitura de `profiles`).
- **1 defeito plantado, pego:** a regra de antes (toda mensagem da equipe como "minha") de volta; 8 testes falharam.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 57 funções e nenhuma vulnerabilidade.
- A Central de Ajuda (`mensagens.md`, seção "Quem escreveu cada mensagem") e o índice do assistente (`npm run ajuda:indice`) foram atualizados; falta publicar `assistente-academia`.
- **Falta, porque esta frente não toca produção:** na Ponto Alto, a conversa da Isabela aberta pelo Diego (a dele como "Você", a da Renata com o nome) e pela Renata (o contrário), no computador e no celular, e o app da Isabela com as duas como "Treinador(a)".


**Em produção, em 09/10:** na Ponto Alto, na conversa de treino da Isabela, a gestora Renata vê o próprio "Teste" como "Você" e o do professor Diego com o nome dele, e o Diego vê o contrário, no computador (tema claro e escuro) e no celular. A mensagem de outra pessoa da equipe fica num balão cinza com o nome em cima.
## "Mensagem" direto do cartão da fila de atendimento (09/10/2026)

**O pedido**, tirado de um vídeo de uso: abrir a conversa com o aluno a partir da fila, sem dar a volta pela ficha. Até aqui, o cartão da tarefa tinha Assumir, Ver Anamnese, Prescrever e o desfecho; para escrever ao aluno, era abrir Alunos, achar a ficha e clicar no chat.

**A decisão: o botão não dá acesso novo.** Ele aparece só para quem a ficha já deixava conversar com aquele aluno, e abre o canal que essa pessoa já via. A regra, que estava espalhada entre a ficha (Método sem chat, nutrição só para quem atende a saúde e com nutricionista na equipe) e a caixa de Mensagens (o canal pelo papel, `canaisDoPapel`), foi para um lugar só: `canaisDaConversaComAluno()` em `src/lib/conversaComAluno.ts`. A caixa passou a ler `canaisDoPapel` de lá. Nada mudou no banco: as regras de `mensagens_treino`, `mensagens_dieta` e `mensagens_mentor` continuam as de `20261400010000` e `20261423010000`.

- **Fila da academia (`AdminDashboard`, a tela Atendimento):** cada cartão com aluno ganha **Mensagem** (rótulo acessível "Mensagem para <nome>"), que abre o mesmo `ChatPanel` da ficha num diálogo. O professor e a recepção abrem o chat de treino; a nutricionista, o da nutrição; a gestão, os dois, com a troca no próprio diálogo (a nutrição só quando a academia tem nutricionista). Aluno do Método fica sem botão: a conversa dele é com o mentor da ArkeFit. O plano e o nome de cada aluno da fila vêm numa leitura em lotes de 200 (`porLotes`), com o `planoDoAluno()` de sempre; enquanto ela não volta, o botão não aparece, em vez de aparecer errado.
- **Fila do Mentor (Mentoria → Chamados):** cada chamado ganha **Mensagem**, que abre o `ChatMentor` da aba Conversa da ficha. O Mentor contratado só recebe chamado de aluno do Método (`get_fila_mentor`), e o RLS de `mensagens_mentor` diz o mesmo.
- **A trava (`conversaDaFila.guarda`):** a lista fechada das telas que montam o chat do lado da equipe (`viewerType="staff"` ou `"mentor"`), cada uma com o motivo; a fila decide o botão por `canaisDaConversaComAluno()`; e a `get_fila_mentor` vigente filtra o aluno do Método para quem não é sócio.

**Conferido:**
- **Testes:** `npx vitest run` com 1.625 testes em 203 arquivos, 15 novos: 6 da regra (`conversaComAluno.test`: o professor só no treino, a recepção nunca na nutrição, a nutricionista na nutrição, a gestão nos dois, sem nutricionista sem nutrição, o Método sem conversa para nenhum papel), 5 do diálogo (`ConversaDaFila.test`: o rótulo acessível, o canal único, a troca de canal com `aria-pressed`) e 4 na trava.
- **1 defeito plantado, pego:** a regra sem conferir a saúde e sem barrar o Método (2 testes falharam).
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 57 funções e nenhuma vulnerabilidade.
- **Falta, porque esta frente não toca produção:** conferir a tela no computador e no celular, na academia de demonstração, com o gestor, o professor e a recepção, e no Mentor.


**Em produção, em 09/10:** na Ponto Alto, como a gestora Renata e o professor Diego, no computador e no celular, o botão nos 163 cartões da fila abriu a conversa do aluno. A gestora vê o chat de treino e o da nutrição; o professor, só o de treino (a "Minha Fila" dele está vazia, e os cartões estão na "Fila da Organização"). As duas mensagens "Teste" ficaram em `mensagens_treino`, com `remetente_tipo` `treinador` e não lidas, como histórico da demonstração. **Observação:** na conversa de treino, a mensagem de qualquer pessoa da equipe aparece como "Você"; o banco guarda quem enviou, mas a tela não mostra o nome.
## O contador de não lidas baixa na hora (06/10/2026)

Na tela em produção, depois da `20261400` (a mensagem lida passou a gravar), o professor abriu a conversa do aluno. A mensagem ficou lida no banco, mas o número do menu continuou em 1. O chat (`ChatPanel`) recarregava só as próprias mensagens depois de marcar como lida. O contador do menu e da caixa (`useCaixaMensagens`, chave `caixa-mensagens`) só baixava na próxima atualização, até 30 s depois, ou ao fechar a conversa pelo botão da tela de Mensagens. Agora o chat recarrega o contador também, onde quer que esteja aberto, inclusive na ficha do aluno.

**Conferido:** a tela, de novo, depois do deploy (abaixo, no PR).

## Aviso de mensagem nova: na tela inicial do aluno e no celular, dos dois lados (10/10/2026)

**O pedido** (Jean, 09/10): aviso visível de mensagem nova do treinador na tela inicial e por notificação push; o responsável acrescentou que o push vale para o mentor e para o aluno.

**O que já existia:** o `ChatPanel` (treino e nutrição) chamava `send-chat-push` depois de gravar, nos dois sentidos: a equipe avisa o aluno (o `user_id` dele), e o aluno avisa a equipe da academia por papel (treino: professor, gestor, admin_arke; nutrição: nutricionista, gestor, admin_arke; a recepção nunca recebe a nutrição). O aviso leva o trecho da mensagem (140 caracteres no app, cortado em 180 no servidor), agrupa por conversa e some em 12 h. O "Sair" apaga a inscrição do aparelho (`avisosDoAparelho.ts`), e a sessão simulada não registra o aparelho.

**O que faltava, e foi feito:**
- **A conversa com o mentor (`ChatMentor`, `mensagens_mentor`) não avisava ninguém.** `send-chat-push` ganhou o canal `mentor`: o app manda só o `alunoId`, e o servidor procura a mensagem que quem chama gravou nos últimos 2 minutos, **lida com a sessão dele** (o RLS de `mensagens_mentor` já decide quem fala ali: o próprio aluno, os sócios e o nível Mentor com as duas etapas e só com o aluno do Método). Mensagem do mentor avisa o aluno; do aluno, avisa o mentor atribuído (`alunos.mentor_id`), se ainda é da equipe da Mentoria (sócio ou `equipe_arkefit` ativo com o nível `mentor`); sem mentor, a equipe inteira da Mentoria. Aluno fora do Método não avisa ninguém. Regra pura em `send-chat-push/regras.ts` (`destinoNoCanalMentor`, `mensagemRecente`).
- **O aviso do mentor não leva trecho.** É o canal em que o aluno fala da dor e do que não contaria à academia, e a tela bloqueada do celular é pública. O texto é fixo (`AVISO_DO_MENTOR`): "Nova mensagem do seu mentor ARKE" para o aluno, "Nova mensagem de aluno do Método" para o mentor. Treino e nutrição continuam com o trecho, como antes (o padrão de hoje, mantido).
- **Nenhuma tela pedia a permissão do navegador.** `requestPushPermission()` existia desde o porte do chat e ninguém chamava: o aviso só chegava a quem tinha liberado as notificações do site por conta própria. `AtivarAvisosCelular` aparece embaixo de cada conversa que aceita mensagem (`ChatPanel` e `ChatMentor`, no app, na ficha, na caixa de Mensagens, na fila e na Mentoria), só enquanto a pessoa não respondeu ao navegador, e some na sessão simulada e onde o navegador não oferece push (o iPhone sem o app na tela de início).
- **A tela inicial do aluno:** mensagem não lida da equipe ou do mentor **vira a Próxima Ação** (`mensagem_nova`, em `definirProximaAcao()`), com "Nova mensagem do seu treinador" (ou da nutrição, ou do seu mentor ARKE) e o botão **Ler mensagem**, que abre a tela da conversa (treino; dieta para a nutrição). Ordem: mentor, treino, nutrição (`canalDaMensagemNova`).

**Por que Próxima Ação, e não um cartão a mais:** a regra da home é uma ação só. Um cartão próprio acima dela criaria duas chamadas disputando o topo; abaixo, a mensagem ficaria escondida, que é o contrário do pedido. Ler é um toque, a resposta costuma mudar o resto (o ajuste do treino de hoje, a dúvida da dieta), e aberta a conversa ela fica lida e a home volta sozinha ao treino. Ela vem depois do "carregando" e antes de tudo o mais, inclusive "ficha sendo preparada" e "em dia". A consulta não segura a Próxima Ação: enquanto não volta, a home segue pelo resto. Falha da consulta também cai no resto (não há estado vazio dela para trocar por `<ErroAoCarregar>`); a mensagem continua no chat e no push.

**O que ficou de fora:** a nutrição conta só a conversa da dieta mais recente, a mesma que o chat abre e marca como lida; as das dietas antigas ficariam "não lidas" para sempre. Nada no banco mudou: sem migration, e a função é a mesma `send-chat-push`.

**A trava (`avisoDeMensagem.guarda`):** as três conversas avisam o outro lado depois de gravar; a do mentor não chama `sendChatPush(` (que leva texto) e o ramo do servidor usa o texto fixo e lê a mensagem com a sessão de quem chama; e cada conversa que aceita mensagem tem o `AtivarAvisosCelular`. `send-chat-push` e `vapid-public-key` entraram em `CHAMADAS_DA_VISAO_MASTER`.

**Conferido:**
- **Testes:** `npx vitest run` com 1.665 testes em 209 arquivos, todos verdes. Novos: 4 da home (`proximaAcao.test`: a mensagem antes do treino, com ficha esperando e em dia, sem mensagem ou sem saber segue igual, a ordem mentor-treino-nutrição), 5 do canal do mentor (`avisoCelular.test`: quem recebe em cada sentido, mentor que saiu, fora do Método, a janela de 2 minutos, o texto fixo dentro dos limites), o agrupamento `mentor:` (`avisoPush.test`) e 3 na trava.
- **1 defeito plantado, pego:** a regra da mensagem desligada em `definirProximaAcao`; 2 testes falharam.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 57 funções e nenhuma vulnerabilidade.
- A Central de Ajuda (`app-tela-inicial.md`, `mensagens.md`, `vm-mentoria.md`) e o índice do assistente (`npm run ajuda:indice`) foram atualizados; falta publicar `assistente-academia`.
- **Publicado em 10/10:** `send-chat-push` (v35) e `assistente-academia` (v56).
- **Na Ponto Alto, no computador e no celular:**
  - O professor Diego grava "Teste" no chat de treino da Marina com a sessão dele (201), e `send-chat-push` aceita o aviso (200, sem aparelho inscrito).
  - A home da Marina mostra "Nova mensagem do seu treinador", e "Ler mensagem" abre `/app/treinos`.
  - A conversa mostra "Ativar avisos", e a mensagem fica lida.
  - O canal do mentor chamado por aluna fora do Método é recusado (403).
  - A Marina aceitou antes, pela tela, a Política de 09/10.2.
- **Defeito que a prova achou:** lida a mensagem, a home continuava com o cartão. O chat atualizava o próprio cache e o contador do menu, mas não o do cartão, que fica guardado por 30 s e é relido a cada minuto. Agora os dois chats atualizam `aluno-mensagem-nova` ao marcar como lida, e a trava ganhou o quarto caso. O defeito plantado (a linha tirada do `ChatMentor`) fez 1 teste falhar.
- **Ainda falta:** o push chegando de verdade num celular com os avisos ligados, nos dois sentidos, e a conversa do mentor com um aluno do Método. A Ponto Alto não tem aluno do Método com a senha da demonstração.
- **Falta, porque esta frente não toca produção:** publicar `send-chat-push` e conferir na Ponto Alto: o aluno vê "Nova mensagem do seu treinador" na home depois de o professor escrever, e o aviso chega ao celular nos dois sentidos, também na conversa do mentor.

## O cartão "Próximo Evento de Acompanhamento" leva a algum lugar, e o atalho para o mentor (10/10/2026)

**O pedido** (Jean, 10/10): o cartão de evento da tela inicial do aluno não levava a lugar nenhum. Que ele abra a tela onde o aluno vê ou faz aquilo, e que tenha um atalho direto para falar com o mentor.

**O que existia:** o cartão mostra **um tipo de evento só**, o encontro de Acolhimento M.A.P.A.®. Ele vem de `obter_proximo_evento_aluno()` (`20261010020000`), que devolve a última tarefa `anamnese` aberta do próprio aluno (motivo, `data_agendada`, prazo). Essa tarefa nasce no acolhimento do Método (`Onboarding.tsx`, `agendar_acolhimento:<aluno>`), e a data entra pelo **Agendar** da fila (`AdminDashboard`), o único lugar que grava `data_agendada`. Não há avaliação, consulta ou aula no cartão. A conversa com o mentor (`CanalMentor`/`ChatMentor`) fica nas telas de treino e de dieta; a da academia, no fim da tela de treino.

**A decisão: o destino** (`destinoDoEvento()`, `src/lib/eventoAcompanhamento.ts`):
- o acolhimento não tem tela própria e não aparece em calendário nenhum do app: a **Agenda** é a das aulas da academia (e só existe quando ela tem turmas), e o **Calendário** do treino é o dos treinos feitos. Mandar o aluno para lá seria mandá-lo procurar o que não existe;
- **no Método**, o cartão abre a **Jornada**, que começa no M.A.P.A.®: lá ficam os objetivos de que o encontro trata;
- **no Free**, a Jornada é só o convite do Método; o cartão abre a conversa com a academia, que é quem marcou e com quem se remarca. Quase não acontece: a tarefa nasce do acolhimento do Método, então o Free só tem evento se saiu do Método com ela aberta.

**A decisão: o atalho** (`atalhoDeConversa()`): **Falar com o mentor**, só no Método, abre a tela de treino e desce até a conversa com o mentor. **No Free, nenhum**: o chat da academia já está a um toque (o atalho Treino de Hoje), a resposta nova da equipe vira a Próxima Ação, e um botão de conversa num cartão que no Free quase sempre está vazio seria uma segunda chamada disputando com a Próxima Ação. O atalho é do cartão (um botão secundário, `outline`), não uma segunda Próxima Ação.

**Como desce até a conversa:** a navegação é por `HashRouter`, então a âncora não cabe na URL; ela vai no estado da rota (`rolarPara`), e a tela de treino rola até o bloco (`conversa-mentor` ou `conversa-academia`) depois que o treino carregou, senão o bloco de cima cresce e empurra a conversa.

**De passagem:** a data do cartão saía pelo fuso do aparelho (`new Date().toLocaleString`); passou a sair por `formatarDataBR`, no fuso de Brasília. E o texto do cartão vazio no Free dizia "Em breve — sua equipe vai agendar os próximos passos", promessa que no Free não existe (não há acolhimento); agora diz "Nenhum encontro marcado. Quando a equipe marcar, a data aparece aqui." No Método o texto ficou.

**O que ficou de fora:**
- o motivo que o cartão mostra é o texto da tarefa, escrito para a equipe ("Acolhimento M.A.P.A.®: ler a anamnese e prescrever o primeiro treino"); trocar por um texto para o aluno pede mexer na RPC, numa migration — fica para quando houver outro tipo de evento;
- outros tipos de evento (avaliação, consulta): não existem no banco; a regra por tipo nasce com o primeiro deles;
- a Próxima Ação "mensagem nova" do mentor continua abrindo a tela de treino no topo; dá para usar o mesmo `rolarPara` depois.

Sem migration. A única publicação é a do `assistente-academia`, pelo índice dos artigos da Central.

**Conferido:**
- **Testes:** `npx vitest run` com 1.669 testes em 210 arquivos, todos verdes; 4 novos (`eventoAcompanhamento.test`: o Método vai à Jornada, o Free não, o atalho do mentor só no Método).
- **1 defeito plantado, pego:** as duas regras sem o ramo do Free (o Free ia à Jornada e ganhava o atalho do mentor); 2 testes falharam.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das funções e nenhuma vulnerabilidade.
- A Central de Ajuda (`app-tela-inicial.md`, `app-checkin-do-dia.md`, `fila-de-atendimento.md`) e o índice do assistente (`npm run ajuda:indice`) foram atualizados; falta publicar `assistente-academia`.
- **Falta, porque esta frente não toca produção:** conferir a tela no computador e no celular, na Ponto Alto: a aluna do Free sem evento vê o texto novo e nenhum botão; com o Método, o atalho abre a conversa do mentor e o cartão com data abre a Jornada.

## Dieta do aluno: o calendário de adesão no topo e o guia de alimentos recolhível (10/10/2026)

**O pedido** (Jean, 10/10): na tela de dieta do aluno (`/app/dieta`), o guia de alimentos fica recolhível, para a tela não ficar comprida demais; o calendário de adesão ganha destaque; e o check dos alimentos e das refeições continua, porque é engajamento no objetivo.

**O que existia:** `AlunoDieta.tsx` mostrava, nesta ordem, os macros do dia, o guia de alimentos (cada refeição e cada alimento com a sua caixa, gravadas em `registro_habito.refeicoes_concluidas` e `itens_consumidos`) e, no fim, o "Controle da Dieta" (`ControleDieta.tsx`): o calendário de adesão (`dieta_adesao`, o Sim/Não por refeição de cada dia), o resumo da semana e o do mês. O calendário ficava abaixo da lista inteira, com branco sobre verde, laranja e vermelho fixos (`bg-emerald-500`, `bg-orange-400`, `bg-red-400`), abaixo de 3:1 no número de 10px. Não havia preferência salva de nada na tela.

**As decisões:**
- **O calendário sobe e vira o destaque.** `ControleDieta` ganhou o encaixe `depoisDoCalendario`: a tela fica calendário → macros e guia → resumos da semana e do mês, sem duplicar o estado do diálogo de registro. O cartão tem a borda da marca (`border-primary/50`), título maior e uma linha com os dias registrados no mês e a média.
- **Só tokens no calendário.** O dia registrado tem o fundo claro da faixa (`bg-success/15`, `bg-primary/15`, `bg-warning/15`, `bg-destructive/15`), um contorno da mesma cor e o número no `--*-texto`, que tem 4,5:1 nos dois temas. O corte das faixas (80, 50, 30) saiu para `faixaDeAdesao()` em `src/lib/adesaoDieta.ts`, e a legenda lê o mesmo mapa, para não divergir.
- **O guia recolhe com o `Collapsible` do shadcn**, o mesmo das substituições logo abaixo: o botão "Recolher"/"Ver alimentos" no título do cartão, com `aria-expanded` e `aria-controls` dados pelo Radix. Recolhido, o título ainda diz "N de M refeições marcadas hoje", para o engajamento continuar à vista.
- **Abre por padrão e lembra a escolha no aparelho** (`localStorage`, chave `arke:dieta:guia-aberto`, leitura e gravação com try/catch em `guiaDietaAberto()` e `gravarGuiaDietaAberto()`). Lembrar porque quem recolhe uma vez quer a tela curta toda vez; no aparelho e não no banco porque é conveniência de quem vê, não dado do aluno. Sem armazenamento (aba privada), o guia abre: o check continua a um toque, como antes. Nenhum check foi tirado.
- **De passagem:** o "hoje" e o "futuro" do calendário saíam de `isToday` e `day > new Date()`, no fuso do aparelho; agora o dia é comparado como texto com `hojeBrasilia()`. A consulta do calendário tratava erro como mês vazio; agora mostra `<ErroAoCarregar>`. Cada dia ganhou `aria-label` ("10 de outubro: 80% de adesão") e `aria-current="date"`, e as caixas do guia, rótulo ("Fiz a refeição: Almoço", "Comi: Arroz").

**O que ficou de fora:**
- as cores fixas do diálogo de registro (o Sim em `bg-emerald-600`, o Não em `bg-orange-500`) e os ícones coloridos dos resumos (doce, álcool, água): fora do pedido, ficam para uma passada de tokens na tela inteira;
- o mês do calendário ainda parte de `new Date()` do aparelho (só na virada do mês, perto da meia-noite, pode abrir no mês vizinho);
- a imagem da Central (`app-dieta.jpg`) mostra a ordem antiga; trocar na próxima captura.

Sem migration. A única publicação é a do `assistente-academia`, pelo índice dos artigos da Central.

**Conferido:**
- **Testes:** `npx vitest run` com 1.674 testes em 210 arquivos, todos verdes; 4 novos em `adesaoDieta.test` (os cortes da faixa; o guia abre por padrão; lembra a escolha; sem armazenamento não quebra e abre).
- **2 defeitos plantados, pegos:** o corte de 80 virou `> 80` e o guia passou a abrir só com "1" gravado (fechado por padrão); 2 testes falharam.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 57 funções e nenhuma vulnerabilidade.
- A Central de Ajuda (`app-dieta-e-agua.md`) e o índice do assistente (`npm run ajuda:indice`) foram atualizados; falta publicar `assistente-academia`.
- **Falta, porque esta frente não toca produção:** conferir a tela no computador e no celular, nos dois temas, na Ponto Alto com a aluna Marina Costa Ribeiro (o roteiro da demonstração dá a ela dieta e duas semanas de adesão): o calendário no topo, o guia recolhendo e abrindo, a escolha lembrada ao voltar, e as caixas marcando como antes.
