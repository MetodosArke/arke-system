/**
 * Documentos legais da plataforma (Rodada 5). O texto mora no repositório,
 * versionado pelo git; o banco guarda versão e hash SHA-256 em
 * `documentos_legais`, e cada aceite aponta para essa linha — assim o
 * registro prova qual texto exato a pessoa aceitou.
 *
 * Mudou o texto: suba a `versao`, atualize o `sha256` e publique a nova linha
 * no banco (migration). O teste `documentosLegais.test.ts` falha se o texto
 * mudar sem o hash mudar junto, e a plataforma pede novo aceite a todos.
 *
 * Enquanto `revisadoJuridico` for falso, as páginas mostram que o texto é
 * minuta em revisão.
 *
 * O texto em si mora em `documentosLegaisTexto.ts` (07/10/2026): este módulo
 * entra no pacote principal (o aceite e os links do login o usam), e os três
 * textos, uns 38 kB, iam junto para todo mundo, a cada abertura do app.
 */

export type TipoDocumento = "termos_uso" | "privacidade" | "contrato_academia";

export const DOCUMENTOS: Record<
  TipoDocumento,
  { titulo: string; caminho: string; versao: string; sha256: string; revisadoJuridico: boolean }
> = {
  termos_uso: {
    titulo: "Termos de Uso",
    caminho: "/termos",
    // Mudou em 23/09/2026: a clausula 3 passou a declarar a trava do PAR-Q,
    // por determinacao do parecer juridico (item 3.8).
    // 2026-10-06: o parecer revisto do advogado sobre o item 3 do memorando
    // (registrado pelo responsavel no workspace em 06/10/2026): modelo hibrido.
    // No plano Free a prescricao e da academia; no Metodo ARKE, da equipe de
    // mentoria da ArkeFit, por profissionais com CREF e CRN, e a ArkeFit
    // responde por ela -- como ja diziam o Contrato e a Politica.
    // 2026-10-06.2: a secao 5 ganhou a clausula de prestacao de servicos
    // financeiros do playbook de BaaS do Asaas (Resolucao Conjunta BCB/CMN
    // n. 16/2025, art. 14): o Asaas presta os servicos financeiros, a ArkeFit
    // so integra a tecnologia, e o suporte financeiro e do Asaas. Clausula
    // modelo do Asaas, aprovada pelo responsavel no workspace em 06/10/2026.
    versao: "2026-10-06.2",
    sha256: "69076e2b5668289147efb9faaef3adbcea7f12dfc15d55e4e6a97e5138be011d",
    revisadoJuridico: true,
  },
  privacidade: {
    titulo: "Política de Privacidade",
    caminho: "/privacidade",
    // .3: a IA passou da OpenAI (EUA) para o Amazon Bedrock em Sao Paulo.
    // .4: aprovada pelo encarregado com um ajuste -- "o provedor nao guarda o
    // conteudo" virou "o conteudo nao fica registrado na nossa conta do
    // provedor", que e o que foi de fato verificado (registro de invocacoes
    // da conta desligado), e nao uma afirmacao da documentacao da AWS.
    // .5: a digital, como ela passou a funcionar na versao 1.0 -- autorizacao
    // no app ou por termo impresso assinado, digital apagada dos equipamentos
    // ao retirar a autorizacao ou encerrar a matricula, e o termo assinado
    // guardado como prova. Texto aprovado pelo responsavel em 23/09/2026
    // ("implementa o mais indicado e encerra").
    // 2026-09-24: nota fiscal automatica da academia -- o endereco do aluno
    // passa a ser coletado (a prefeitura exige o endereco do tomador), o Asaas
    // tambem emite a nota no CNPJ da academia, a prefeitura recebe a nota e a
    // BrasilAPI recebe so o CEP do aluno. Texto aprovado pelo responsavel
    // como estava, em 24/09/2026 (a marca de minuta nao muda o hash, entao
    // nao pede aceite de novo).
    // 2026-09-25: a leitura do plano alimentar em PDF volta, agora no Brasil
    // (transcricao, nao analise; texto sem as linhas de identificacao; so o
    // texto sai do aparelho; mesma base legal do acompanhamento), e o contato
    // pelo site entra com a guarda de 12 meses sem andamento. Texto aprovado
    // pelo responsavel como estava, em 25/09/2026 (a marca de minuta nao muda
    // o hash, entao nao pede aceite de novo).
    // 2026-09-28: Metodo ARKE, fase 6 -- a ArkeFit prescreve treino e dieta do
    // aluno do Metodo (CREF, CRN), a academia deixa de ver a anamnese e a dieta
    // dele e continua vendo o treino e a avaliacao; ao sair do Metodo, o
    // acompanhamento volta a academia. Texto aprovado pelo responsavel no chat
    // em 28/09/2026 ("Aprovado").
    // 2026-09-28.2: a resposta automatica ao contato do site (Leticia) -- o
    // texto e nosso e a IA, no Brasil, escreve uma ou duas frases a partir da
    // mensagem; ate dois lembretes e link para nao receber mais. Texto aprovado
    // pelo responsavel no workspace em 28/09/2026, como estava.
    // 2026-09-30: o contato comercial alem do site (Pipeline comercial) --
    // WhatsApp, telefone, indicacao e prospeccao; legitimo interesse para
    // indicacao e prospeccao, com a origem do contato no primeiro e-mail; a
    // Leticia sozinha so no site e, nos outros canais, quando a equipe aciona;
    // a IA so a partir do que a propria academia contou; guarda de 12 meses
    // para qualquer canal. Texto aprovado pelo responsavel no chat em
    // 30/09/2026 ("Texto aprovado").
    // 2026-10-03: o rosto entra ao lado da digital -- reconhecimento facial na
    // catraca, com o mesmo consentimento especifico; o rosto cadastrado pela
    // camera do equipamento ou por foto enviada pelo app, que passa pela
    // plataforma so para chegar aos equipamentos e e apagada dela ao chegar ou
    // em 24 horas. Texto-base aprovado pelo responsavel no chat em 02/10/2026
    // ("o texto base ja esta aprovado").
    // 2026-10-06: a auditoria de prontidao de 05/10 -- o assistente da equipe
    // da academia, que roda na infraestrutura global da AWS, entra na lista
    // de suboperadores e na transferencia internacional; Google Fonts e
    // YouTube entram na lista; o resumo da anamnese no plano gratuito (com
    // autorizacao, lido pela equipe da academia) passa a constar da secao 4;
    // o Sentry identifica so por codigo interno; o hash de IP do contato pelo
    // site; e a secao 11 descreve o consentimento do responsavel pelo menor.
    // Decisao do responsavel no workspace (D2, 06/10/2026): versao antes do
    // primeiro cliente. Texto aprovado pelo responsavel no workspace em
    // 06/10/2026, como estava.
    // 2026-10-06.2: o memorando de adequação regulatória do advogado, enviado
    // pelo responsável em 06/10/2026 -- a secao 6 passa a fundamentar a
    // transferencia internacional no art. 33, II, com os DPAs dos provedores
    // em conformidade com as Clausulas-Padrao da ANPD (Resolucao CD/ANPD
    // 19/2024), e a secao 7 declara a guarda dos registros de acesso por 6
    // meses (Marco Civil, art. 15). Redacao do advogado, como estava.
    versao: "2026-10-06.2",
    sha256: "82fa9b246d294daa2cffacc20510b8c0292dcbd66b02804dd3042e0a466cd550",
    revisadoJuridico: true,
  },
  contrato_academia: {
    titulo: "Contrato da Academia (licença e tratamento de dados)",
    caminho: "/contrato-academia",
    // .2 incorpora o parecer: a subsecao 6.2 passou a nomear a
    // cocontroladoria, citar o art. 42 e afastar a responsabilidade da
    // ArkeFit por falha exclusiva de execucao presencial da academia.
    // .3: clausula 6.1, item 4 -- processamento da IA no Brasil. Aprovada
    // pelo encarregado sem alteracao.
    // 2026-09-24: secao 3 ganhou a clausula de responsabilidade fiscal (cada
    // parte pelo que entra no proprio caixa; a nota automatica sai no CNPJ da
    // academia, e o cadastro fiscal e dela). Texto aprovado pelo responsavel
    // como estava, em 24/09/2026.
    // 2026-09-28: Metodo ARKE, fase 6 -- a ArkeFit prescreve e responde pelo
    // conteudo prescrito no Metodo (secoes 4, 5 e 8), a divisao do que fica
    // com cada lado e a volta do aluno a academia (6.1, itens 5 e 6), e a
    // cocontroladoria ajustada (6.2). Texto aprovado pelo responsavel no chat
    // em 28/09/2026 ("Aprovado").
    // 2026-09-28.2: secao 8 ganhou a clausula de que a ArkeFit nao garante
    // resultado de retencao, evasao, receita ou adesao, e de que indicadores
    // sao medicoes do periodo, nao promessa. Texto aprovado pelo responsavel
    // em 28/09/2026, por comentario no proprio texto no workspace e no chat.
    // 2026-10-01: secao 2 com a tabela B2B nova (Growth, Enterprise, Redes e
    // Custom), enviada pelo responsavel em 01/10/2026 com a ordem de alterar
    // o sistema todo.
    // 2026-10-06: na mesma tabela, o teto do Growth subiu de 300 para 500
    // alunos (e o Enterprise passou a comecar em 501), por decisao do
    // responsavel no chat em 06/10/2026. Nada mais mudou no texto.
    // 2026-10-06.2: a secao 3 ganhou a mesma clausula de prestacao de servicos
    // financeiros dos Termos (playbook de BaaS do Asaas), aprovada pelo
    // responsavel no workspace em 06/10/2026.
    versao: "2026-10-06.2",
    sha256: "f01f9fdc896c954ab39d982bef003cf6c246b424fe06a8eb806c3dcf48dc833f",
    revisadoJuridico: true,
  },
};
