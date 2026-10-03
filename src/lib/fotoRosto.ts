import { TAMANHO_MAXIMO_FOTO, bytesDoDataUrl, dimensoesDaFoto, fotoGrandeOBastante } from "@/lib/cadastroRosto";

/**
 * Prepara a foto do rosto no próprio aparelho, antes de qualquer envio:
 * reduz para caber em 480x640 (600x450 deitada), regrava em JPEG e baixa a
 * qualidade até o arquivo caber em 100 KB. O original não sai do aparelho; o
 * que sai é a versão reduzida, que é a que os leitores pedem.
 *
 * Só funciona no navegador (canvas). As contas ficam em `cadastroRosto.ts`,
 * onde os testes as conferem.
 */
export async function prepararFotoRosto(arquivo: File): Promise<string> {
  if (!arquivo.type.startsWith("image/")) throw new Error("Escolha uma foto.");
  const imagem = await carregar(arquivo);
  try {
    const largura = "naturalWidth" in imagem ? imagem.naturalWidth : imagem.width;
    const altura = "naturalHeight" in imagem ? imagem.naturalHeight : imagem.height;
    if (!fotoGrandeOBastante(largura, altura)) throw new Error("A foto ficou pequena demais. Tire outra, mais perto.");
    const destino = dimensoesDaFoto(largura, altura);
    const canvas = document.createElement("canvas");
    canvas.width = destino.largura;
    canvas.height = destino.altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Este aparelho não conseguiu preparar a foto.");
    ctx.drawImage(imagem, 0, 0, destino.largura, destino.altura);
    for (const qualidade of [0.88, 0.8, 0.7, 0.6, 0.5]) {
      const dataUrl = canvas.toDataURL("image/jpeg", qualidade);
      if (dataUrl.startsWith("data:image/jpeg;base64,") && bytesDoDataUrl(dataUrl) <= TAMANHO_MAXIMO_FOTO) return dataUrl;
    }
    throw new Error("Não foi possível deixar a foto leve o bastante. Tente outra, com fundo mais simples.");
  } finally {
    if ("close" in imagem) imagem.close();
  }
}

/**
 * createImageBitmap respeita a orientação gravada pelo celular (foto de pé
 * continua de pé); o elemento <img> fica de reserva para navegador antigo.
 */
async function carregar(arquivo: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    } catch {
      // segue para o <img>
    }
  }
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Não foi possível abrir esta foto."));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
