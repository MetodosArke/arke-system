import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, GripVertical, Dumbbell, Video, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AdicionarExercicioDialog } from "./AdicionarExercicioDialog";
import { EditarExercicioTreinoDialog } from "./EditarExercicioTreinoDialog";

interface TreinoExerciciosProps {
  treinoId: string;
  treinoTipo: string;
}

export function TreinoExercicios({ treinoId, treinoTipo }: TreinoExerciciosProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editExercicio, setEditExercicio] = useState<any>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: exercicios = [], isLoading } = useQuery({
    queryKey: ["treino-exercicios", treinoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treino_exercicios")
        .select(
          "*, exercicios:exercicio_id(nome, video_url, imagem_url, grupo_muscular, equipamento)"
        )
        .eq("treino_id", treinoId)
        .order("ordem");
      if (error) throw error;
      return data || [];
    },
  });

  const removeExercicio = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("treino_exercicios")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["treino-exercicios", treinoId] });
      toast({ title: "Exercício removido do treino!" });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs sm:text-sm font-semibold">
          Exercícios do Treino {treinoTipo}
        </h4>
        <Button size="sm" className="text-xs sm:text-sm h-7 sm:h-8" onClick={() => setAddDialogOpen(true)}>
          <Plus className="mr-1 h-3 w-3 sm:h-3.5 sm:w-3.5" />
          <span className="hidden sm:inline">Adicionar Exercício</span>
          <span className="sm:hidden">Adicionar</span>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : exercicios.length === 0 ? (
        <div className="text-center py-6">
          <Dumbbell className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Nenhum exercício adicionado
          </p>
        </div>
      ) : (
        exercicios.map((ex: any, idx: number) => (
          <div
            key={ex.id}
            className="flex items-start gap-2 sm:gap-3 rounded-lg bg-muted/20 p-2.5 sm:p-3 border"
          >
            <div className="flex items-center gap-1 sm:gap-2 text-muted-foreground pt-0.5 shrink-0">
              <GripVertical className="h-3.5 w-3.5 sm:h-4 sm:w-4 hidden sm:block" />
              <span className="text-xs sm:text-sm font-mono w-4 text-center">
                {idx + 1}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <p className="font-semibold text-xs sm:text-sm truncate">
                  {ex.exercicios?.nome || "—"}
                </p>
                {ex.exercicios?.video_url && (
                  <Badge variant="outline" className="text-[10px] sm:text-xs gap-0.5 sm:gap-1 px-1.5 sm:px-2">
                    <Video className="h-2.5 w-2.5 sm:h-3 sm:w-3" /> Vídeo
                  </Badge>
                )}
              </div>
              <div className="flex gap-1 sm:gap-2 mt-1 flex-wrap">
                <Badge variant="secondary" className="text-[10px] sm:text-xs px-1.5 sm:px-2">
                  🏋️ {ex.series}s
                </Badge>
                <Badge variant="secondary" className="text-[10px] sm:text-xs px-1.5 sm:px-2">
                  🔁 {ex.repeticoes}
                </Badge>
                <Badge variant="secondary" className="text-[10px] sm:text-xs px-1.5 sm:px-2">
                  ⏱️ {ex.descanso_seg}s
                </Badge>
              </div>
              {ex.observacoes && (
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-1.5 sm:mt-2 whitespace-pre-wrap line-clamp-2 sm:line-clamp-none">
                  💡 {ex.observacoes}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 sm:h-7 sm:w-7"
                onClick={() => setEditExercicio(ex)}
              >
                <Pencil className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 sm:h-7 sm:w-7 text-destructive hover:bg-destructive/10"
                onClick={() => removeExercicio.mutate(ex.id)}
              >
                <Trash2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              </Button>
            </div>
          </div>
        ))
      )}

      <AdicionarExercicioDialog
        treinoId={treinoId}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        currentOrder={exercicios.length + 1}
      />

      {editExercicio && (
        <EditarExercicioTreinoDialog
          open={!!editExercicio}
          onOpenChange={(v) => { if (!v) setEditExercicio(null); }}
          treinoId={treinoId}
          exercicio={editExercicio}
        />
      )}
    </div>
  );
}
