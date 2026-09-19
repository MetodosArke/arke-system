import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Settings } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type ConfigRow = Tables<"plataforma_config">;

const CHAVES = ["taxa_processamento_percentual", "taxa_processamento_fixa"] as const;

export default function SuperAdminConfiguracoes() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [valores, setValores] = useState<Record<string, string>>({});

  const { data: config = [], isLoading } = useQuery({
    queryKey: ["plataforma-config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plataforma_config").select("*").in("chave", CHAVES);
      if (error) throw error;
      return data as ConfigRow[];
    },
  });

  useEffect(() => {
    if (config.length === 0) return;
    setValores((prev) => {
      const novo = { ...prev };
      for (const row of config) {
        if (novo[row.chave] === undefined) novo[row.chave] = String(row.valor);
      }
      return novo;
    });
  }, [config]);

  const salvar = useMutation({
    mutationFn: async () => {
      for (const chave of CHAVES) {
        const bruto = valores[chave];
        if (bruto === undefined) continue;
        const valor = Number(bruto.replace(",", "."));
        if (!Number.isFinite(valor) || valor < 0) throw new Error(`Valor inválido para ${chave}.`);
        const { error } = await supabase
          .from("plataforma_config")
          .update({ valor, updated_by: user?.id })
          .eq("chave", chave);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Configuração salva" });
      void queryClient.invalidateQueries({ queryKey: ["plataforma-config"] });
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  const taxaPercentual = config.find((c) => c.chave === "taxa_processamento_percentual");
  const taxaFixa = config.find((c) => c.chave === "taxa_processamento_fixa");

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Configurações da Plataforma</h1>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Taxa de processamento — mensalidade da academia</CardTitle>
          <CardDescription>
            Retida automaticamente via split no Asaas sobre cada mensalidade de plano próprio cobrada pela academia
            (independente do Método ARKE), cobrindo o custo de processamento do Asaas. Alterar aqui só vale para
            matrículas novas — assinaturas já criadas mantêm o split definido na hora da matrícula.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {!isLoading && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Percentual (%)</Label>
                  <Input
                    inputMode="decimal"
                    value={valores.taxa_processamento_percentual ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, taxa_processamento_percentual: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Valor fixo (R$)</Label>
                  <Input
                    inputMode="decimal"
                    value={valores.taxa_processamento_fixa ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, taxa_processamento_fixa: e.target.value }))}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Fórmula aplicada: repasse ARKE = (valor cobrado × percentual) + valor fixo. Atual:{" "}
                {taxaPercentual ? Number(taxaPercentual.valor).toString() : "—"}% + R${" "}
                {taxaFixa ? Number(taxaFixa.valor).toFixed(2) : "—"}.
              </p>
              <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
                {salvar.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
