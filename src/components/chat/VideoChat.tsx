import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Vídeo do chat. O bucket `chat-videos` é privado (vídeo do aluno é dado
 * pessoal): a mensagem guarda o caminho do arquivo, e o player recebe um link
 * temporário. Mensagem antiga com endereço completo (http) toca direto.
 */
export function VideoChat({ referencia }: { referencia: string }) {
  const ehLinkDireto = /^https?:\/\//.test(referencia);
  const { data: url } = useQuery({
    queryKey: ["video-chat", referencia],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("chat-videos").createSignedUrl(referencia, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
    enabled: !ehLinkDireto,
    staleTime: 50 * 60_000,
  });
  const src = ehLinkDireto ? referencia : url;
  if (!src) return <div className="rounded-lg bg-black/20 w-[220px] h-[124px]" aria-label="Carregando vídeo" />;
  return <video src={src} controls preload="metadata" className="rounded-lg max-w-[220px] max-h-[160px]" />;
}
