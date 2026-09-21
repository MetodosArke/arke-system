import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlaskConical, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Enums } from "@/integrations/supabase/types";

type Nivel = Enums<"nivel_atacado">;

const NIVEIS: { valor: Nivel; label: string }[] = [
  { valor: "essencial", label: "Essencial — Treino ARKE" },
  { valor: "integrado", label: "Integrado — Treino + Nutrição" },
  { valor: "elite", label: "Elite — Acompanhamento 360°" },
];

// Trial do Método ARKE para o aluno, espelhando o trial B2B da organização:
// libera o produto inteiro, tem prazo e não gera cobrança nenhuma.
//
// Existe para homologação — é como se percorre a jornada dos três níveis sem
// passar pelo Asaas. Por isso o nível é escolhido aqui: cada um entrega
// coisas diferentes (nutrição, acolhimento expandido) e a jornada muda.
//
// Só o Super Admin atribui ou encerra (o banco recusa qualquer outro papel).
// A academia vê o componente em `somenteLeitura`: fica sabendo que o aluno está
// em trial, sem o botão que ela não pode usar.
export function TrialMetodoArke({
  alunoId,
  emTrial,
  trialFim,
  nivelAtual,
  somenteLeitura = false,
  onAlterado,
}: {
  alunoId: string;
  emTrial: boolean;
  trialFim: string | null;
  nivelAtual: Nivel | null;
  somenteLeitura?: boolean;
  onAlterado?: () => void;
}) {
  const [nivel, setNivel] = useState<Nivel>(nivelAtual ?? "essencial");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: ["aluno-perfil"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-alunos"] });
    onAlterado?.();
  };

  const iniciar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("iniciar_trial_metodo_arke", {
        _aluno_id: alunoId,
        _nivel: nivel,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Trial iniciado",
        description: "O aluno entra na jornada do Método sem nenhuma cobrança.",
      });
      invalidar();
    },
    onError: (erro: Error) =>
      toast({ title: "Não foi possível iniciar o trial", description: erro.message, variant: "destructive" }),
  });

  const encerrar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("encerrar_trial_metodo_arke", { _aluno_id: alunoId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Trial encerrado", description: "O aluno volta a ficar sem adesão ao Método." });
      invalidar();
    },
    onError: (erro: Error) =>
      toast({ title: "Não foi possível encerrar o trial", description: erro.message, variant: "destructive" }),
  });

  const ocupado = iniciar.isPending || encerrar.isPending;

  if (emTrial) {
    const fim = trialFim ? new Date(`${trialFim}T00:00:00`).toLocaleDateString("pt-BR") : null;
    return (
      <div className="space-y-2">
        <p className="text-sm">
          <FlaskConical className="inline h-3.5 w-3.5 mr-1 text-amber-600 dark:text-amber-400" />
          Em trial de homologação{fim ? ` até ${fim}` : ""} — sem cobrança.
        </p>
        {!somenteLeitura && (
          <Button variant="outline" size="sm" disabled={ocupado} onClick={() => encerrar.mutate()}>
            {encerrar.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Encerrar trial
          </Button>
        )}
      </div>
    );
  }

  if (somenteLeitura) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Libera a jornada completa do Método no nível escolhido, sem passar pelo Asaas e sem gerar cobrança.
      </p>
      <div className="flex flex-wrap gap-2">
        <Select value={nivel} onValueChange={(v) => setNivel(v as Nivel)}>
          <SelectTrigger className="w-[230px]" aria-label="Nível do trial">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NIVEIS.map((n) => (
              <SelectItem key={n.valor} value={n.valor}>
                {n.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={ocupado} onClick={() => iniciar.mutate()}>
          {iniciar.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
          Iniciar trial
        </Button>
      </div>
    </div>
  );
}
