import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { HeartPulse, RouteOff } from "lucide-react";
import { useAlertaSla, type TipoAlertaSla } from "@/hooks/useAlertaSla";

const TIPO_CONFIG: Record<TipoAlertaSla, { titulo: string; placeholder: string; icon: typeof HeartPulse }> = {
  dor: {
    titulo: "Senti Dor/Desconforto",
    placeholder: "Onde sentiu e em qual exercício ou momento?",
    icon: HeartPulse,
  },
  barreira: {
    titulo: "Tive Problema de Rotina",
    placeholder: "O que aconteceu? Ex.: viagem, imprevisto no trabalho...",
    icon: RouteOff,
  },
};

export function AlertaSlaDialog({
  open,
  onOpenChange,
  tipo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipo: TipoAlertaSla | null;
}) {
  const [descricao, setDescricao] = useState("");
  const alertaSla = useAlertaSla();
  const config = tipo ? TIPO_CONFIG[tipo] : null;

  const enviar = () => {
    if (!tipo) return;
    alertaSla.mutate(
      { tipo, descricao },
      {
        onSuccess: () => {
          setDescricao("");
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setDescricao(""); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {config && <config.icon className="h-4 w-4 text-primary" />}
            {config?.titulo ?? "Registrar alerta"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="alerta-descricao">Conte pra gente o que houve</Label>
          <Textarea
            id="alerta-descricao"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder={config?.placeholder}
          />
        </div>
        <DialogFooter>
          <Button disabled={!descricao.trim() || alertaSla.isPending} onClick={enviar}>
            {alertaSla.isPending ? "Enviando..." : "Enviar alerta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
