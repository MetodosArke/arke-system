import { useEffect } from "react";
import { Link } from "react-router-dom";
import { DOCUMENTOS, type TipoDocumento } from "@/lib/documentosLegais";
import { MarkdownSimples } from "@/lib/markdownSimples";

/** Página pública de um documento legal (/termos, /privacidade, /contrato-academia). */
export default function DocumentoLegal({ tipo }: { tipo: TipoDocumento }) {
  const doc = DOCUMENTOS[tipo];

  useEffect(() => {
    document.title = `${doc.titulo} — ARKE`;
  }, [doc.titulo]);

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <article className="mx-auto max-w-3xl space-y-4">
        {!doc.revisadoJuridico && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            Minuta em revisão jurídica. O texto pode mudar; se mudar, a plataforma pede um novo aceite.
          </p>
        )}
        <MarkdownSimples texto={doc.texto} />
        <p className="text-xs text-muted-foreground pt-4 border-t">Versão de {new Date(`${doc.versao.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR")}.</p>
        <nav className="flex flex-wrap gap-4 text-xs">
          {Object.entries(DOCUMENTOS)
            .filter(([t]) => t !== tipo)
            .map(([t, d]) => (
              <Link key={t} to={d.caminho} className="text-primary underline-offset-2 hover:underline">
                {d.titulo}
              </Link>
            ))}
          <Link to="/auth/login" className="text-primary underline-offset-2 hover:underline">
            Entrar
          </Link>
        </nav>
      </article>
    </div>
  );
}
