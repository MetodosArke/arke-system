import type { AppRole } from "@/contexts/AuthContext";

const STAFF_ROLES: AppRole[] = ["gestor", "professor", "nutricionista"];

// Rota inicial após autenticação: admin_arke e staff da organização (gestor,
// professor, nutricionista) vão para o painel /admin; aluno vai para /app.
export function resolveHomePath(roles: AppRole[], organizationRole: AppRole | null): string {
  const isStaff = roles.includes("admin_arke") || STAFF_ROLES.includes(organizationRole as AppRole);
  return isStaff ? "/admin" : "/app";
}
