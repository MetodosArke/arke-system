/**
 * Fica fora de `textoDoPdf.ts` de propósito: aquele módulo é baixado só na hora
 * da leitura, e é justamente ele que pode ter sumido depois de uma publicação.
 */
export type FalhaDoPdf = "versao_antiga" | "senha" | "invalido" | "outro";

/**
 * Por que a leitura do PDF falhou. A tela respondia "protegido por senha ou
 * corrompido" para qualquer erro, e o erro de verdade se perdia (achado em
 * 28/09/2026: no celular a importação falhou sem chegar ao servidor, e não
 * havia como saber o motivo).
 *
 * O caso mais comum não é o PDF: é a aba aberta desde antes de uma
 * publicação. A leitura baixa a biblioteca de PDF só na hora, e o arquivo da
 * versão anterior já não existe. Cada navegador diz isso de um jeito; o pdf.js
 * embrulha a mesma falha em "Setting up fake worker failed".
 */
export function motivoDaFalhaDoPdf(erro: unknown): FalhaDoPdf {
  const nome = erro instanceof Error ? erro.name : "";
  const mensagem = erro instanceof Error ? erro.message : String(erro ?? "");
  if (nome === "PasswordException") return "senha";
  if (nome === "InvalidPDFException" || nome === "MissingPDFException") return "invalido";
  if (
    /dynamically imported module|importing a module script failed|error loading dynamically|fake worker failed|failed to fetch|loading chunk|unable to preload/i.test(
      mensagem,
    )
  ) {
    return "versao_antiga";
  }
  return "outro";
}

export const MENSAGEM_DA_FALHA: Record<FalhaDoPdf, string> = {
  versao_antiga: "O ArkeFit foi atualizado enquanto esta tela estava aberta. Recarregue a página e escolha o PDF de novo.",
  senha: "Este PDF está protegido por senha. Exporte de novo sem a senha e tente outra vez.",
  invalido: "Este arquivo não abriu como PDF. Confira se ele não está corrompido, ou exporte de novo do programa em que a dieta foi montada.",
  outro: "Não foi possível ler este PDF neste aparelho. Tente de novo; se continuar, tente pelo computador e avise o suporte.",
};
