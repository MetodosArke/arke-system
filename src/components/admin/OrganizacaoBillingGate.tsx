import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink, RefreshCw, LogOut } from "lucide-react";

// Gate de adimplência B2B: bloqueia a EQUIPE da academia (gestor, professor,
// nutricionista) quando há cobrança da ARKE emitida e vencida sem
// confirmação de pagamento.
//
// O que este gate deliberadamente NÃO faz:
//   - não bloqueia os alunos da academia. O contrato B2B é com a academia, e
//     o aluno que pagou a mensalidade dele não deu causa ao atraso. A
//     inadimplência do aluno é tratada pelo AlunoBillingGate, à parte.
//   - não bloqueia Super Admin nem Admin ARKE: são eles que resolvem a
//     cobrança, e trancá-los junto tornaria o problema insolúvel pelo produto.
//   - não bloqueia organização em `trial`, que é ferramenta de homologação do
//     Super Admin e não cliente comercial.
//
// Toda essa regra mora em get_bloqueio_organizacao() — aqui só se desenha o
// resultado. Este é um gate de experiência, não uma fronteira de segurança:
// o que protege os dados continua sendo o RLS de cada tabela.
export function OrganizacaoBillingGate({ children }: { children: React.ReactNode }) {
  const { rolesLoaded, signOut } = useAuth();
  const queryClient = useQueryClient();

  const { data: bloqueio, isFetching } = useQuery({
    queryKey: ["bloqueio-organizacao"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_bloqueio_organizacao");
      if (error) throw error;
      // Sem linha = isento (ARKE, ou quem não é equipe de nenhuma academia).
      return (data ?? [])[0] ?? null;
    },
    enabled: rolesLoaded,
  });

  if (!bloqueio?.bloqueada) {
    return <>{children}</>;
  }

  const valor = Number(bloqueio.valor_em_aberto).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const vencimento = bloqueio.vencimento_mais_antigo
    ? new Date(`${bloqueio.vencimento_mais_antigo}T00:00:00`).toLocaleDateString("pt-BR")
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-destructive/40">
        <CardHeader className="items-center text-center">
          <AlertTriangle className="h-10 w-10 text-destructive mb-2" />
          <CardTitle>Acesso suspenso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            O painel de <span className="font-medium text-foreground">{bloqueio.organizacao_nome}</span> está
            temporariamente suspenso por pendência financeira com a ArkeFit.
          </p>

          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p>
              {Number(bloqueio.cobrancas_vencidas) === 1 ? "1 cobrança vencida" : `${bloqueio.cobrancas_vencidas} cobranças vencidas`}
              {" · "}
              <span className="font-semibold">{valor}</span>
            </p>
            {vencimento && (
              <p className="text-xs text-muted-foreground mt-0.5">Vencimento mais antigo: {vencimento}</p>
            )}
          </div>

          {/* O aluno continua treinando — dizer isso evita que o gestor ache
              que a academia inteira parou e ligue para o suporte por engano. */}
          <p className="text-xs text-muted-foreground">
            Seus alunos seguem com acesso normal ao aplicativo. A suspensão vale apenas para o painel da equipe.
          </p>

          {bloqueio.invoice_url ? (
            <Button className="w-full" size="lg" asChild>
              <a href={bloqueio.invoice_url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" /> Regularizar pagamento
              </a>
            </Button>
          ) : (
            <p className="text-sm">
              Entre em contato com o suporte ArkeFit para regularizar e liberar o acesso.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Já regularizou ou acredita que isto é um engano? Fale com o suporte ArkeFit.
          </p>

          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="w-full"
              disabled={isFetching}
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["bloqueio-organizacao"] })}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {isFetching ? "Verificando..." : "Já paguei, verificar novamente"}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => void signOut()}>
              <LogOut className="mr-2 h-4 w-4" /> Sair
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
