import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { divisoesDoTreino, rotuloTecnica, seriesDoExercicio, seriesUniformes } from "@/lib/seriesTreino";
import { formatarDataBR } from "@/lib/dataBrasilia";

export interface ExercicioSnapshotImpressao {
  ordem: number;
  nome_exercicio: string;
  series: number;
  repeticoes: string;
  descanso_seg: number;
  observacoes: string | null;
  divisao?: string | null;
  series_detalhe?: unknown;
}

export interface TreinoImpressao {
  titulo: string;
  validade_inicio: string | null;
  validade_fim: string | null;
  exercicios: ExercicioSnapshotImpressao[];
}

// Recibo de bobina térmica (80mm), a mesma largura usada em
// ReciboComprovanteDialog — o aluno chega na academia, a recepção ou o
// professor imprime a ficha do treino ativo em segundos, sem precisar do
// aplicativo.
export function ImprimirTreinoDialog({
  open,
  onOpenChange,
  organizacaoNome,
  alunoNome,
  treino,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizacaoNome: string;
  alunoNome: string;
  treino: TreinoImpressao | null;
}) {
  if (!treino) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="no-print">
          <DialogTitle>Imprimir Treino — {alunoNome}</DialogTitle>
        </DialogHeader>

        <div className="print-area print-area--termica space-y-3 text-sm">
          <div className="text-center border-b border-border pb-3">
            <p className="text-base font-bold">{organizacaoNome}</p>
            <p className="text-xs text-muted-foreground">Ficha de Treino</p>
          </div>

          <div className="space-y-0.5">
            <p className="font-medium">{alunoNome}</p>
            <p className="text-xs text-muted-foreground">{treino.titulo}</p>
            {treino.validade_fim && (
              <p className="text-xs text-muted-foreground">
                Válido até {formatarDataBR(treino.validade_fim)}
              </p>
            )}
          </div>

          <div className="border-t border-border pt-2 space-y-2.5">
            {treino.exercicios.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum exercício cadastrado neste treino.</p>
            )}
            {divisoesDoTreino(treino.exercicios).map((div, _i, todas) => (
              <div key={div} className="space-y-2">
                {todas.length > 1 && <p className="text-xs font-bold uppercase tracking-wide">Treino {div}</p>}
                {treino.exercicios
                  .filter((ex) => (ex.divisao || "A") === div)
                  .map((ex, i) => {
                    const series = seriesDoExercicio(ex);
                    return (
                      <div key={ex.ordem} className="text-xs">
                        <p className="font-semibold">
                          {i + 1}. {ex.nome_exercicio}
                        </p>
                        {seriesUniformes(series) ? (
                          <p className="text-muted-foreground">
                            {series.length}x{series[0].reps} · descanso {series[0].descanso_seg}s
                          </p>
                        ) : (
                          <p className="text-muted-foreground">
                            {series
                              .map((sr, n) => `S${n + 1}: ${sr.reps} (${sr.descanso_seg}s${sr.tecnica ? ", " + rotuloTecnica(sr.tecnica) : ""})`)
                              .join(" · ")}
                          </p>
                        )}
                        {ex.observacoes && <p className="text-muted-foreground italic">{ex.observacoes}</p>}
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>

          <p className="text-center text-[10px] text-muted-foreground pt-2 border-t border-border">
            Impresso via ArkeFit em {new Date().toLocaleDateString("pt-BR")}
          </p>
        </div>

        <DialogFooter className="no-print">
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" /> Imprimir (impressora térmica)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
