/**
 * O texto de um PDF, lido no próprio navegador: o arquivo do plano alimentar
 * não sai do aparelho da nutricionista — só o texto vai para a leitura (ver
 * `supabase/functions/importar-dieta-pdf`). A biblioteca (pdf.js) é carregada
 * só quando alguém importa, e o build "legacy" roda também em celular antigo.
 */
export async function extrairTextoDoPdf(arquivo: File): Promise<string> {
  const [pdfjs, { default: urlDoWorker }] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = urlDoWorker;
  const documento = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  try {
    const paginas: string[] = [];
    for (let n = 1; n <= documento.numPages; n++) {
      const conteudo = await (await documento.getPage(n)).getTextContent();
      // Remonta as linhas: cada pedaço diz se termina a linha (hasEOL).
      let linha = "";
      const linhas: string[] = [];
      for (const item of conteudo.items) {
        if (!("str" in item)) continue;
        linha += item.str;
        if (item.hasEOL) {
          linhas.push(linha.trimEnd());
          linha = "";
        }
      }
      if (linha.trim()) linhas.push(linha.trimEnd());
      paginas.push(linhas.join("\n"));
    }
    return paginas.join("\n\n");
  } finally {
    void documento.destroy();
  }
}
