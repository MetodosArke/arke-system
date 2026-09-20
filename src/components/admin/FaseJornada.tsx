import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Enums } from "@/integrations/supabase/types";

type Fase = Enums<"fase_jornada">;

const FASES: { valor: Fase; label: string; resumo: string }[] = [
  { valor: "mapa", label: "M.A.P.A.®", resumo: "Acolhimento e diagnóstico" },
  { valor: "base", label: "B.A.S.E.®", resumo: "Prescrição em execução" },
  { valor: "rota", label: "R.O.T.A.®", resumo: "Acompanhamento e check-ins" },
  { valor: "apex", label: "A.P.E.X.®", resumo: "Evolução consolidada" },
  { valor: "legado", label: "L.E.G.A.D.O.®", resumo: "Autonomia e manutenção" },
];

const formatarDataHora = (valor: string) =>
  new Date(valor).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// Progressão da jornada, movida pela equipe.
//
// A decisão foi manter isto manual em vez de automatizar: quem convive com o
// aluno é quem sabe se ele de fato mudou de fase, e um gatilho automático
// erraria justamente nos casos que mais importam. O que o sistema garante é
// o registro — quem moveu, quando e por quê — porque a fase orienta o
// atendimento e uma mudança sem autor não se explica depois.
export function FaseJornada({
  alunoId,
  faseAtual,
}: {
  alunoId: string;
  faseAtual: Fase;
}) {
  const [fase, setFase] = useState<Fase>(faseAtual);
  const [observacao, setObservacao] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: historico = [] } = useQuery({
    queryKey: ["aluno-fase-historico", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aluno_fase_historico")
        .select("id, fase_anterior, fase_nova, movido_por_nome, observacao, created_at")
        .eq("aluno_id", alunoId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const mover = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("mover_fase_jornada", {
        _aluno_id: alunoId,
        _fase: fase,
        _observacao: observacao || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setObservacao("");
      toast({ title: "Fase atualizada", description: "O movimento ficou registrado no histórico." });
      void queryClient.invalidateQueries({ queryKey: ["aluno-fase-historico", alunoId] });
      void queryClient.invalidateQueries({ queryKey: ["aluno-perfil"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-alunos"] });
    },
    onError: (erro: Error) =>
      toast({ title: "Não foi possível mover a fase", description: erro.message, variant: "destructive" }),
  });

  const rotulo = (f: Fase | null) => (f ? FASES.find((x) => x.valor === f)?.label ?? f : "—");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={fase} onValueChange={(v) => setFase(v as Fase)}>
          <SelectTrigger className="w-[230px]" aria-label="Fase da jornada">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FASES.map((f) => (
              <SelectItem key={f.valor} value={f.valor}>
                {f.label} — {f.resumo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={fase === faseAtual || mover.isPending} onClick={() => mover.mutate()}>
          {mover.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Mover fase
        </Button>
      </div>

      <Input
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
        placeholder="Por que está mudando de fase? (opcional)"
        className="text-sm"
      />

      {historico.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs font-medium text-muted-foreground">Movimentos recentes</p>
          {historico.map((h) => (
            <div key={h.id} className="text-[11px] text-muted-foreground">
              <span className="text-foreground">
                {rotulo(h.fase_anterior)} <ArrowRight className="inline h-3 w-3" /> {rotulo(h.fase_nova)}
              </span>
              {" · "}
              {h.movido_por_nome ?? "equipe"} · {formatarDataHora(h.created_at)}
              {h.observacao && <span className="block italic">“{h.observacao}”</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
