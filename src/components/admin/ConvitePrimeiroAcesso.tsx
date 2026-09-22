import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Copy, Download, QrCode, MessageCircle } from "lucide-react";

/**
 * Convite de primeiro acesso da academia: um link e um QR Code iguais para
 * todos os alunos — na recepção, no grupo de WhatsApp, no Instagram. Cada
 * aluno se ativa sozinho, em vez de a equipe mandar um link por aluno. O
 * botão individual de WhatsApp continua na lista, para quem ficou para trás.
 */
export function ConvitePrimeiroAcesso() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const link = organization ? `${window.location.origin}/#/p/${organization.slug}/primeiro-acesso` : "";

  useEffect(() => {
    if (!link) return;
    QRCode.toDataURL(link, { width: 512, margin: 2 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [link]);

  // Adesão ao app: quantos alunos já entraram pelo menos uma vez.
  const { data: adesao } = useQuery({
    queryKey: ["adesao-primeiro-acesso", organization?.id],
    queryFn: async () => {
      const [total, ativos] = await Promise.all([
        supabase.from("alunos").select("id", { count: "exact", head: true }).eq("organization_id", organization!.id).is("anonimizado_em", null),
        supabase
          .from("alunos")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organization!.id)
          .is("anonimizado_em", null)
          .not("primeiro_acesso_em", "is", null),
      ]);
      if (total.error) throw total.error;
      if (ativos.error) throw ativos.error;
      return { total: total.count ?? 0, ativos: ativos.count ?? 0 };
    },
    enabled: !!organization?.id,
  });

  if (!organization) return null;
  const pct = adesao && adesao.total > 0 ? Math.round((adesao.ativos / adesao.total) * 100) : 0;
  const textoWhatsApp = `Olá! Já dá para usar o app da ${organization.nome}. Abra o link, digite o e-mail ou o celular que você cadastrou na academia e crie a sua senha: ${link}`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <QrCode className="h-4 w-4 text-primary" /> Convite de primeiro acesso ao app
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col sm:flex-row gap-4">
        {qr && <img src={qr} alt="QR Code do primeiro acesso ao app" className="h-36 w-36 rounded border border-border self-center" />}
        <div className="flex-1 space-y-3 min-w-0">
          <p className="text-sm text-muted-foreground">
            Um link e um QR Code para todos os alunos. Cada um digita o e-mail ou o celular cadastrado e recebe o próprio link para criar a senha.
          </p>
          <p className="text-xs break-all rounded bg-muted px-2 py-1.5">{link}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => toast({ title: "Link copiado" }));
              }}
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copiar link
            </Button>
            {qr && (
              <Button size="sm" variant="outline" asChild>
                <a href={qr} download={`primeiro-acesso-${organization.slug}.png`}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Baixar QR Code
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <a href={`https://wa.me/?text=${encodeURIComponent(textoWhatsApp)}`} target="_blank" rel="noreferrer">
                <MessageCircle className="h-3.5 w-3.5 mr-1.5" /> Enviar no WhatsApp
              </a>
            </Button>
          </div>
          {adesao && adesao.total > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {adesao.ativos} de {adesao.total} alunos já entraram no app ({pct}%)
              </p>
              <Progress value={pct} className="h-1.5" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
