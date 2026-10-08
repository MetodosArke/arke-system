# Decisões e tarefas pendentes

Só o que continua em aberto. As decisões já tomadas e aplicadas saíram desta lista (a última rodada foi em 23/09/2026); o que cada uma mudou no sistema está registrado em `docs/registro/` e no histórico do git.

## Com o responsável, antes do primeiro cliente pagante

- **GIFs dos exercícios.** Os 105 exercícios globais continuam sem mídia. Os GIFs vêm do banco do app original; a estrutura de envio já existe e está testada. Vídeo é recurso a mais, não linha de base — a ficha se explica com GIF.
- **Infraestrutura paga** — Supabase Pro, Vercel Pro, Resend pago e Sentry conforme o volume — e, só depois dela, o **teste de carga**. Depois do upgrade do Supabase, trocar `limite_banco_mb` pelo disco contratado em Visão Master → Configurações.
- **Planilha real de exportação** (EVO, Tecnofit, Next Fit ou Pacto), para conferir o reconhecimento das colunas na importação de alunos.
- **Verificação em duas etapas na conta comercial@metodosarke.com.br.** A do responsável já está ativa; a comercial cadastra o aplicativo autenticador na primeira entrada na Visão Master. Quem perder o celular tem o fator removido pelo banco e cadastra de novo.
- **Nota fiscal da própria ArkeFit** (mensalidade das academias, taxa de implantação e repasse) configurada na conta Asaas da ArkeFit, com o contador.
- **Ensaio de restauração do backup**, logo depois do Supabase Pro (`docs/RESTAURACAO_BACKUP.md`).

## Página de vendas e endereço do app (25/09/2026)

- **Um envio de verdade pelo formulário de contato** da página de vendas, para conferir que um envio real passa pelo captcha (o falso já é recusado). Depois, apagar o contato de teste em Visão Master → Pipeline comercial.
- **Aprovar o texto da Política de Privacidade 2026-09-25** (leitura do plano alimentar em PDF e contato pelo site). Ela vai ao ar como minuta; aprovada, vira `revisadoJuridico: true` sem pedir aceite de novo, porque o hash não muda.

## Achados da Central de Ajuda (25/09/2026)


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

## Equipe da ArkeFit: o que sobrou dos níveis (08/10/2026)

As duas entregas puseram no ar os quatro níveis (Suporte, Mentor, Comercial e Financeiro), a limpeza do `admin_arke` nas funções do Sócio e os avisos por área (ver `docs/registro/seguranca-e-acesso.md`, "Os níveis da equipe ArkeFit, entrega 1" e "entrega 2"). Fica:

- **A coluna `equipe_arkefit.mentor` sai depois do deploy do app da entrega 2.** A tela publicada ainda a lê (a lista da equipe e o "Atende como mentor" do Sócio). O Mentor contratado já é `mentor` pelo nível; no Sócio ela é a chave "Atende como mentor", que precisa de um lugar antes de a coluna sair (por exemplo, o nível Mentor também para o sócio, ou uma coluna própria). Decidir o lugar e, numa migration pós-deploy, tirar a coluna de `get_superadmin_equipe_arkefit`, do salvar, do convite gravado, de `atribuir_mentor_aluno` e da tela.
- **Os outros avisos por área.** Só o aviso de dinheiro (a troca da carteira de recebimento) e os técnicos (as rotinas e as catracas) passaram a ir também ao Financeiro e ao Suporte (`emails_da_area`). O contato novo do site (Comercial), os chamados do Lucas e do Bruno (Suporte), o Vigia e o encerramento seguem só para os sócios. Decidir se o Comercial recebe o aviso do contato novo (ele traz o nome e o contato da pessoa) e se o Suporte recebe os chamados.
- **O detalhe do Gateway para o Suporte:** a telemetria, os eventos e as ordens de cada catraca são lidos direto das tabelas, cujo RLS é da academia e do Sócio; hoje o Suporte vê o resumo de cada catraca. Decidir se a operação lê também o detalhe, e se manda ordem remota (liberar o giro).
- **Devolver o acesso a quem saiu.** A conta retirada continua existindo, sem papel nem nível, e o convite recusa e-mail que já tem conta. Decidir entre reativar a conta antiga pelo link de definir a senha (como a gestão pendente) ou pedir outro e-mail.
- **O limite de alunos negociado.** O Financeiro troca o plano, e o limite acompanha o plano (`trg_limite_segue_plano`). O limite fora da tabela (Custom) continua sendo gravado só pelo Sócio, direto no banco; se precisar ir para a tela, entra em `definir_mensalidade_b2b`.

## O cadastro da equipe da ArkeFit (08/10/2026)

O cadastro completo de cada pessoa da equipe (identificação, documentos, endereço, vínculo, remuneração e conta bancária, em `equipe_arkefit_cadastro`, com os anexos no bucket `equipe-arkefit-documentos`) é visto só pelos sócios e pela própria pessoa. O que fica para decidir:

- **O nível Financeiro e os dados bancários.** O nível Financeiro (no ar desde 08/10/2026) não lê o cadastro. Se ele precisar da conta e do PIX para pagar a equipe, é decisão à parte: abrir só as colunas de pagamento (por uma função que devolve só elas, com a auditoria da leitura), e nunca a identificação, a filiação e os documentos. A regra mora em `pode_ver_cadastro_equipe_arkefit()`.
- **Quanto tempo o cadastro de quem saiu fica.** A linha some com a conta (`on delete cascade`), e os anexos ficam no bucket até um sócio apagar. A lei trabalhista e a previdenciária pedem a guarda dos registros por anos depois da saída: decidir o prazo com a contabilidade e, com ele, a rotina que apaga.
- **O aviso de privacidade ao colaborador.** O cadastro trata dado pessoal da equipe, e não de aluno: a Política de Privacidade da plataforma fala com quem usa o app. Decidir com o jurídico se a equipe recebe um aviso próprio na contratação (a finalidade, as bases legais, quem vê e o prazo), ou se a Política ganha um item na próxima versão.
- **Duas etapas na troca da conta bancária.** A pessoa já precisa das duas etapas para abrir o cadastro. Se a troca da conta ou do PIX passar a exigir um código novo na hora (como a carteira de recebimento da academia) e um aviso aos sócios por e-mail, é uma entrega à parte.

## Depois do primeiro cliente pagante (decisão de 08/10/2026)

- **O bloqueio B2B no servidor.** Hoje o bloqueio por mensalidade B2B vencida é só da tela (`OrganizacaoBillingGate`): a equipe bloqueada ainda grava pela API. Quando vier, ele **barra só as funções de gestão e de operação em massa**, e não o que a recepção usa no modo essencial (`src/lib/modoEssencial.ts`, `NO_MODO_ESSENCIAL`): a matrícula de quem está no balcão, a mensalidade e a cobrança avulsa do aluno, o check-in manual, pelo QR Code e do visitante do Wellhub e do TotalPass, o atestado, o PAR-Q, a digital e o rosto, a fila de atendimento e as mensagens. Gestor, professor e nutricionista da academia bloqueada continuam fora da tela inteira, e o servidor pode barrar a escrita deles. O mapa do que a equipe grava pela API, os riscos (a service role e as funções `security definer` pulam o RLS; a regra restritiva de alteração responde 200 com zero linhas; `tarefas`, `presencas` e `checkins` também nascem de ações do aluno) e o caminho proposto (primeiro as edge functions que gravam em nome da equipe, com uma conferência só em `_shared`; depois as regras restritivas nas tabelas que só a gestão grava) estão em `docs/registro/seguranca-e-acesso.md`, "Auditoria de prontidão, frente D", item 7. O pagamento não depende disso: a fatura abre no Asaas, e o webhook grava com a service role.

## Depois do lançamento

- **Preço do profissional autônomo.** O plano Custom segue negociado caso a caso.
- **Venda de produtos e estoque.**
- **Colunas de repasse visíveis ao próprio aluno.** A regra de leitura de `mensalidades` deixa o aluno ler as linhas dele inteiras, inclusive quanto a ArkeFit retém e quanto a academia recebe. Não expõe outro aluno nem outra academia; fechar pede uma consulta própria para a equipe, porque privilégio de coluna não distingue equipe de aluno.

## Na implantação de cada cliente com catraca

- **Bancada de cada marca, com o equipamento de verdade:** sentido de giro da borboleta montada, tempo real de acionamento e do cadastro remoto da digital, mensagens de erro do firmware e, na Control iD, se o `uuid` do aviso de giro é o mesmo da identificação. O ensaio com o emulador prova a conversa; a primeira instalação prova o equipamento. Roteiro em `docs/MANUAL_GATEWAY_LOCAL.md` e `docs/PONTE_TOPDATA.md`.
- **Henry e Dimep:** a integração inteira, quando entrar o primeiro cliente com uma delas.
- **Topdata:** o Kit Integrador (suporte@topdata.com.br) roda a maior parte da bancada antes. E um ponto que só ela responde: na Topdata o aluno tem um número só no equipamento (o do cartão, ou o da digital), então quem quiser usar **cartão e digital ao mesmo tempo** precisa de dois números — o formato depende de como a digital da Topdata identifica o aluno.
- **Instalador do Gateway** gerado na implantação, sem assinatura de código: o Windows mostra o aviso do SmartScreen na primeira execução, e isso foi aceito.
