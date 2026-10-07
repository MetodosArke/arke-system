import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErroAoCarregar } from "@/components/ErroAoCarregar";
import { formatarDataBR } from "@/lib/dataBrasilia";
import { PrestadorPagamentos } from "@/components/pagamento/PrestadorPagamentos";

type Situacao = {
  ligado: boolean;
  chave_conectada: boolean;
  webhook_registrado_em: string | null;
  plano_vivas_arkefit: number;
  plano_vivas_academia: number;
  avulsas_abertas_academia: number;
};

/**
 * Cobrança na conta da academia, na ficha da organização (Visão Master).
 *
 * Desligado (o padrão), a mensalidade e a avulsa saem da conta da ArkeFit,
 * com split para a carteira da academia e a taxa de processamento. Ligado, a
 * cobrança nova sai da conta Asaas da própria academia, sem split e sem a
 * taxa: o Asaas cobra a tarifa direto dela. O Método segue na conta da
 * ArkeFit. Ligar registra o aviso de pagamento (webhook) na conta da
 * academia; só a ArkeFit, com as duas etapas, liga, e fica na auditoria.
 *
 * A tela diz o que recusa: assinatura de plano viva na conta da ArkeFit (para
 * ligar) ou na conta da academia (para desligar) — não se migra assinatura.
 */
export function CobrancaContaAcademiaOrganizacao({ organizationId }: { organizationId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);

  const situacao = useQuery({
    queryKey: ["situacao-cobranca-conta-academia", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("situacao_cobranca_conta_academia", { _organization_id: organizationId });
      if (error) throw error;
      return data as unknown as Situacao;
    },
  });

  const mudar = useMutation({
    mutationFn: async (ligar: boolean) => {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; ligado?: boolean; webhook?: string }>("asaas-conta-academia", {
        body: { organization_id: organizationId, acao: "modo_cobranca", ligar },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível mudar a conta das cobranças."));
      return data;
    },
    onSuccess: (r) => {
      setConfirmando(false);
      toast({
        title: r?.ligado ? "Cobrança na conta da academia ligada" : "Cobrança voltou para a conta da ArkeFit",
        description: r?.ligado
          ? `O aviso de pagamento foi ${r.webhook === "atualizado" ? "atualizado" : "registrado"} na conta da academia. Vale para as cobranças novas.`
          : "As cobranças novas saem da conta da ArkeFit, com split. O aviso de pagamento da conta da academia continua, para estornos antigos.",
      });
      void queryClient.invalidateQueries({ queryKey: ["situacao-cobranca-conta-academia", organizationId] });
    },
    onError: (e: Error) => {
      setConfirmando(false);
      toast({ title: "Não mudou", description: e.message, variant: "destructive" });
    },
  });

  if (situacao.error && !situacao.data) {
    return <ErroAoCarregar oQue="a conta das cobranças" onTentarDeNovo={() => void situacao.refetch()} tentando={situacao.isFetching} className="p-2" />;
  }
  const s = situacao.data;
  if (!s) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  const ligar = !s.ligado;
  const bloqueio = ligar
    ? s.plano_vivas_arkefit > 0
      ? `${s.plano_vivas_arkefit} assinatura(s) de plano viva(s) na conta da ArkeFit: o modo não migra assinatura.`
      : !s.chave_conectada
        ? "A chave da conta Asaas da academia não está conectada (a gestão conecta em Financeiro → Notas fiscais)."
        : null
    : s.plano_vivas_academia + s.avulsas_abertas_academia > 0
      ? `${s.plano_vivas_academia} assinatura(s) de plano e ${s.avulsas_abertas_academia} cobrança(s) avulsa(s) em aberto na conta da academia.`
      : null;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={s.ligado ? "default" : "outline"}>{s.ligado ? "Na conta da academia" : "Na conta da ArkeFit (split)"}</Badge>
        {s.webhook_registrado_em && (
          <span className="text-xs text-muted-foreground">Aviso de pagamento registrado em {formatarDataBR(s.webhook_registrado_em)}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {s.ligado
          ? "Mensalidade e cobrança avulsa novas saem da conta Asaas da academia, sem split e sem taxa da ArkeFit. O Método segue na conta da ArkeFit."
          : "Mensalidade e cobrança avulsa saem da conta da ArkeFit, com split para a carteira da academia. Ligar vale só para as cobranças novas."}
      </p>
      {bloqueio && <p className="text-xs text-warning">{bloqueio}</p>}
      {confirmando ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs">{ligar ? "Ligar e registrar o aviso de pagamento na conta da academia?" : "Voltar as cobranças novas para a conta da ArkeFit?"}</span>
          <Button size="sm" disabled={mudar.isPending} onClick={() => mudar.mutate(ligar)}>
            {mudar.isPending ? "Gravando..." : "Confirmar"}
          </Button>
          <Button size="sm" variant="ghost" disabled={mudar.isPending} onClick={() => setConfirmando(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={!!bloqueio} onClick={() => setConfirmando(true)}>
          {ligar ? "Cobrar na conta da academia" : "Voltar para a conta da ArkeFit"}
        </Button>
      )}
      <PrestadorPagamentos atendimento={false} />
    </div>
  );
}
