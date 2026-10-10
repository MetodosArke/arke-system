import { useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushContext } from "@/components/PushNotificationManager";
import { emPerfilSimulado } from "@/lib/impersonation";

/**
 * O convite para ligar os avisos no celular, embaixo de cada conversa.
 *
 * O navegador só pede a permissão a partir de um toque da pessoa, e até
 * 10/10/2026 nenhuma tela pedia: o aviso de mensagem nova existia, mas só
 * chegava a quem tinha liberado as notificações do site por conta própria.
 * Aparece só enquanto a pessoa não respondeu ao navegador; quem negou muda
 * nas configurações do aparelho (artigo da Central). No iPhone, só com o app
 * na tela de início, que é quando o navegador oferece o push.
 */
export function AtivarAvisosCelular() {
  const { pushStatus, requestPushPermission, isSupported } = usePushContext();
  const [pedindo, setPedindo] = useState(false);
  if (!isSupported || pushStatus !== "idle" || emPerfilSimulado()) return null;

  return (
    <div className="flex items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
      <span>Receba no celular o aviso de mensagem nova.</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pedindo}
        onClick={() => {
          setPedindo(true);
          void requestPushPermission().finally(() => setPedindo(false));
        }}
      >
        <Bell className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Ativar avisos
      </Button>
    </div>
  );
}
