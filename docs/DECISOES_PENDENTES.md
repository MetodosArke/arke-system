# Decisões e tarefas pendentes

Só o que continua em aberto. As decisões já tomadas e aplicadas saíram desta lista (a última rodada foi em 23/09/2026); o que cada uma mudou no sistema está registrado no `CLAUDE.md` e no histórico do git.

## Com o responsável, antes do primeiro cliente pagante

- **GIFs dos exercícios.** Os 105 exercícios globais continuam sem mídia. Os GIFs vêm do banco do app original; a estrutura de envio já existe e está testada. Vídeo é recurso a mais, não linha de base — a ficha se explica com GIF.
- **Infraestrutura paga** — Supabase Pro, Vercel Pro, Resend pago e Sentry conforme o volume — e, só depois dela, o **teste de carga**. Depois do upgrade do Supabase, trocar `limite_banco_mb` pelo disco contratado em Visão Master → Configurações.
- **Planilha real de exportação** (EVO, Tecnofit, Next Fit ou Pacto), para conferir o reconhecimento das colunas na importação de alunos.
- **Verificação em duas etapas na conta comercial@metodosarke.com.br.** A do responsável já está ativa; a comercial cadastra o aplicativo autenticador na primeira entrada na Visão Master. Quem perder o celular tem o fator removido pelo banco e cadastra de novo.
- **Nota fiscal da própria ArkeFit** (mensalidade das academias, taxa de implantação e repasse) configurada na conta Asaas da ArkeFit, com o contador.
- **Ensaio de restauração do backup**, logo depois do Supabase Pro (`docs/RESTAURACAO_BACKUP.md`).

## Página de vendas e endereço do app (25/09/2026)

- **Um envio de verdade pelo formulário de contato** da página de vendas, para conferir que um envio real passa pelo captcha (o falso já é recusado). Depois, apagar o contato de teste em Visão Master → Contatos do site.
- **Preços na página de vendas.** A página não mostra preços dos planos nem da taxa de implantação; o contato leva à demonstração. Publicar os preços é decisão comercial.
- **Contato comercial na Política de Privacidade.** O formulário avisa a finalidade na hora; a Política não menciona contatos comerciais pelo site. Recomendação: incluir na próxima revisão, com o prazo de guarda de contato que não virou cliente.

## Achados da Central de Ajuda (25/09/2026)

- **Recepção cadastrar aluno.** Hoje cadastrar, importar e o convite de primeiro acesso são só do gestor, na tela e na função (`convidar-membro`). No balcão, quem matricula costuma ser a recepção. Recomendação: liberar para a recepção o cadastro e o convite de **aluno** (não o de equipe nem a importação em massa).
- **Importação de dieta por PDF.** Removida porque mandava o PDF ao Google, fora do Brasil. Para voltar: processar no Amazon Bedrock em São Paulo, como o Sentinela, e acrescentar a finalidade na Política (nova versão e novo aceite). Até lá, a nutricionista digita a dieta.
- **Secret `GEMINI_API_KEY`.** Nenhum código lê mais. Fica ou sai, a critério do responsável (o `OPENAI_API_KEY` ficou por decisão dele).

## Nota fiscal automática da academia (24/09/2026)

Implementada, com a Política de Privacidade e o Contrato da Academia `2026-09-24` aprovados como estavam. O que ficou:

- **Subcontas de teste no sandbox do Asaas.** A criação parou no limite de subcontas de teste; o responsável vai excluir algumas antigas quando for preciso testar de novo a abertura de subconta pelo ARKE.

## Quando o primeiro cliente pedir (decisão de 24/09/2026)

- **Plano com fidelidade** (anual pago mês a mês, com multa se cancelar antes). Hoje "anual" cobra uma vez por ano.
- **Desconto** (convênio de empresa, plano família, primeiro mês). Hoje se resolve criando outro plano com o valor menor.

## Vigia: depende de casos reais (decisão de 24/09/2026)

As Fases 1 a 3 estão no ar. O que vem depois é upgrade, e só se decide com o desempenho medido em operação real — o simulado provou que o Vigia acerta nos cenários que foram escritos para ele, não nos que a operação vai trazer. Os números ficam em Visão Master → Vigia: o que cada regra corrigiu, o que sumiu antes da hora de agir, o que foi para uma pessoa, e quantas ações da IA foram aprovadas, dispensadas ou falharam.

- **Fase 4 — ampliar o catálogo de ferramentas.** A primeira candidata é "reiniciar o Gateway", que exige uma ordem nova no próprio Gateway. Novas ferramentas entram conforme os casos reais mostrarem o que falta.
- **Autonomia da análise por IA.** As ações que ela propõe pedem aprovação, mesmo as que o catálogo classifica como "sozinho". Rever com casos reais suficientes para medir o acerto fora do simulado.
- **Ao medir, desconsiderar as 22 ocorrências de 24/09/2026 entre 10:35 e 12:30** ("rotina falhou" nas rotinas do próprio Vigia e no alerta de catracas). Eram o painel de rotinas lendo uma execução ainda em andamento como falha, corrigido na mesma data; não houve incidente.

## Depois do lançamento

- **Preço do profissional autônomo.** O plano Custom segue negociado caso a caso.
- **Venda de produtos e estoque.**
- **Colunas de repasse visíveis ao próprio aluno.** A regra de leitura de `mensalidades` deixa o aluno ler as linhas dele inteiras, inclusive quanto a ArkeFit retém e quanto a academia recebe. Não expõe outro aluno nem outra academia; fechar pede uma consulta própria para a equipe, porque privilégio de coluna não distingue equipe de aluno.

## Na implantação de cada cliente com catraca

- **Bancada de cada marca, com o equipamento de verdade:** sentido de giro da borboleta montada, tempo real de acionamento e do cadastro remoto da digital, mensagens de erro do firmware e, na Control iD, se o `uuid` do aviso de giro é o mesmo da identificação. O ensaio com o emulador prova a conversa; a primeira instalação prova o equipamento. Roteiro em `docs/MANUAL_GATEWAY_LOCAL.md` e `docs/PONTE_TOPDATA.md`.
- **Henry e Dimep:** a integração inteira, quando entrar o primeiro cliente com uma delas.
- **Topdata:** o Kit Integrador (suporte@topdata.com.br) roda a maior parte da bancada antes. E um ponto que só ela responde: na Topdata o aluno tem um número só no equipamento (o do cartão, ou o da digital), então quem quiser usar **cartão e digital ao mesmo tempo** precisa de dois números — o formato depende de como a digital da Topdata identifica o aluno.
- **Instalador do Gateway** gerado na implantação, sem assinatura de código: o Windows mostra o aviso do SmartScreen na primeira execução, e isso foi aceito.
