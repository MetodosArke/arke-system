import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Maximize2, QrCode } from "lucide-react";
import { hojeBrasilia } from "@/lib/dataBrasilia";

/**
 * Tela de check-in da recepção: um QR que o aluno escaneia com a câmera do
 * celular para registrar a presença. O código muda a cada 10 minutos (a tela
 * se atualiza sozinha), então uma foto do QR não serve de casa. É a frequência
 * de quem não tem catraca — a maioria das academias pequenas.
 */
export default function AdminCheckinQr() {
  const { organization } = useAuth();
  const [qr, setQr] = useState<string | null>(null);

  const { data: codigo, refetch } = useQuery({
    queryKey: ["codigo-checkin", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("codigo_checkin_atual", { _organization_id: organization!.id });
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: !!organization?.id,
  });

  const { data: presencasHoje = 0 } = useQuery({
    queryKey: ["presencas-hoje", organization?.id],
    queryFn: async () => {
      const hoje = hojeBrasilia();
      const { count, error } = await supabase
        .from("presencas")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization!.id)
        .eq("dia", hoje);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organization?.id,
    refetchInterval: 30_000,
  });

  // Troca o QR quando a janela de 10 minutos vira.
  useEffect(() => {
    if (!codigo) return;
    const t = setTimeout(() => void refetch(), (codigo.segundos_restantes + 1) * 1000);
    return () => clearTimeout(t);
  }, [codigo, refetch]);

  useEffect(() => {
    if (!codigo || !organization) return;
    const url = `${window.location.origin}/#/checkin?o=${organization.id}&c=${codigo.codigo}`;
    QRCode.toDataURL(url, { width: 640, margin: 2 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [codigo, organization]);

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Check-in por QR Code</h1>
        </div>
        <Button size="sm" variant="outline" onClick={() => void document.documentElement.requestFullscreen?.()}>
          <Maximize2 className="h-4 w-4 mr-1.5" /> Tela cheia
        </Button>
      </div>
      <Card>
        <CardContent className="py-6 flex flex-col items-center gap-3 text-center">
          <p className="text-lg font-semibold">{organization?.nome}</p>
          <p className="text-sm text-muted-foreground">Aponte a câmera do celular para registrar sua presença</p>
          {qr ? <img src={qr} alt="QR Code de check-in" className="w-72 h-72 sm:w-96 sm:h-96" /> : <div className="w-72 h-72" />}
          <p className="text-xs text-muted-foreground">O código muda a cada 10 minutos · {presencasHoje} presença(s) hoje</p>
        </CardContent>
      </Card>
    </div>
  );
}
