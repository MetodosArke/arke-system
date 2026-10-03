/**
 * O ícone do app instalado com a marca da academia, gerado no navegador do
 * gestor a partir do logo que ele já enviou. Nada sai do aparelho além dos
 * dois PNGs prontos, que vão para o mesmo bucket do logo.
 *
 * O Android recorta o ícone em círculo, gota ou quadrado arredondado
 * ("maskable"): só o centro, num círculo de 80% do lado, é garantido. O logo
 * fica dentro de um quadrado de 56% do lado, que cabe nesse círculo com
 * folga, sobre um fundo que ocupa o quadrado inteiro.
 */

export const LADO_DO_LOGO = 0.56;

export type FundoDoIcone = "branco" | "escuro" | "marca";

export const FUNDO_HEX: Record<Exclude<FundoDoIcone, "marca">, string> = {
  branco: "#ffffff",
  escuro: "#0f0f0f",
};

/** O retângulo do logo dentro do ícone: inteiro, proporcional e centrado. */
export function encaixarLogo(larguraLogo: number, alturaLogo: number, lado: number): { x: number; y: number; w: number; h: number } {
  const caixa = lado * LADO_DO_LOGO;
  if (larguraLogo <= 0 || alturaLogo <= 0) return { x: (lado - caixa) / 2, y: (lado - caixa) / 2, w: caixa, h: caixa };
  const escala = Math.min(caixa / larguraLogo, caixa / alturaLogo);
  const w = larguraLogo * escala;
  const h = alturaLogo * escala;
  return { x: (lado - w) / 2, y: (lado - h) / 2, w, h };
}

function carregar(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // O bucket público responde com CORS: sem isto o canvas fica "sujo" e não exporta.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível abrir o logo. Envie o logo pelo botão desta tela e tente de novo."));
    img.src = url;
  });
}

function desenhar(img: HTMLImageElement, lado: number, fundo: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Este navegador não conseguiu gerar o ícone."));
  ctx.fillStyle = fundo;
  ctx.fillRect(0, 0, lado, lado);
  // SVG sem tamanho próprio chega com 0 x 0: vira quadrado.
  const r = encaixarLogo(img.naturalWidth || img.width, img.naturalHeight || img.height, lado);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível gerar o ícone."))), "image/png");
    } catch {
      reject(new Error("O logo está num endereço que não deixa gerar o ícone. Envie o logo pelo botão desta tela."));
    }
  });
}

/** Os dois tamanhos que o manifesto pede, do mesmo desenho. */
export async function gerarIcones(logoUrl: string, fundo: string): Promise<{ i192: Blob; i512: Blob }> {
  const img = await carregar(logoUrl);
  const [i512, i192] = await Promise.all([desenhar(img, 512, fundo), desenhar(img, 192, fundo)]);
  return { i192, i512 };
}
