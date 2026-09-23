import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dividirCobranca, type RepasseConfig, type TaxaProcessamento } from "@/lib/repasse";

/**
 * Quanto a ArkeFit retém de cada aluno no Método, negociado academia a academia.
 *
 * Antes era um custo por nível igual para todo mundo (Integrado R$ 45, Elite
 * R$ 85), o que não permitia contrato a contrato — e o modelo comercial novo
 * negocia cada academia pelo porte e pelo ticket médio dela.
 *
 * Só a ArkeFit configura: `trg_proteger_colunas_organizacao` recusa a
 * alteração vinda do gestor, que de outro modo se daria retenção zero pela
 * política de UPDATE da própria organização.
 *
 * **O valor é o líquido desejado.** A taxa do gateway é somada por cima, na
 * parte da academia, porque ela recebe valor fixo no split e o que o Asaas
 * desconta sai do que sobra.
 */
export function RepasseOrganizacao({ organizationId }: { organizationId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<RepasseConfig["tipo"]>("fixo");
  const [valor, setValor] = useState("");
  // Varejo de referência só para a prévia — não é gravado em lugar nenhum.
  const [simulado, setSimulado] = useState("119");

  const { data: config } = useQuery({
    queryKey: ["repasse-config", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("repasse_tipo, repasse_valor")
        .eq("id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: taxa } = useQuery({
    queryKey: ["taxa-processamento-config"],
    queryFn: async (): Promise<TaxaProcessamento> => {
      const { data, error } = await supabase.rpc("arke_taxa_processamento_config");
      if (error) throw error;
      const linha = data?.[0];
      return { percentual: Number(linha?.percentual ?? 0), fixa: Number(linha?.fixa ?? 0) };
    },
  });

  useEffect(() => {
    if (!config) return;
    setTipo((config.repasse_tipo as RepasseConfig["tipo"]) ?? "fixo");
    setValor(config.repasse_valor === null || config.repasse_valor === undefined ? "" : String(config.repasse_valor));
  }, [config]);

  const numero = Number(valor.replace(",", "."));
  const valido = valor.trim() !== "" && Number.isFinite(numero) && numero >= 0 && (tipo !== "percentual" || numero <= 100);

  const previa = dividirCobranca(
    Number(simulado.replace(",", ".")) || 0,
    { tipo, valor: valido ? numero : null },
    taxa ?? { percentual: 0, fixa: 0 }
  );

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("organizations")
        .update({ repasse_tipo: tipo, repasse_valor: numero })
        .eq("id", organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Repasse atualizado",
        description: "Vale para assinaturas novas. As existentes seguem com o repasse travado na criação.",
      });
      void queryClient.invalidateQueries({ queryKey: ["repasse-config", organizationId] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const naoNegociado = config?.repasse_valor === null || config?.repasse_valor === undefined;

  return (
    <div className="space-y-3">
      {naoNegociado && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
          Sem repasse negociado: a cobrança do Método nesta academia é recusada até configurar aqui.
        </p>
      )}

      <div className="flex gap-2">
        <div className="w-36 space-y-1">
          <Label className="text-xs">Tipo</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as RepasseConfig["tipo"])}>
            <SelectTrigger aria-label="Tipo de repasse">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixo">Valor fixo</SelectItem>
              <SelectItem value="percentual">Percentual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 space-y-1">
          <Label htmlFor="repasse-valor" className="text-xs">
            {tipo === "percentual" ? "Percentual retido (%)" : "Valor retido por aluno (R$)"}
          </Label>
          <Input
            id="repasse-valor"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder={tipo === "percentual" ? "30" : "49,00"}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="repasse-simulado" className="text-xs">
          Prévia com um varejo de (R$)
        </Label>
        <Input
          id="repasse-simulado"
          inputMode="decimal"
          value={simulado}
          onChange={(e) => setSimulado(e.target.value)}
          className="w-32"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {previa.semRepasseNegociado
          ? "Informe o valor para ver a divisão."
          : !previa.cobreORepasse
            ? `Este varejo não cobre o repasse de R$ ${previa.repasseArke!.toFixed(2)} — a cobrança seria recusada.`
            : `ArkeFit fica com R$ ${previa.repasseArke!.toFixed(2)} (negociado R$ ${(
                previa.repasseArke! - previa.taxaEstimada
              ).toFixed(2)} + taxa R$ ${previa.taxaEstimada.toFixed(2)}) · academia recebe R$ ${previa.liquidoAcademia!.toFixed(2)}`}
      </p>

      <Button size="sm" disabled={!valido || salvar.isPending} onClick={() => salvar.mutate()}>
        Salvar repasse
      </Button>
    </div>
  );
}
