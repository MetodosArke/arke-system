import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, Receipt } from "lucide-react";
import { hojeBrasilia } from "@/lib/dataBrasilia";
import { reais } from "@/lib/numeros";
import type { Enums } from "@/integrations/supabase/types";

type Status = Enums<"status_mensalidade">;

/** Uma cobrança da academia ao aluno: mensalidade do plano ou cobrança avulsa. */
export interface CobrancaDaAcademia {
  id: string;
  descricao: string;
  vencimento: string;
  valor: number;
  status: Status;
  invoice_url: string | null;
}

const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** O que o aluno precisa ler de uma cobrança em aberto: quando vence, ou quando venceu. */
export function prazo(m: Pick<CobrancaDaAcademia, "vencimento" | "status">, hoje: string): string {
  if (m.status === "atrasado" || m.vencimento < hoje) return `Venceu em ${dataCurta(m.vencimento)}`;
  if (m.vencimento === hoje) return "Vence hoje";
  return `Vence em ${dataCurta(m.vencimento)}`;
}

/**
 * O que o aluno deve à academia pelo ARKE, e o que já pagou: a mensalidade do
 * plano e as cobranças avulsas (taxa de matrícula, avaliação, personal...),
 * cada uma com o link da fatura.
 *
 * Até 24/09/2026 o app mostrava só a assinatura do Método ARKE — quem pagava
 * mensalidade pelo ARKE só achava o boleto no e-mail do Asaas, e "me manda a
 * segunda via" ia parar na recepção. Sem nada cobrado pelo ARKE (a academia
 * que cobra por fora), o cartão não aparece.
 */
export function PagamentosAcademia({ alunoId }: { alunoId: string }) {
  const { data: cobrancas } = useQuery({
    queryKey: ["pagamentos-academia", alunoId],
    queryFn: async () => {
      const [mensalidades, avulsas] = await Promise.all([
        supabase
          .from("mensalidades")
          .select("id, vencimento, valor, status, invoice_url")
          .eq("aluno_id", alunoId)
          .order("vencimento", { ascending: false })
          .limit(12),
        supabase
          .from("cobrancas_avulsas")
          .select("id, descricao, vencimento, valor, status, invoice_url")
          .eq("aluno_id", alunoId)
          .order("vencimento", { ascending: false })
          .limit(12),
      ]);
      if (mensalidades.error) throw mensalidades.error;
      if (avulsas.error) throw avulsas.error;
      return [
        ...(mensalidades.data ?? []).map((m) => ({ ...m, descricao: "Mensalidade" })),
        ...(avulsas.data ?? []),
      ] as CobrancaDaAcademia[];
    },
  });

  if (!cobrancas?.length) return null;

  const hoje = hojeBrasilia();
  // Dívida é só o que espera pagamento — mesma regra do bloqueio.
  const abertas = cobrancas
    .filter((m) => m.status === "pendente" || m.status === "atrasado")
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const pagas = cobrancas
    .filter((m) => m.status === "confirmado")
    .sort((a, b) => b.vencimento.localeCompare(a.vencimento))
    .slice(0, 3);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4 text-primary" /> Pagamentos da academia
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {abertas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada em aberto.</p>
        ) : (
          abertas.map((m) => {
            const vencida = m.status === "atrasado" || m.vencimento < hoje;
            return (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">
                    {m.descricao} · {reais(m.valor)}
                  </p>
                  <p className={`text-xs ${vencida ? "text-destructive" : "text-muted-foreground"}`}>{prazo(m, hoje)}</p>
                </div>
                {m.invoice_url ? (
                  <Button asChild size="sm" variant={vencida ? "default" : "outline"}>
                    <a href={m.invoice_url} target="_blank" rel="noopener noreferrer">
                      Pagar <ExternalLink className="ml-1 h-3.5 w-3.5" />
                    </a>
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Fatura sendo gerada</span>
                )}
              </div>
            );
          })
        )}
        {pagas.length > 0 && (
          <ul className="space-y-1">
            {pagas.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {m.descricao} · {dataCurta(m.vencimento)} · {reais(m.valor)}
                </span>
                <Badge variant="outline">Paga</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
