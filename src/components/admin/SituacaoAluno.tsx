import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROTULO_SITUACAO, SITUACOES, type SituacaoAcademia } from "@/lib/planoAluno";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { cn } from "@/lib/utils";

const COR: Record<SituacaoAcademia, string> = {
  em_dia: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  inadimplente: "border-destructive/50 text-destructive",
  pausado: "border-amber-500/50 text-amber-700 dark:text-amber-400",
};

// Motivos que o painel de retenção consegue agrupar; "Outro" abre texto livre.
const MOTIVOS_PAUSA = ["Viagem", "Saúde ou lesão", "Financeiro", "Trabalho ou rotina", "Gestação", "Outro"];

/**
 * Situação do aluno na academia (em dia, inadimplente, pausado). Só "em dia"
 * entra no app. Gestor e recepção alteram; o resto da equipe só vê — a trava
 * de verdade é o gatilho `trg_proteger_situacao_aluno` no banco. Pausar pede o
 * motivo e a data prevista de retorno: sem motivo, a retenção não diz por que
 * o aluno parou.
 */
export function SituacaoAluno({
  alunoId,
  situacao,
  motivo,
  retorno,
  desabilitado,
  onAlterada,
}: {
  alunoId: string;
  situacao: SituacaoAcademia;
  motivo?: string | null;
  retorno?: string | null;
  desabilitado?: boolean;
  onAlterada?: () => void;
}) {
  const { hasRole, organizationRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pedindo, setPedindo] = useState<SituacaoAcademia | null>(null);
  const [motivoEscolhido, setMotivoEscolhido] = useState("");
  const [motivoLivre, setMotivoLivre] = useState("");
  const [dataRetorno, setDataRetorno] = useState("");
  const podeAlterar =
    hasRole("admin_arke") || hasRole("superadmin") || organizationRole === "gestor" || organizationRole === "recepcao";

  const alterar = useMutation({
    mutationFn: async (dados: { nova: SituacaoAcademia; motivo: string | null; retorno: string | null }) => {
      const { error } = await supabase
        .from("alunos")
        .update({
          situacao_academia: dados.nova,
          situacao_academia_motivo: dados.motivo,
          situacao_academia_retorno: dados.retorno,
        })
        .eq("id", alunoId);
      if (error) throw error;

      // Pausar o aluno precisa pausar a cobrança dele — senão ele sai do app
      // e segue pagando, que é a reclamação mais previsível que existe. E
      // voltar a "em dia" precisa retomar, senão a academia para de receber
      // sem perceber.
      //
      // A situação é gravada primeiro porque é o efeito que a pessoa pediu.
      // Se o gateway falhar em seguida, o erro é dito em alto e bom som em
      // vez de engolido: a varredura diária corrige, mas até lá alguém seria
      // cobrado por um mês que não usou.
      const acao = dados.nova === "pausado" ? "pausar" : situacao === "pausado" && dados.nova === "em_dia" ? "retomar" : null;
      if (acao) {
        const { data, error: erroCobranca } = await supabase.functions.invoke("asaas-assinatura-ciclo", {
          body: { aluno_id: alunoId, acao },
        });
        if (erroCobranca) {
          const mensagem = await mensagemDeErroEdge(erroCobranca, "Não foi possível alterar a cobrança no gateway.");
          // Aluno sem assinatura é o caso comum (plano Free): não é falha.
          if (!/não tem assinatura/i.test(mensagem)) {
            return { nova: dados.nova, avisoCobranca: mensagem };
          }
        }
        if (data?.cobrancas_vencidas_mantidas) {
          return {
            nova: dados.nova,
            avisoCobranca: `A cobrança foi pausada, mas ${data.cobrancas_vencidas_mantidas} cobrança(s) já vencida(s) continuam valendo — são de período já usado.`,
          };
        }
      }
      return { nova: dados.nova, avisoCobranca: null as string | null };
    },
    onSuccess: ({ nova, avisoCobranca }) => {
      if (avisoCobranca) {
        toast({ title: "Situação alterada, mas a cobrança não", description: avisoCobranca, variant: "destructive" });
      } else {
      toast({
        title: `Situação: ${ROTULO_SITUACAO[nova]}`,
        description:
          nova === "em_dia"
            ? "O aluno volta a acessar o app."
            : "O acesso ao app fica suspenso e as tarefas automáticas dele foram encerradas.",
      });
      }
      setPedindo(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-alunos"] });
      void queryClient.invalidateQueries({ queryKey: ["aluno-perfil", alunoId] });
      onAlterada?.();
    },
    onError: (error: Error) => toast({ title: "Não foi possível alterar", description: error.message, variant: "destructive" }),
  });

  const escolher = (nova: SituacaoAcademia) => {
    if (nova === "em_dia") {
      alterar.mutate({ nova, motivo: null, retorno: null });
      return;
    }
    setMotivoEscolhido("");
    setMotivoLivre("");
    setDataRetorno("");
    setPedindo(nova);
  };

  const dica = [motivo, retorno ? `volta prevista ${new Date(`${retorno}T12:00:00`).toLocaleDateString("pt-BR")}` : null]
    .filter(Boolean)
    .join(" · ");

  if (!podeAlterar || desabilitado) {
    return (
      <Badge variant="outline" className={cn("text-[11px]", COR[situacao])} title={dica || undefined}>
        {ROTULO_SITUACAO[situacao]}
      </Badge>
    );
  }

  const motivoFinal = motivoEscolhido === "Outro" ? motivoLivre.trim() : motivoEscolhido;

  return (
    <>
      <Select value={situacao} onValueChange={(v) => escolher(v as SituacaoAcademia)} disabled={alterar.isPending}>
        <SelectTrigger className={cn("h-7 w-[132px] text-xs", COR[situacao])} aria-label="Situação do aluno na academia" title={dica || undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SITUACOES.map((s) => (
            <SelectItem key={s} value={s} className="text-xs">
              {ROTULO_SITUACAO[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={!!pedindo} onOpenChange={(aberto) => !aberto && setPedindo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pedindo === "pausado" ? "Pausar a matrícula" : "Marcar como inadimplente"}</DialogTitle>
            <DialogDescription>
              O aluno deixa de acessar o app até voltar a ficar em dia. Os treinos e o histórico ficam guardados.
            </DialogDescription>
          </DialogHeader>
          {pedindo === "pausado" ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Motivo</Label>
                <Select value={motivoEscolhido} onValueChange={setMotivoEscolhido}>
                  <SelectTrigger aria-label="Motivo da pausa">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {MOTIVOS_PAUSA.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {motivoEscolhido === "Outro" && (
                <Input aria-label="Outro motivo" placeholder="Qual?" value={motivoLivre} onChange={(e) => setMotivoLivre(e.target.value)} />
              )}
              <div className="space-y-1">
                <Label htmlFor="retorno-pausa" className="text-xs">
                  Volta prevista (opcional)
                </Label>
                <Input id="retorno-pausa" type="date" value={dataRetorno} onChange={(e) => setDataRetorno(e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="obs-inadimplencia" className="text-xs">
                Observação (opcional)
              </Label>
              <Input
                id="obs-inadimplencia"
                placeholder="Ex.: mensalidade de setembro em aberto"
                value={motivoLivre}
                onChange={(e) => setMotivoLivre(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPedindo(null)}>
              Cancelar
            </Button>
            <Button
              disabled={alterar.isPending || (pedindo === "pausado" && !motivoFinal)}
              onClick={() =>
                pedindo &&
                alterar.mutate({
                  nova: pedindo,
                  motivo: pedindo === "pausado" ? motivoFinal : motivoLivre.trim() || null,
                  retorno: pedindo === "pausado" && dataRetorno ? dataRetorno : null,
                })
              }
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
