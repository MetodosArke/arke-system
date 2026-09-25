import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Markdown mínimo para os documentos legais e a Central de Ajuda: títulos
 * (#, ##, ###), parágrafos, listas (- ou 1.), negrito (**texto**), código
 * (`texto`), links ([texto](destino)), imagens numa linha só
 * (![legenda](/ajuda/…)), dicas (> texto) e blocos de código entre linhas
 * de três crases, mostrados como estão. Não interpreta HTML nenhum — o
 * texto vira nó de texto do React, então não há como injetar marcação. Uma
 * dependência inteira de Markdown seria exagero para textos que nós mesmos
 * escrevemos.
 *
 * Link só vira link para rota do próprio app (/…) ou https; imagem, só da
 * pasta pública da ajuda. Qualquer outra coisa aparece como texto. Quem
 * mostra o texto pode traduzir destinos próprios antes (`resolverLink`): a
 * Central de Ajuda troca `ajuda:<artigo>` pelo endereço na área de quem lê.
 */

type ResolverLink = (destino: string) => string;

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(texto: string, chave: string, resolver?: ResolverLink): ReactNode[] {
  return texto.split(INLINE).map((parte, i) => {
    const k = `${chave}-${i}`;
    if (parte.startsWith("**") && parte.endsWith("**") && parte.length > 4) {
      return <strong key={k}>{parte.slice(2, -2)}</strong>;
    }
    if (parte.startsWith("`") && parte.endsWith("`") && parte.length > 2) {
      return (
        <code key={k} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {parte.slice(1, -1)}
        </code>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(parte);
    if (link) {
      const rotulo = link[1];
      const destino = resolver ? resolver(link[2]) : link[2];
      if (destino.startsWith("/") && !destino.startsWith("//")) {
        return (
          <Link key={k} to={destino} className="text-primary underline underline-offset-2">
            {rotulo}
          </Link>
        );
      }
      if (destino.startsWith("https://")) {
        return (
          <a key={k} href={destino} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
            {rotulo}
          </a>
        );
      }
      return <Fragment key={k}>{rotulo}</Fragment>;
    }
    return <Fragment key={k}>{parte}</Fragment>;
  });
}

export type Bloco =
  | { tipo: "h1" | "h2" | "h3" | "p" | "dica"; texto: string }
  | { tipo: "ul" | "ol"; itens: string[] }
  | { tipo: "imagem"; legenda: string; src: string }
  | { tipo: "codigo"; texto: string };

/** Imagem aceita: arquivo da pasta pública da Central de Ajuda. */
export const imagemPermitida = (src: string) => /^\/ajuda\/[\w\-/]+\.(png|jpe?g|webp|svg)$/.test(src);

export function blocosMarkdown(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  let paragrafo: string[] = [];
  let ultimaFoiDica = false;
  let codigo: string[] | null = null;
  let recuoCodigo = 0;
  const fecharParagrafo = () => {
    if (paragrafo.length) blocos.push({ tipo: "p", texto: paragrafo.join(" ") });
    paragrafo = [];
  };
  for (const bruta of texto.replace(/\r\n/g, "\n").split("\n")) {
    const linha = bruta.trim();
    // Bloco de código: tudo até a próxima linha de crases, sem interpretar.
    if (codigo) {
      if (linha.startsWith("```")) {
        blocos.push({ tipo: "codigo", texto: codigo.join("\n") });
        codigo = null;
      } else {
        codigo.push(bruta.slice(Math.min(recuoCodigo, bruta.length - bruta.trimStart().length)));
      }
      continue;
    }
    if (linha.startsWith("```")) {
      fecharParagrafo();
      codigo = [];
      // O recuo da cerca sai de cada linha: bloco dentro de lista continua
      // alinhado à esquerda.
      recuoCodigo = bruta.length - bruta.trimStart().length;
      ultimaFoiDica = false;
      continue;
    }
    const titulo = /^(#{1,3})\s+(.*)$/.exec(linha);
    const itemUl = /^[-*]\s+(.*)$/.exec(linha);
    const itemOl = /^\d+[.)]\s+(.*)$/.exec(linha);
    const imagem = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(linha);
    const dica = /^>\s?(.*)$/.exec(linha);
    const ultimo = blocos[blocos.length - 1];
    if (!linha) {
      fecharParagrafo();
    } else if (titulo) {
      fecharParagrafo();
      blocos.push({ tipo: (["h1", "h2", "h3"] as const)[titulo[1].length - 1], texto: titulo[2] });
    } else if (imagem) {
      fecharParagrafo();
      blocos.push({ tipo: "imagem", legenda: imagem[1], src: imagem[2] });
    } else if (dica) {
      fecharParagrafo();
      if (ultimaFoiDica && ultimo?.tipo === "dica") ultimo.texto += ` ${dica[1]}`;
      else blocos.push({ tipo: "dica", texto: dica[1] });
    } else if (itemUl || itemOl) {
      fecharParagrafo();
      const tipo = itemUl ? "ul" : "ol";
      const item = (itemUl ?? itemOl)![1];
      if (ultimo && ultimo.tipo === tipo) ultimo.itens.push(item);
      else blocos.push({ tipo, itens: [item] });
    } else {
      paragrafo.push(linha);
    }
    ultimaFoiDica = Boolean(linha && dica && !titulo);
  }
  fecharParagrafo();
  if (codigo) blocos.push({ tipo: "codigo", texto: codigo.join("\n") });
  return blocos;
}

export function MarkdownSimples({ texto, resolverLink }: { texto: string; resolverLink?: ResolverLink }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocosMarkdown(texto).map((b, i) => {
        const k = `b${i}`;
        switch (b.tipo) {
          case "h1":
            return <h1 key={k} className="text-2xl font-bold pt-2">{inline(b.texto, k, resolverLink)}</h1>;
          case "h2":
            return <h2 key={k} className="text-lg font-semibold pt-3">{inline(b.texto, k, resolverLink)}</h2>;
          case "h3":
            return <h3 key={k} className="text-base font-semibold pt-2">{inline(b.texto, k, resolverLink)}</h3>;
          case "ul":
            return (
              <ul key={k} className="list-disc pl-5 space-y-1">
                {b.itens.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`, resolverLink)}</li>)}
              </ul>
            );
          case "ol":
            return (
              <ol key={k} className="list-decimal pl-5 space-y-1">
                {b.itens.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`, resolverLink)}</li>)}
              </ol>
            );
          case "codigo":
            return (
              <pre key={k} className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs leading-relaxed">
                <code>{b.texto}</code>
              </pre>
            );
          case "dica":
            return (
              <aside key={k} className="rounded-md border-l-4 border-primary bg-primary/5 px-3 py-2">
                {inline(b.texto, k, resolverLink)}
              </aside>
            );
          case "imagem":
            return imagemPermitida(b.src) ? (
              <figure key={k} className="space-y-1.5 break-inside-avoid">
                <img
                  src={b.src}
                  alt={b.legenda}
                  loading="lazy"
                  className="w-full rounded-lg border border-border shadow-sm"
                />
                {b.legenda && <figcaption className="text-xs text-muted-foreground">{b.legenda}</figcaption>}
              </figure>
            ) : (
              <p key={k} className="text-xs text-muted-foreground">{b.legenda}</p>
            );
          default:
            return <p key={k}>{inline(b.texto, k, resolverLink)}</p>;
        }
      })}
    </div>
  );
}
