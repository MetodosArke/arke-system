import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Trophy, Dumbbell, LifeBuoy, UtensilsCrossed, Droplet } from "lucide-react";

// Versão simplificada da pontuação de engajamento — não é o motor de
// gamificação completo do protótipo legado (200 pontos / 30 regras), só
// um resumo de 4 sinais que já existem: treino, check-in, adesão à dieta
// e água. Compara só com a média da organização (nunca um ranking
// individual de outros alunos).
export default function PontuacaoEngajamento() {
  const { alunoId } = useAuth();

  const { data: pontuacao } = useQuery({
    queryKey: ["aluno-pontuacao-engajamento", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_pontuacao_engajamento_mensal");
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: !!alunoId,
  });

  if (!pontuacao) return null;

  const propria = Math.round(pontuacao.pontuacao_propria ?? 0);
  const media = pontuacao.media_organizacao ?? 0;
  const diferenca = Math.round(propria - media);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-primary" /> Pontuação de Engajamento do Mês
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-2xl font-bold text-primary">{propria}/100</span>
          <span className={`text-xs font-medium ${diferenca >= 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
            {diferenca >= 0 ? `+${diferenca}` : diferenca} vs. média da academia ({Math.round(media)})
          </span>
        </div>
        <Progress value={propria} />

        <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
          <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 p-2">
            <Dumbbell className="h-3.5 w-3.5 text-primary shrink-0" />
            <span>{pontuacao.treinos_concluidos ?? 0} treinos concluídos</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 p-2">
            <LifeBuoy className="h-3.5 w-3.5 text-primary shrink-0" />
            <span>{pontuacao.checkins_registrados ?? 0} check-ins</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 p-2">
            <UtensilsCrossed className="h-3.5 w-3.5 text-primary shrink-0" />
            <span>{pontuacao.adesao_dieta_media != null ? `${Math.round(pontuacao.adesao_dieta_media)}% adesão dieta` : "Sem dieta ativa"}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 p-2">
            <Droplet className="h-3.5 w-3.5 text-primary shrink-0" />
            <span>
              {pontuacao.dias_meta_agua_batida ?? 0}/{pontuacao.dias_no_mes ?? 30} dias com meta de água
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
