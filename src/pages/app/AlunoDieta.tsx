import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UtensilsCrossed } from "lucide-react";

interface RefeicaoSnapshot {
  ordem: number;
  nome_refeicao: string;
  horario_sugerido: string | null;
  itens: string | null;
}

export default function AlunoDieta() {
  const { alunoId } = useAuth();

  const { data: aluno } = useQuery({
    queryKey: ["aluno-nivel", alunoId],
    queryFn: async () => {
      const { data } = await supabase.from("alunos").select("nivel_atacado").eq("id", alunoId!).maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const { data: dieta, isLoading } = useQuery({
    queryKey: ["aluno-dieta-atual", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("dietas")
        .select("id, titulo, snapshot_conteudo")
        .eq("aluno_id", alunoId!)
        .eq("status", "ativo")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId && aluno?.nivel_atacado !== "essencial",
  });

  const refeicoes = (dieta?.snapshot_conteudo as unknown as RefeicaoSnapshot[] | null) ?? [];

  if (aluno?.nivel_atacado === "essencial") {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardContent className="py-8 text-center space-y-2">
            <UtensilsCrossed className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm font-medium">Nutrição não incluída no seu plano</p>
            <p className="text-xs text-muted-foreground">
              Fale com sua academia para migrar para o plano Integrado ou Elite e ter acesso ao acompanhamento nutricional.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <UtensilsCrossed className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Minha Dieta</h1>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!isLoading && !dieta && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma dieta publicada ainda. Sua equipe vai te avisar assim que estiver pronta.
          </CardContent>
        </Card>
      )}

      {dieta && (
        <Card>
          <CardHeader>
            <CardTitle>{dieta.titulo}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {refeicoes.map((r) => (
              <div key={r.ordem} className="border-b border-border pb-3 last:border-0">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{r.nome_refeicao}</p>
                  {r.horario_sugerido && <span className="text-xs text-muted-foreground">{r.horario_sugerido}</span>}
                </div>
                {r.itens && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{r.itens}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
