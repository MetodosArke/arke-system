import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AdminSidebarMobile } from "./AdminSidebar";
import { AppSidebarMobile } from "./AppSidebar";
import { useLocation, useNavigate } from "react-router-dom";

export function AppHeader({ title }: { title?: string }) {
  const { theme, toggleTheme } = useTheme();
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = location.pathname.startsWith("/admin");
  const isApp = location.pathname.startsWith("/app");

  const initials = profile?.full_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card/95 backdrop-blur-xl px-3 sm:px-4 py-3.5 sm:py-4 shadow-sm safe-top no-print">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {isAdmin && <AdminSidebarMobile />}
        {isApp && <AppSidebarMobile />}
        <button
          type="button"
          onClick={() => navigate(isAdmin ? "/admin/perfil" : "/app/perfil")}
          className="flex items-center gap-2 sm:gap-3 min-w-0 hover:opacity-80 transition-opacity text-left"
          aria-label="Abrir meu perfil"
        >
          <Avatar className="h-8 w-8 sm:h-9 sm:w-9 shrink-0">
            <AvatarImage src={profile?.avatar_url || undefined} />
            <AvatarFallback className="bg-primary text-primary-foreground text-xs sm:text-sm font-semibold">
              {initials || "AR"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            {title ? (
              <h1 className="text-base sm:text-lg font-bold truncate">{title}</h1>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Olá,</p>
                <p className="text-sm font-semibold truncate">
                  {profile?.full_name || "Bem-vindo"}
                </p>
              </>
            )}
          </div>
        </button>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-8 w-8 sm:h-9 sm:w-9">
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
  );
}
