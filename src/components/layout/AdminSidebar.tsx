import { useState } from "react";
import { LayoutDashboard, Users, Building2, LogOut, ChevronLeft, Menu } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminSidebar } from "@/contexts/AdminSidebarContext";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const menuItems = [
  { icon: LayoutDashboard, label: "Minha Fila", path: "/admin" },
  { icon: Users, label: "Alunos", path: "/admin/alunos" },
  { icon: Building2, label: "Organização", path: "/admin/organizacao" },
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
          <h1
            className="text-lg font-bold tracking-wide text-primary"
            style={{ fontFamily: "'Cormorant Garamond', serif" }}
          >
            ARKE
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
          const isActive = location.pathname === item.path;
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

      <div className="border-t border-border p-2">
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

export function AdminSidebarDesktop() {
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

export function AdminSidebarMobile() {
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
