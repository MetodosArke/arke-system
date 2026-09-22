import { Fragment, type ReactNode } from "react";

/**
 * Markdown mínimo para os documentos legais: títulos (#, ##, ###), parágrafos,
 * listas (- ou 1.) e negrito (**texto**). Não interpreta HTML nenhum — o texto
 * vira nó de texto do React, então não há como injetar marcação. Uma
 * dependência inteira de Markdown seria exagero para três documentos que nós
 * mesmos escrevemos.
 */

function inline(texto: string, chave: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith("**") && parte.endsWith("**") && parte.length > 4 ? (
      <strong key={`${chave}-${i}`}>{parte.slice(2, -2)}</strong>
    ) : (
      <Fragment key={`${chave}-${i}`}>{parte}</Fragment>
    )
  );
}

type Bloco =
  | { tipo: "h1" | "h2" | "h3" | "p"; texto: string }
  | { tipo: "ul" | "ol"; itens: string[] };

export function blocosMarkdown(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  let paragrafo: string[] = [];
  const fecharParagrafo = () => {
    if (paragrafo.length) blocos.push({ tipo: "p", texto: paragrafo.join(" ") });
    paragrafo = [];
  };
  for (const bruta of texto.replace(/\r\n/g, "\n").split("\n")) {
    const linha = bruta.trim();
    const titulo = /^(#{1,3})\s+(.*)$/.exec(linha);
    const itemUl = /^[-*]\s+(.*)$/.exec(linha);
    const itemOl = /^\d+[.)]\s+(.*)$/.exec(linha);
    if (!linha) {
      fecharParagrafo();
    } else if (titulo) {
      fecharParagrafo();
      blocos.push({ tipo: (["h1", "h2", "h3"] as const)[titulo[1].length - 1], texto: titulo[2] });
    } else if (itemUl || itemOl) {
      fecharParagrafo();
      const tipo = itemUl ? "ul" : "ol";
      const ultimo = blocos[blocos.length - 1];
      const item = (itemUl ?? itemOl)![1];
      if (ultimo && ultimo.tipo === tipo) ultimo.itens.push(item);
      else blocos.push({ tipo, itens: [item] });
    } else {
      paragrafo.push(linha);
    }
  }
  fecharParagrafo();
  return blocos;
}

export function MarkdownSimples({ texto }: { texto: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocosMarkdown(texto).map((b, i) => {
        const k = `b${i}`;
        switch (b.tipo) {
          case "h1":
            return <h1 key={k} className="text-2xl font-bold pt-2">{inline(b.texto, k)}</h1>;
          case "h2":
            return <h2 key={k} className="text-lg font-semibold pt-3">{inline(b.texto, k)}</h2>;
          case "h3":
            return <h3 key={k} className="text-base font-semibold pt-2">{inline(b.texto, k)}</h3>;
          case "ul":
            return (
              <ul key={k} className="list-disc pl-5 space-y-1">
                {b.itens.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}
              </ul>
            );
          case "ol":
            return (
              <ol key={k} className="list-decimal pl-5 space-y-1">
                {b.itens.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}
              </ol>
            );
          default:
            return <p key={k}>{inline(b.texto, k)}</p>;
        }
      })}
    </div>
  );
}
