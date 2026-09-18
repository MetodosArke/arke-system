import { useEffect, useState } from "react";
import { UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getImpersonationBackup, stopImpersonation } from "@/lib/impersonation";

// Mostrado em qualquer tela enquanto um admin_arke/gestor está "simulando"
// outro perfil (ver src/lib/impersonation.ts), para deixar claro que a
// sessão atual não é a do próprio administrador e permitir voltar.
export function ImpersonationBanner() {
  const [backup, setBackup] = useState(() => getImpersonationBackup());

  useEffect(() => {
    setBackup(getImpersonationBackup());
  }, []);

  if (!backup) return null;

  const handleVoltar = async () => {
    await stopImpersonation();
    // "/" (não "/admin" fixo): a sessão original é restaurada e o
    // RootRedirect decide a rota certa a partir dos papéis reais de quem
    // voltou — inclusive superadmin, que precisa ir para /superadmin, não
    // para /admin.
    window.location.assign("/#/");
    window.location.reload();
  };

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 no-print">
      <span className="flex items-center gap-2">
        <UserCog className="h-4 w-4 shrink-0" />
        Modo simulação: visualizando como {backup.impersonating_email}
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 shrink-0 bg-amber-950 text-amber-50 hover:bg-amber-900"
        onClick={() => void handleVoltar()}
      >
        Voltar para Admin
      </Button>
    </div>
  );
}
