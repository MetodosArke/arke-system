import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

// Metas do aluno ajustáveis pela equipe: água do dia e dias de treino na
// semana. O aluno também ajusta as duas no próprio app (Perfil e Calendário);
// aqui é para quem acompanha poder calibrar — o 2.000 ml padrão não serve
// para todo mundo. Os limites repetem os do banco (alunos_meta_agua_ml_check).
export const AGUA_MIN = 500;
export const AGUA_MAX = 8000;

export function MetasAluno({
  alunoId,
  metaAguaMl,
  metaSemanalDias,
}: {
  alunoId: string;
  metaAguaMl: number | null;
  metaSemanalDias: number | null;
}) {
  const [agua, setAgua] = useState(String(metaAguaMl ?? 2000));
  const [dias, setDias] = useState(String(metaSemanalDias ?? 3));
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const salvar = useMutation({
    mutationFn: async () => {
      const ml = Number(agua);
      const d = Number(dias);
      if (!Number.isInteger(ml) || ml < AGUA_MIN || ml > AGUA_MAX) {
        throw new Error(`A meta de água deve ficar entre ${AGUA_MIN} e ${AGUA_MAX} ml.`);
      }
      if (!Number.isInteger(d) || d < 1 || d > 7) throw new Error("A meta de treino deve ficar entre 1 e 7 dias.");
      const { error } = await supabase.from("alunos").update({ meta_agua_ml: ml, meta_semanal_dias: d }).eq("id", alunoId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Metas atualizadas", description: "O aluno já vê as novas metas no app." });
      void queryClient.invalidateQueries({ queryKey: ["aluno-perfil", alunoId] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const mudou = agua !== String(metaAguaMl ?? 2000) || dias !== String(metaSemanalDias ?? 3);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`meta-agua-${alunoId}`} className="text-xs">
            Água por dia (ml)
          </Label>
          <Input
            id={`meta-agua-${alunoId}`}
            type="number"
            inputMode="numeric"
            min={AGUA_MIN}
            max={AGUA_MAX}
            step={100}
            value={agua}
            onChange={(e) => setAgua(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`meta-dias-${alunoId}`} className="text-xs">
            Treinos por semana (dias)
          </Label>
          <Input
            id={`meta-dias-${alunoId}`}
            type="number"
            inputMode="numeric"
            min={1}
            max={7}
            value={dias}
            onChange={(e) => setDias(e.target.value)}
          />
        </div>
      </div>
      {mudou && (
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
          {salvar.isPending ? "Salvando..." : "Salvar metas"}
        </Button>
      )}
    </div>
  );
}
