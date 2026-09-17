import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  Dumbbell,
  CheckCircle2,
  Info,
  Film,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AvaliacaoTreinoDialog } from "@/components/aluno/AvaliacaoTreinoDialog";

interface SerieData {
  id?: string; // registro_serie id if already saved
  repeticoes: number;
  carga_kg: number;
  concluida: boolean;
}

interface ExercicioState {
  exercicioId: string;
  series: SerieData[];
}

export default function TreinoExecucao() {
  const { treinoId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [expandedEx, setExpandedEx] = useState<string | null>(null);
  const [exercicioStates, setExercicioStates] = useState<Map<string, ExercicioState>>(new Map());
  const [showAvaliacao, setShowAvaliacao] = useState(false);
  const [registroId, setRegistroId] = useState<string | null>(null);
  const [showIncompleteAlert, setShowIncompleteAlert] = useState(false);

  // Fetch treino with exercises
  const { data: treino, isLoading } = useQuery({
    queryKey: ["treino-execucao", treinoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("treinos")
        .select(`
          id, titulo, tipo, descricao,
          treino_exercicios(
            id, ordem, series, repeticoes, descanso_seg, observacoes,
            exercicio_id,
            exercicios(id, nome, descricao, grupo_muscular, imagem_url, video_url)
          )
        `)
        .eq("id", treinoId!)
        .single();
      return data;
    },
    enabled: !!treinoId,
  });

  // Get or create registro_treino for today's session
  useEffect(() => {
    if (!treinoId || !user || registroId) return;

    const getOrCreateRegistro = async () => {
      const today = new Date().toISOString().split("T")[0];

      // Check for existing registro today that is NOT completed (nota is null)
      const { data: existingList } = await supabase
        .from("registro_treino")
        .select("id, nota")
        .eq("treino_id", treinoId)
        .eq("aluno_id", user.id)
        .eq("data", today)
        .order("created_at", { ascending: false });

      // Find an in-progress (not completed) registro
      const inProgress = (existingList || []).find((r: any) => r.nota === null);

      if (inProgress) {
        setRegistroId(inProgress.id);
      } else {
        // All existing registros are completed or none exist — create new one
        const { data: newReg } = await supabase
          .from("registro_treino")
          .insert({
            treino_id: treinoId,
            aluno_id: user.id,
          } as any)
          .select("id")
          .single();
        if (newReg) setRegistroId(newReg.id);
      }
    };

    getOrCreateRegistro();
  }, [treinoId, user, registroId]);

  // Fetch last session's series data for pre-filling carga (from any previous completed session, including today)
  const { data: lastSeriesData } = useQuery({
    queryKey: ["last-series", treinoId, user?.id, registroId],
    queryFn: async () => {
      // Get the most recent COMPLETED registro_treino (nota not null), excluding current registroId
      const query = supabase
        .from("registro_treino")
        .select("id")
        .eq("treino_id", treinoId!)
        .eq("aluno_id", user!.id)
        .not("nota", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);

      if (registroId) {
        query.neq("id", registroId);
      }

      const { data: lastRegistro } = await query.single();

      if (!lastRegistro) return null;

      const { data: series } = await supabase
        .from("registro_serie")
        .select("exercicio_id, serie_numero, carga_kg, repeticoes")
        .eq("registro_treino_id", lastRegistro.id);

      return series || [];
    },
    enabled: !!treinoId && !!user && !!registroId,
  });

  // Fetch current session's saved series
  const { data: currentSeriesData } = useQuery({
    queryKey: ["current-series", registroId],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_serie")
        .select("id, exercicio_id, serie_numero, carga_kg, repeticoes, concluida, created_at")
        .eq("registro_treino_id", registroId!)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!registroId,
  });

  const currentSeriesMap = useMemo(() => {
    const map = new Map<string, any>();

    (currentSeriesData || []).forEach((serie: any) => {
      const key = `${serie.exercicio_id}-${serie.serie_numero}`;
      if (!map.has(key)) {
        map.set(key, serie);
      }
    });

    return map;
  }, [currentSeriesData]);

  const lastSeriesMap = useMemo(() => {
    const map = new Map<string, any>();

    (lastSeriesData || []).forEach((serie: any) => {
      const key = `${serie.exercicio_id}-${serie.serie_numero}`;
      if (!map.has(key)) {
        map.set(key, serie);
      }
    });

    return map;
  }, [lastSeriesData]);

  // Initialize exercise states
  useEffect(() => {
    if (!treino?.treino_exercicios) return;
    // Wait for currentSeriesData to load if we have a registroId
    if (!registroId) return;
    if (currentSeriesData === undefined) return;

    const newStates = new Map<string, ExercicioState>();
    treino.treino_exercicios.forEach((te: any) => {
      const repsArr = te.repeticoes.split(",").map((r: string) => parseInt(r.trim()) || 0);
      const seriesData: SerieData[] = [];
      for (let i = 0; i < te.series; i++) {
        // First check current session data
        const currentSerie = currentSeriesMap.get(`${te.exercicio_id}-${i + 1}`);
        const lastSerie = lastSeriesMap.get(`${te.exercicio_id}-${i + 1}`);

        if (currentSerie) {
          seriesData.push({
            id: currentSerie.id,
            repeticoes: currentSerie.repeticoes,
            carga_kg: currentSerie.carga_kg ?? 0,
            concluida: currentSerie.concluida,
          });
        } else {
          seriesData.push({
            repeticoes: repsArr[i] !== undefined ? repsArr[i] : repsArr[0] || 0,
            carga_kg: lastSerie?.carga_kg ?? 0,
            concluida: false,
          });
        }
      }
      newStates.set(te.exercicio_id, {
        exercicioId: te.exercicio_id,
        series: seriesData,
      });
    });
    setExercicioStates(newStates);
  }, [treino, currentSeriesMap, lastSeriesMap, registroId]);

  const exercicios = (treino?.treino_exercicios || []).sort(
    (a: any, b: any) => a.ordem - b.ordem
  );

  const totalExercicios = exercicios.length;
  const exerciciosConcluidos = Array.from(exercicioStates.values()).filter(
    (es) => es.series.every((s) => s.concluida)
  ).length;
  const progressPercent =
    totalExercicios > 0 ? (exerciciosConcluidos / totalExercicios) * 100 : 0;

  const updateSerie = (
    exercicioId: string,
    serieIdx: number,
    field: keyof SerieData,
    value: any
  ) => {
    setExercicioStates((prev) => {
      const newMap = new Map(prev);
      const state = newMap.get(exercicioId);
      if (state) {
        const newSeries = [...state.series];
        newSeries[serieIdx] = { ...newSeries[serieIdx], [field]: value };
        newMap.set(exercicioId, { ...state, series: newSeries });
      }
      return newMap;
    });
  };

  // Save/upsert a single serie to the database
  const saveSerie = useCallback(async (
    exercicioId: string,
    serieIdx: number,
    serieData: SerieData
  ) => {
    if (!registroId) return;

    let serieId = serieData.id;

    if (!serieId) {
      const { data: existingSerie } = await supabase
        .from("registro_serie")
        .select("id")
        .eq("registro_treino_id", registroId)
        .eq("exercicio_id", exercicioId)
        .eq("serie_numero", serieIdx + 1)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      serieId = existingSerie?.id;
    }

    if (serieId) {
      await supabase
        .from("registro_serie")
        .update({
          repeticoes: serieData.repeticoes,
          carga_kg: serieData.carga_kg,
          concluida: serieData.concluida,
        })
        .eq("id", serieId);

      setExercicioStates((prev) => {
        const newMap = new Map(prev);
        const state = newMap.get(exercicioId);
        if (state) {
          const newSeries = [...state.series];
          newSeries[serieIdx] = { ...newSeries[serieIdx], id: serieId };
          newMap.set(exercicioId, { ...state, series: newSeries });
        }
        return newMap;
      });

      return;
    }

    const { data } = await supabase
      .from("registro_serie")
      .insert({
        registro_treino_id: registroId,
        exercicio_id: exercicioId,
        serie_numero: serieIdx + 1,
        repeticoes: serieData.repeticoes,
        carga_kg: serieData.carga_kg,
        concluida: serieData.concluida,
      })
      .select("id")
      .single();

    if (data) {
      setExercicioStates((prev) => {
        const newMap = new Map(prev);
        const state = newMap.get(exercicioId);
        if (state) {
          const newSeries = [...state.series];
          newSeries[serieIdx] = { ...newSeries[serieIdx], id: data.id };
          newMap.set(exercicioId, { ...state, series: newSeries });
        }
        return newMap;
      });
    }
  }, [registroId]);

  // Handle checkbox toggle - save immediately
  const handleCheckSerie = useCallback(async (
    exercicioId: string,
    serieIdx: number,
    checked: boolean
  ) => {
    const state = exercicioStates.get(exercicioId);
    if (!state) return;

    const updatedSerie = { ...state.series[serieIdx], concluida: checked };

    setExercicioStates((prev) => {
      const newMap = new Map(prev);
      const currentState = newMap.get(exercicioId);
      if (currentState) {
        const newSeries = [...currentState.series];
        newSeries[serieIdx] = updatedSerie;
        newMap.set(exercicioId, { ...currentState, series: newSeries });
      }
      return newMap;
    });

    await saveSerie(exercicioId, serieIdx, updatedSerie);
  }, [exercicioStates, saveSerie]);

  const handleSerieFieldChange = useCallback(
    async (
      exercicioId: string,
      serieIdx: number,
      field: keyof SerieData,
      value: number
    ) => {
      const state = exercicioStates.get(exercicioId);
      if (!state) return;

      const updatedSerie = { ...state.series[serieIdx], [field]: value };

      setExercicioStates((prev) => {
        const newMap = new Map(prev);
        const currentState = newMap.get(exercicioId);
        if (currentState) {
          const newSeries = [...currentState.series];
          newSeries[serieIdx] = updatedSerie;
          newMap.set(exercicioId, { ...currentState, series: newSeries });
        }
        return newMap;
      });

      await saveSerie(exercicioId, serieIdx, updatedSerie);
    },
    [exercicioStates, saveSerie]
  );

  // Finalizar mutation - just update the existing registro with avaliação data
  const finalizarMutation = useMutation({
    mutationFn: async (avaliacaoData: {
      nota: number;
      duracao_min: number;
      feedback: string;
      desconforto: boolean;
      desconforto_descricao: string;
    }) => {
      if (!registroId) throw new Error("No registro found");

      // Update registro_treino with avaliação
      const { error } = await supabase
        .from("registro_treino")
        .update({
          nota: avaliacaoData.nota,
          duracao_min: avaliacaoData.duracao_min,
          feedback: avaliacaoData.feedback || null,
          desconforto: avaliacaoData.desconforto,
          desconforto_descricao: avaliacaoData.desconforto_descricao || null,
        })
        .eq("id", registroId);

      if (error) throw error;

      // Save any remaining unsaved series
      for (const [exId, state] of exercicioStates) {
        for (let i = 0; i < state.series.length; i++) {
          await saveSerie(exId, i, state.series[i]);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aluno-treinos-full"] });
      queryClient.invalidateQueries({ queryKey: ["aluno-registros-completed-count"] });
      queryClient.invalidateQueries({ queryKey: ["aluno-treinos-iniciados"] });
      queryClient.invalidateQueries({ queryKey: ["aluno-ultimos-concluidos"] });
      navigate("/app/treinos");
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted/50" />
      </div>
    );
  }

  if (!treino) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">Treino não encontrado.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/app/treinos")}>
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-40">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/app/treinos")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{treino.titulo}</h1>
        </div>
      </div>

      {/* Progress */}
      <div>
        <Progress value={progressPercent} className="h-2" />
        <p className="text-sm text-muted-foreground mt-1">
          {exerciciosConcluidos} de {totalExercicios} exercícios concluídos
        </p>
      </div>

      {/* Exercise list */}
      <div>
        <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Dumbbell className="h-4 w-4" />
          Lista de Exercícios
        </h3>
        <div className="space-y-3">
          {exercicios.map((te: any) => {
            const ex = te.exercicios;
            const state = exercicioStates.get(te.exercicio_id);
            const isExpanded = expandedEx === te.exercicio_id;
            const allDone = state?.series.every((s) => s.concluida) || false;
            const doneCount = state?.series.filter((s) => s.concluida).length || 0;

            return (
              <Card
                key={te.id}
                className={`border-0 shadow-md overflow-hidden transition-all ${
                  allDone ? "opacity-60" : ""
                }`}
              >
                <CardContent className="p-0">
                  {/* Exercise header */}
                  <div
                    className="flex items-start gap-3 p-4 cursor-pointer"
                    onClick={() =>
                      setExpandedEx(isExpanded ? null : te.exercicio_id)
                    }
                  >
                    <div className="mt-0.5">
                      {allDone ? (
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold">{ex?.nome}</h4>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-1">
                          <Dumbbell className="h-3 w-3" />
                          {te.series}x{te.repeticoes}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {te.descanso_seg}s
                        </span>
                      </div>
                      {doneCount > 0 && !allDone && (
                        <p className="text-xs text-primary mt-0.5">
                          {doneCount}/{state?.series.length} séries concluídas
                        </p>
                      )}
                      {te.observacoes && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {te.observacoes}
                        </p>
                      )}
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                  </div>

                  {/* Expanded: exercise details + series tracking */}
                  <AnimatePresence>
                    {isExpanded && state && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <Separator />
                        <div className="p-4 space-y-4">
                          {/* Info badges */}
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="default" className="text-xs">
                              {te.series} séries x {te.repeticoes} reps
                            </Badge>
                            <Badge variant="secondary" className="text-xs flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {te.descanso_seg}s descanso
                            </Badge>
                          </div>

                          {/* Observações */}
                          {ex?.descricao && (
                            <div className="bg-muted/50 rounded-lg p-3 text-sm">
                              <div className="flex items-start gap-2">
                                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                                <p className="text-muted-foreground">{ex.descricao}</p>
                              </div>
                            </div>
                          )}

                          {/* Exercise video */}
                          {(() => {
                            const videoUrl = ex?.video_url;
                            const isYoutube = videoUrl && (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be"));
                            const isUploadVideo = videoUrl && !isYoutube;
                            return (
                              <>
                                {isUploadVideo && (
                                  <video
                                    src={videoUrl}
                                    controls
                                    muted
                                    playsInline
                                    preload="metadata"
                                    onVolumeChange={(e) => { e.currentTarget.muted = true; }}
                                    className="w-full rounded-lg border border-border/50"
                                    style={{ maxHeight: 220 }}
                                  />
                                )}
                                {isYoutube && (
                                  <a
                                    href={videoUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                                  >
                                    <Film className="h-4 w-4" />
                                    Ver vídeo no YouTube
                                  </a>
                                )}
                              </>
                            );
                          })()}

                          {/* Series tracking */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <h5 className="text-sm font-semibold">Registrar Séries</h5>
                              <span className="text-xs text-muted-foreground">
                                {doneCount}/{state.series.length}
                              </span>
                            </div>
                            <div className="space-y-2">
                              {state.series.map((serie, idx) => (
                                <div
                                  key={idx}
                                  className={`flex items-center gap-3 rounded-lg border p-3 transition-all ${
                                    serie.concluida
                                      ? "bg-primary/5 border-primary/20"
                                      : "border-border"
                                  }`}
                                >
                                  <span className="text-sm font-medium w-6 text-center text-muted-foreground">
                                    {idx + 1}
                                  </span>
                                  <div className="flex-1 grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="text-xs text-muted-foreground">
                                        Repetições
                                      </label>
                                      <Input
                                        type="number"
                                        value={serie.repeticoes || ""}
                                         onChange={(e) =>
                                           updateSerie(
                                             te.exercicio_id,
                                             idx,
                                             "repeticoes",
                                             parseInt(e.target.value) || 0
                                           )
                                         }
                                         onBlur={(e) =>
                                           handleSerieFieldChange(
                                             te.exercicio_id,
                                             idx,
                                             "repeticoes",
                                             parseInt(e.target.value) || 0
                                           )
                                         }
                                        className="h-8 text-sm"
                                        min={0}
                                      />
                                    </div>
                                    <div>
                                      <label className="text-xs text-muted-foreground">
                                        Carga (kg)
                                      </label>
                                      <Input
                                        type="number"
                                        step="0.5"
                                        value={serie.carga_kg || ""}
                                        onChange={(e) =>
                                          updateSerie(
                                            te.exercicio_id,
                                            idx,
                                            "carga_kg",
                                            parseFloat(e.target.value) || 0
                                          )
                                        }
                                         onBlur={(e) =>
                                           handleSerieFieldChange(
                                             te.exercicio_id,
                                             idx,
                                             "carga_kg",
                                             parseFloat(e.target.value) || 0
                                           )
                                         }
                                        className="h-8 text-sm"
                                        min={0}
                                      />
                                    </div>
                                  </div>
                                  <Checkbox
                                    checked={serie.concluida}
                                    onCheckedChange={(checked) =>
                                      handleCheckSerie(
                                        te.exercicio_id,
                                        idx,
                                        !!checked
                                      )
                                    }
                                    className="h-6 w-6"
                                  />
                                </div>
                              ))}
                            </div>

                            {/* Concluir exercício button */}
                            {!allDone && (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="w-full mt-3"
                                disabled={doneCount < state.series.length}
                                onClick={async () => {
                                  for (let i = 0; i < state.series.length; i++) {
                                    if (!state.series[i].concluida) {
                                      await handleCheckSerie(te.exercicio_id, i, true);
                                    }
                                  }
                                  setExpandedEx(null);
                                }}
                              >
                                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                                Concluir Exercício ({doneCount}/{state.series.length} séries)
                              </Button>
                            )}
                            {allDone && (
                              <div className="flex items-center justify-center gap-2 mt-3 text-sm text-primary font-medium">
                                <CheckCircle2 className="h-4 w-4" />
                                Exercício Concluído
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Bottom actions */}
      <div className="fixed bottom-20 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t border-border">
        <div className="flex gap-3 max-w-lg mx-auto">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => navigate("/app/treinos")}
          >
            Voltar
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              const hasIncomplete = Array.from(exercicioStates.values()).some(
                (es) => !es.series.every((s) => s.concluida)
              );
              if (hasIncomplete) {
                setShowIncompleteAlert(true);
              } else {
                setShowAvaliacao(true);
              }
            }}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Finalizar Treino
          </Button>
        </div>
      </div>

      {/* Alert for incomplete exercises */}
      <AlertDialog open={showIncompleteAlert} onOpenChange={setShowIncompleteAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exercícios não concluídos</AlertDialogTitle>
            <AlertDialogDescription>
              Você ainda tem {totalExercicios - exerciciosConcluidos} exercício(s) sem concluir. 
              Deseja finalizar o treino assim mesmo?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar ao treino</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setShowIncompleteAlert(false);
              setShowAvaliacao(true);
            }}>
              Finalizar assim mesmo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Avaliação dialog */}
      <AvaliacaoTreinoDialog
        open={showAvaliacao}
        onOpenChange={setShowAvaliacao}
        treinoTitulo={treino.titulo}
        loading={finalizarMutation.isPending}
        onSubmit={(data) => finalizarMutation.mutate(data)}
      />
    </div>
  );
}
