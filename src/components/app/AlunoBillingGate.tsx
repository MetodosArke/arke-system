import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";

// Gate de adimplência do App do Aluno. Pergunta a `get_bloqueio_aluno`, que
// une dois sinais: o status que o webhook do Asaas gravou **e** a cobrança
// emitida cujo vencimento passou sem confirmação.
//
// A segunda metade é a que importa e é nova. Antes isto lia
// `aluno_assinaturas.status` direto, e esse campo só muda quando um webhook
// chega — um PAYMENT_OVERDUE perdido deixava a assinatura `ativa` para
// sempre e o aluno treinando de graça, sem ninguém notar. É o mesmo desenho
// que o lado B2B já usava em `get_bloqueio_organizacao`.
//
// Continua sendo gate de experiência, não fronteira de segurança: o que
// protege os dados é o RLS de cada tabela.
export function AlunoBillingGate({ children }: { children: React.ReactNode }) {
  const { alunoId, rolesLoaded } = useAuth();
  const queryClient = useQueryClient();

  const { data: assinatura, isFetching } = useQuery({
    queryKey: ["aluno-bloqueio", alunoId],
    queryFn: async () => {
      // Passa o aluno que o AuthContext já resolveu em vez de deixar o banco
      // redescobri-lo por user_id: quem é aluno de duas academias tem duas
      // linhas legítimas, e escolher uma delas no escuro é a armadilha do
      // vínculo duplo que já custou cinco defeitos neste projeto.
      const { data, error } = await supabase.rpc("get_bloqueio_aluno", { _aluno_id: alunoId! });
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: !!alunoId && rolesLoaded,
  });

  if (!assinatura?.bloqueado) {
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
          {assinatura.invoice_url ? (
            <Button className="w-full" size="lg" asChild>
              <a href={assinatura.invoice_url} target="_blank" rel="noreferrer">
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
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["aluno-bloqueio", alunoId] })}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> {isFetching ? "Verificando..." : "Já paguei, verificar novamente"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
