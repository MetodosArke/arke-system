import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { caminhoDaMidia, validarArquivo } from "@/lib/midiaExercicio";
import { removerAudio } from "@/lib/removerAudio";
import { MidiaExercicio } from "@/components/acervo/MidiaExercicio";
import { Loader2, Upload, Link2, X } from "lucide-react";

/**
 * Vídeo e imagem/GIF do exercício: envio para o armazenamento do ARKE (o
 * caminho principal) ou link, para quem já tem o vídeo no YouTube. O vídeo
 * enviado perde a faixa de áudio antes de subir (lib/removerAudio).
 *
 * `pasta` é o dono do arquivo: o id da organização, ou "global" no acervo da
 * ArkeFit — o banco só aceita o envio na pasta de quem pode gravar nela.
 */
export function CampoMidia({
  pasta,
  videoUrl,
  imagemUrl,
  nome,
  onChange,
}: {
  pasta: string;
  videoUrl: string;
  imagemUrl: string;
  nome: string;
  onChange: (mudanca: { video_url?: string; gif_url?: string }) => void;
}) {
  const { toast } = useToast();
  const refVideo = useRef<HTMLInputElement>(null);
  const refImagem = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState<"video" | "imagem" | null>(null);
  const [etapa, setEtapa] = useState("");
  const [modoLink, setModoLink] = useState(false);

  const enviar = async (arquivoOriginal: File, tipo: "video" | "imagem") => {
    const erro = validarArquivo(arquivoOriginal, tipo);
    if (erro) {
      toast({ title: "Arquivo não aceito", description: erro, variant: "destructive" });
      return;
    }
    setEnviando(tipo);
    try {
      let arquivo = arquivoOriginal;
      if (tipo === "video") {
        setEtapa("Tirando o áudio do vídeo…");
        arquivo = (await removerAudio(arquivoOriginal)).arquivo;
      }
      setEtapa("Enviando…");
      const bucket = tipo === "video" ? "exercicio-videos" : "exercicio-imagens";
      const caminho = caminhoDaMidia(pasta, arquivo.name);
      const { error } = await supabase.storage.from(bucket).upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from(bucket).getPublicUrl(caminho);
      onChange(tipo === "video" ? { video_url: data.publicUrl } : { gif_url: data.publicUrl });
    } catch (e) {
      toast({
        title: "Não foi possível enviar",
        description: e instanceof Error ? e.message : "Tente de novo.",
        variant: "destructive",
      });
    } finally {
      setEnviando(null);
      setEtapa("");
    }
  };

  return (
    <div className="space-y-3">
      {(videoUrl || imagemUrl) && <MidiaExercicio videoUrl={videoUrl || null} imagemUrl={imagemUrl || null} nome={nome || "exercício"} />}

      <div className="flex flex-wrap gap-2">
        <input
          ref={refVideo}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void enviar(f, "video");
          }}
        />
        <input
          ref={refImagem}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void enviar(f, "imagem");
          }}
        />
        <Button type="button" size="sm" variant="outline" disabled={!!enviando} onClick={() => refVideo.current?.click()}>
          {enviando === "video" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
          {videoUrl ? "Trocar vídeo" : "Enviar vídeo"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!!enviando} onClick={() => refImagem.current?.click()}>
          {enviando === "imagem" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
          {imagemUrl ? "Trocar imagem/GIF" : "Enviar imagem/GIF"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setModoLink((v) => !v)}>
          <Link2 className="h-3.5 w-3.5 mr-1.5" /> Usar link
        </Button>
        {(videoUrl || imagemUrl) && (
          <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onChange({ video_url: "", gif_url: "" })}>
            <X className="h-3.5 w-3.5 mr-1.5" /> Remover mídia
          </Button>
        )}
      </div>
      {etapa && <p className="text-xs text-muted-foreground">{etapa}</p>}
      <p className="text-[11px] text-muted-foreground">
        Vídeo até 15 MB (MP4, WebM ou MOV), sem som; imagem ou GIF até 5 MB. Tudo roda dentro do app.
      </p>

      {modoLink && (
        <div className="grid gap-2">
          <div className="space-y-1">
            <Label htmlFor="midia-link-video" className="text-xs">Link do vídeo (YouTube ou arquivo)</Label>
            <Input id="midia-link-video" value={videoUrl} onChange={(e) => onChange({ video_url: e.target.value })} placeholder="https://..." />
          </div>
          <div className="space-y-1">
            <Label htmlFor="midia-link-imagem" className="text-xs">Link da imagem ou GIF</Label>
            <Input id="midia-link-imagem" value={imagemUrl} onChange={(e) => onChange({ gif_url: e.target.value })} placeholder="https://..." />
          </div>
        </div>
      )}
    </div>
  );
}
