import { CircleHelp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { artigoDaRota } from "@/lib/ajuda/catalogo";
import { useAjuda } from "./useAjuda";

/**
 * O "?" do cabeçalho: abre o artigo que explica a tela aberta ou, se não
 * houver um, a Central de Ajuda.
 */
export function BotaoAjuda({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { base, publicos, pathname } = useAjuda();
  if (pathname.startsWith(base)) return null;
  const artigo = artigoDaRota(pathname, publicos);
  const rotulo = artigo ? `Ajuda: ${artigo.titulo}` : "Central de Ajuda";
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className ?? "h-8 w-8 sm:h-9 sm:w-9"}
      onClick={() => navigate(artigo ? `${base}/${artigo.slug}` : base)}
      aria-label={rotulo}
      title={rotulo}
    >
      <CircleHelp className="h-4 w-4 sm:h-5 sm:w-5" />
    </Button>
  );
}
