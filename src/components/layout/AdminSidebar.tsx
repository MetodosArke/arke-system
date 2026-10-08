import { useState } from "react";
import { LogOut, ChevronLeft, Menu, CircleHelp } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminSidebar } from "@/contexts/AdminSidebarContext";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useCaixaMensagens } from "@/hooks/useCaixaMensagens";
import { MarcaArkeFit } from "@/components/marca/MarcaArkeFit";
import { podePrescrever } from "@/lib/prescricaoPermitida";
import { buildSections, buildSectionsProfissionalAutonomo } from "@/lib/menuPainel";
import { menuNoModoEssencial } from "@/lib/modoEssencial";
import { useModoEssencial } from "@/contexts/ModoEssencialContext";

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
  const { signOut, hasRole, organizationRole, organization } = useAuth();
  const { naoLidas } = useCaixaMensagens();
  const isAdminArke = hasRole("admin_arke");
  const podeGerenciarEquipe = isAdminArke || organizationRole === "gestor";
  const ehProfissionalAutonomo = organization?.tipo === "profissional_autonomo";
  const ehStudio = organization?.tipo === "studio";
  const contextoPrescricao = {
    tipoOrganizacao: organization?.tipo,
    especialidade: organization?.especialidadeProfissional,
    papel: organizationRole,
    adminArke: isAdminArke,
  };
  const podePrescreverTreino = podePrescrever("treino", contextoPrescricao);
  const podePrescreverDieta = podePrescrever("dieta", contextoPrescricao);
  const menuCompleto = ehProfissionalAutonomo
    ? buildSectionsProfissionalAutonomo({ podePrescreverTreino, podePrescreverDieta, ehDono: organizationRole === "gestor" })
    : buildSections({
        ehStudio,
        podeGerenciarEquipe,
        podePrescreverTreino,
        podePrescreverDieta,
        alunosLabel: "Alunos & Prescrições",
      });
  // Modo essencial (a recepção da academia com a mensalidade B2B bloqueada):
  // o item pausado sai do menu, e o nome dele vai para a nota no fim.
  const modoEssencial = useModoEssencial();
  const { secoes: sections, pausados } = modoEssencial
    ? menuNoModoEssencial(menuCompleto)
    : { secoes: menuCompleto, pausados: [] as string[] };

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
        {sections.map((section) => (
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
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <span className="relative shrink-0">
                    <item.icon className="h-5 w-5" />
                    {item.path === "/admin/mensagens" && naoLidas > 0 && collapsed && (
                      <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-destructive" aria-hidden />
                    )}
                  </span>
                  {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
                  {!collapsed && item.path === "/admin/mensagens" && naoLidas > 0 && (
                    <span
                      className="rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 min-w-[1.25rem] text-center"
                      aria-label={`${naoLidas} mensagens não lidas`}
                    >
                      {naoLidas > 99 ? "99+" : naoLidas}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {!collapsed && pausados.length > 0 && (
          <p className="px-3 pt-1 text-xs text-muted-foreground">
            Pausados enquanto a assinatura da academia estiver pendente:{" "}
            {pausados.length === 1 ? pausados[0] : `${pausados.slice(0, -1).join(", ")} e ${pausados[pausados.length - 1]}`}.
          </p>
        )}
      </nav>

      <div className="border-t border-border p-2 space-y-1">
        <button
          onClick={() => handleNav("/admin/ajuda")}
          title={collapsed ? "Ajuda" : undefined}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            location.pathname.startsWith("/admin/ajuda")
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <CircleHelp className="h-5 w-5 shrink-0" />
          {!collapsed && <span>Ajuda</span>}
        </button>
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
