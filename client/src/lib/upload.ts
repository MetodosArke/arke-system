export function readFileAsBase64(file: File): Promise<{ base64: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Não foi possível ler o arquivo."));
    reader.onload = () => {
      const result = String(reader.result);
      resolve({ base64: result.slice(result.indexOf(",") + 1), contentType: file.type });
    };
    reader.readAsDataURL(file);
  });
}
