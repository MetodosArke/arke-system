import type { AppRole } from "@/contexts/AuthContext";
import type { Enums } from "@/integrations/supabase/types";

const STAFF_ROLES: AppRole[] = ["gestor", "professor", "nutricionista", "recepcao"];

// Rota inicial após autenticação, 100% automática a partir do perfil —
// ninguém precisa digitar a rota manualmente:
//   1. superadmin (papel global) → /superadmin
//   2. staff (admin_arke ou gestor/professor/nutricionista) de um Studio
//      (organization.tipo === 'studio') → /admin/agenda, a tela própria
//      desse tipo de negócio (grade semanal de turmas)
//   3. staff de Academia (ou profissional autônomo) → /admin
//   4. aluno → /app
export function resolveHomePath(
  roles: AppRole[],
  organizationRole: AppRole | null,
  organizationTipo?: Enums<"organization_tipo"> | null
): string {
  if (roles.includes("superadmin")) return "/superadmin";

  const isStaff = roles.includes("admin_arke") || STAFF_ROLES.includes(organizationRole as AppRole);
  if (!isStaff) return "/app";

  return organizationTipo === "studio" ? "/admin/agenda" : "/admin";
}
