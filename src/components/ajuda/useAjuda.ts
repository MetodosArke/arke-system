import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { publicosDaArea, type Area } from "@/lib/ajuda/catalogo";

/** A área (painel, app ou Visão Master) e os públicos de quem está vendo. */
export function useAjuda() {
  const { pathname } = useLocation();
  const { organizationRole, organization, hasRole } = useAuth();
  const area: Area = pathname.startsWith("/superadmin") ? "superadmin" : pathname.startsWith("/app") ? "app" : "admin";
  const papel = hasRole("admin_arke") && !organizationRole ? "admin_arke" : organizationRole;
  const publicos = publicosDaArea(area, {
    papel,
    autonomo: organization?.tipo === "profissional_autonomo",
    especialidade: organization?.especialidadeProfissional ?? null,
  });
  return { area, publicos, base: `/${area}/ajuda`, pathname };
}
