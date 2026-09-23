import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dividirCobranca, resolverRepasse, type RepasseConfig, type TaxaProcessamento } from "@/lib/repasse";

/** Os níveis pagos do Método. Free não tem cobrança, então não tem repasse. */
const NIVEIS: { id: string; rotulo: string; varejoRef: number }[] = [
  { id: "integrado", rotulo: "Integrado", varejoRef: 119 },
  { id: "elite", rotulo: "Elite", varejoRef: 199 },
];

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

      <ExcecoesPorNivel
        organizationId={organizationId}
        padrao={{ tipo, valor: valido ? numero : null }}
        taxa={taxa ?? { percentual: 0, fixa: 0 }}
      />
    </div>
  );
}

/**
 * Exceção por nível, dentro da academia.
 *
 * Integrado e Elite custam coisas diferentes de servir — Elite entrega
 * acolhimento expandido, encontros periódicos e fila prioritária, que no
 * Mentor Centralizado é tempo de gente. Deixar os dois no mesmo repasse seria
 * um retrocesso: antes da negociação por academia eles já diferiam.
 *
 * Em branco = vale o negociado acima, para não obrigar a configurar duas vezes
 * quem fechou um valor só.
 */
function ExcecoesPorNivel({
  organizationId,
  padrao,
  taxa,
}: {
  organizationId: string;
  padrao: RepasseConfig;
  taxa: TaxaProcessamento;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rascunho, setRascunho] = useState<Record<string, { tipo: RepasseConfig["tipo"]; valor: string }>>({});

  const { data: linhas = [] } = useQuery({
    queryKey: ["repasse-niveis", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_planos_precificacao")
        .select("nivel_atacado, repasse_tipo, repasse_valor")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const inicial: Record<string, { tipo: RepasseConfig["tipo"]; valor: string }> = {};
    for (const n of NIVEIS) {
      const l = linhas.find((x) => x.nivel_atacado === n.id);
      inicial[n.id] = {
        tipo: (l?.repasse_tipo as RepasseConfig["tipo"]) ?? "fixo",
        valor: l?.repasse_valor === null || l?.repasse_valor === undefined ? "" : String(l.repasse_valor),
      };
    }
    setRascunho(inicial);
  }, [linhas]);

  const salvar = useMutation({
    mutationFn: async (nivel: string) => {
      const r = rascunho[nivel];
      const vazio = !r || r.valor.trim() === "";
      const n = Number((r?.valor ?? "").replace(",", "."));
      if (!vazio && (!Number.isFinite(n) || n < 0 || (r.tipo === "percentual" && n > 100))) {
        throw new Error("Valor inválido para este tipo de repasse.");
      }
      const { error } = await supabase
        .from("organization_planos_precificacao")
        .update({ repasse_tipo: vazio ? null : r.tipo, repasse_valor: vazio ? null : n })
        .eq("organization_id", organizationId)
        .eq("nivel_atacado", nivel as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Exceção atualizada", description: "Vale para assinaturas novas desse nível." });
      void queryClient.invalidateQueries({ queryKey: ["repasse-niveis", organizationId] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs font-medium">Exceção por nível</p>
      <p className="text-xs text-muted-foreground -mt-1">Em branco, vale o repasse acima.</p>
      {NIVEIS.map((n) => {
        const r = rascunho[n.id] ?? { tipo: "fixo" as const, valor: "" };
        const num = Number(r.valor.replace(",", "."));
        const temValor = r.valor.trim() !== "" && Number.isFinite(num);
        const efetivo = resolverRepasse(padrao, temValor ? { tipo: r.tipo, valor: num } : null);
        const previa = dividirCobranca(n.varejoRef, efetivo, taxa);
        return (
          <div key={n.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-20 text-xs">{n.rotulo}</span>
              <Select
                value={r.tipo}
                onValueChange={(v) => setRascunho((s) => ({ ...s, [n.id]: { ...r, tipo: v as RepasseConfig["tipo"] } }))}
              >
                <SelectTrigger className="h-8 w-28 text-xs" aria-label={`Tipo de repasse do ${n.rotulo}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixo">Fixo</SelectItem>
                  <SelectItem value="percentual">%</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="h-8 w-24 text-xs"
                inputMode="decimal"
                aria-label={`Valor do repasse do ${n.rotulo}`}
                placeholder="padrão"
                value={r.valor}
                onChange={(e) => setRascunho((s) => ({ ...s, [n.id]: { ...r, valor: e.target.value } }))}
              />
              <Button size="sm" variant="outline" disabled={salvar.isPending} onClick={() => salvar.mutate(n.id)}>
                Salvar
              </Button>
            </div>
            <p className="pl-[5.5rem] text-[11px] text-muted-foreground">
              {previa.semRepasseNegociado
                ? "Sem repasse: a cobrança deste nível seria recusada."
                : `A R$ ${n.varejoRef}: ArkeFit R$ ${previa.repasseArke!.toFixed(2)} · academia R$ ${previa.liquidoAcademia!.toFixed(2)}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}
