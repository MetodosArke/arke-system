import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { PauseCircle, PlayCircle, Pencil, XCircle } from "lucide-react";
import { reais } from "@/lib/numeros";

type Assinatura = {
  status: string;
  valor_cobrado: number | string | null;
  asaas_subscription_id: string | null;
} | null;

type Acao = "cancelar" | "pausar" | "retomar" | "alterar_valor";

/**
 * Parar e ajustar a cobrança do Método — o que faltava inteiro no produto.
 *
 * Sem isto a única saída era o painel do Asaas, e o mais comum era não haver
 * saída nenhuma: excluir o aluno apagava o registro deste lado e deixava a
 * assinatura cobrando uma pessoa real, todo mês, sem ninguém ver.
 *
 * Cancelar pede motivo porque parar de cobrar alguém é decisão que precisa se
 * explicar depois — para a academia e para o aluno que ligar perguntando.
 */
export function CicloAssinatura({
  alunoId,
  assinatura,
  onAlterada,
}: {
  alunoId: string;
  assinatura: Assinatura;
  onAlterada?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogo, setDialogo] = useState<"cancelar" | "valor" | null>(null);
  const [motivo, setMotivo] = useState("");
  const [valor, setValor] = useState("");

  const status = assinatura?.status ?? null;
  // Trial não existe no gateway e Free não tem assinatura: nada a parar.
  const temCobranca = !!assinatura?.asaas_subscription_id;
  const ativa = status === "ativa" || status === "atrasada";
  const pausada = status === "pausada";

  const executar = useMutation({
    mutationFn: async (corpo: { acao: Acao; motivo?: string; valor_cobrado?: number }) => {
      const { data, error } = await supabase.functions.invoke("asaas-assinatura-ciclo", {
        body: { aluno_id: alunoId, ...corpo },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível alterar a cobrança."));
      return data as Record<string, unknown>;
    },
    onSuccess: (data) => {
      const vencidas = Number(data?.cobrancas_vencidas_mantidas ?? 0);
      const encerrado = Number(data?.valor_em_aberto_encerrado ?? 0);
      toast({
        title: "Cobrança atualizada",
        description:
          vencidas > 0
            ? `${vencidas} cobrança(s) já vencida(s) continuam valendo — são de período já usado.`
            : encerrado > 0
              ? `Cancelada. ${reais(encerrado)} em aberto deixaram de ser cobráveis.`
              : "Feito.",
      });
      setDialogo(null);
      setMotivo("");
      setValor("");
      void queryClient.invalidateQueries({ queryKey: ["aluno-perfil", alunoId] });
      onAlterada?.();
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível alterar a cobrança", description: error.message, variant: "destructive" }),
  });

  if (!temCobranca) return null;

  return (
    <div className="mt-3 border-t pt-3">
      <p className="mb-2 text-xs text-muted-foreground">Cobrança do Método</p>
      <div className="flex flex-wrap gap-2">
        {ativa && (
          <Button variant="outline" size="sm" disabled={executar.isPending} onClick={() => executar.mutate({ acao: "pausar" })}>
            <PauseCircle className="mr-1.5 h-3.5 w-3.5" />
            Pausar
          </Button>
        )}
        {pausada && (
          <Button variant="outline" size="sm" disabled={executar.isPending} onClick={() => executar.mutate({ acao: "retomar" })}>
            <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
            Retomar
          </Button>
        )}
        {(ativa || pausada) && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={executar.isPending}
              onClick={() => {
                setValor(String(assinatura?.valor_cobrado ?? ""));
                setDialogo("valor");
              }}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Alterar valor
            </Button>
            <Button variant="outline" size="sm" disabled={executar.isPending} onClick={() => setDialogo("cancelar")}>
              <XCircle className="mr-1.5 h-3.5 w-3.5" />
              Cancelar
            </Button>
          </>
        )}
      </div>

      <Dialog open={dialogo === "cancelar"} onOpenChange={(a) => !a && setDialogo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar a cobrança do Método</DialogTitle>
            <DialogDescription>
              A assinatura é encerrada no gateway e o aluno deixa de ser cobrado. As cobranças ainda em aberto deixam de
              ser cobráveis — se houver dívida a receber, cobre antes de cancelar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo-cancelamento">Motivo</Label>
            <Input
              id="motivo-cancelamento"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: aluno encerrou a matrícula"
            />
            <p className="text-xs text-muted-foreground">Fica registrado no histórico do aluno.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogo(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={!motivo.trim() || executar.isPending}
              onClick={() => executar.mutate({ acao: "cancelar", motivo: motivo.trim() })}
            >
              Cancelar cobrança
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogo === "valor"} onOpenChange={(a) => !a && setDialogo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar o valor da assinatura</DialogTitle>
            <DialogDescription>
              O repasse à ARKE é recalculado e a divisão com a academia acompanha. Cobrança já emitida e ainda não
              vencida passa a valer o novo valor; cobrança já vencida fica como está.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="novo-valor">Novo valor mensal (R$)</Label>
            <Input
              id="novo-valor"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value.replace(",", "."))}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogo(null)}>
              Voltar
            </Button>
            <Button
              disabled={!Number(valor) || executar.isPending}
              onClick={() => executar.mutate({ acao: "alterar_valor", valor_cobrado: Number(valor) })}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
