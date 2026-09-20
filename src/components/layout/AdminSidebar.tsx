import { useState } from "react";
import { Home, Users, UsersRound, Building2, LogOut, ChevronLeft, Menu, ClipboardList, UserCircle, BarChart3, DoorOpen, CalendarDays, Dumbbell, UtensilsCrossed, Sparkles, DollarSign, Plug } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminSidebar } from "@/contexts/AdminSidebarContext";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

type MenuItem = { icon: typeof Home; label: string; path: string };
type MenuSection = { label: string; items: MenuItem[] };

// Menu lateral reorganizado em 3 blocos claros. "Onboarding" não tem mais
// item fixo — só é alcançado pelo banner na Home ou em Organização.
// Studio: turmas de horário fixo e capacidade limitada — Agenda só faz
// sentido para esse tipo de negócio. Configurações (Organização, Catracas)
// e Inteligência (Gestão 360°, Equipe) são assuntos de gestão da unidade —
// só aparecem para quem pode gerenciar a equipe (gestor/admin_arke); o
// painel de professor e de nutricionista fica restrito ao escopo deles
// (atendimento, alunos e a prescrição do que cada um prescreve).
function buildSections({
  ehStudio,
  podeGerenciarEquipe,
  podePrescreverTreino,
  podePrescreverDieta,
  alunosLabel,
}: {
  ehStudio: boolean;
  podeGerenciarEquipe: boolean;
  podePrescreverTreino: boolean;
  podePrescreverDieta: boolean;
  alunosLabel: string;
}): MenuSection[] {
  const operacao: MenuItem[] = [
    { icon: Home, label: "Home (Início)", path: "/admin/dashboard" },
    { icon: ClipboardList, label: "Atendimento (Fila)", path: "/admin" },
    { icon: Users, label: alunosLabel, path: "/admin/alunos" },
  ];
  if (podePrescreverTreino) {
    // Acervo de Exercícios virou uma aba dentro de Prescrever Treinos.
    operacao.push({ icon: Dumbbell, label: "Prescrever Treinos", path: "/admin/treinos" });
  }
  if (podePrescreverDieta) {
    operacao.push({ icon: UtensilsCrossed, label: "Prescrever Dietas", path: "/admin/dietas" });
  }
  if (ehStudio) {
    operacao.push({ icon: CalendarDays, label: "Agenda", path: "/admin/agenda" });
  }
  // Desafios + Competições + Feed viraram abas dentro de Engajamento.
  operacao.push({ icon: Sparkles, label: "Engajamento", path: "/admin/engajamento" });

  const sections: MenuSection[] = [{ label: "Operação", items: operacao }];

  if (podeGerenciarEquipe) {
    sections.push({
      label: "Inteligência",
      items: [
        { icon: BarChart3, label: "Gestão 360°", path: "/admin/gestao-360" },
        { icon: UsersRound, label: "Equipe", path: "/admin/equipe" },
        // Comissões virou uma aba dentro de Financeiro.
        { icon: DollarSign, label: "Financeiro", path: "/admin/financeiro" },
      ],
    });
    sections.push({
      label: "Configurações",
      items: [
        // Planos da Academia virou uma aba dentro de Organização.
        { icon: Building2, label: "Organização", path: "/admin/organizacao" },
        { icon: DoorOpen, label: "Catracas", path: "/admin/catracas" },
        { icon: Plug, label: "Integrações", path: "/admin/configuracoes/integracoes" },
      ],
    });
  }

  return sections;
}

// Personal/nutricionista autônomo: carteira própria de alunos, sem
// estrutura física de academia — sem Catracas, Organização (slug/split de
// academia), Equipe nem Gestão 360°/Onboarding B2B. A prescrição disponível
// segue a especialidade de quem contratou (treino ou dieta, nunca as duas).
function buildSectionsProfissionalAutonomo({
  podePrescreverTreino,
  podePrescreverDieta,
}: {
  podePrescreverTreino: boolean;
  podePrescreverDieta: boolean;
}): MenuSection[] {
  const operacao: MenuItem[] = [
    { icon: Home, label: "Home (Início)", path: "/admin/dashboard" },
    { icon: ClipboardList, label: "Atendimento (Fila)", path: "/admin" },
    { icon: Users, label: "Meus Alunos", path: "/admin/alunos" },
  ];
  if (podePrescreverTreino) {
    operacao.push({ icon: Dumbbell, label: "Prescrever Treinos", path: "/admin/treinos" });
  }
  if (podePrescreverDieta) {
    operacao.push({ icon: UtensilsCrossed, label: "Prescrever Dietas", path: "/admin/dietas" });
  }
  return [{ label: "Operação", items: operacao }];
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
  const { signOut, hasRole, organizationRole, organization } = useAuth();
  const isAdminArke = hasRole("admin_arke");
  const podeGerenciarEquipe = isAdminArke || organizationRole === "gestor";
  const ehProfissionalAutonomo = organization?.tipo === "profissional_autonomo";
  const ehStudio = organization?.tipo === "studio";
  const especialidade = organization?.especialidadeProfissional;
  const podePrescreverTreino = ehProfissionalAutonomo
    ? especialidade !== "nutricionista"
    : isAdminArke || organizationRole === "gestor" || organizationRole === "professor";
  const podePrescreverDieta = ehProfissionalAutonomo
    ? especialidade === "nutricionista"
    : isAdminArke || organizationRole === "gestor" || organizationRole === "nutricionista";
  const sections = ehProfissionalAutonomo
    ? buildSectionsProfissionalAutonomo({ podePrescreverTreino, podePrescreverDieta })
    : buildSections({
        ehStudio,
        podeGerenciarEquipe,
        podePrescreverTreino,
        podePrescreverDieta,
        alunosLabel: "Alunos & Prescrições",
      });

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
            ArkeFit
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
                  <item.icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-2 space-y-1">
        {isAdminArke && (
          <button
            onClick={() => handleNav("/app")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Alternar para a visão do aluno (testes de homologação)"
          >
            <UserCircle className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Visão do Aluno</span>}
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
