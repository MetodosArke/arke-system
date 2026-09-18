import type { AppRole } from "@/contexts/AuthContext";
import type { Enums } from "@/integrations/supabase/types";

const STAFF_ROLES: AppRole[] = ["gestor", "professor", "nutricionista", "recepcao"];

// Rota inicial após autenticação, 100% automática a partir do perfil —
// ninguém precisa digitar a rota manualmente:
//   1. superadmin (papel global) → /superadmin
//   2. staff (admin_arke ou gestor/professor/nutricionista) → /admin/dashboard,
//      a Home personalizada por papel (que já mostra a visão certa para
//      Studio, Academia, Personal ou Nutricionista — ver DashboardHome.tsx)
//   3. aluno → /app
export function resolveHomePath(
  roles: AppRole[],
  organizationRole: AppRole | null,
  organizationTipo?: Enums<"organization_tipo"> | null
): string {
  if (roles.includes("superadmin")) return "/superadmin";

  const isStaff = roles.includes("admin_arke") || STAFF_ROLES.includes(organizationRole as AppRole);
  if (!isStaff) return "/app";

  return "/admin/dashboard";
}
