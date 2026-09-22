import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Mensalidade B2B da academia (Visão Master). A assinatura nasce sozinha
 * quando a academia conclui o onboarding; aqui a ArkeFit define o valor
 * negociado (obrigatório no Custom e no autônomo, que não têm preço de
 * tabela) e inicia a assinatura das academias que já estavam no ar.
 */
export function MensalidadeB2bOrganizacao({ organizationId }: { organizationId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [valor, setValor] = useState("");

  const { data } = useQuery({
    queryKey: ["mensalidade-b2b", organizationId],
    queryFn: async () => {
      const [{ data: org, error }, { data: efetivo }] = await Promise.all([
        supabase
          .from("organizations")
          .select("plano_b2b, status, onboarding_completed, valor_mensal_b2b, asaas_subscription_id_b2b")
          .eq("id", organizationId)
          .single(),
        supabase.rpc("valor_mensal_b2b", { _organization_id: organizationId }),
      ]);
      if (error) throw error;
      return { ...org, efetivo: efetivo === null || efetivo === undefined ? null : Number(efetivo) };
    },
  });

  useEffect(() => {
    setValor(data?.valor_mensal_b2b ? String(data.valor_mensal_b2b).replace(".", ",") : "");
  }, [data?.valor_mensal_b2b]);

  const atualizar = () => void queryClient.invalidateQueries({ queryKey: ["mensalidade-b2b", organizationId] });

  const salvarValor = useMutation({
    mutationFn: async () => {
      const numero = valor.trim() ? Number(valor.replace(/\./g, "").replace(",", ".")) : null;
      if (numero !== null && (!Number.isFinite(numero) || numero <= 0)) throw new Error("Valor inválido.");
      const { error } = await supabase.from("organizations").update({ valor_mensal_b2b: numero }).eq("id", organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Valor salvo", description: "Vale para a próxima assinatura. Uma assinatura já criada mantém o valor dela no Asaas." });
      atualizar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const iniciar = useMutation({
    mutationFn: async () => {
      const { data: r, error } = await supabase.functions.invoke<{ subscription_id?: string; valor_divergente?: boolean }>("asaas-assinatura-b2b", {
        body: { organization_id: organizationId },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível criar a assinatura."));
      return r;
    },
    onSuccess: (r) => {
      toast({
        title: "Mensalidade recorrente iniciada",
        description: r?.valor_divergente ? "Atenção: havia uma assinatura com outro valor no Asaas, e ela foi adotada." : "A primeira fatura vence hoje.",
      });
      atualizar();
    },
    onError: (e: Error) => toast({ title: "Mensalidade não iniciada", description: e.message, variant: "destructive" }),
  });

  if (!data) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Mensalidade:</span>
        <span className="font-medium">{data.efetivo ? moeda(data.efetivo) : "sem preço de tabela"}</span>
        {data.asaas_subscription_id_b2b ? (
          <Badge>Recorrente</Badge>
        ) : (
          <Badge variant="outline">{data.status === "trial" ? "Trial — não cobra" : "Sem assinatura"}</Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          aria-label="Valor negociado da mensalidade B2B"
          className="h-8 w-36"
          inputMode="decimal"
          placeholder="Valor negociado"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
        <Button size="sm" variant="outline" disabled={salvarValor.isPending} onClick={() => salvarValor.mutate()}>
          Salvar valor
        </Button>
      </div>
      {!data.asaas_subscription_id_b2b && data.status !== "trial" && (
        <Button size="sm" disabled={iniciar.isPending || !data.onboarding_completed || !data.efetivo} onClick={() => iniciar.mutate()}>
          {iniciar.isPending ? "Criando..." : "Iniciar mensalidade recorrente"}
        </Button>
      )}
      {!data.onboarding_completed && data.status !== "trial" && (
        <p className="text-[11px] text-muted-foreground">A mensalidade começa quando a academia conclui o onboarding.</p>
      )}
      {data.asaas_subscription_id_b2b && <p className="text-[11px] text-muted-foreground font-mono">{data.asaas_subscription_id_b2b}</p>}
    </div>
  );
}
