/**
 * Guia do aluno: uma folha A4 com o QR Code do primeiro acesso e o passo a
 * passo, para imprimir e deixar no balcão ou colar na parede. Gerada no
 * navegador, num canvas, sem nada externo: a mesma imagem serve para baixar
 * (PNG) e para imprimir ou salvar em PDF.
 */

export const PASSOS_GUIA = [
  "Aponte a câmera do celular para o QR Code.",
  "Digite o e-mail ou o celular que você deu na matrícula.",
  "Abra o e-mail que chegou e crie a sua senha.",
  "Instale na tela de início. iPhone: Compartilhar → Adicionar à Tela de Início. Android: menu ⋮ → Instalar app.",
];

/** Quebra o texto em linhas que caibam na largura, pela medida que o canvas dá. */
export function quebrarLinhas(texto: string, largura: number, medir: (t: string) => number): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (atual && medir(tentativa) > largura) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = tentativa;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

const carregarImagem = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível montar o QR Code."));
    img.src = src;
  });

/** A folha em PNG (1240 × 1754, A4 a 150 dpi), como data URL. */
export async function gerarGuiaAluno({ academia, link, qrDataUrl }: { academia: string; link: string; qrDataUrl: string }): Promise<string> {
  const L = 1240;
  const A = 1754;
  const canvas = document.createElement("canvas");
  canvas.width = L;
  canvas.height = A;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Este navegador não consegue gerar a imagem.");
  const fonte = (peso: number, tamanho: number) => `${peso} ${tamanho}px Inter, "Segoe UI", Arial, sans-serif`;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, L, A);

  // Faixa do topo com o nome da academia.
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, L, 330);
  ctx.fillStyle = "#22d3ee";
  ctx.fillRect(0, 330, L, 8);
  ctx.textAlign = "center";
  ctx.fillStyle = "#94a3b8";
  ctx.font = fonte(600, 34);
  ctx.fillText("O APP DA SUA ACADEMIA", L / 2, 110);
  ctx.fillStyle = "#ffffff";
  let tamanhoNome = 76;
  ctx.font = fonte(800, tamanhoNome);
  while (ctx.measureText(academia).width > L - 160 && tamanhoNome > 40) {
    tamanhoNome -= 4;
    ctx.font = fonte(800, tamanhoNome);
  }
  ctx.fillText(academia, L / 2, 205);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = fonte(400, 34);
  ctx.fillText("Treino, dieta, pagamentos e a academia no seu celular", L / 2, 272);

  // QR Code.
  const qr = await carregarImagem(qrDataUrl);
  const lado = 600;
  const x = (L - lado) / 2;
  const y = 400;
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(x - 24, y - 24, lado + 48, lado + 48);
  ctx.drawImage(qr, x, y, lado, lado);

  // Passo a passo.
  ctx.textAlign = "left";
  let topo = y + lado + 110;
  ctx.fillStyle = "#0f172a";
  ctx.font = fonte(800, 44);
  ctx.fillText("Primeiro acesso em 4 passos", 120, topo);
  topo += 40;
  PASSOS_GUIA.forEach((passo, i) => {
    topo += 58;
    ctx.fillStyle = "#0e7490";
    ctx.beginPath();
    ctx.arc(146, topo - 12, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = fonte(800, 30);
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), 146, topo - 1);
    ctx.textAlign = "left";
    ctx.fillStyle = "#1e293b";
    ctx.font = fonte(500, 32);
    const linhas = quebrarLinhas(passo, L - 320, (t) => ctx.measureText(t).width);
    linhas.forEach((linha, j) => ctx.fillText(linha, 196, topo + j * 42));
    topo += (linhas.length - 1) * 42;
  });

  // Rodapé.
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(120, A - 220, L - 240, 2);
  ctx.textAlign = "center";
  ctx.fillStyle = "#0f172a";
  ctx.font = fonte(700, 34);
  ctx.fillText("Dúvidas? Fale com a recepção.", L / 2, A - 150);
  ctx.fillStyle = "#64748b";
  ctx.font = fonte(400, 24);
  const linhasLink = quebrarLinhas(link.replace(/^https?:\/\//, ""), L - 240, (t) => ctx.measureText(t).width);
  linhasLink.slice(0, 2).forEach((linha, j) => ctx.fillText(linha, L / 2, A - 100 + j * 30));

  return canvas.toDataURL("image/png");
}
