// Upload real para o Supabase Storage (buckets já provisionados: "avatars"
// para logos e "dietas" para anexos de plano alimentar), substituindo o
// base64 gravado direto nas tabelas (CLAUDE.md §D: "funciona pra um
// cliente, não escala pra dez"). Ambos os buckets são públicos e o caminho
// de cada objeto usa um UUID aleatório, então a URL não é adivinhável.
const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
export const LOGO_MIME_TYPES = IMAGE_MIME_TYPES;
export const DIETA_MIME_TYPES = [...IMAGE_MIME_TYPES, "application/pdf"];

// Limites pensados para o corpo de requisição do Vercel (~4.5MB): base64
// infla o arquivo original em ~33%, então o teto aqui deixa margem.
export const LOGO_MAX_BYTES = 1.5 * 1024 * 1024;
export const DIETA_MAX_BYTES = 3 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

export function extensionFor(contentType: string) {
  return EXTENSION_BY_MIME[contentType] ?? "bin";
}

export function decodeUpload(dataBase64: string, contentType: string, allowed: string[], maxBytes: number) {
  if (!allowed.includes(contentType)) throw new Error("Tipo de arquivo não suportado.");
  const buffer = Buffer.from(dataBase64, "base64");
  if (buffer.byteLength === 0) throw new Error("Arquivo vazio.");
  if (buffer.byteLength > maxBytes) throw new Error(`Arquivo muito grande (máximo ${(maxBytes / (1024 * 1024)).toFixed(1)}MB).`);
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
