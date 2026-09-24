import { useEffect, useState } from "react";
import { CanaisSuporte, PrecosPlanosB2b } from "@/components/superadmin/ConfiguracoesComerciais";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Database, Settings } from "lucide-react";
import { useCapacidadeBanco } from "@/lib/rotinas";
import type { Tables } from "@/integrations/supabase/types";
import { decimal } from "@/lib/numeros";

type ConfigRow = Tables<"plataforma_config">;

const CHAVES = ["taxa_processamento_percentual", "taxa_processamento_fixa", "limite_banco_mb"] as const;

export default function SuperAdminConfiguracoes() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [valores, setValores] = useState<Record<string, string>>({});
  const { data: capacidade } = useCapacidadeBanco();

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
      void queryClient.invalidateQueries({ queryKey: ["superadmin-capacidade"] });
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
                {taxaFixa ? decimal(Number(taxaFixa.valor), 2) : "—"}.
              </p>
              <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
                {salvar.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" /> Capacidade do banco
          </CardTitle>
          <CardDescription>
            O alerta avisa por e-mail e na faixa da Visão Master quando o banco passa de 70% e de 85% deste limite. No
            plano gratuito do Supabase o limite é 500 MB, e acima dele o banco fica somente leitura — nenhuma academia
            grava nada. Depois do upgrade, informe aqui o disco contratado: o aviso passa a ser de custo, não de parada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5 max-w-xs">
            <Label htmlFor="limite-banco">Limite (MB)</Label>
            <Input
              id="limite-banco"
              inputMode="numeric"
              value={valores.limite_banco_mb ?? ""}
              onChange={(e) => setValores((v) => ({ ...v, limite_banco_mb: e.target.value }))}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Em uso agora: {capacidade ? capacidade.detalhe : "—"}.
          </p>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            {salvar.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </CardContent>
      </Card>

      <PrecosPlanosB2b />

      <CanaisSuporte />
    </div>
  );
}
