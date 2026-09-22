/**
 * Remove a faixa de áudio de um vídeo no navegador antes de enviar — trazido do
 * app original (`stripAudioFromVideo`). Vídeo gravado na academia costuma
 * levar música e conversa de fundo: sem áudio, o arquivo fica menor e não
 * espalha a voz de ninguém para todos os alunos.
 *
 * Como funciona: toca o vídeo sem som e regrava só a imagem
 * (captureStream + MediaRecorder). Leva o tempo do próprio vídeo. Onde o
 * navegador não oferece isso (Safari do iPhone, por exemplo), ou se passar do
 * tempo-limite, devolve o arquivo original — e o app toca todo vídeo de
 * exercício sem som de qualquer jeito.
 */
type VideoComCaptura = HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };

export async function removerAudio(arquivo: File, limiteMs = 120_000): Promise<{ arquivo: File; semAudio: boolean }> {
  const video = document.createElement("video") as VideoComCaptura;
  const suporta = typeof video.captureStream === "function" || typeof video.mozCaptureStream === "function";
  if (!suporta || typeof MediaRecorder === "undefined") return { arquivo, semAudio: false };

  const tipo = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) =>
    MediaRecorder.isTypeSupported?.(t)
  );
  if (!tipo) return { arquivo, semAudio: false };

  const url = URL.createObjectURL(arquivo);
  try {
    const resultado = await Promise.race([
      new Promise<File>((resolve, reject) => {
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.onerror = () => reject(new Error("Não foi possível ler o vídeo."));
        video.onloadedmetadata = async () => {
          try {
            await video.play();
            const fluxo = video.captureStream?.() ?? video.mozCaptureStream!();
            const gravador = new MediaRecorder(new MediaStream(fluxo.getVideoTracks()), { mimeType: tipo });
            const pedacos: Blob[] = [];
            gravador.ondataavailable = (e) => e.data.size > 0 && pedacos.push(e.data);
            gravador.onerror = () => reject(new Error("Falha ao regravar o vídeo."));
            gravador.onstop = () => {
              const ext = tipo.includes("mp4") ? "mp4" : "webm";
              const base = arquivo.name.replace(/\.[^.]+$/, "");
              resolve(new File([new Blob(pedacos, { type: tipo })], `${base}-sem-audio.${ext}`, { type: tipo.split(";")[0] }));
            };
            video.onended = () => gravador.state !== "inactive" && gravador.stop();
            gravador.start(250);
          } catch (e) {
            reject(e instanceof Error ? e : new Error("Falha ao regravar o vídeo."));
          }
        };
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), limiteMs)),
    ]);
    return resultado ? { arquivo: resultado, semAudio: true } : { arquivo, semAudio: false };
  } catch {
    return { arquivo, semAudio: false };
  } finally {
    try {
      video.pause();
    } catch {
      /* já parado */
    }
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
