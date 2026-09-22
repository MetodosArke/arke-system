import { embedYoutube, tipoDoVideo } from "@/lib/midiaExercicio";
import { cn } from "@/lib/utils";

/**
 * Mostra a execução do exercício dentro do app: vídeo próprio num player
 * nativo (sem som, em loop), link do YouTube num player embutido, ou a
 * imagem/GIF. Nunca abre o navegador — era a queixa com os links externos,
 * que tiravam o aluno do app no meio do treino.
 */
export function MidiaExercicio({
  videoUrl,
  imagemUrl,
  nome,
  className,
}: {
  videoUrl?: string | null;
  imagemUrl?: string | null;
  nome: string;
  className?: string;
}) {
  const tipo = tipoDoVideo(videoUrl);
  const moldura = cn("w-full aspect-video rounded-lg bg-muted overflow-hidden", className);

  if (tipo === "video_arquivo") {
    return (
      <video
        className={cn(moldura, "object-contain bg-black")}
        src={videoUrl!}
        poster={imagemUrl ?? undefined}
        muted
        loop
        playsInline
        controls
        preload="metadata"
        aria-label={`Execução: ${nome}`}
      />
    );
  }
  if (tipo === "youtube") {
    const src = embedYoutube(videoUrl!);
    if (src) {
      return (
        <iframe
          className={moldura}
          src={src}
          title={`Execução: ${nome}`}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      );
    }
  }
  if (imagemUrl) {
    return <img className={cn(moldura, "object-contain")} src={imagemUrl} alt={`Execução: ${nome}`} loading="lazy" />;
  }
  return null;
}

/** Miniatura para listas e para a busca da prescrição. */
export function MiniaturaExercicio({ imagemUrl, videoUrl, nome }: { imagemUrl?: string | null; videoUrl?: string | null; nome: string }) {
  const temVideo = tipoDoVideo(videoUrl) !== "nenhuma";
  return (
    <div className="relative h-12 w-12 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
      {imagemUrl ? (
        <img src={imagemUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="text-[10px] text-muted-foreground px-1 text-center leading-tight">{nome.slice(0, 12)}</span>
      )}
      {temVideo && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] text-white" aria-label="tem vídeo">
          ▶
        </span>
      )}
    </div>
  );
}
