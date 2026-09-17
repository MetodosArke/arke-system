import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  treinoId: string;
  exercicio: {
    id: string;
    exercicio_id: string;
    ordem: number;
    series: number;
    repeticoes: string;
    descanso_seg: number;
    descanso_por_serie?: string | null;
    observacoes?: string | null;
    exercicios?: {
      nome: string;
      grupo_muscular?: string;
      equipamento?: string;
    };
  };
}

export function EditarExercicioTreinoDialog({ open, onOpenChange, treinoId, exercicio }: Props) {
  const [numSeries, setNumSeries] = useState(3);
  const [mesmaConfig, setMesmaConfig] = useState(true);
  const [seriesData, setSeriesData] = useState<{ reps: string; descanso: string }[]>([]);
  const [observacoes, setObservacoes] = useState("");
  const [ordem, setOrdem] = useState(1);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open && exercicio) {
      setNumSeries(exercicio.series);
      setObservacoes(exercicio.observacoes || "");
      setOrdem(exercicio.ordem);

      const repsArr = exercicio.repeticoes.split(",");
      const descansoArr = exercicio.descanso_por_serie
        ? exercicio.descanso_por_serie.split(",")
        : [];

      const allSameReps = repsArr.every((r) => r === repsArr[0]);
      const allSameDescanso = descansoArr.length === 0 || descansoArr.every((d) => d === descansoArr[0]);
      const isSame = allSameReps && allSameDescanso && (repsArr.length <= 1 || descansoArr.length <= 1);

      setMesmaConfig(isSame);
      setSeriesData(
        Array.from({ length: exercicio.series }, (_, i) => ({
          reps: repsArr[i] || repsArr[0] || "12",
          descanso: descansoArr[i] || String(exercicio.descanso_seg) || "60",
        }))
      );
    }
  }, [open, exercicio]);

  useEffect(() => {
    setSeriesData((prev) =>
      Array.from({ length: numSeries }, (_, i) => prev[i] || { reps: "12", descanso: "60" })
    );
  }, [numSeries]);

  const applyFirstToAll = () => {
    if (seriesData.length === 0) return;
    const first = seriesData[0];
    setSeriesData(seriesData.map(() => ({ ...first })));
  };

  const updateSerie = (idx: number, field: "reps" | "descanso", value: string) => {
    setSeriesData((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    let repeticoes: string;
    let descansoSeg: number;
    let descansoPorSerie: string | null = null;

    if (mesmaConfig) {
      repeticoes = seriesData[0]?.reps || "12";
      descansoSeg = parseInt(seriesData[0]?.descanso || "60") || 60;
    } else {
      repeticoes = seriesData.map((s) => s.reps).join(",");
      descansoSeg = parseInt(seriesData[0]?.descanso || "60") || 60;
      descansoPorSerie = seriesData.map((s) => s.descanso).join(",");
    }

    const { error } = await supabase
      .from("treino_exercicios")
      .update({
        series: numSeries,
        repeticoes,
        descanso_seg: descansoSeg,
        descanso_por_serie: descansoPorSerie,
        observacoes: observacoes || null,
        ordem,
      })
      .eq("id", exercicio.id);

    setLoading(false);

    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Exercício atualizado!" });
    queryClient.invalidateQueries({ queryKey: ["treino-exercicios", treinoId] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">
            Editar: {exercicio.exercicios?.nome || "Exercício"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
          <div>
            <Label>Número de Séries</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={numSeries}
              onChange={(e) => setNumSeries(parseInt(e.target.value) || 1)}
            />
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={mesmaConfig}
                onCheckedChange={(v) => setMesmaConfig(!!v)}
              />
              <span className="text-sm">Mesmas reps/descanso para todas</span>
            </label>
            {!mesmaConfig && (
              <Button type="button" variant="outline" size="sm" onClick={applyFirstToAll}>
                <Copy className="mr-1 h-3.5 w-3.5" />
                Copiar 1ª série
              </Button>
            )}
          </div>

          {mesmaConfig ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Repetições</Label>
                <Input
                  value={seriesData[0]?.reps || "12"}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSeriesData((prev) => prev.map((s) => ({ ...s, reps: val })));
                  }}
                  placeholder="Ex: 12"
                />
              </div>
              <div>
                <Label>Descanso (s)</Label>
                <Input
                  value={seriesData[0]?.descanso || "60"}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSeriesData((prev) => prev.map((s) => ({ ...s, descanso: val })));
                  }}
                  placeholder="60"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Detalhes por Série</Label>
              {seriesData.map((s, i) => (
                <div key={i} className="grid grid-cols-[80px_1fr_1fr] gap-2 items-center">
                  <span className="text-sm text-muted-foreground">Série {i + 1}</span>
                  <Input
                    value={s.reps}
                    onChange={(e) => updateSerie(i, "reps", e.target.value)}
                    placeholder="Reps"
                  />
                  <Input
                    value={s.descanso}
                    onChange={(e) => updateSerie(i, "descanso", e.target.value)}
                    placeholder="Descanso (s)"
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <Label>Observações</Label>
            <Textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Técnica de execução, dicas, etc..."
            />
          </div>

          <div>
            <Label>Ordem no Treino</Label>
            <Input
              type="number"
              min={1}
              value={ordem}
              onChange={(e) => setOrdem(parseInt(e.target.value) || 1)}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
