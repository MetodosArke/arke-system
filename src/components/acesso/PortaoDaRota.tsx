import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { podeAbrirNoPainel } from "@/lib/acessoPainel";

/**
 * A página do painel confere o papel de quem abre, pela mesma tabela do menu
 * (`src/lib/acessoPainel.ts`). Antes, o endereço digitado abria Gestão 360° e
 * Financeiro para o professor e a recepção.
 */
export function PortaoDaRota({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { organizationRole, organization, hasRole } = useAuth();
  const contexto = {
    tipoOrganizacao: organization?.tipo,
    especialidade: organization?.especialidadeProfissional,
    papel: organizationRole,
    adminArke: hasRole("admin_arke"),
  };
  if (podeAbrirNoPainel(pathname, contexto)) return <>{children}</>;
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <Lock className="h-8 w-8 text-muted-foreground" aria-hidden />
      <h1 className="text-base font-semibold">Esta página não faz parte do seu acesso</h1>
      <p className="text-sm text-muted-foreground">
        O que cada pessoa da equipe vê depende do papel dela na academia. Se você precisa desta página, fale com a gestão.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to="/admin/dashboard">Voltar ao início</Link>
      </Button>
    </div>
  );
}
