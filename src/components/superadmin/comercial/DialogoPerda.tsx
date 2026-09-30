import { useEffect, useState } from "react";
import { MOTIVOS_PERDA } from "@/lib/crmComercial";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * "Perdido" pede o motivo: é o que ensina o comercial, e o banco recusa perdido
 * sem motivo. Um toque nos motivos mais comuns, ou o texto livre.
 */
export function DialogoPerda({
  academia,
  aberto,
  salvando,
  onCancelar,
  onConfirmar,
}: {
  academia: string | null;
  aberto: boolean;
  salvando: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  useEffect(() => {
    if (aberto) setMotivo("");
  }, [aberto]);
  const pronto = motivo.trim().length >= 2;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onCancelar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Por que não fechou?</DialogTitle>
          <DialogDescription>{academia}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {MOTIVOS_PERDA.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMotivo(m)}
              aria-pressed={motivo === m}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                motivo === m ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:border-primary/40",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <Input
          aria-label="Motivo da perda"
          placeholder="Ou escreva o motivo"
          value={motivo}
          maxLength={300}
          onChange={(e) => setMotivo(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button disabled={!pronto || salvando} onClick={() => onConfirmar(motivo.trim())}>
            Marcar como perdido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
