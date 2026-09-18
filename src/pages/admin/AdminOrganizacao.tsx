import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Building2, Wallet } from "lucide-react";
import type { Enums, Tables } from "@/integrations/supabase/types";

type Nivel = Enums<"nivel_atacado">;

const NIVEIS: { value: Nivel; label: string }[] = [
  { value: "essencial", label: "Essencial" },
  { value: "integrado", label: "Integrado" },
  { value: "elite", label: "Elite" },
];

const EMPTY_PRECIFICACAO: Tables<"organization_planos_precificacao">[] = [];
const EMPTY_PLANOS_ATACADO: Tables<"planos_atacado">[] = [];

export default function AdminOrganizacao() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: planosAtacado = EMPTY_PLANOS_ATACADO } = useQuery({
    queryKey: ["planos-atacado"],
    queryFn: async () => {
      const { data, error } = await supabase.from("planos_atacado").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: precificacao = EMPTY_PRECIFICACAO } = useQuery({
    queryKey: ["precificacao", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_planos_precificacao")
        .select("*")
        .eq("organization_id", organization!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const [valores, setValores] = useState<Record<Nivel, string>>({ essencial: "", integrado: "", elite: "" });

  useEffect(() => {
    const next: Record<Nivel, string> = { essencial: "", integrado: "", elite: "" };
    precificacao.forEach((p) => {
      next[p.nivel_atacado] = String(p.valor_varejo);
    });
    setValores((prev) => ({ ...prev, ...next }));
  }, [precificacao]);

  const { data: orgDetalhes } = useQuery({
    queryKey: ["organizacao-wallet", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("asaas_wallet_id")
        .eq("id", organization!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const [walletId, setWalletId] = useState("");

  useEffect(() => {
    setWalletId(orgDetalhes?.asaas_wallet_id ?? "");
  }, [orgDetalhes]);

  const salvarWallet = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("organizations")
        .update({ asaas_wallet_id: walletId || null })
        .eq("id", organization!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Wallet do Asaas salva" });
      void queryClient.invalidateQueries({ queryKey: ["organizacao-wallet", organization?.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    },
  });

  const salvar = useMutation({
    mutationFn: async (nivel: Nivel) => {
      const custo = planosAtacado.find((p) => p.id === nivel)?.custo_mensal ?? 0;
      const valorVarejo = Number(valores[nivel] || 0);
      const markupPct = custo > 0 ? ((valorVarejo - custo) / custo) * 100 : 0;

      const { error } = await supabase
        .from("organization_planos_precificacao")
        .upsert(
          {
            organization_id: organization!.id,
            nivel_atacado: nivel,
            valor_varejo: valorVarejo,
            markup_pct: markupPct,
          },
          { onConflict: "organization_id,nivel_atacado" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Preço atualizado" });
      void queryClient.invalidateQueries({ queryKey: ["precificacao", organization?.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">{organization?.nome ?? "Organização"}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Precificação de varejo (markup sobre o atacado ARKE)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {NIVEIS.map(({ value, label }) => {
            const plano = planosAtacado.find((p) => p.id === value);
            return (
              <div key={value} className="flex items-end gap-3">
                <div className="flex-1">
                  <Label htmlFor={`valor-${value}`}>
                    {label}{" "}
                    {plano != null && (
                      <span className="text-muted-foreground">
                        (custo atacado R$ {plano.custo_mensal} · sugestão ARKE R$ {plano.valor_sugerido_varejo})
                      </span>
                    )}
                  </Label>
                  <Input
                    id={`valor-${value}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={valores[value]}
                    onChange={(e) => setValores((prev) => ({ ...prev, [value]: e.target.value }))}
                    placeholder="Valor de varejo (R$)"
                  />
                </div>
                <Button onClick={() => salvar.mutate(value)} disabled={salvar.isPending}>
                  Salvar
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Split de Pagamento (Asaas)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Wallet ID da academia no Asaas — usada para receber automaticamente a parte líquida de cada
            cobrança (o repasse de atacado à ARKE é retido na origem).
          </p>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="wallet-id">Wallet ID do Asaas</Label>
            <Input
              id="wallet-id"
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              placeholder="ex.: 22e49670-27e4-4579-a4f4-0dfd42b2e-000"
            />
          </div>
          <Button onClick={() => salvarWallet.mutate()} disabled={salvarWallet.isPending}>
            Salvar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
