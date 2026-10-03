import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatarDataBR } from "@/lib/dataBrasilia";

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Mensalidade B2B da academia (Visão Master). A assinatura nasce sozinha
 * quando a academia conclui o onboarding; aqui a ArkeFit define o valor
 * negociado (obrigatório no Custom e no autônomo, que não têm preço de
 * tabela) e inicia a assinatura das academias que já estavam no ar.
 *
 * Zero é a unidade de uma rede: a rede paga na unidade principal, e esta
 * não tem mensalidade própria nem assinatura.
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
    setValor(data?.valor_mensal_b2b != null ? String(data.valor_mensal_b2b).replace(".", ",") : "");
  }, [data?.valor_mensal_b2b]);

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: ["mensalidade-b2b", organizationId] });
    void queryClient.invalidateQueries({ queryKey: ["mensalidade-b2b-asaas", organizationId] });
  };

  // A assinatura guarda o valor do dia em que nasceu: mudar o valor aqui não
  // muda a cobrança. A ficha compara os dois e oferece levar o de hoje.
  const noAsaas = useQuery({
    queryKey: ["mensalidade-b2b-asaas", organizationId],
    enabled: !!data?.asaas_subscription_id_b2b,
    queryFn: async () => {
      const { data: r, error } = await supabase.functions.invoke<{
        valor_asaas: number;
        status: string;
        proximo_vencimento: string | null;
        valor_hoje: number | null;
        divergente: boolean;
      }>("asaas-assinatura-b2b", { body: { organization_id: organizationId, acao: "situacao" } });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível consultar a assinatura no Asaas."));
      return r;
    },
  });

  const levarValor = useMutation({
    mutationFn: async () => {
      const { data: r, error } = await supabase.functions.invoke<{
        de?: number;
        para?: number;
        sem_mudanca?: boolean;
        pendentes_atualizadas?: boolean;
        vencidas_no_valor_antigo?: number;
      }>("asaas-assinatura-b2b", { body: { organization_id: organizationId, acao: "alterar_valor" } });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível atualizar a assinatura."));
      return r;
    },
    onSuccess: (r) => {
      toast({
        title: r?.sem_mudanca ? "A assinatura já estava no valor de hoje" : `Assinatura atualizada para ${moeda(Number(r?.para ?? 0))}`,
        description: r?.sem_mudanca
          ? undefined
          : r?.pendentes_atualizadas
            ? "A fatura do mês, ainda não vencida, já sai no valor novo."
            : `${r?.vencidas_no_valor_antigo ?? 0} fatura(s) já vencida(s) ficam no valor antigo; o novo vale a partir da próxima.`,
      });
      atualizar();
    },
    onError: (e: Error) => toast({ title: "Assinatura não atualizada", description: e.message, variant: "destructive" }),
  });

  const salvarValor = useMutation({
    mutationFn: async (texto: string) => {
      const numero = texto.trim() ? Number(texto.replace(/\./g, "").replace(",", ".")) : null;
      if (numero !== null && (!Number.isFinite(numero) || numero < 0)) throw new Error("Valor inválido.");
      const { error } = await supabase.from("organizations").update({ valor_mensal_b2b: numero }).eq("id", organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Valor salvo", description: "Vale para a próxima assinatura. Uma assinatura já criada continua no valor dela até você levar o valor novo, logo abaixo." });
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
        <span className="font-medium">
          {data.efetivo === 0 ? "sem mensalidade própria" : data.efetivo ? moeda(data.efetivo) : "sem preço de tabela"}
        </span>
        {data.asaas_subscription_id_b2b ? (
          <Badge>Recorrente</Badge>
        ) : data.efetivo === 0 ? (
          <Badge variant="outline">{data.plano_b2b === "redes" ? "Unidade de rede" : "Sem mensalidade"}</Badge>
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
        <Button size="sm" variant="outline" disabled={salvarValor.isPending} onClick={() => salvarValor.mutate(valor)}>
          Salvar valor
        </Button>
      </div>
      {!data.asaas_subscription_id_b2b && data.status !== "trial" && data.efetivo !== 0 && (
        <Button size="sm" disabled={iniciar.isPending || !data.onboarding_completed || !data.efetivo} onClick={() => iniciar.mutate()}>
          {iniciar.isPending ? "Criando..." : "Iniciar mensalidade recorrente"}
        </Button>
      )}
      {data.efetivo === 0 && (
        <p className="text-[11px] text-muted-foreground">
          {data.plano_b2b === "redes"
            ? "Unidade de rede: a mensalidade do plano Redes é cobrada na unidade principal."
            : "Valor zero: o ArkeFit não cobra mensalidade desta organização, e nenhuma assinatura é criada."}
        </p>
      )}
      {!data.onboarding_completed && data.status !== "trial" && data.efetivo !== 0 && (
        <p className="text-[11px] text-muted-foreground">A mensalidade começa quando a academia conclui o onboarding.</p>
      )}
      {data.asaas_subscription_id_b2b && (
        <div className="space-y-1">
          {noAsaas.isLoading && <p className="text-[11px] text-muted-foreground">Conferindo a assinatura no Asaas...</p>}
          {noAsaas.error && <p className="text-[11px] text-destructive">{(noAsaas.error as Error).message}</p>}
          {noAsaas.data && (
            <p className="text-[11px] text-muted-foreground">
              No Asaas: {moeda(Number(noAsaas.data.valor_asaas))}
              {noAsaas.data.status !== "ACTIVE" ? ` (${noAsaas.data.status})` : ""}
              {noAsaas.data.proximo_vencimento ? ` · próxima fatura em ${formatarDataBR(noAsaas.data.proximo_vencimento)}` : ""}
            </p>
          )}
          {noAsaas.data?.divergente && (
            <div className="space-y-1 rounded-md border border-amber-500/40 p-2">
              <p className="text-xs">
                O valor de hoje é {moeda(Number(noAsaas.data.valor_hoje))}, e a assinatura cobra {moeda(Number(noAsaas.data.valor_asaas))}.
                Fatura já vencida fica no valor antigo.
              </p>
              <Button size="sm" variant="outline" disabled={levarValor.isPending} onClick={() => levarValor.mutate()}>
                {levarValor.isPending ? "Atualizando..." : `Cobrar ${moeda(Number(noAsaas.data.valor_hoje))} a partir de agora`}
              </Button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground font-mono">{data.asaas_subscription_id_b2b}</p>
        </div>
      )}
    </div>
  );
}
