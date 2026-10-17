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
- (superado em 13/10/2026: o cartão mostra um texto para o aluno) o motivo que o cartão mostra é o texto da tarefa, escrito para a equipe ("Acolhimento M.A.P.A.®: ler a anamnese e prescrever o primeiro treino"); trocar por um texto para o aluno pede mexer na RPC, numa migration — fica para quando houver outro tipo de evento;
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
- (superado em 13/10/2026) as cores fixas do diálogo de registro (o Sim em `bg-emerald-600`, o Não em `bg-orange-500`) e os ícones coloridos dos resumos (doce, álcool, água): fora do pedido, ficam para uma passada de tokens na tela inteira;
- (superado em 13/10/2026) o mês do calendário ainda parte de `new Date()` do aparelho (só na virada do mês, perto da meia-noite, pode abrir no mês vizinho);
- (superado em 13/10/2026) a imagem da Central (`app-dieta.jpg`) mostra a ordem antiga; trocar na próxima captura.

Sem migration. A única publicação é a do `assistente-academia`, pelo índice dos artigos da Central.

**Conferido:**
- **Testes:** `npx vitest run` com 1.674 testes em 210 arquivos, todos verdes; 4 novos em `adesaoDieta.test` (os cortes da faixa; o guia abre por padrão; lembra a escolha; sem armazenamento não quebra e abre).
- **2 defeitos plantados, pegos:** o corte de 80 virou `> 80` e o guia passou a abrir só com "1" gravado (fechado por padrão); 2 testes falharam.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 57 funções e nenhuma vulnerabilidade.
- A Central de Ajuda (`app-dieta-e-agua.md`) e o índice do assistente (`npm run ajuda:indice`) foram atualizados; falta publicar `assistente-academia`.
- **Falta, porque esta frente não toca produção:** conferir a tela no computador e no celular, nos dois temas, na Ponto Alto com a aluna Marina Costa Ribeiro (o roteiro da demonstração dá a ela dieta e duas semanas de adesão): o calendário no topo, o guia recolhendo e abrindo, a escolha lembrada ao voltar, e as caixas marcando como antes.

## Evolução do aluno: os gráficos dos hábitos das últimas 8 semanas (10/10/2026)

**O pedido** (Jean, 10/10): na tela Evolução do aluno (`/app/evolucao`), mais gráficos: sono, energia etc.

**O levantamento, antes de desenhar** (princípio "sem dado inventado": só entra gráfico de dado que existe e é coletado de verdade):

| Dado | Tabela e coluna | Escala | Quem grava, quando |
|---|---|---|---|
| Treino concluído | `registro_treino.concluido`, `data` | um por dia | o aluno, ao concluir o treino da ficha |
| Esforço percebido | `registro_treino.esforco_percebido` | 1 a 10, opcional | o aluno, no fim do treino (`AvaliacaoTreinoDialog`) |
| Sensação do treino | `registro_treino.sensacao` | ótimo, bom, regular, difícil, dor | idem |
| Duração do treino | `registro_treino.duracao_min` | minutos | o app, pelo cronômetro |
| Treino lançado à mão | `treino_calendario` (`tipos`, `duracao_min`, `distancia_km`, `intensidade`) | livre | o aluno, no calendário |
| Adesão à dieta | `dieta_adesao.adesao_percentual` | 0 a 100%, por dia | o aluno, ao marcar as refeições do dia |
| Saciedade, fome | `dieta_adesao.nivel_saciedade`, `fome_manha/tarde/noite` | 4 níveis; sim/não | idem |
| Doce, álcool | `dieta_adesao.consumiu_doce`, `consumiu_alcool` | sim/não | idem |
| Água | `registro_habito.agua_ml` (a fonte das métricas; `dieta_adesao.agua_ml` é cópia) | ml por dia | o aluno |
| Check-in | `checkins.status`, `motivo_dificuldade` | 4 estados | o aluno, quando quer |
| Presença | `presencas` | um por dia | catraca ou QR |
| Avaliação física | `avaliacoes_fisicas`, `metrica_valores` | kg, %, cm; métrica livre de 0 a 10 | a equipe, na avaliação |
| Sono, estresse | `anamnese_acolhimento.qualidade_sono`, `nivel_estresse` | **texto livre, uma vez**, no acolhimento | o aluno, no Método |

**Sono e energia não são coletados por dia.** O que existe é a resposta de texto livre do acolhimento, uma vez só, e só de quem está no Método: não dá curva. Energia e humor não existem em tabela nenhuma. Esta frente não criou coleta nova; fica a decisão para o responsável (abaixo).

**O que a Evolução mostrava:** as avaliações físicas (peso, gordura e músculo em gráfico; perímetros e métricas da avaliação no histórico) e, no Elite, a pontuação de engajamento do mês.

**As decisões:**
- **Quatro gráficos, um por dado que já se coleta com data**, numa seção "Seus hábitos nas últimas 8 semanas", acima da avaliação física (`src/components/aluno/EvolucaoHabitos.tsx`): dias de treino por semana, esforço percebido médio, adesão média à dieta e água média por dia. Com recharts, que a tela já usava (a página é preguiçosa; nada novo no pacote inicial).
- **Constância contra a meta do próprio aluno:** o gráfico de treino tem a linha da `meta_semanal_dias` e diz em quantas semanas fechadas ele chegou nela; a semana atual, que ainda corre, fica fora da conta. A água tem a linha da `meta_agua_ml`.
- **Dias de treino somam a ficha e o calendário**, como o "esta semana" do calendário de treinos: o mesmo dia nos dois conta uma vez.
- **Semana sem registro fica em branco**, nunca zero inventado: média de nada é `null`. O dia com 0 ml de água é o registro de quem só marcou refeição, e não entra na média.
- **Para todo aluno, não só o Elite:** treino, dieta e água são do plano Free. É a evolução privada dele; não há comparação com ninguém.
- A regra (semana de Brasília, de domingo a sábado; médias; semanas na meta) mora em `src/lib/evolucaoHabitos.ts`, com teste ao lado. Uma consulta só, com as cinco leituras em paralelo e `<ErroAoCarregar>` no erro; até 8 semanas por aluno é no máximo um registro por dia, longe do corte de mil linhas.

**O que ficou de fora:**
- **Sono, energia, humor e estresse por dia** (superado em 10/10/2026 para sono e energia, na seção seguinte): precisam de coleta nova (por exemplo, duas perguntas de 1 a 5 no check-in ou no fim do treino, numa coluna com data). É decisão do responsável: o que perguntar, com que frequência, se é dado de saúde para o consentimento e quem da equipe vê.
- Saciedade, doce e álcool: já têm o resumo da semana e do mês na tela da Dieta; repetir aqui só alongaria a Evolução.
- Sensação do treino e check-ins: são categorias, e a "dor" e o "preciso de ajuda" não devem virar curva de desempenho (dor não tira ponto).
- A imagem da Central (`app-evolucao.jpg`) mostra a tela antiga; trocar na próxima captura.

Sem migration. A única publicação é a do `assistente-academia`, pelo índice dos artigos da Central.

**Conferido:**
- **Testes:** `npx vitest run` com 1.680 testes em 211 arquivos, todos verdes; 6 novos em `evolucaoHabitos.test` (a semana de domingo a sábado; as semanas atravessando o mês; a média por semana; o dia repetido conta uma vez; o 0 ml fora da média; as semanas na meta só entre as fechadas).
- **Defeito plantado, pego:** sem tirar a repetição dos dias de treino, o teste "o mesmo dia na ficha e no calendário conta uma vez" falhou.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 57 funções e nenhuma vulnerabilidade.
- A Central de Ajuda (`app-evolucao-e-desafios.md`) e o índice do assistente (`npm run ajuda:indice`) foram atualizados; falta publicar `assistente-academia`.
- **Falta, porque esta frente não toca produção:** conferir a tela no computador e no celular, nos dois temas, na Ponto Alto com a aluna Marina Costa Ribeiro (o roteiro da demonstração dá a ela 8 semanas de treino com esforço de 5 a 9, meta de 3 dias, e duas semanas de dieta e água).

## Sono e energia no fim do treino, com as curvas na Evolução (10/10/2026)

**A decisão do responsável** (10/10): sono e energia passam a ser perguntados com **duas perguntas de 1 a 5 no fim do treino**, junto do esforço percebido: um toque a mais, sem tela nova. As curvas entram na Evolução por semana, como as outras. A equipe da academia vê; a recepção não.

**Por quê no fim do treino:** é a única tela que o aluno já responde a cada treino, de pé, ainda na academia. Um check-in diário separado seria tela nova e pergunta a mais todo dia; no fim do treino a resposta vem com a data do treino e entra na semana certa.

**O levantamento:**
- O fim do treino é o `AvaliacaoTreinoDialog`, aberto pela `TreinoExecucao`: um `update` direto em `registro_treino` (esforço, sensação, duração, observação), sem RPC, conferido por `exigirGravacao`.
- A leitura de `registro_treino` é do aluno, de `is_org_staff` (gestão, professor, nutricionista **e recepção**), da ArkeFit (`admin_arke`) e da mentoria no Método. Ou seja: a recepção lê o registro do treino.
- A saúde do aluno, desde 06/10 (`20261360010000`), é lida por `atende_saude()` (gestão, professor e nutricionista, sem a recepção), e a ArkeFit a lê só no Método (`equipe_metodo()` e `aluno_no_metodo()`); `acessoPainel.guarda` trava a lista.

**As decisões:**
- **Sono e energia autorrelatados são tratados como dado de saúde para quem vê**, como o relato de dor e a adesão à dieta: dizem do corpo e do descanso da pessoa, e não servem ao balcão.
- **Tabela própria, `registro_treino_bem_estar`, e não duas colunas em `registro_treino`.** Coluna não tem regra própria no RLS, e o GRANT por coluna não separa a recepção do aluno (os dois são `authenticated`). A tabela é a mais simples que cumpre a regra: uma linha por treino, chave `registro_treino_id` (como `registro_serie`), `sono` e `energia` `smallint` de 1 a 5, opcionais, com `check`. Sem `aluno_id`: sai em cascata com o treino na exclusão e na anonimização do aluno, sem mexer nas funções de saída.
- **Quem lê:** o aluno, a equipe que atende a saúde (`atende_saude`) e a mentoria no Método (`(select equipe_metodo())` com `aluno_no_metodo`), como `dieta_adesao`. **Quem grava:** só o aluno, sobre o próprio treino e com a academia do treino (o `with check` confere as duas coisas); sem exclusão pela API. A regra restritiva "duas etapas" vale aqui também. `registro_treino_bem_estar` entrou na lista da saúde de `acessoPainel.guarda`.
- **A tela:** duas escalas de 1 a 5 entre o esforço e a sensação, "Como você dormiu esta noite?" e "Como está sua energia hoje?", com "Ruim" e "Ótimo" nos extremos; cada uma é um `radiogroup` com rótulo, cada número um `radio` com o extremo no nome; cor só por token. Opcionais, tocar de novo desmarca, e a linha só é gravada se houver ao menos uma resposta (`upsert` pelo treino). A mutação passou a receber as respostas no `mutate`, não pelo fechamento. Quem retirou o consentimento de saúde não recebe as duas perguntas.
- **A Evolução:** dois gráficos de linha, "Sono" e "Energia", média semanal de 1 a 5; semana sem resposta fica **em branco** (sem ligar os pontos por cima dela). Vale também o treino encerrado pela metade: a resposta conta pela data do treino. Estado vazio próprio: "Ao concluir um treino, diga como dormiu, de 1 a 5…". A regra continua em `evolucaoHabitos.ts`, com teste ao lado.
- **Meus dados:** a exportação do aluno leva o sono e a energia junto de cada treino.

**O que ficou de fora:**
- Nenhuma tela da equipe mostra sono e energia ainda (como o esforço percebido, que também não aparece na ficha da academia); o RLS já deixa a gestão, o professor e a nutricionista lerem.
- **A Política de Privacidade ganhou a versão de 10/10, no mesmo PR.** Decisão do responsável em 10/10/2026: sono e energia são dado de saúde, e a lista de "Dados de saúde (dados sensíveis)" da seção 2 passa a citar "como você dormiu e a sua energia, que você marca no fim do treino", ao lado de "relatos de dor ou dificuldade". A versão entra no banco depois do deploy (`20261443010000`), e todo usuário aceita de novo na próxima entrada.
- Sono e energia não pedem o consentimento de saúde para serem coletados, como o relato de dor de hoje; só somem para quem o retirou. Decisão do responsável em 10/10/2026: igual ao relato de dor, e as respostas são opcionais.

**Antes do merge:** aplicar a migration `20261442010000_sono_e_energia_no_fim_do_treino.sql`. A Evolução lê a tabela nova e cai em "Não foi possível carregar" sem ela, e o fim do treino com resposta falha ao gravar. Depois, gerar o `types.ts` de novo e publicar `assistente-academia` (índice dos artigos).

**Conferido:**
- **O banco, em transação desfeita** (a migration inteira num bloco que termina em exceção): a aluna gravou e regravou pelo `upsert` (1 linha, com o valor novo); a recepção da mesma academia leu **0** linhas; o professor leu **1**; trocar a academia da linha foi recusado (42501); sono 6 foi recusado pelo `check`.
- **Testes:** `npx vitest run` com 1.680 testes em 211 arquivos, todos verdes; `evolucaoHabitos.test` cobre a média semanal do sono e da energia e a semana sem resposta nula.
- **Defeitos plantados, pegos:** o sono lendo a lista da energia fez "agrupa cada registro na sua semana" falhar (`sonoMedio` null em vez de 3,5); a leitura por `is_org_staff` em vez de `atende_saude` fez `acessoPainel.guarda` falhar.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 57 funções e nenhuma vulnerabilidade.
- A Central (`app-treino.md`, `app-evolucao-e-desafios.md`) e o índice do assistente (`npm run ajuda:indice`) foram atualizados.
- **Falta, porque esta frente não toca produção:** depois de aplicar a migration, concluir um treino na Ponto Alto com a aluna Marina Costa Ribeiro respondendo sono e energia, ver os dois gráficos na Evolução (computador e celular, nos dois temas), e confirmar com um login da recepção que a tabela volta vazia.

## As sobras de 10/10: as cores da dieta, o texto do cartão de evento e as imagens da Central (13/10/2026)

**O que sobrou** das entregas de 10/10 (seções acima): o diálogo de registro da dieta e os ícones dos resumos com cor fixa; o mês inicial do calendário pelo relógio do aparelho; o cartão "Próximo Evento de Acompanhamento" mostrando ao aluno o motivo da tarefa, escrito para a equipe; e as imagens `app-dieta.jpg` e `app-evolucao.jpg` da Central com as telas antigas.

**As decisões:**
- **O Sim e o Não do registro seguem o calendário.** Marcados, eram branco sobre `bg-emerald-600` (3,8:1) e sobre `bg-orange-500` (2,8:1), abaixo de 4,5:1. Agora o botão fica no contorno, com o fundo claro da cor (`bg-success/15`, `bg-warning/15`), a borda e o texto no `--*-texto`: 5,2:1 e 5,8:1 no claro, 7,0:1 e 6,9:1 no escuro. O `aria-pressed` continua dizendo qual está marcado.
- **Os ícones dos resumos vão pelos tokens:** doce em `text-warning`, álcool em `text-destructive`, água em `text-info`, o "Este Mês" em `text-success`, e os fundos da saciedade em `bg-success/10`, `bg-info/10`, `bg-warning/10` e `bg-destructive/10`. Ícone é decoração ao lado do texto, então a cor só precisa acompanhar o tema.
- **O mês inicial do calendário sai de `hojeBrasilia()`** (`parseISO(hojeBrasilia())`), como o "hoje" e o "futuro" já saíam. Antes, perto da meia-noite da virada do mês, o aparelho noutro fuso abria o mês vizinho.
- **O cartão de evento diz "Seu encontro de acolhimento M.A.P.A.®"** (`TITULO_DO_EVENTO`, `src/lib/eventoAcompanhamento.ts`), e não o `motivo` da tarefa. O texto vem do app, sem mexer no banco, porque `obter_proximo_evento_aluno()` só devolve a tarefa `anamnese`: o evento é sempre o mesmo, e um texto por tipo no banco seria regra para tipos que não existem. Quando nascer outro tipo de evento, o título passa a ser por tipo, e aí vale levar o texto para a RPC. A RPC continua devolvendo o `motivo` (ela é de 10/10 e já o tratava como seguro de mostrar); a tela só deixou de usá-lo. Sem migration.
- **As imagens da Central foram tiradas de novo** com `scripts/ajuda/capturar-telas.mjs`: `app-dieta` (o calendário no topo), `app-evolucao` (os gráficos dos hábitos) e `app-home` (o cartão de evento com o texto do Free). O roteiro estava quebrado em dois pontos, consertados aqui:
  - `demonstracao.mjs semear` parava em `publicar_treino`, porque com o Método ativo só a equipe da ArkeFit com registro prescreve (`definir_dono_da_prescricao`), e o roteiro não tem pessoa na sessão. As alunas do Método nascem sem adesão e o Método liga depois do treino e da dieta. O Pedro ganhou uma semana de adesão à dieta, para o calendário ter cor;
  - a dieta saía rolada até o fim (o chat desce até a última mensagem) e a Evolução, carregando. As duas esperam o título da tela e voltam ao topo antes da foto.
  As imagens são do app publicado: os ícones dos resumos ficam com a cor de antes até o deploy deste PR, e estão abaixo da dobra da foto da dieta.

**Conferido:**
- **Testes:** `npx vitest run` com 1.696 testes em 214 arquivos, todos verdes. `eventoAcompanhamento.test` ganhou 1 teste: o título não fala de anamnese nem de prescrição, e a home usa o título e não lê `proximoEvento.motivo`.
- **1 defeito plantado, pego:** o cartão voltou a mostrar `{proximoEvento.motivo}`; o teste novo falhou.
- **Contraste**, pela mesma conta de `acessibilidade.guarda`, nos dois temas: os números acima.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das funções e nenhuma vulnerabilidade.
- A Central (`app-tela-inicial.md`) e o índice do assistente (`npm run ajuda:indice`) foram atualizados; falta publicar `assistente-academia`.
- **Roteiro das imagens, em produção:** `semear` com a academia fictícia "Academia Horizonte" (trial), as capturas e `limpar` no fim, sem linha órfã. A primeira tentativa parou no `publicar_treino` e foi limpa na hora (`limpar`: organização e 12 contas apagadas, nenhuma linha órfã).
- **Falta, porque esta frente não publica:** depois do deploy, na Ponto Alto com a aluna Marina Costa Ribeiro, no celular e no computador, nos dois temas: o registro de um dia com Sim e Não legíveis, os ícones dos resumos e, com o acolhimento agendado pela fila, o cartão dizendo "Seu encontro de acolhimento M.A.P.A.®".

## Dois alunos da Ponto Alto no Método, com valor R$ 0,00 (13/10/2026)

**O pedido:** dois alunos da academia de demonstração no Método, um masculino e uma feminina, com valor R$ 0,00, para servirem de exemplo nas demonstrações e nos testes. A Marina Costa Ribeiro e o Pedro Henrique Almeida continuam no Free.

**Os dois** (logins de `scripts/demonstracao/academia.mjs`, com a senha da apresentação, que fica fora do repositório):
- **Juliana Marques Santana**, `aluno180@demonstracao.arkefit.com.br`: Método **Integrado**, modelo dos exercícios feminino.
- **Hugo Souza**, `aluno152@demonstracao.arkefit.com.br`: Método **Elite**, modelo dos exercícios masculino.

Os dois já eram alunos da Ponto Alto, em dia, com treino, dieta, duas avaliações físicas e treinos registrados; foram escolhidos por isso, e não criados.

**As decisões:**
- **O valor zero é o caminho que o produto já tem:** o trial do Método que o Super Admin dá (`iniciar_trial_metodo_arke`). Ele deixa o aluno `ativo` no nível e a assinatura `trial` com `valor_cobrado = 0`, sem Asaas. O roteiro faz o mesmo pelo SQL, porque a função confere o Sócio na sessão e o roteiro não tem pessoa. O `valor_repasse_arke` fica 0 e o fim do trial acompanha o da academia (`trial_vencimento`, 31/12/2030): com os 15 dias padrão, a ficha diria "vencido" daqui a duas semanas. A academia já é de homologação (trial), então o trial do aluno não é oferta. Sem `metodo_arke_ativado_por`, nenhuma comissão de adesão nasce.
- **Os gatilhos de `alunos` fazem a passagem:** o chamado de boas-vindas da ArkeFit (`passar_bastao_do_metodo`), a dieta e a anamnese fora da vista da academia (`aluno_no_metodo` no RLS), e o treino ainda visível para ela. O treino e a dieta que a academia publicou seguem valendo até o mentor publicar os dele.
- **Sem mentor atribuído** (`mentor_id` nulo): nenhuma pessoa da equipe ArkeFit está marcada como mentor hoje, então a conversa vai à equipe da Mentoria.
- **O acolhimento M.A.P.A.® feito pelo próprio aluno.** Aluno novo no Método cai no acolhimento até mandar a anamnese, e o consentimento de saúde só o titular dá (`consentimento_saude_so_do_titular`). O roteiro entra com a conta de cada um e faz o que a tela faz (`Onboarding.tsx`): a anamnese com o consentimento (o banco carimba a data, o hash e o navegador) e a tarefa `anamnese` para o mentor. Depois marca o encontro para daqui a três dias, como o mentor marcaria, para o cartão "Próximo Evento de Acompanhamento" ter data.
- **No roteiro:** `NO_METODO` fixa os dois nomes (o sorteio corre igual, para o resto da academia não mudar), e `semear`/`recriar` ligam o Método neles no fim, depois do treino e da dieta. O subcomando novo `metodo` faz só isso na academia que já existe, sem recriar: dá a senha da apresentação, o aceite dos documentos, liga o Método e acrescenta os dois logins ao arquivo de acessos. Rodar de novo só remarca o encontro.

**O defeito do caminho:** a gravação da anamnese pela API voltava 500 "Something went wrong" com o `User-Agent` "academia de demonstração": cabeçalho com acento não passa pelo gateway. Ficou "ArkeFit academia de demonstracao".

**Conferido:**
- **Em produção, só na Ponto Alto:** `academia.mjs metodo` rodou e os dois ficaram com `plano_do_aluno()` = `integrado` e `elite`, a assinatura `trial` com R$ 0,00, repasse 0 e sem id do Asaas, e `mentor_id` nulo. Nenhuma mensalidade nem cobrança avulsa nova para os dois. A anamnese está concluída, com a versão `2026-09-23` do consentimento e o hash carimbado, e cada um tem duas tarefas abertas da ArkeFit: a de boas-vindas e a do acolhimento, marcada para 16/10 às 10h.
- **O RLS pelo lado da academia**, em transação desfeita com a sessão da gestão, da nutricionista e da recepção: o treino dos dois aparece (1 cada), a dieta, a anamnese e a tarefa de acolhimento não (0). A dieta da Marina, no Free, continua aparecendo para a gestão e a nutricionista.
- **A tela**, no app publicado, no computador e no celular, entrando como cada um: a home abre direto, com o cartão "Seu encontro de acolhimento M.A.P.A.®" de sexta-feira, 16/10, 10:00, e o botão "Falar com o mentor"; o toque leva ao Treino com a conversa "Meu Mentor ARKE" aberta.
- Antes de rodar em produção, a ligação do Método foi provada em transação desfeita.
- Uma primeira versão marcava o encontro numa tarefa própria (`demo:acolhimento:`), que duplicaria a do acolhimento; as duas linhas foram apagadas antes da versão final.
- `npm run check` sem erro (tipos, lint com 0 erros e os 27 avisos de antes, o `deno check` das 57 funções e nenhuma vulnerabilidade) e `npx vitest run` com 1.696 testes em 214 arquivos, todos verdes.

## O realce da home do aluno e o botão do questionário de saúde (13/10/2026)

As capturas dos dois alunos do Método (#389) mostraram dois defeitos de tela:
- **O realce ao passar o mouse era o azul da academia.** O cartão do próximo evento (#382) e os quatro atalhos da home usavam `hover:bg-accent/50`, e o tema da academia troca o `--accent` pela cor da marca. Com o mouse em cima, a data em `text-primary` ficava azul sobre azul. Os cinco passam a `hover:bg-muted`, neutro em qualquer tema, e o cartão de evento ganhou o respiro lateral que faltava.
- **O texto do botão saía da borda no celular.** "Responder o questionário de saúde (1 min)" não cabia em 390 px, e o botão não quebrava a linha. Os botões de documentos da matrícula passam a quebrar a linha.

**Conferido** na Ponto Alto, com a Juliana (computador, temas claro e escuro) e o Hugo (celular), medindo o contraste com o mouse em cima do cartão:
- **Título:** 13,3 a 15,0:1.
- **Data:** 4,53:1 no tema claro. No escuro deu 4,48:1 com o `hover:bg-muted` cheio, e o realce do cartão de evento passou a `hover:bg-muted/60` (#391). Medido de novo depois do deploy: 4,81:1 no claro e 4,64:1 no escuro.
- **O texto do questionário de saúde** cabe no botão nos três.

## Pesquisa de satisfação (NPS) no app do aluno, com a nota baixa na fila (16/10/2026)

**O pedido** (decisão do responsável de 15/10/2026, depois de comparar com o concorrente, que vende "Pesquisas e feedbacks" como módulo pago): o segundo recurso para nivelar o ArkeFit. A pergunta "De 0 a 10, quanto você recomendaria a [academia] a um amigo?" no app do aluno, com um comentário opcional, e a nota baixa virando pendência na fila, no ciclo que a fila já cobra (motivo, responsável, prazo, ação, desfecho, próxima checagem). A gestão vê o NPS.

**As decisões:**
- **Um cartão abaixo da Próxima Ação, e não a Próxima Ação.** A Próxima Ação é única e fica com o que o aluno precisa fazer; responder pesquisa não é obrigação dele. O cartão só aparece quando é a hora e some depois da resposta (`PesquisaSatisfacao.tsx`). A escala é um grupo de rádio de 0 a 10 (o do Radix, com as setas do teclado), com "0: nada provável" e "10: muito provável" ligados a ele, em duas linhas no celular e uma no computador, e as cores pelos tokens.
- **Quando perguntar mora numa regra pura** (`devePerguntar`, `src/lib/pesquisaSatisfacao.ts`, com o teste ao lado): a primeira vez 30 dias depois da matrícula, depois a cada 90 dias, e o "Agora não" esconde por 7. O banco confere de novo ao gravar (`responder_pesquisa_satisfacao`), com os mesmos 30 e 90 dias, e recusa a segunda resposta na mesma janela; o teste da regra lê a função da migration e falha se os números dos dois lados divergirem. A linha do aluno fica travada durante a resposta, então duas respostas ao mesmo tempo viram uma.
- **Quem não é perguntado** é o que a plataforma já chama de bloqueado: `situacao_permite_app()` (o pausado na hora, o inadimplente depois dos 5 dias de tolerância), e a matrícula sem nenhuma ativa (pausada ou encerrada). O inadimplente ainda dentro da tolerância continua sendo perguntado: ele usa o app, e a opinião dele conta. Quem não tem matrícula no ARKE (a academia que cobra por fora) não é barrado por isso, como na catraca.
- **Uma tabela só, `pesquisa_satisfacao`**: a resposta (nota e comentário) e o "Agora não" (nota nula, um por dia), com `organization_id` e RLS desde o primeiro script. Uma regra, a de leitura, e só da gestão (`has_org_role(..., 'gestor')`); a recepção, o professor e a nutricionista não leem, porque o comentário é texto livre e pode falar de alguém da equipe. O aluno lê e grava a dele só pelas três funções `security definer` que conferem quem chama (`pesquisa_satisfacao_do_aluno`, `responder_pesquisa_satisfacao`, `adiar_pesquisa_satisfacao`). Inclusão, alteração e exclusão pela API são recusadas sem permissão (42501). A regra restritiva "duas etapas" vale aqui, como em toda tabela com dado de aluno.
- **A nota de 0 a 6 abre a tarefa "Avaliação baixa do aluno"** (tipo novo `avaliacao_baixa`), dentro da própria função de resposta: prioridade alta, prazo de 2 dias úteis (sábado e domingo não contam; feriado fica de fora até alguma academia pedir) e o desfecho obrigatório de toda tarefa. Ela é só da gestão na fila: o termo da equipe da academia nas regras de `tarefas` ganhou a condição `not tarefa_da_gestao(tipo) or has_org_role(..., 'gestor')`, ao lado da condição da saúde, na leitura, nas duas metades da alteração e na exclusão (`tarefasPorDono.guarda` cobra). Nenhum gatilho novo em `tarefas`: a ordem dos `before insert` não muda.
- **A tarefa é da academia mesmo com o aluno no Método**: a nota é sobre ela. `dono_da_tarefa()` ganhou `avaliacao_baixa` entre os tipos que são sempre da academia; sem isso, o gatilho de dono mandaria a tarefa para o mentor da ArkeFit.
- **O comentário não vai no motivo da tarefa.** O motivo diz só "Nota 4 de 10 para a academia na pesquisa de satisfação", e a fila lê o comentário da resposta, pela origem (`avaliacao_baixa:<id>`). Assim a saída do aluno (`anonimizar_dados_do_aluno`) apaga o comentário de um lugar só e deixa a nota no NPS, sem nome: a regra da sugestão ao mentor, o texto sai e o número fica.
- **A fila mostra o nome do aluno** no cartão, ao lado do prazo, em toda tarefa. A avaliação baixa precisa disso para ser atendida, e as outras também estavam sem.
- **O NPS fica no Gestão 360°** (`SatisfacaoDosAlunos.tsx`), que já é só da gestão: a nota dos últimos 90 dias (uma janela da pesquisa, em que cada aluno responde no máximo uma vez), o número de respostas, promotores (9 e 10), neutros (7 e 8) e detratores (0 a 6), e a evolução mês a mês dos últimos 12. A conta (`resumoNps`, `npsPorMes`, de Brasília) tem teste. Sem resposta, o quadro diz "Ainda sem respostas: a pesquisa aparece para o aluno 30 dias depois da matrícula", e não zero; com a consulta falhando, `<ErroAoCarregar>`.
- **Em perfil simulado, a pesquisa fica para o próprio aluno:** o cartão não aparece e o banco recusa a resposta e o "Agora não". A opinião é da pessoa, e a ArkeFit respondendo por ela entraria no NPS da academia.
- **Privacidade:** a resposta é dado pessoal comum, não sensível. A Política não muda agora; a frase para a próxima versão está abaixo.

**Os defeitos do caminho:**
- **O tipo novo de tarefa não pode ser usado na transação em que nasce** (55P04, "unsafe use of new value"). Por isso o tipo mora numa migration própria (20261448010000), como o `equipamento`, e a 20261450010000 roda depois dela. Na prova em transação desfeita, nem a tarefa da dor podia ser aberta depois da `dono_da_tarefa` nova: a função SQL cita o tipo novo e é lida ao rodar. A prova roda a migration com o tipo `outro` no lugar do `avaliacao_baixa` antes de a 20261448010000 ir ao ar; depois dela, o mesmo roteiro usa o tipo de verdade.
- **A primeira versão perguntava só a quem estava "em dia".** A Marina Costa Ribeiro, da Ponto Alto, está inadimplente desde 11/10 e bloqueada; o critério passou a ser o bloqueio da plataforma (`situacao_permite_app`), que é o que o pedido diz ("nunca para aluno pausado, bloqueado ou com a matrícula encerrada").
- **A primeira tentativa da prova parou no `lock_timeout` de 5 s** (as regras de `tarefas` pedem a trava da tabela, e o app estava em uso). A segunda rodou.

**A frase proposta para a próxima versão da Política** (na parte do que a academia recebe do aluno): "Pesquisa de satisfação: de tempos em tempos, o app pergunta de 0 a 10 quanto você recomendaria a academia e, se quiser, o porquê. A nota e o comentário vão só para a gestão da academia, que os usa para melhorar o atendimento; uma nota baixa pode levar a academia a falar com você. Na exclusão dos seus dados, o comentário é apagado e a nota fica só como número, sem identificar você."

**Ordem para ir ao ar:** a migration 20261448010000 (o tipo novo), depois a 20261450010000, depois o deploy do app. Nenhuma edge function nova nem alterada; o índice da Central mudou, então publicar `assistente-academia`.

**Conferido:**
- **O banco, em transação desfeita** (as duas migrations e os casos num bloco que termina com erro de propósito, com as contas da Ponto Alto; antes da 20261448010000, com o tipo `outro` no lugar do novo). Depois, a tabela, as funções e o tipo não existiam, e a saída do aluno era a de antes. Os casos:
  - o Pedro Henrique Almeida (Free, em dia, matrícula de 07/06) aparece liberado, sem resposta; o estado de outra pessoa volta vazio;
  - responder pela Marina é recusado (42501); nota 11 e comentário de 501 caracteres são recusados (P0001);
  - a nota 9 grava, com o comentário sem os espaços das pontas, e não abre tarefa; a segunda resposta na mesma janela é recusada ("A pesquisa não está aberta para você agora.");
  - dois "Agora não" no mesmo dia gravam uma linha só;
  - o aluno não lê a tabela (0 linhas) e não inclui, altera nem exclui nela (42501 nas três); o anônimo também não lê (42501);
  - a Marina, bloqueada, não é liberada, e a resposta dela é recusada;
  - com a matrícula de 29 dias, recusada; com a matrícula pausada, não liberada; com 30 dias, gravada;
  - as respostas da academia: a gestão lê 1, a recepção, o professor e a nutricionista 0;
  - o prazo de 2 dias úteis: sexta, sábado e domingo vão a terça; segunda a quarta; quinta a segunda;
  - a nota 3 da Juliana Marques Santana (Método Integrado) abre a tarefa com dono `academia` (a dor dela segue `arkefit`); a saída dela deixa a nota 3 e apaga o comentário;
  - a nota 4 do Pedro, 90 dias depois da anterior, abre a tarefa de prioridade alta, aberta, com prazo de terça 20 às 10:00 (aberta na sexta 16 às 10:00), o motivo "Nota 4 de 10 para a academia na pesquisa de satisfação", e o comentário achado pela origem;
  - a gestão vê a tarefa, não a fecha sem desfecho (P0001) e fecha com ele; a recepção, o professor e a nutricionista não a veem, e a recepção não a altera (0 linhas).
- **Os testes:** a regra de quando perguntar (a primeira vez, a janela de 90 dias, o "Agora não", o bloqueio, a virada de mês e de ano), a conta do NPS (os três grupos, a nota sem resposta, o mês de Brasília às 23h) e a conferência dos números da tela contra a função do banco; na guarda da fila, a condição da gestão nas quatro metades das regras e a avaliação baixa na lista de `tarefa_da_gestao` e entre os tipos da academia em `dono_da_tarefa`.
- **Os defeitos plantados:** a leitura de `tarefas` sem a condição da gestão, a janela da tela em 60 dias e a nota 6 fora dos detratores. Os três fizeram 4 testes falhar (a guarda da fila, a janela, a conferência com o banco e a conta do NPS); desfeitos, voltaram a passar.
- `npm run check` sem erro (tipos, lint com 0 erros e os 27 avisos de antes, o `deno check` das 60 funções e nenhuma vulnerabilidade). `npx vitest run`: antes de juntar a main, 1.751 testes em 219 arquivos, todos verdes; depois, 1.768 em 221, com 6 que passaram dos 5 s nesta máquina (duas guardas que leem o histórico do banco e quatro telas da Visão Master), e que passam sozinhos ou com mais prazo. No CI, todos verdes.
- **Em produção (16/10):** as duas migrations na ordem, o roteiro de novo com o tipo de verdade (os mesmos casos, com a recepção, o professor e a nutricionista vendo 0 tarefas) e `assistente-academia` publicado.
- **A tela, na Ponto Alto:**
  - o Pedro Henrique Almeida (Free), no computador e no tema claro, vê o cartão abaixo da Próxima Ação, dá 8 com o comentário e o cartão some; ao recarregar, não volta;
  - a Juliana Marques Santana (Método Integrado), no celular e no tema escuro, vê a escala em duas linhas (6 e 5), dá 4 com o comentário e o cartão some;
  - o Hugo Souza (Elite), no celular e no tema claro: com o foco no 8, a seta à direita marca o 9 e duas à esquerda marcam o 7; o "Agora não" tira o cartão, e ao recarregar ele não volta;
  - a gestora Renata, no computador e no celular escuro, vê na fila "Nota 4 de 10 para a academia na pesquisa de satisfação", prioridade alta, o comentário entre aspas, o nome da Juliana e o prazo de terça 20/10 (aberta na sexta 16, 2 dias úteis); o Gestão 360° mostra NPS −50 com 2 respostas (1 neutro, 1 detrator);
  - a recepção abre a mesma fila e não vê a tarefa nem o comentário.
- **O defeito da prova:** o mês do quadro saía "Outubro De 2026", porque a classe `capitalize` sobe a inicial de cada palavra. Passou a `first-letter:uppercase` ("Outubro de 2026").
- **O que a prova deixou na demonstração**, como histórico: as duas respostas (8 do Pedro, 4 da Juliana), o "Agora não" do Hugo e a tarefa aberta da Juliana. As contas do Pedro, da Juliana, do Hugo, da gestora e da recepção deram o aceite da Política de 16/10. A mensalidade de outubro da Marina Costa Ribeiro, fictícia e sem cobrança no Asaas, foi marcada como paga, porque ela é o exemplo do Free e estava bloqueada; a sincronização da situação a libera na próxima passada.

## Sugestão de progressão do treino, para quem prescreve (16/10/2026)

**O pedido** (decisão do responsável de 15/10/2026): o terceiro item que nivela o sistema antes de qualquer ERP, depois da recuperação da mensalidade (#404) e da pesquisa de satisfação (#415). Pelas séries feitas, pelo esforço, pelo sono, pela energia e pela dor que o aluno informa, o sistema **sugere** a quem prescreve o treino subir, manter ou segurar a carga. A sugestão sai por regra, sem IA, e a decisão continua com o professor (CREF). Nada muda no treino sozinho: o treino é um snapshot imutável, e só muda quando o professor publica uma versão nova.

**O levantamento:**
- O aluno anota cada série na execução do treino (`TreinoExecucao`), na hora: `registro_serie`, com carga, repetições, concluída e o `exercicio_id`. No fim do treino (`AvaliacaoTreinoDialog`) vão o esforço (1 a 10, **do treino inteiro**) e a sensação, com "Senti dor", em `registro_treino`; o sono e a energia (1 a 5), em `registro_treino_bem_estar`. O "Meu Treino" grava só uma carga por exercício (`detalhes_execucao`), sem repetições.
- A dor chega por três caminhos: "Senti dor" no fim do treino (`sensacao = 'dor'`, que abre a tarefa crítica e carimba `alunos.progressao_bloqueada_em` até alguém liberar, `20261225010000`), "desconforto ou dor" no check-in (`checkins.motivo_dificuldade = 'desconforto_dor'`, que abre a tarefa) e o próprio carimbo.
- A faixa de repetições está no snapshot do treino, série a série (`series_detalhe`) ou no resumo (`repeticoes`): "10-12", "12", "30-45s".
- **A carga não é prescrita:** a ficha tem séries, repetições, descanso e técnica, e é o aluno quem escolhe e anota a carga. "Subir a carga" é uma orientação do professor, na observação do exercício da versão nova ou na conversa.
- A leitura de `registro_serie` é do aluno, da equipe da academia (`is_org_staff`, inclusive a recepção) e do Admin ARKE, e **não do Mentor contratado**: a regra é de 23/09 (`20261218010000`), de antes do Método. `registro_treino` e `registro_treino_bem_estar` já têm o termo do Método.
- O editor de treino (`PrescricaoTreino`) é o mesmo para a academia (Prescrever Treinos) e para o mentor (a ficha do aluno do Método, aba Treino).

**As decisões:**
- **A regra, por exercício, em `src/lib/sugestaoProgressao.ts`**, com teste ao lado, na ordem que o responsável definiu (a primeira que casar vence):
  1. **sem dado suficiente**, "Ainda sem dados para sugerir": menos de 2 sessões do exercício com carga e repetições nos últimos 21 dias, ou uma série sem faixa em número;
  2. **segurar**, e a segurança vem antes: dor ("Segurar e conversar com o aluno sobre a dor"); sono ou energia até 2 na última sessão ("Segurar: o aluno chegou cansado"); mais de 14 dias sem o exercício ("Retomar com a mesma carga");
  3. **rever a carga**: nas 2 últimas sessões, alguma série prescrita sem concluir ou abaixo do mínimo da faixa ("Rever a carga: o aluno não está completando"), ou esforço 9 ou 10 nas duas ("Rever a carga: esforço no limite em 2 treinos seguidos"). Só a referência de 5 a 10%, de meio em meio quilo, sem número imposto;
  4. **subir** (dupla progressão): nas 2 últimas, a mesma carga série a série, todas as séries prescritas feitas no topo da faixa ou acima, e esforço até 7 nas duas ("Pode subir a carga: completou o topo da faixa com folga em 2 treinos"). A referência é o menor incremento: cerca de 2 a 5% da série mais pesada, arredondado para cima no passo do equipamento (1 kg em halter e cabo, 2,5 kg em barra e máquina, pelo nome do acervo), nunca menos que um passo; sem passo conhecido, "o menor incremento disponível";
  5. **manter**, todo o resto ("Manter: ainda progredindo dentro da faixa").

  Os limiares moram em `LIMIARES`, cada um com o motivo no comentário: janela de 21 dias, 2 sessões, dor de 7 dias, bem-estar baixo até 2, pausa de 14 dias, esforço no limite a partir de 9, folga até 7. Um passo por vez: subir pede 2 sessões na mesma carga, então depois de uma troca a regra espera de novo.
- **O que foi adaptado ao que o banco tem** (o pedido mandava dizer):
  - **O esforço é do treino inteiro**, não do exercício: a sessão de cada exercício herda o esforço do dia. É por isso que a folga fica em 7, e não mais alto.
  - **"Rever" tem duas frases.** "O aluno não está completando" seria falso para quem completa tudo com esforço 10.
  - **A pausa conta também da última sessão até hoje**, além do intervalo entre as duas últimas: quem parou há 15 dias volta com a mesma carga.
  - **A dor tem três fontes**: o fim do treino (na última sessão do exercício, de qualquer data, ou em qualquer treino dos últimos 7 dias), o check-in dos últimos 7 dias e a progressão suspensa, que segura até alguém liberar, como já vale para a fase. A dor recente segura todos os exercícios, de qualquer divisão, e a tela avisa no alto ("Converse com ele antes de mexer na carga").
  - **"O mesmo exercício"** é o mesmo `exercicio_id`, que sobrevive à republicação da ficha, como a "carga da última vez" da execução; republicar com a mesma faixa não zera a história. Sem `exercicio_id` (ficha antiga), ou com o mesmo exercício duas vezes na ficha (em divisões com faixas diferentes), vale a ordem dentro do mesmo treino publicado. A faixa comparada é sempre a da ficha atual.
  - **"12" é a faixa de 12 a 12.** Tempo ("30-45s"), "até a falha", "12 cada perna" e a pirâmide escrita numa linha só não são faixa em número, e não há sugestão.
  - **Série marcada como feita sem as repetições anotadas** não prova o topo da faixa: não sobe.
  - **O aluno que retirou o consentimento de saúde não tem sugestão** ("Sem sugestão: o aluno retirou a autorização de uso dos dados de saúde, e ela depende deles"): a base do acompanhamento com dado de saúde é o consentimento.
- **Calculada na leitura, sem tabela nova e sem função no banco**, como o plano do aluno. A tela lê as tabelas pela API, com o RLS de quem olha, e a regra roda no navegador. Uma função `security definer` entregaria o que o RLS esconde; gravar a sugestão pediria decidir quando recalcular e criaria mais uma tabela de saúde para proteger. Não achei motivo forte para gravar.
- **Onde aparece: num lugar só**, o editor de treino, na aba Publicar para Aluno, logo abaixo do aluno escolhido e acima de "Como montar o treino", que é o caminho que já existe para mudar o treino (publicar a versão nova). O mesmo componente (`SugestaoProgressao.tsx`) serve à academia e ao mentor. Segurar, rever e subir aparecem um a um, com a referência; manter e sem dados, numa linha cada. O texto diz "Sugestão", que a decisão é de quem prescreve, que nada muda até a versão nova e que o aluno não a vê. Cor só pelos tokens (`text-warning` para segurar e rever, `text-success` para subir), o carregando com `role="status"` e o erro com `<ErroAoCarregar>`.
- **Quem vê: quem atende a saúde e é dono do treino** (`papelVeSugestao` e `veSugestaoDeProgressao`):
  - na academia, a gestão e o professor (`atende_saude` e prescreve treino; no autônomo, quem é da parte do treino), no aluno do Free. A recepção e a nutricionista não veem, e a tela nem pede os dados. O Admin ARKE não entra pelo atalho da tela: o `atende_saude()` do banco é de quem é da equipe da academia, e sem ele o sono e a energia voltariam vazios e a sugestão sairia sem o cansaço;
  - no Método, o mentor, na ficha do aluno do Método; a academia não vê a do aluno do Método;
  - o aluno não vê: nenhuma tela do app do aluno importa a regra ou a tela;
  - a recepção também não vê pela API: a sugestão não existe no banco, e o sono e a energia continuam só com quem atende a saúde e com a mentoria no Método.
- **A migration `20261451010000`**: a leitura de `registro_serie` ganha o termo do Método, igual ao do bem-estar (`(select equipe_metodo())` uma vez por consulta, com `aluno_no_metodo` pelo treino). Sem ela, o Mentor contratado leria zero séries e a sugestão diria "Ainda sem dados" para quem anota as séries todo dia: um vazio que não é verdade. Uma regra de leitura só, o resto dela igual; inclusão, alteração e exclusão não mudam. Nenhuma função nova.
- **A Visão Master**: `from:registro_treino` e `from:checkins` entraram no mapa de chamadas da mentoria (`CHAMADAS_DA_VISAO_MASTER`), porque o editor de treino faz parte da ficha do Método.
- **A Política não muda.** Sono, energia, dor e esforço já constam da versão de 10/10 como dado de saúde para o acompanhamento, com acesso só de quem atende. A sugestão é por regra fixa, sem IA, e quem decide é uma pessoa: não é decisão automatizada sobre o aluno. Frase proposta para a próxima versão, na seção 3: "Sugestão de progressão do treino: com os treinos que você anota (séries, esforço, sono, energia e dor), a plataforma calcula, por uma regra fixa e sem inteligência artificial, uma sugestão de subir, manter ou segurar a carga, que só o profissional que prescreve o seu treino vê. A decisão é sempre dele, e o seu treino só muda quando ele publica uma versão nova."
- **A Central:** `prescrever-treino.md` ganhou a seção da sugestão (como ela decide e quem vê), `vm-mentoria.md` a frase na aba Treino da ficha, e o catálogo o resumo; o índice do assistente foi gerado de novo (`npm run ajuda:indice`).

**O que achei no caminho e ficou de fora:**
- **A dor do fim do treino e o esforço moram em `registro_treino`, que a recepção lê** (`is_org_staff`); o carimbo `progressao_bloqueada_em`, em `alunos`, também. Sono e energia saíram dali em 10/10 exatamente por isso; a sensação "dor" e o esforço ficaram. Não mudei aqui: mexe no gatilho da dor, no calendário e no Meu Treino do aluno, em Meus dados e na ficha do mentor, e é frente própria. Proposta: levar `sensacao` e `esforco_percebido` para `registro_treino_bem_estar` (ou uma tabela irmã), com a leitura de `atende_saude`. **Feito em 16/10/2026:** ver *A dor e o esforço do fim do treino só com quem atende a saúde* em `seguranca-e-acesso.md`.
- **A Ponto Alto não tem séries anotadas.** O roteiro da demonstração grava os treinos com uma carga por exercício (`detalhes_execucao`), sem séries, sem repetições e sem sono e energia; lá, a sugestão vai dizer "Ainda sem dados para sugerir" para todo aluno, que é a verdade. Para mostrar na apresentação, o roteiro teria de gravar séries (e algumas respostas de sono e energia) nos treinos das últimas 3 semanas. Não mudei o roteiro: não há banco local para provar o SQL dele, e um erro ali quebraria o `demo:recriar` na véspera de uma apresentação. O roteiro de prova da migration conta as séries e as respostas de sono e energia da Ponto Alto, para confirmar.

**Os defeitos do caminho:**
- **O Mentor contratado não lia as séries** (acima): achado ao conferir quem lê cada tabela que a regra usa; virou a migration.
- **A referência saía "de 30 kg para 31 kg"**, com a unidade repetida; o teste pegou e o primeiro número ficou sem a unidade.
- **O teste "só as duas últimas sessões contam"** usava uma terceira sessão sem nenhuma série feita, que a regra descarta antes; o teste passava sem provar nada. A terceira sessão passou a ter série feita.

**Ordem para ir ao ar:** a migration `20261451010000`, depois o deploy do app. Sem a migration, o mentor contratado vê "Ainda sem dados" (não quebra nada). Nenhuma edge function nova nem alterada; o índice da Central mudou, então publicar `assistente-academia`.

**Conferido:**
- **A regra:** `sugestaoProgressao.test.ts` com 53 testes: cada ramo e cada limiar na borda (21 dias, 14 dias, sono 2 e 3, esforço 7, 8 e 9), a precedência (dor com esforço baixo e topo da faixa segura; dor segura quem não completa; cansaço com esforço no limite segura), sem dado (nenhuma sessão, uma sessão, sessão sem carga ou sem repetição, sem faixa), séries incompletas, a pirâmide, a faixa de um número, a troca de carga, a referência por equipamento (40 kg na barra vai a 42,5; 12 kg no halter, a 13; 200 kg, a 205), o treino inteiro (o `exercicio_id` entre versões, a ordem sem ele, o mesmo exercício em duas divisões, a dor em outra divisão, no check-in e suspensa, o consentimento retirado) e quem vê (Free contra Método, a recepção, a nutricionista, o autônomo).
- **A tela:** `SugestaoProgressao.test.tsx` com 6 testes: o professor vê, com a frase da decisão e a de que o aluno não vê; a recepção e a nutricionista não veem e a tela não faz nenhuma consulta; a academia não vê a do aluno do Método e o mentor vê; a dor segura e avisa no alto; a consulta que falha diz que falhou.
- **A guarda:** `sugestaoProgressao.guarda.test.ts` com 8 testes: a tela e a regra não gravam nem chamam função; a tela pergunta o papel antes de ler e o dono antes de mostrar; aparece só no editor de treino; o app do aluno não a importa; a leitura de sono e energia continua com `atende_saude` e sem `is_org_staff`; a de séries tem um termo do Método só, com o `(select ...)` e o aluno do Método.
- **Os defeitos plantados, pegos e desfeitos:** a folga em 9 em vez de 7 (2 testes falharam); a dor depois da subida, a precedência invertida (7); o termo do Método na migration sem o aluno do Método (a guarda); a tela lendo antes de perguntar o papel (a guarda); o papel liberando qualquer pessoa da equipe (5, na regra e na tela).
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 60 funções e nenhuma vulnerabilidade.
- `npx vitest run`: 1.835 testes em 224 arquivos. Na primeira rodada, um teste de tela de outra frente (`NotasFiscaisPainel`, "só liga a emissão quando o Asaas diz que está pronta") passou do prazo de 5 s nesta máquina, que levou 29 minutos para a suíte; com `--testTimeout=60000`, os 1.835 passaram.
- **O roteiro de prova da migration** (transação desfeita, termina com `RESULTADO`), em produção, antes de aplicar: lê como o Mentor (com e sem as duas etapas), a recepção, o professor e o próprio aluno, antes e depois do texto da migration, e conta as regras de leitura de `registro_serie`. Precisou de dois acertos para rodar: o Mentor temporário vinha de `profiles.id`, que não é o id da conta (o certo é `profiles.user_id`; o banco recusou pela chave estrangeira de `equipe_arkefit`), e produção não tem conta sem papel nenhum, então o roteiro cria uma em `auth.users`, que some com o erro do fim. Os números: o Mentor com as duas etapas foi de 0 a 1 na série do aluno do Método; ficou em 0 na do Free e em 0 só com a senha; a recepção (1, Free), o professor (1, Método) e o aluno (1) iguais antes e depois; uma regra de leitura. A Ponto Alto tem 1 série anotada e 1 resposta de sono e energia. Depois, nada ficou gravado.
- **Em produção (16/10):** a `20261451010000` aplicada; a regra de leitura de `registro_serie` tem o termo do Método.
- **Depois do deploy (16/10):** `assistente-academia` publicado. Na Ponto Alto:
  - o professor, no computador (tema claro) e no celular (tema escuro), em Prescrever Treinos, Publicar para Aluno, escolhe o Pedro Henrique Almeida e vê a sugestão logo abaixo do aluno, com a frase da decisão e "Ainda sem dados para sugerir", que é a verdade: a demonstração não anota séries (a única série da academia, da Marina, não tem carga nem repetições);
  - no mesmo editor, a Juliana Marques Santana vem desabilitada, com "Método ARKE (treino com o mentor)";
  - a nutricionista e a recepção não abrem o editor (a recepção vê "Esta página não faz parte do seu acesso").
- **Fica para depois:** os estados com dado (segurar, rever, subir, manter) na tela de produção, quando um aluno anotar as séries em 2 treinos de dias diferentes; e a visão do mentor, porque a demonstração não tem conta de Mentor (os dois estão nos testes de tela).

**Liberar a progressão na academia (16/10/2026, achado na prova do #420):**
- **O defeito:** o "Senti dor" suspende a progressão até alguém liberar (`liberar_progressao_aluno`), e a sugestão segura todos os exercícios enquanto ela estiver suspensa. Só que o único botão de liberar fica na Visão Master, para o mentor. Na academia não havia onde: o aluno do Free que marcasse dor uma vez ficaria com a sugestão em "Segurar" para sempre. Apareceu na prova de tela do #420, quando o Pedro Henrique Almeida marcou dor e ninguém na Ponto Alto tinha como liberar.
- **A correção:** o aviso da dor na sugestão ganha **"Já conversei: liberar a progressão"**, só no escopo da academia (aluno do Free). No Método, o mentor continua liberando na Visão Master. Quem pode liberar é decisão do banco (desde o #420, quem atende a saúde do aluno do Free; a recepção recebe 42501), e a liberação fica nas observações do aluno. A dor dos últimos 7 dias segue segurando até passar a semana, como a regra manda.
- **O botão mora em `LiberarProgressao.tsx`, fora de `SugestaoProgressao.tsx`:** a sugestão continua só lendo, como a guarda (`sugestaoProgressao.guarda`) exige, e liberar é outra decisão, sobre o relato de dor, não sobre a carga.
- **A Central:** `prescrever-treino.md` explica a suspensão e o botão; o índice do assistente foi gerado de novo.
- **Conferido:** `SugestaoProgressao.test.tsx` com 2 testes novos (na academia, com a suspensão, o botão chama `liberar_progressao_aluno` com o aluno; com só a dor da semana, ou no Método, não há botão), 9 testes; com a guarda da sugestão e a da saúde do fim do treino, 28 testes em 4 arquivos, verdes. O defeito plantado (o botão sem a condição da academia) fez o teste do Método falhar; desfeito, voltou a passar.
- **Falta, depois do deploy:** com o professor da Ponto Alto, liberar a progressão do Pedro pelo botão e ver o aviso da suspensão sumir (o da dor da semana fica).
