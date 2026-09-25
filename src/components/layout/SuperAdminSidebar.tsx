import { useState } from "react";
import { ChevronLeft, CircleHelp, Cpu, Dumbbell, Inbox, LayoutDashboard, LogOut, Menu, MessageCircle, Radar, ScrollText, Settings, Shield, UserCog, Webhook } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminSidebar } from "@/contexts/AdminSidebarContext";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MarcaArkeFit } from "@/components/marca/MarcaArkeFit";

type MenuItem = { icon: typeof LayoutDashboard; label: string; path: string };

// Mesmo desenho do menu do painel da academia, com os itens da Visão Master
// agrupados pelo que se vai fazer: atender, vigiar a plataforma, ajustar o
// catálogo. Antes eram onze abas numa faixa no alto, que no celular rolava
// para o lado e escondia metade delas.
export const SECOES_SUPERADMIN: { label: string; items: MenuItem[] }[] = [
  {
    label: "Operação",
    items: [
      { icon: LayoutDashboard, label: "Visão Geral", path: "/superadmin" },
      { icon: MessageCircle, label: "Mentoria", path: "/superadmin/mentoria" },
      { icon: Inbox, label: "Contatos do site", path: "/superadmin/contatos" },
      { icon: UserCog, label: "Profissionais", path: "/superadmin/profissionais" },
    ],
  },
  {
    label: "Monitoramento",
    items: [
      { icon: Radar, label: "Vigia", path: "/superadmin/vigia" },
      { icon: Cpu, label: "Equipamentos", path: "/superadmin/equipamentos" },
      { icon: Webhook, label: "Webhooks", path: "/superadmin/webhooks" },
      { icon: ScrollText, label: "Auditoria", path: "/superadmin/auditoria" },
    ],
  },
  {
    label: "Configurações",
    items: [
      { icon: Dumbbell, label: "Acervo Global", path: "/superadmin/acervo" },
      { icon: Settings, label: "Configurações", path: "/superadmin/configuracoes" },
    ],
  },
];

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
  const { signOut } = useAuth();

  const handleNav = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-border p-4">
        {!collapsed && (
          <div className="space-y-1.5">
            <h1>
              <MarcaArkeFit className="h-6 w-auto" />
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-[11px] font-medium text-primary">
              <Shield className="h-3 w-3" aria-hidden /> Visão Master
            </span>
          </div>
        )}
        {onCollapse && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onCollapse}
            className="h-8 w-8"
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </Button>
        )}
      </div>

      <nav className="flex-1 space-y-4 p-2 overflow-y-auto">
        {SECOES_SUPERADMIN.map((section) => (
          <div key={section.label} className="space-y-1">
            {!collapsed && (
              <p className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.label}
              </p>
            )}
            {section.items.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => handleNav(item.path)}
                  title={collapsed ? item.label : undefined}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-2 space-y-1">
        <button
          onClick={() => handleNav("/superadmin/ajuda")}
          title={collapsed ? "Ajuda" : undefined}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            location.pathname.startsWith("/superadmin/ajuda")
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <CircleHelp className="h-5 w-5 shrink-0" />
          {!collapsed && <span>Ajuda</span>}
        </button>
        <button
          onClick={signOut}
          title={collapsed ? "Sair" : undefined}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </>
  );
}

export function SuperAdminSidebarDesktop() {
  const { collapsed, toggle } = useAdminSidebar();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 hidden md:flex h-full flex-col border-r border-border bg-card transition-all duration-300 no-print",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <SidebarNav collapsed={collapsed} onCollapse={toggle} />
    </aside>
  );
}

export function SuperAdminSidebarMobile() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden h-9 w-9 shrink-0" aria-label="Abrir menu">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="p-0 w-72 flex flex-col">
        <SidebarNav collapsed={false} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
