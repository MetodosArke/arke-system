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

export interface Mensalidade {
  id: string;
  vencimento: string;
  valor: number;
  status: Status;
  invoice_url: string | null;
  data_pagamento: string | null;
}

const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** O que o aluno precisa ler de uma mensalidade em aberto: quando vence, ou quando venceu. */
export function prazo(m: Pick<Mensalidade, "vencimento" | "status">, hoje: string): string {
  if (m.status === "atrasado" || m.vencimento < hoje) return `Venceu em ${dataCurta(m.vencimento)}`;
  if (m.vencimento === hoje) return "Vence hoje";
  return `Vence em ${dataCurta(m.vencimento)}`;
}

/**
 * A mensalidade da academia vista pelo aluno: a que está em aberto, com o link
 * da fatura, e as últimas pagas.
 *
 * Até 24/09/2026 o app mostrava só a assinatura do Método ARKE — quem pagava
 * mensalidade pelo ARKE só achava o boleto no e-mail do Asaas, e "me manda a
 * segunda via" ia parar na recepção. Sem mensalidade cobrada pelo ARKE (a
 * academia que cobra por fora), o cartão não aparece.
 */
export function MinhasMensalidades({ alunoId }: { alunoId: string }) {
  const { data: mensalidades } = useQuery({
    queryKey: ["minhas-mensalidades", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mensalidades")
        .select("id, vencimento, valor, status, invoice_url, data_pagamento")
        .eq("aluno_id", alunoId)
        .order("vencimento", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as Mensalidade[];
    },
  });

  if (!mensalidades?.length) return null;

  const hoje = hojeBrasilia();
  // Dívida é só o que espera pagamento — mesma regra do bloqueio.
  const abertas = mensalidades
    .filter((m) => m.status === "pendente" || m.status === "atrasado")
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const pagas = mensalidades.filter((m) => m.status === "confirmado").slice(0, 3);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4 text-primary" /> Mensalidade da academia
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {abertas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma mensalidade em aberto.</p>
        ) : (
          abertas.map((m) => {
            const vencida = m.status === "atrasado" || m.vencimento < hoje;
            return (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">{reais(m.valor)}</p>
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
                  {dataCurta(m.vencimento)} · {reais(m.valor)}
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
