import { Navigate } from "react-router-dom";
import { useAuth, AppRole } from "@/contexts/AuthContext";

interface Props {
  children: React.ReactNode;
  requiredRoles?: AppRole[];
}

export function ProtectedRoute({ children, requiredRoles }: Props) {
  const { isAuthenticated, isLoading, roles, rolesLoaded } = useAuth();

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
    const hasAccess = requiredRoles.some((r) => roles.includes(r));
    if (!hasAccess) {
      return <Navigate to="/app" replace />;
    }
  }

  return <>{children}</>;
}
