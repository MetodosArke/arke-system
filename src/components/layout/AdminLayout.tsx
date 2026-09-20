import { Outlet, useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { AdminSidebarDesktop } from "./AdminSidebar";
import { AppHeader } from "./AppHeader";
import { AdminSidebarProvider, useAdminSidebar } from "@/contexts/AdminSidebarContext";
import { cn } from "@/lib/utils";

function AdminLayoutInner() {
  const { collapsed } = useAdminSidebar();
  const { organization, rolesLoaded, hasRole } = useAuth();
  const navigate = useNavigate();

  // Antes, um admin_arke sem organização fazia o layout chamar
  // `provisionar_organizacao_padrao()` sozinho, que criava a "Academia
  // Piloto" e o vinculava como gestor dela. Navegar passava a criar tenant
  // — com seed de modelos, linha no funil e vínculo novo — sem ninguém
  // pedir. O painel Super Admin já cria organização pelo caminho próprio
  // ("+ Nova Organização"), então aqui basta dizer a verdade e sair do
  // caminho.
  if (rolesLoaded && !organization) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <Building2 className="h-10 w-10 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-base font-semibold">Nenhuma organização vinculada</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            O painel de gestão trabalha sempre sobre uma academia. Sua conta não está
            vinculada a nenhuma — peça um convite ao gestor, ou crie a organização pelo
            painel Super Admin.
          </p>
        </div>
        {hasRole("superadmin") && (
          <Button variant="outline" size="sm" onClick={() => navigate("/superadmin")}>
            Ir para o painel Super Admin
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background overflow-x-hidden">
      <AdminSidebarDesktop />
      <div
        className={cn(
          "flex flex-1 flex-col min-w-0 transition-all duration-300",
          collapsed ? "md:ml-16" : "md:ml-64"
        )}
      >
        <AppHeader />
        <main className="flex-1 p-3 sm:p-4 md:p-6 min-w-0 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AdminLayout() {
  return (
    <AdminSidebarProvider>
      <AdminLayoutInner />
    </AdminSidebarProvider>
  );
}
