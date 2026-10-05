import { Navigate } from "react-router-dom";
import { useAuth, AppRole } from "@/contexts/AuthContext";
import { VerificacaoDuasEtapas } from "@/components/VerificacaoDuasEtapas";
import { emPerfilSimulado } from "@/lib/impersonation";

interface Props {
  children: React.ReactNode;
  requiredRoles?: AppRole[];
}

export function ProtectedRoute({ children, requiredRoles }: Props) {
  const { isAuthenticated, isLoading, roles, organizationRole, rolesLoaded } = useAuth();

  if (isLoading || (requiredRoles && requiredRoles.length > 0 && !rolesLoaded)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  if (requiredRoles && requiredRoles.length > 0) {
    // `roles` são papéis globais de plataforma (ex.: admin_arke); gestor/
    // professor/nutricionista são papéis da organização (organizationRole).
    const hasAccess =
      requiredRoles.some((r) => roles.includes(r)) ||
      (organizationRole !== null && requiredRoles.includes(organizationRole));
    if (!hasAccess) {
      return <Navigate to="/app" replace />;
    }
    // A conta da ArkeFit alcança todas as academias: nas áreas que pedem papel,
    // ela só entra com a verificação em duas etapas (o banco exige o mesmo).
    if (roles.includes("superadmin") || roles.includes("admin_arke")) {
      return <VerificacaoDuasEtapas>{children}</VerificacaoDuasEtapas>;
    }
    // A gestão que ligou as duas etapas (Perfil) digita o código ao entrar no
    // painel; quem não ligou passa direto. A sessão simulada pela ArkeFit não
    // tem o celular da pessoa, e a simulação já exige as duas etapas de quem simula.
    if (!emPerfilSimulado()) {
      return (
        <VerificacaoDuasEtapas
          soSeAtivada
          descricao="Você ligou a verificação em duas etapas. Além da senha, a entrada pede o código do aplicativo autenticador do seu celular."
        >
          {children}
        </VerificacaoDuasEtapas>
      );
    }
  }

  return <>{children}</>;
}
