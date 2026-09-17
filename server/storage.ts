// Upload real para o Supabase Storage (buckets já provisionados: "avatars"
// para logos e "dietas" para anexos de plano alimentar), substituindo o
// base64 gravado direto nas tabelas (CLAUDE.md §D: "funciona pra um
// cliente, não escala pra dez"). Ambos os buckets são públicos e o caminho
// de cada objeto usa um UUID aleatório, então a URL não é adivinhável.
const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
export const LOGO_MIME_TYPES = IMAGE_MIME_TYPES;
export const DIETA_MIME_TYPES = [...IMAGE_MIME_TYPES, "application/pdf"];
export const EXERCICIO_VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
export const CHAT_VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
export const FEED_IMAGE_MIME_TYPES = IMAGE_MIME_TYPES;

// Limites pensados para o corpo de requisição do Vercel (~4.5MB): base64
// infla o arquivo original em ~33%, então o teto aqui deixa margem. O
// bucket "exercicio-videos" aceita até 15MB (ver migração de Storage) para
// já comportar um futuro upload direto-pro-Storage sem outra migração —
// hoje, porém, o caminho é sempre via este relay pelo servidor, então o
// limite aplicado aqui é o que realmente vale.
export const LOGO_MAX_BYTES = 1.5 * 1024 * 1024;
export const DIETA_MAX_BYTES = 3 * 1024 * 1024;
export const EXERCICIO_VIDEO_MAX_BYTES = 3 * 1024 * 1024;
export const CHAT_VIDEO_MAX_BYTES = 3 * 1024 * 1024;
export const FEED_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export function extensionFor(contentType: string) {
  return EXTENSION_BY_MIME[contentType] ?? "bin";
}

// contentType até aqui é só o que o cliente declarou — sem checar a
// assinatura real dos bytes, um arquivo qualquer (ex. HTML/JS) disfarçado
// de "video/mp4" seria publicado como se fosse vídeo, no content-type
// declarado, num bucket público. SVG não tem assinatura binária fixa (é
// texto), então a checagem ali é o começo do arquivo parecer XML/SVG.
const MAGIC_VALIDATORS: Record<string, (buffer: Buffer) => boolean> = {
  "image/png": (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  "image/svg+xml": (b) => /^\s*(<\?xml|<svg)/i.test(b.toString("utf8", 0, Math.min(b.length, 300))),
  "application/pdf": (b) => b.length >= 4 && b.toString("ascii", 0, 4) === "%PDF",
  "video/mp4": (b) => b.length >= 8 && b.toString("ascii", 4, 8) === "ftyp",
  "video/quicktime": (b) => b.length >= 8 && b.toString("ascii", 4, 8) === "ftyp",
  "video/webm": (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
};

export function decodeUpload(dataBase64: string, contentType: string, allowed: string[], maxBytes: number) {
  if (!allowed.includes(contentType)) throw new Error("Tipo de arquivo não suportado.");
  const buffer = Buffer.from(dataBase64, "base64");
  if (buffer.byteLength === 0) throw new Error("Arquivo vazio.");
  if (buffer.byteLength > maxBytes) throw new Error(`Arquivo muito grande (máximo ${(maxBytes / (1024 * 1024)).toFixed(1)}MB).`);
  if (MAGIC_VALIDATORS[contentType] && !MAGIC_VALIDATORS[contentType](buffer)) throw new Error("O conteúdo do arquivo não corresponde ao tipo declarado.");
  return buffer;
}

function storageConfig() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  return { url: url.replace(/\/$/, ""), key };
}

export async function uploadPublicFile(bucket: string, path: string, data: Buffer, contentType: string): Promise<string> {
  const { url, key } = storageConfig();
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": contentType, "x-upsert": "true" },
    body: new Uint8Array(data),
  });
  if (!response.ok) throw new Error(`Supabase Storage ${response.status}: ${await response.text()}`);
  return `${url}/storage/v1/object/public/${bucket}/${path}`;
}
