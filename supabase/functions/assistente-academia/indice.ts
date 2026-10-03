// O índice da Central de Ajuda que o assistente da academia consulta.
//
// O texto dos artigos mora no repositório (`src/content/ajuda/*.md`) e o
// catálogo em `src/lib/ajuda/catalogo.ts`; a edge function não importa do app,
// então leva uma cópia em `artigos.json`, montada por `montarIndice` a partir
// dos dois. `src/lib/assistenteAcademia.test.ts` monta de novo e compara: um
// artigo mudado sem o índice ir junto falha no CI. Para atualizar:
// `npm run ajuda:indice`.
//
// Sem Deno e sem Supabase, para o teste do app usar exatamente este código.

export type Publico = "gestor" | "recepcao" | "professor" | "nutricionista" | "autonomo" | "aluno" | "arkefit";

export type Trecho = {
  slug: string;
  artigo: string;
  secao: string | null;
  publicos: Publico[];
  texto: string;
};

export type ArtigoParaIndice = { slug: string; titulo: string; publicos: Publico[] };

/** Tamanho máximo de um trecho: o modelo recebe 4, e cada um cabe numa leitura. */
export const TAMANHO_TRECHO = 1400;

/** Markdown para texto corrido: sem imagem, com o texto do link e sem marcação. */
export function limparMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_`#]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function partir(texto: string): string[] {
  if (texto.length <= TAMANHO_TRECHO) return [texto];
  const partes: string[] = [];
  let atual = "";
  for (const paragrafo of texto.split(/\n\n/)) {
    if (atual && atual.length + paragrafo.length + 2 > TAMANHO_TRECHO) {
      partes.push(atual);
      atual = "";
    }
    atual = atual ? `${atual}\n\n${paragrafo}` : paragrafo;
    while (atual.length > TAMANHO_TRECHO) {
      partes.push(atual.slice(0, TAMANHO_TRECHO));
      atual = atual.slice(TAMANHO_TRECHO);
    }
  }
  if (atual) partes.push(atual);
  return partes;
}

/** Um trecho por seção (`## `) de cada artigo; seção longa vira mais de um. */
export function montarIndice(artigos: ArtigoParaIndice[], textos: Record<string, string>): Trecho[] {
  const trechos: Trecho[] = [];
  for (const a of [...artigos].sort((x, y) => x.slug.localeCompare(y.slug))) {
    const md = textos[a.slug] ?? "";
    const blocos = md.split(/^## /m);
    blocos.forEach((bloco, i) => {
      const quebra = bloco.indexOf("\n");
      const secao = i === 0 ? null : (quebra < 0 ? bloco : bloco.slice(0, quebra)).trim();
      const corpo = limparMarkdown(i === 0 ? bloco : quebra < 0 ? "" : bloco.slice(quebra + 1));
      if (!corpo) return;
      for (const texto of partir(corpo)) {
        trechos.push({ slug: a.slug, artigo: a.titulo, secao, publicos: a.publicos, texto });
      }
    });
  }
  return trechos;
}
