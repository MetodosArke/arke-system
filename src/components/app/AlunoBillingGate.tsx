import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";

// Gate de adimplência: bloqueia o acesso ao App do Aluno quando a
// assinatura está `atrasada` (webhook do Asaas — PAYMENT_OVERDUE) e
// direciona para a fatura pendente. Assim que o webhook confirma o
// pagamento (PAYMENT_RECEIVED/CONFIRMED), o status volta para `ativa`
// e o acesso é liberado no próximo refetch (foco da janela ou botão).
export function AlunoBillingGate({ children }: { children: React.ReactNode }) {
  const { alunoId, rolesLoaded } = useAuth();
  const queryClient = useQueryClient();

  const { data: assinatura, isFetching } = useQuery({
    queryKey: ["aluno-assinatura-status", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("aluno_assinaturas")
        .select("status, fatura_pendente_url")
        .eq("aluno_id", alunoId!)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId && rolesLoaded,
  });

  if (assinatura?.status !== "atrasada") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-amber-500/40">
        <CardHeader className="items-center text-center">
          <AlertTriangle className="h-10 w-10 text-amber-500 mb-2" />
          <CardTitle>Pagamento pendente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            Identificamos uma cobrança em atraso na sua assinatura. Regularize o pagamento para
            voltar a acessar seus treinos e sua dieta.
          </p>
          {assinatura.fatura_pendente_url ? (
            <Button className="w-full" size="lg" asChild>
              <a href={assinatura.fatura_pendente_url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" /> Ir para pagamento
              </a>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Fale com a sua academia para obter o link de pagamento atualizado.
            </p>
          )}
          <Button
            variant="outline"
            className="w-full"
            disabled={isFetching}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["aluno-assinatura-status", alunoId] })}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> {isFetching ? "Verificando..." : "Já paguei, verificar novamente"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
