import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export interface ReciboData {
  organizacaoNome: string;
  alunoNome: string;
  planoNome: string;
  valor: number;
  formaPagamento: string;
  data: string; // ISO
  statusPagamento: string;
  invoiceUrl: string | null;
}

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ReciboComprovanteDialog({
  open,
  onOpenChange,
  recibo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recibo: ReciboData | null;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    setQrDataUrl(null);
    if (!open || !recibo?.invoiceUrl) return;
    let cancelado = false;
    void (async () => {
      const QRCode = await import("qrcode");
      const dataUrl = await QRCode.toDataURL(recibo.invoiceUrl!, { margin: 1, width: 180 });
      if (!cancelado) setQrDataUrl(dataUrl);
    })();
    return () => {
      cancelado = true;
    };
  }, [open, recibo?.invoiceUrl]);

  if (!recibo) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="no-print">
          <DialogTitle>Comprovante de Matrícula</DialogTitle>
        </DialogHeader>

        <div className="print-area space-y-3 text-sm">
          <div className="text-center border-b border-border pb-3">
            <p className="text-lg font-bold">{recibo.organizacaoNome}</p>
            <p className="text-xs text-muted-foreground">Comprovante de Matrícula / Recibo</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Aluno</span>
              <span className="font-medium">{recibo.alunoNome}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plano</span>
              <span className="font-medium">{recibo.planoNome}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Valor</span>
              <span className="font-medium">{formatarMoeda(recibo.valor)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Forma de pagamento</span>
              <span className="font-medium">{recibo.formaPagamento}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium">{recibo.statusPagamento}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Data</span>
              <span className="font-medium">{new Date(recibo.data).toLocaleDateString("pt-BR")}</span>
            </div>
          </div>

          {recibo.invoiceUrl ? (
            <div className="flex flex-col items-center gap-1.5 border-t border-border pt-3">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="QR Code da fatura para quitação via Pix/Asaas" className="h-36 w-36" />
              ) : (
                <div className="h-36 w-36 animate-pulse rounded bg-muted" />
              )}
              <p className="text-[11px] text-muted-foreground text-center">
                Escaneie para quitar via Pix/Asaas
              </p>
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground border-t border-border pt-3">
              Sem pendência de pagamento no momento.
            </p>
          )}

          <p className="text-center text-[10px] text-muted-foreground pt-2">
            Documento gerado eletronicamente pela plataforma ArkeFit.
          </p>
        </div>

        <DialogFooter className="no-print">
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" /> Imprimir Recibo / Comprovante
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
