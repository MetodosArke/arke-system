import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AdminSidebarDesktop } from "./AdminSidebar";
import { AppHeader } from "./AppHeader";
import { AdminSidebarProvider, useAdminSidebar } from "@/contexts/AdminSidebarContext";
import { cn } from "@/lib/utils";

function AdminLayoutInner() {
  const { collapsed } = useAdminSidebar();
  const { organization, rolesLoaded, hasRole, refreshOrganization } = useAuth();

  // Super Admin (admin_arke) é um papel global, sem organização própria —
  // mas todas as telas de /admin operam sobre UMA organização específica.
  // Provisiona (de forma idempotente, no banco) uma organização padrão de
  // homologação e vincula o admin_arke a ela como gestor, para que a
  // homologação ponta a ponta não fique bloqueada por falta de organização.
  // Centralizado aqui (e não em cada página) para cobrir Alunos, Equipe,
  // Organização etc. de uma vez.
  const provisionarOrganizacao = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("provisionar_organizacao_padrao");
      if (error) throw error;
    },
    onSuccess: () => {
      void refreshOrganization();
    },
  });

  useEffect(() => {
    if (
      rolesLoaded &&
      !organization &&
      hasRole("admin_arke") &&
      !provisionarOrganizacao.isPending &&
      !provisionarOrganizacao.isSuccess
    ) {
      provisionarOrganizacao.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesLoaded, organization, hasRole]);

  const aguardandoProvisionamento = rolesLoaded && !organization && hasRole("admin_arke");

  if (aguardandoProvisionamento) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Provisionando organização padrão de homologação...</p>
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
