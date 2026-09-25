import { useState } from "react";
import { useAppSidebar } from "./AppLayout";
import { Home, User, LogOut, ChevronLeft, Menu, Dumbbell, UtensilsCrossed, LayoutDashboard, Activity, Compass, Trophy, Medal, Users, CalendarDays, CircleHelp } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MarcaArkeFit } from "@/components/marca/MarcaArkeFit";

function buildMenuItems(ehStudio: boolean) {
  const items = [
    { icon: Home, label: "Início", path: "/app" },
    { icon: Dumbbell, label: "Treino", path: "/app/treinos" },
    { icon: UtensilsCrossed, label: "Dieta", path: "/app/dieta" },
  ];
  if (ehStudio) {
    items.push({ icon: CalendarDays, label: "Agenda", path: "/app/agenda" });
  }
  items.push(
    { icon: Activity, label: "Evolução", path: "/app/evolucao" },
    { icon: Compass, label: "Jornada", path: "/app/jornada" },
    { icon: Trophy, label: "Desafios", path: "/app/desafios" },
    { icon: Medal, label: "Competições", path: "/app/competicoes" },
    { icon: Users, label: "Feed", path: "/app/feed" },
    { icon: User, label: "Perfil", path: "/app/perfil" },
    { icon: CircleHelp, label: "Ajuda", path: "/app/ajuda" }
  );
  return items;
}

function SidebarNav({
  collapsed,
  onCollapse,
  onNavigate,
}: {
  collapsed: boolean;
  onCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, hasRole, organization } = useAuth();
  const isAdminArke = hasRole("admin_arke");
  const menuItems = buildMenuItems(organization?.tipo === "studio");

  const handleNav = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-border p-4">
        {!collapsed && (
          <h1>
            <MarcaArkeFit className="h-6 w-auto" />
          </h1>
        )}
        {onCollapse && (
          <Button variant="ghost" size="icon" onClick={onCollapse} className="h-8 w-8">
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </Button>
        )}
      </div>

      <nav className="flex-1 space-y-1 p-2 overflow-y-auto">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path || (item.path === "/app/ajuda" && location.pathname.startsWith("/app/ajuda/"));
          return (
            <button
              key={item.path}
              onClick={() => handleNav(item.path)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-border p-2 space-y-1">
        {/* Só com organização: sem ela, /admin não tem sobre o que operar. */}
        {isAdminArke && organization && (
          <button
            onClick={() => handleNav("/admin")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Voltar ao painel de gestão"
          >
            <LayoutDashboard className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Painel de Gestão</span>}
          </button>
        )}
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </>
  );
}

export function AppSidebarDesktop() {
  const { collapsed, setCollapsed } = useAppSidebar();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 hidden md:flex h-full flex-col border-r border-border bg-card transition-all duration-300 no-print",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <SidebarNav collapsed={collapsed} onCollapse={() => setCollapsed(!collapsed)} />
    </aside>
  );
}

export function AppSidebarMobile() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden h-9 w-9 shrink-0">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="p-0 w-72 flex flex-col">
        <SidebarNav collapsed={false} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
