import { Navigate } from "react-router-dom";
import { useAuth, AppRole } from "@/contexts/AuthContext";
import { VerificacaoDuasEtapas } from "@/components/VerificacaoDuasEtapas";

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
  }

  return <>{children}</>;
}
