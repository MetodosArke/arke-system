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
    versao: "2026-09-22",
    sha256: "3de05425d29933b44fe0a0f6803bd0d0d6903ed4574bbb824c55ad354a2f9899",
    texto: termosUso,
    revisadoJuridico: false,
  },
  privacidade: {
    titulo: "Política de Privacidade",
    caminho: "/privacidade",
    versao: "2026-09-22",
    sha256: "a4da5b1a743899e25292bf5fe10ca19a0a2fa2b66f8031940d57070069ad4ef9",
    texto: privacidade,
    revisadoJuridico: false,
  },
  contrato_academia: {
    titulo: "Contrato da Academia (licença e tratamento de dados)",
    caminho: "/contrato-academia",
    versao: "2026-09-22",
    sha256: "33e61005ddcbe2858c1cc28a429783eedd312e7fe3831157944b18b81c755d7b",
    texto: contratoAcademia,
    revisadoJuridico: false,
  },
};
