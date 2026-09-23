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
    // .2 incorpora o parecer de 23/09/2026: cocontroladoria nomeada com o
    // art. 42, e a reducao para retencao zero deixando de exigir novo aceite.
    versao: "2026-09-23.2",
    sha256: "7b48f0515413a990e644349048fe4a556d53685518ac628e1b7d42508554f17a",
    texto: privacidade,
    revisadoJuridico: true,
  },
  contrato_academia: {
    titulo: "Contrato da Academia (licença e tratamento de dados)",
    caminho: "/contrato-academia",
    // .2 incorpora o parecer: a subsecao 6.2 passou a nomear a
    // cocontroladoria, citar o art. 42 e afastar a responsabilidade da
    // ArkeFit por falha exclusiva de execucao presencial da academia.
    versao: "2026-09-23.2",
    sha256: "9d3f4f50878f311363a87d9235dcaaa42b026a58cdd86734d1601584f993421d",
    texto: contratoAcademia,
    revisadoJuridico: true,
  },
};
