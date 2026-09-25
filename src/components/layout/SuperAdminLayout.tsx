import { Suspense } from "react";
import { CarregandoPagina } from "@/components/CarregandoPagina";
import { AvisoRotinas } from "@/components/superadmin/SaudeRotinas";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LogOut, Moon, Shield, Sun } from "lucide-react";
import { BotaoAjuda } from "@/components/ajuda/BotaoAjuda";
import { MarcaArkeFit } from "@/components/marca/MarcaArkeFit";
import { AdminSidebarProvider, useAdminSidebar } from "@/contexts/AdminSidebarContext";
import { SECOES_SUPERADMIN, SuperAdminSidebarDesktop, SuperAdminSidebarMobile } from "./SuperAdminSidebar";

/** O nome da tela aberta, para o cabeçalho. A Central de Ajuda tem subpáginas. */
function tituloDaTela(pathname: string): string {
  if (pathname.startsWith("/superadmin/ajuda")) return "Ajuda";
  const item = SECOES_SUPERADMIN.flatMap((s) => s.items).find((i) => i.path === pathname);
  return item?.label ?? "Visão Master";
}

function SuperAdminLayoutInner() {
  const { signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { collapsed } = useAdminSidebar();
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-background overflow-x-hidden">
      <SuperAdminSidebarDesktop />
      <div
        className={cn(
          "flex flex-1 flex-col min-w-0 transition-all duration-300",
          collapsed ? "md:ml-16" : "md:ml-64"
        )}
      >
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-card/95 backdrop-blur-xl px-3 sm:px-4 py-3 shadow-sm safe-top no-print">
          <div className="flex items-center gap-2 min-w-0">
            <SuperAdminSidebarMobile />
            {/* No celular o menu fica recolhido, então a marca sobe para o cabeçalho. */}
            <MarcaArkeFit className="h-5 w-auto md:hidden" />
            <span className="hidden md:flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-xs font-medium text-primary shrink-0">
              <Shield className="h-3 w-3" aria-hidden /> Super Admin
            </span>
            <p className="hidden sm:block text-sm font-semibold truncate" data-titulo-tela>
              {tituloDaTela(location.pathname)}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <BotaoAjuda />
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-8 w-8 sm:h-9 sm:w-9" aria-label="Trocar tema" title="Trocar tema">
              {theme === "dark" ? <Sun className="h-4 w-4 sm:h-5 sm:w-5" /> : <Moon className="h-4 w-4 sm:h-5 sm:w-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              aria-label="Sair"
              title="Sair"
              className="h-8 w-8 sm:h-9 sm:w-9 text-muted-foreground hover:text-destructive"
            >
              <LogOut className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
          </div>
        </header>
        <AvisoRotinas />
        <main className="mx-auto w-full max-w-6xl flex-1 min-w-0 p-3 sm:p-4 md:p-6">
          <Suspense fallback={<CarregandoPagina />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export function SuperAdminLayout() {
  return (
    <AdminSidebarProvider>
      <SuperAdminLayoutInner />
    </AdminSidebarProvider>
  );
}
