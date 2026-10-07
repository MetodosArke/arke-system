import { UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { MENSAGEM_PERFIL_SIMULADO } from "@/lib/impersonation";

/**
 * Ao lado do que só a própria pessoa faz (autorizar, retirar a autorização,
 * aceitar, assinar), quando a aba está num perfil simulado. Quem trava de
 * verdade é o banco; isto só diz antes de a pessoa tentar.
 */
export function AvisoPerfilSimulado({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-[11px] text-warning", className)}>
      <UserCog className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {MENSAGEM_PERFIL_SIMULADO}
    </p>
  );
}
