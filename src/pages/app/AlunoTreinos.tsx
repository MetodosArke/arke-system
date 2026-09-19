import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Dumbbell,
  CheckCircle2,
  PlayCircle,
  Timer,
  Pause,
  RotateCcw,
  MessageCircle,
  Lock,
  Sparkles,
  Calendar as CalendarIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { RegistrarAlertaCard } from "@/components/aluno/RegistrarAlertaCard";
import { ChatPanel } from "@/components/chat/ChatPanel";
import CalendarioTreinos from "@/components/aluno/CalendarioTreinos";
import type { Json } from "@/integrations/supabase/types";

interface ExercicioSnapshot {
  ordem: number;
  nome_exercicio: string;
  grupo_muscular: string[];
  series: number;
  repeticoes: string;
  descanso_seg: number;
  observacoes: string | null;
  video_url: string | null;
}

interface DetalheExecucao {
  ordem: number;
  concluido: boolean;
  carga_kg: string;
}

const HOJE = new Date().toISOString().slice(0, 10);

export default function AlunoTreinos() {
  const { alunoId, organization, metodoArkeAtivo } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [videoAberto, setVideoAberto] = useState<string | null>(null);
  const [descansoOrdem, setDescansoOrdem] = useState<number | null>(null);
  const [segundosRestantes, setSegundosRestantes] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        .select("id, concluido, detalhes_execucao")
        .eq("aluno_id", alunoId!)
        .eq("data", HOJE)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const exercicios = (treino?.snapshot_conteudo as unknown as ExercicioSnapshot[] | null) ?? [];
  const detalhes = ((registroHoje?.detalhes_execucao as unknown as DetalheExecucao[] | null) ?? []);

  const [progresso, setProgresso] = useState<Record<number, DetalheExecucao>>({});

  useEffect(() => {
    const mapa: Record<number, DetalheExecucao> = {};
    for (const ex of exercicios) {
      const existente = detalhes.find((d) => d.ordem === ex.ordem);
      mapa[ex.ordem] = existente ?? { ordem: ex.ordem, concluido: false, carga_kg: "" };
    }
    setProgresso(mapa);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treino?.id, registroHoje?.id]);

  useEffect(() => {
    if (descansoOrdem === null) return;
    if (segundosRestantes <= 0) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setSegundosRestantes((s) => Math.max(0, s - 1));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descansoOrdem]);

  const salvarProgresso = useMutation({
    mutationFn: async (novoProgresso: Record<number, DetalheExecucao>) => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const listaDetalhes = Object.values(novoProgresso);
      const todosConcluidos = exercicios.length > 0 && listaDetalhes.every((d) => d.concluido);
      const { error } = await supabase.from("registro_treino").upsert(
        {
          organization_id: organization.id,
          aluno_id: alunoId,
          treino_id: treino?.id ?? null,
          data: HOJE,
          concluido: todosConcluidos,
          detalhes_execucao: listaDetalhes as unknown as Json,
        },
        { onConflict: "aluno_id,data" }
      );
      if (error) throw error;
      return todosConcluidos;
    },
    onSuccess: (todosConcluidos) => {
      void queryClient.invalidateQueries({ queryKey: ["aluno-registro-hoje", alunoId] });
      if (todosConcluidos) {
        toast({ title: "Treino concluído!", description: "Bom trabalho hoje." });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    },
  });

  const toggleConcluido = (ex: ExercicioSnapshot) => {
    const atual = progresso[ex.ordem] ?? { ordem: ex.ordem, concluido: false, carga_kg: "" };
    const atualizado = { ...atual, concluido: !atual.concluido };
    const novoProgresso = { ...progresso, [ex.ordem]: atualizado };
    setProgresso(novoProgresso);
    salvarProgresso.mutate(novoProgresso);
    if (atualizado.concluido && ex.descanso_seg > 0) {
      setDescansoOrdem(ex.ordem);
      setSegundosRestantes(ex.descanso_seg);
    }
  };

  const atualizarCarga = (ordem: number, carga: string) => {
    setProgresso((prev) => ({ ...prev, [ordem]: { ...(prev[ordem] ?? { ordem, concluido: false, carga_kg: "" }), carga_kg: carga } }));
  };

  const salvarCarga = (ordem: number) => {
    salvarProgresso.mutate(progresso);
    void ordem;
  };

  const totalConcluidos = Object.values(progresso).filter((d) => d.concluido).length;
  const treinoConcluidoHoje = !!registroHoje?.concluido;

  return (
    <div className="space-y-4 max-w-2xl lg:max-w-4xl mx-auto">
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
          {treinoConcluidoHoje && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 px-3 py-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Treino de hoje já concluído — bom trabalho!
            </div>
          )}

          {descansoOrdem !== null && (
            <Card className="border-primary/40">
              <CardContent className="py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Timer className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">Descanso</p>
                    <p className="text-2xl font-bold tabular-nums">
                      {Math.floor(segundosRestantes / 60)}:{String(segundosRestantes % 60).padStart(2, "0")}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      const ex = exercicios.find((e) => e.ordem === descansoOrdem);
                      setSegundosRestantes(ex?.descanso_seg ?? 0);
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => setDescansoOrdem(null)}>
                    <Pause className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{treino.titulo}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {totalConcluidos}/{exercicios.length} exercícios concluídos hoje
                {treino.validade_fim && ` · Válido até ${new Date(treino.validade_fim).toLocaleDateString("pt-BR")}`}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {exercicios.map((ex) => {
                const estado = progresso[ex.ordem] ?? { ordem: ex.ordem, concluido: false, carga_kg: "" };
                return (
                  <div key={ex.ordem} className="border-b border-border pb-4 last:border-0 last:pb-0">
                    <div className="flex items-start gap-2.5">
                      <Checkbox
                        checked={estado.concluido}
                        onCheckedChange={() => toggleConcluido(ex)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold ${estado.concluido ? "line-through text-muted-foreground" : ""}`}>
                          {ex.nome_exercicio}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <Badge variant="secondary">{ex.series} séries</Badge>
                          <Badge variant="secondary">{ex.repeticoes} reps</Badge>
                          <Badge variant="secondary">{ex.descanso_seg}s descanso</Badge>
                        </div>
                        {ex.observacoes && <p className="text-xs text-muted-foreground mt-1">{ex.observacoes}</p>}

                        <div className="flex items-center gap-2 mt-2">
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder="Carga (kg)"
                            className="h-8 w-28 text-sm"
                            value={estado.carga_kg}
                            onChange={(e) => atualizarCarga(ex.ordem, e.target.value)}
                            onBlur={() => salvarCarga(ex.ordem)}
                          />
                          {ex.video_url && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2"
                              onClick={() => setVideoAberto(ex.video_url)}
                            >
                              <PlayCircle className="h-3.5 w-3.5 mr-1" />
                              Ver execução
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}

      <div className="pt-2">
        <div className="flex items-center gap-2 mb-3">
          <CalendarIcon className="h-4 w-4 text-primary" />
          <h2 className="text-base font-bold">Meu Calendário</h2>
        </div>
        <CalendarioTreinos />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4 text-primary" /> Chat com o Treinador
          </CardTitle>
        </CardHeader>
        <CardContent>
          {metodoArkeAtivo && alunoId && organization ? (
            <ChatPanel organizationId={organization.id} alunoId={alunoId} viewerType="aluno" type="treino" />
          ) : (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <Lock className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Exclusivo do Método ARKE
              </p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Fale direto com seu treinador pelo chat quando aderir ao Método ARKE. Pergunte à sua academia como aderir.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <RegistrarAlertaCard compact />

      <Dialog open={!!videoAberto} onOpenChange={(open) => !open && setVideoAberto(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Vídeo de execução</DialogTitle>
          </DialogHeader>
          {videoAberto && (
            <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
              <iframe
                src={videoAberto}
                title="Execução do exercício"
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
