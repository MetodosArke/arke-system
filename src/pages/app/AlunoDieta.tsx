import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { UtensilsCrossed, Flame, MessageCircle, Lock, Sparkles, CalendarDays } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ChatPanel } from "@/components/chat/ChatPanel";
import ControleDieta from "@/components/aluno/ControleDieta";

interface RefeicaoSnapshot {
  ordem: number;
  nome_refeicao: string;
  horario_sugerido: string | null;
  itens: string | null;
  calorias_kcal: number | null;
  proteinas_g: number | null;
  carboidratos_g: number | null;
  gorduras_g: number | null;
}

const HOJE = new Date().toISOString().slice(0, 10);

export default function AlunoDieta() {
  const { alunoId, organization, metodoArkeAtivo } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
    enabled: !!alunoId && (aluno?.nivel_atacado === "integrado" || aluno?.nivel_atacado === "elite"),
  });

  const { data: habitoHoje } = useQuery({
    queryKey: ["aluno-habito-hoje", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_habito")
        .select("*")
        .eq("aluno_id", alunoId!)
        .eq("data", HOJE)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const refeicoesConcluidas = habitoHoje?.refeicoes_concluidas ?? [];

  const marcarRefeicao = useMutation({
    mutationFn: async (ordem: number) => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const jaMarcada = refeicoesConcluidas.includes(ordem);
      const novaLista = jaMarcada
        ? refeicoesConcluidas.filter((o) => o !== ordem)
        : [...refeicoesConcluidas, ordem];
      const { error } = await supabase.from("registro_habito").upsert(
        {
          organization_id: organization.id,
          aluno_id: alunoId,
          data: HOJE,
          refeicoes_concluidas: novaLista,
        },
        { onConflict: "aluno_id,data" }
      );
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["aluno-habito-hoje", alunoId] }),
    onError: (error: Error) => {
      toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" });
    },
  });

  const refeicoes = (dieta?.snapshot_conteudo as unknown as RefeicaoSnapshot[] | null) ?? [];

  const totais = refeicoes.reduce(
    (acc, r) => ({
      kcal: acc.kcal + (r.calorias_kcal ?? 0),
      proteina: acc.proteina + (r.proteinas_g ?? 0),
      carbo: acc.carbo + (r.carboidratos_g ?? 0),
      gordura: acc.gordura + (r.gorduras_g ?? 0),
    }),
    { kcal: 0, proteina: 0, carbo: 0, gordura: 0 }
  );
  const temMacros = refeicoes.some((r) => r.calorias_kcal || r.proteinas_g || r.carboidratos_g || r.gorduras_g);

  if (aluno && aluno.nivel_atacado !== "integrado" && aluno.nivel_atacado !== "elite") {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardContent className="py-8 text-center space-y-2">
            <UtensilsCrossed className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm font-medium">
              {aluno.nivel_atacado === "essencial" ? "Nutrição não incluída no seu plano" : "Acompanhamento nutricional do Método ARKE"}
            </p>
            <p className="text-xs text-muted-foreground">
              Fale com sua academia sobre o Método ARKE nos níveis Integrado ou Elite para ter acesso ao acompanhamento nutricional.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl lg:max-w-4xl mx-auto">
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
        <>
          {temMacros && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Flame className="h-4 w-4 text-primary" /> Macronutrientes do dia
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-4 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold">{Math.round(totais.kcal)}</p>
                  <p className="text-xs text-muted-foreground">kcal</p>
                </div>
                <div>
                  <p className="text-lg font-bold">{Math.round(totais.proteina)}g</p>
                  <p className="text-xs text-muted-foreground">Proteína</p>
                </div>
                <div>
                  <p className="text-lg font-bold">{Math.round(totais.carbo)}g</p>
                  <p className="text-xs text-muted-foreground">Carbo</p>
                </div>
                <div>
                  <p className="text-lg font-bold">{Math.round(totais.gordura)}g</p>
                  <p className="text-xs text-muted-foreground">Gordura</p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{dieta.titulo}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {refeicoes.map((r) => {
                const marcada = refeicoesConcluidas.includes(r.ordem);
                return (
                  <div key={r.ordem} className="border-b border-border pb-3 last:border-0">
                    <div className="flex items-start gap-2.5">
                      <Checkbox
                        checked={marcada}
                        onCheckedChange={() => marcarRefeicao.mutate(r.ordem)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={`font-semibold ${marcada ? "line-through text-muted-foreground" : ""}`}>
                            {r.nome_refeicao}
                          </p>
                          {r.horario_sugerido && <span className="text-xs text-muted-foreground">{r.horario_sugerido}</span>}
                        </div>
                        {r.itens && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{r.itens}</p>}
                        {(r.calorias_kcal || r.proteinas_g || r.carboidratos_g || r.gorduras_g) && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {r.calorias_kcal != null && <Badge variant="secondary">{r.calorias_kcal} kcal</Badge>}
                            {r.proteinas_g != null && <Badge variant="secondary">{r.proteinas_g}g prot.</Badge>}
                            {r.carboidratos_g != null && <Badge variant="secondary">{r.carboidratos_g}g carbo</Badge>}
                            {r.gorduras_g != null && <Badge variant="secondary">{r.gorduras_g}g gord.</Badge>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <div className="pt-2">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="h-4 w-4 text-primary" />
              <h2 className="text-base font-bold">Controle da Dieta</h2>
            </div>
            <ControleDieta dietaId={dieta.id} />
          </div>
        </>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4 text-primary" /> Chat com a Nutricionista
          </CardTitle>
        </CardHeader>
        <CardContent>
          {metodoArkeAtivo && alunoId && organization ? (
            <ChatPanel organizationId={organization.id} alunoId={alunoId} viewerType="aluno" type="nutri" />
          ) : (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <Lock className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Exclusivo do Método ARKE
              </p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Fale direto com sua nutricionista pelo chat quando aderir ao Método ARKE. Pergunte à sua academia como aderir.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
