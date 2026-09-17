import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dumbbell, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ExercicioSnapshot {
  ordem: number;
  nome_exercicio: string;
  grupo_muscular: string[];
  series: number;
  repeticoes: string;
  descanso_seg: number;
  observacoes: string | null;
}

const HOJE = new Date().toISOString().slice(0, 10);

export default function AlunoTreinos() {
  const { alunoId, organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: treino, isLoading } = useQuery({
    queryKey: ["aluno-treino-atual", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("treinos")
        .select("id, titulo, snapshot_conteudo, validade_inicio, validade_fim")
        .eq("aluno_id", alunoId!)
        .eq("status", "ativo")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const { data: registroHoje } = useQuery({
    queryKey: ["aluno-registro-hoje", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_treino")
        .select("id")
        .eq("aluno_id", alunoId!)
        .eq("data", HOJE)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const registrarTreino = useMutation({
    mutationFn: async () => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const { error } = await supabase.from("registro_treino").insert({
        organization_id: organization.id,
        aluno_id: alunoId,
        treino_id: treino?.id ?? null,
        data: HOJE,
        concluido: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Treino registrado!", description: "Bom trabalho hoje." });
      void queryClient.invalidateQueries({ queryKey: ["aluno-registro-hoje", alunoId] });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível registrar", description: error.message, variant: "destructive" });
    },
  });

  const exercicios = (treino?.snapshot_conteudo as unknown as ExercicioSnapshot[] | null) ?? [];

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <Dumbbell className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Meu Treino</h1>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!isLoading && !treino && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum treino publicado ainda. Sua equipe vai te avisar assim que estiver pronto.
          </CardContent>
        </Card>
      )}

      {treino && (
        <>
          <Button
            className="w-full"
            variant={registroHoje ? "secondary" : "default"}
            disabled={!!registroHoje || registrarTreino.isPending}
            onClick={() => registrarTreino.mutate()}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {registroHoje ? "Treino de hoje já registrado" : "Marcar treino de hoje como feito"}
          </Button>

          <Card>
            <CardHeader>
              <CardTitle>{treino.titulo}</CardTitle>
              {treino.validade_fim && (
                <p className="text-xs text-muted-foreground">
                  Válido até {new Date(treino.validade_fim).toLocaleDateString("pt-BR")}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {exercicios.map((ex) => (
                <div key={ex.ordem} className="border-b border-border pb-3 last:border-0">
                  <p className="font-semibold">{ex.nome_exercicio}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <Badge variant="secondary">{ex.series} séries</Badge>
                    <Badge variant="secondary">{ex.repeticoes} reps</Badge>
                    <Badge variant="secondary">{ex.descanso_seg}s descanso</Badge>
                  </div>
                  {ex.observacoes && <p className="text-xs text-muted-foreground mt-1">{ex.observacoes}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
