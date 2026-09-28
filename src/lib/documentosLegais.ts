import termosUso from "@/content/legal/termos-uso.md?raw";
import privacidade from "@/content/legal/privacidade.md?raw";
import contratoAcademia from "@/content/legal/contrato-academia.md?raw";

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
 */

export type TipoDocumento = "termos_uso" | "privacidade" | "contrato_academia";

export const DOCUMENTOS: Record<
  TipoDocumento,
  { titulo: string; caminho: string; versao: string; sha256: string; texto: string; revisadoJuridico: boolean }
> = {
  termos_uso: {
    titulo: "Termos de Uso",
    caminho: "/termos",
    // Mudou em 23/09/2026: a clausula 3 passou a declarar a trava do PAR-Q,
    // por determinacao do parecer juridico (item 3.8).
    versao: "2026-09-23",
    sha256: "848e8dadb79ee19758769adb316e5d74598e18f537f475dddebcc98de05c219e",
    texto: termosUso,
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
    versao: "2026-09-28",
    sha256: "61c0f3c69fe42815b738b2f921221fd87f2249c238ff6e222a94bc83e465bec2",
    texto: privacidade,
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
    versao: "2026-09-28",
    sha256: "5d6966d9cf70f1156e9f38cbb87bca60090dd93075b24e701e4dd3f835df5f4e",
    texto: contratoAcademia,
    revisadoJuridico: true,
  },
};
