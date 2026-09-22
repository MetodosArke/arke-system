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
    versao: "2026-09-22.2",
    sha256: "3ef255908dd98c67dab15e84f26fee73ed4d3ffd201289d38b8b2f745a1ad969",
    texto: privacidade,
    revisadoJuridico: true,
  },
  contrato_academia: {
    titulo: "Contrato da Academia (licença e tratamento de dados)",
    caminho: "/contrato-academia",
    versao: "2026-09-22.2",
    sha256: "4f27a858ce37eaeb1318c52c9bc8d8f5b6e2b146a5feb27599bd05c47eb177e7",
    texto: contratoAcademia,
    revisadoJuridico: true,
  },
};
