import type { ComponentType, ReactNode } from "react";

export function formatarData(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
}

// Bloco de seção padrão dos painéis de perfil (aluno, funcionário, ...) —
// um rótulo em versalete com ícone seguido do conteúdo livre.
export function Bloco({
  titulo,
  icon: Icon,
  children,
}: {
  titulo: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {titulo}
      </div>
      {children}
    </div>
  );
}
