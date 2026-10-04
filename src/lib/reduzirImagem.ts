/**
 * Reduz a imagem no próprio aparelho antes de ir para o Storage.
 *
 * A foto do celular chega com 3 a 5 MB e 4000 px de lado, e cada tela que a
 * mostra baixa o arquivo inteiro de novo: é o que mais consome a saída de dados
 * do Supabase, e o que mais demora para aparecer no celular do aluno. Reduzida
 * a um lado maior que a tela nunca passa, a mesma foto fica com uns 200 KB.
 *
 * Fica de fora o que o canvas estragaria: SVG (é vetor, já é leve) e GIF (o
 * canvas pega só o primeiro quadro, e a animação some). Esses seguem como
 * vieram, dentro do limite de tamanho do bucket.
 *
 * As contas ficam em funções puras, que os testes conferem; o canvas só existe
 * no navegador.
 */

export type TipoSaida = "image/jpeg" | "image/png" | "image/webp";

/** Tamanho para caber no lado maior, sem aumentar imagem pequena. */
export function dimensoesReduzidas(largura: number, altura: number, ladoMaior: number): { largura: number; altura: number } {
  const maior = Math.max(largura, altura);
  if (maior <= ladoMaior) return { largura, altura };
  const fator = ladoMaior / maior;
  return { largura: Math.max(1, Math.round(largura * fator)), altura: Math.max(1, Math.round(altura * fator)) };
}

/** O que o canvas estragaria passa direto. */
export function passaSemReduzir(tipo: string): boolean {
  return tipo === "image/svg+xml" || tipo === "image/gif";
}

export function extensaoDoTipo(tipo: string): string {
  const extensoes: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
  };
  return extensoes[tipo] ?? "bin";
}

/** O nome do arquivo com a extensão do tipo que de fato saiu ("foto.png" → "foto.webp"). */
export function nomeComExtensao(nome: string, tipo: string): string {
  const base = nome.includes(".") ? nome.slice(0, nome.lastIndexOf(".")) : nome;
  return `${base || "imagem"}.${extensaoDoTipo(tipo)}`;
}

/**
 * Devolve a imagem reduzida, ou o próprio arquivo quando reduzir não ganharia
 * nada (já é pequena e o arquivo novo sairia maior).
 *
 * `tipo: "image/webp"` cai para PNG no navegador que não grava WebP: o padrão
 * do canvas, quando o tipo pedido não existe, é devolver PNG, e o arquivo é
 * gravado com o tipo que de fato saiu.
 */
export async function reduzirImagem(
  arquivo: File,
  opcoes: { ladoMaior: number; tipo: TipoSaida; qualidade?: number }
): Promise<Blob> {
  if (passaSemReduzir(arquivo.type)) return arquivo;
  if (!arquivo.type.startsWith("image/")) throw new Error("Escolha uma imagem.");
  const imagem = await carregar(arquivo);
  try {
    const largura = "naturalWidth" in imagem ? imagem.naturalWidth : imagem.width;
    const altura = "naturalHeight" in imagem ? imagem.naturalHeight : imagem.height;
    const destino = dimensoesReduzidas(largura, altura, opcoes.ladoMaior);
    const canvas = document.createElement("canvas");
    canvas.width = destino.largura;
    canvas.height = destino.altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Este aparelho não conseguiu preparar a imagem.");
    // JPEG não tem transparência: sem fundo branco, o transparente vira preto.
    if (opcoes.tipo === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, destino.largura, destino.altura);
    }
    ctx.drawImage(imagem, 0, 0, destino.largura, destino.altura);
    const reduzida = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, opcoes.tipo, opcoes.qualidade ?? 0.82));
    if (!reduzida) throw new Error("Não foi possível preparar a imagem.");
    const mesmoTamanho = destino.largura === largura && destino.altura === altura;
    return mesmoTamanho && reduzida.size >= arquivo.size ? arquivo : reduzida;
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
      img.onerror = () => reject(new Error("Não foi possível abrir esta imagem."));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
