import { Suspense } from "react";
import { CarregandoPagina } from "@/components/CarregandoPagina";
import { AvisoRotinas } from "@/components/superadmin/SaudeRotinas";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LogOut, Shield, LayoutDashboard, UserCog, Settings, Dumbbell, ScrollText, Webhook, MessageCircle, Cpu, Radar } from "lucide-react";

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Visão Geral", path: "/superadmin" },
  { icon: UserCog, label: "Profissionais", path: "/superadmin/profissionais" },
  { icon: Dumbbell, label: "Acervo Global", path: "/superadmin/acervo" },
  { icon: ScrollText, label: "Auditoria", path: "/superadmin/auditoria" },
  { icon: MessageCircle, label: "Mentoria", path: "/superadmin/mentoria" },
  { icon: Cpu, label: "Equipamentos", path: "/superadmin/equipamentos" },
  { icon: Webhook, label: "Webhooks", path: "/superadmin/webhooks" },
  { icon: Radar, label: "Vigia", path: "/superadmin/vigia" },
  { icon: Settings, label: "Configurações", path: "/superadmin/configuracoes" },
];

export function SuperAdminLayout() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <AvisoRotinas />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span
              className="text-base font-bold tracking-wide text-primary"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}
            >
              ArkeFit — Super Admin
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={signOut} title="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-4">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cn(
                  "flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-3 sm:p-4 md:p-6">
        <Suspense fallback={<CarregandoPagina />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
