/**
 * Remove a faixa de áudio de um arquivo de vídeo no navegador.
 * Usa HTMLVideoElement.captureStream() + MediaRecorder com apenas as video tracks.
 *
 * Fallback: se o navegador não suportar captureStream/MediaRecorder, retorna o arquivo original.
 */
export async function stripAudioFromVideo(file: File): Promise<File> {
  // Verifica suporte
  const video = document.createElement("video");
  const supportsCapture =
    typeof (video as any).captureStream === "function" ||
    typeof (video as any).mozCaptureStream === "function";
  if (!supportsCapture || typeof MediaRecorder === "undefined") {
    return file;
  }

  // Escolhe um mimeType suportado
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported?.(t));
  if (!mimeType) return file;

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<File>((resolve, reject) => {
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      (video as any).crossOrigin = "anonymous";

      const cleanup = () => {
        try {
          video.pause();
        } catch {}
      };

      video.onerror = () => {
        cleanup();
        reject(new Error("Falha ao carregar vídeo para remoção de áudio"));
      };

      video.onloadedmetadata = async () => {
        try {
          await video.play();

          const stream: MediaStream =
            (video as any).captureStream?.() ?? (video as any).mozCaptureStream();

          // Mantém apenas as video tracks
          const videoOnly = new MediaStream(stream.getVideoTracks());

          const recorder = new MediaRecorder(videoOnly, { mimeType });
          const chunks: Blob[] = [];
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
          };
          recorder.onerror = (e) => {
            cleanup();
            reject((e as any).error || new Error("MediaRecorder error"));
          };
          recorder.onstop = () => {
            cleanup();
            const blob = new Blob(chunks, { type: mimeType });
            const ext = mimeType.includes("mp4") ? "mp4" : "webm";
            const baseName = file.name.replace(/\.[^.]+$/, "");
            const out = new File([blob], `${baseName}-no-audio.${ext}`, {
              type: mimeType,
              lastModified: Date.now(),
            });
            resolve(out);
          };

          video.onended = () => {
            if (recorder.state !== "inactive") recorder.stop();
          };

          recorder.start(250);
        } catch (err) {
          cleanup();
          reject(err as Error);
        }
      };
    });
  } finally {
    // pequena espera para garantir leitura completa antes de revogar
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
