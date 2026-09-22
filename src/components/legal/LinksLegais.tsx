import { Link } from "react-router-dom";
import { DOCUMENTOS } from "@/lib/documentosLegais";

/** Rodapé com os documentos legais, para as telas públicas e de login. */
export function LinksLegais({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-[11px] text-center text-muted-foreground space-x-3"}>
      <Link to={DOCUMENTOS.termos_uso.caminho} target="_blank" className="hover:underline underline-offset-2">
        Termos de Uso
      </Link>
      <Link to={DOCUMENTOS.privacidade.caminho} target="_blank" className="hover:underline underline-offset-2">
        Política de Privacidade
      </Link>
    </p>
  );
}
