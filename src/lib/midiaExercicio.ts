/**
 * Mídia dos exercícios: vídeo e imagem/GIF enviados para o armazenamento do
 * próprio ARKE, tocados dentro do app — sem abrir o navegador, que era a
 * queixa com os links externos. Link do YouTube continua aceito, mas vira
 * player embutido.
 *
 * Os arquivos ficam em `exercicio-videos` e `exercicio-imagens`, na pasta do
 * dono: o id da organização, ou "global" para o acervo da ArkeFit (regra em
 * `pode_gravar_midia_exercicio`).
 */
export const LIMITE_VIDEO_BYTES = 15 * 1024 * 1024;
export const LIMITE_IMAGEM_BYTES = 5 * 1024 * 1024;
export const TIPOS_VIDEO = ["video/mp4", "video/webm", "video/quicktime"];
export const TIPOS_IMAGEM = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type TipoMidia = "video_arquivo" | "youtube" | "imagem" | "nenhuma";

/** Id do vídeo do YouTube em qualquer formato comum de link, ou null. */
export function idYoutube(url: string | null | undefined): string | null {
  if (!url) return null;
  const m =
    url.match(/youtu\.be\/([\w-]{11})/) ||
    url.match(/youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/** Player embutido, sem som e sem sugestões de outros canais no fim. */
export function embedYoutube(url: string): string | null {
  const id = idYoutube(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}?mute=1&rel=0&playsinline=1` : null;
}

export function tipoDoVideo(url: string | null | undefined): TipoMidia {
  if (!url) return "nenhuma";
  if (idYoutube(url)) return "youtube";
  return "video_arquivo";
}

/** Caminho no armazenamento: pasta do dono + nome único, mantendo a extensão. */
export function caminhoDaMidia(pasta: string, nomeArquivo: string): string {
  const ext = (nomeArquivo.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${pasta}/${crypto.randomUUID()}.${ext}`;
}

/** Validação antes de enviar; devolve a mensagem de erro, ou null. */
export function validarArquivo(arquivo: { size: number; type: string }, tipo: "video" | "imagem"): string | null {
  const [tipos, limite, rotulo] =
    tipo === "video" ? [TIPOS_VIDEO, LIMITE_VIDEO_BYTES, "vídeo MP4, WebM ou MOV"] : [TIPOS_IMAGEM, LIMITE_IMAGEM_BYTES, "imagem PNG, JPG, WebP ou GIF"];
  if (!tipos.includes(arquivo.type)) return `Envie um ${rotulo}.`;
  if (arquivo.size > limite) return `O arquivo passa de ${Math.round(limite / 1024 / 1024)} MB. Envie um trecho mais curto ou mais leve.`;
  return null;
}
