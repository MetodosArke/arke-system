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
    versao: "2026-09-22.2",
    sha256: "47946ceeeb61e25f6bf8d5d302520db8166c009af1a75f535581d016170ccdef",
    texto: termosUso,
    revisadoJuridico: true,
  },
  privacidade: {
    titulo: "Política de Privacidade",
    caminho: "/privacidade",
    versao: "2026-09-23",
    sha256: "27f55132300f39c74ae2d79acf2dd67a9184b09d1fc3221a4b9c508941781b03",
    texto: privacidade,
    // Volta a minuta: a versao anterior foi revisada, esta reescreveu a
    // secao de responsabilidade, a de dados de saude e a de transferencia
    // internacional. Manter `true` diria que um advogado leu um texto que
    // ainda nao existia quando ele leu.
    revisadoJuridico: false,
  },
  contrato_academia: {
    titulo: "Contrato da Academia (licença e tratamento de dados)",
    caminho: "/contrato-academia",
    versao: "2026-09-23",
    sha256: "1892e08c58d5d4d56c273af7c43ecbed7fcd9c38f1ebbdc68bb74c54fa35439c",
    texto: contratoAcademia,
    revisadoJuridico: false,
  },
};
