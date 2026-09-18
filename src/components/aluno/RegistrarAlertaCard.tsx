import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HeartPulse, RouteOff, AlertTriangle } from "lucide-react";
import { AlertaSlaDialog } from "@/components/aluno/AlertaSlaDialog";
import type { TipoAlertaSla } from "@/hooks/useAlertaSla";

export function RegistrarAlertaCard({ compact = false }: { compact?: boolean }) {
  const [tipoAberto, setTipoAberto] = useState<TipoAlertaSla | null>(null);

  return (
    <>
      <Card>
        {!compact && (
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-primary" /> Registrar Alerta
            </CardTitle>
          </CardHeader>
        )}
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setTipoAberto("dor")}>
            <HeartPulse className="mr-2 h-4 w-4" /> Senti Dor/Desconforto
          </Button>
          <Button variant="outline" onClick={() => setTipoAberto("barreira")}>
            <RouteOff className="mr-2 h-4 w-4" /> Tive Problema de Rotina
          </Button>
        </CardContent>
      </Card>

      <AlertaSlaDialog open={!!tipoAberto} onOpenChange={(open) => !open && setTipoAberto(null)} tipo={tipoAberto} />
    </>
  );
}
