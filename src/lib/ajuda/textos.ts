/**
 * O texto de todos os artigos, para a Central mostrar e buscar. Só a página
 * da Central importa este arquivo, então o texto vai no pacote dela e não no
 * principal.
 */
const arquivos = import.meta.glob("../../content/ajuda/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const TEXTOS_AJUDA: Record<string, string> = Object.fromEntries(
  Object.entries(arquivos).map(([caminho, texto]) => [caminho.split("/").pop()!.replace(/\.md$/, ""), texto]),
);
