import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Building2 } from "lucide-react";
import type { Enums } from "@/integrations/supabase/types";

type Nivel = Enums<"nivel_atacado">;

const NIVEIS: { value: Nivel; label: string }[] = [
  { value: "essencial", label: "Essencial" },
  { value: "integrado", label: "Integrado" },
  { value: "integral", label: "Integral" },
];

export default function AdminOrganizacao() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: planosAtacado = [] } = useQuery({
    queryKey: ["planos-atacado"],
    queryFn: async () => {
      const { data, error } = await supabase.from("planos_atacado").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: precificacao = [] } = useQuery({
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

  const [valores, setValores] = useState<Record<Nivel, string>>({ essencial: "", integrado: "", integral: "" });

  useEffect(() => {
    const next: Record<Nivel, string> = { essencial: "", integrado: "", integral: "" };
    precificacao.forEach((p) => {
      next[p.nivel_atacado] = String(p.valor_varejo);
    });
    setValores((prev) => ({ ...prev, ...next }));
  }, [precificacao]);

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
            const custo = planosAtacado.find((p) => p.id === value)?.custo_mensal;
            return (
              <div key={value} className="flex items-end gap-3">
                <div className="flex-1">
                  <Label htmlFor={`valor-${value}`}>
                    {label} {custo != null && <span className="text-muted-foreground">(custo atacado R$ {custo})</span>}
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
    </div>
  );
}
