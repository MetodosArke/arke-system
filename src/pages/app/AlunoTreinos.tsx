import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { RegistrarAlertaCard } from "@/components/aluno/RegistrarAlertaCard";
import { ChatPanel } from "@/components/chat/ChatPanel";
import CalendarioTreinos from "@/components/aluno/CalendarioTreinos";
import RotinaSemanal from "@/components/aluno/RotinaSemanal";
import type { Json } from "@/integrations/supabase/types";
import { MidiaExercicio } from "@/components/acervo/MidiaExercicio";
import { divisoesDoTreino, rotuloTecnica, seriesDoExercicio } from "@/lib/seriesTreino";

interface ExercicioSnapshot {
  ordem: number;
  nome_exercicio: string;
  grupo_muscular: string[];
  series: number;
  repeticoes: string;
  descanso_seg: number;
  observacoes: string | null;
  video_url: string | null;
  descricao_execucao: string | null;
  gif_url: string | null;
  // Fichas publicadas antes das divisões e das séries individuais não têm estes.
  divisao?: string | null;
  series_detalhe?: unknown;
  equipamento?: string | null;
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
  const [videoAberto, setVideoAberto] = useState<{ url: string; imagem: string | null; nome: string } | null>(null);
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
        .select("id, concluido, detalhes_execucao, divisao")
        .eq("aluno_id", alunoId!)
        .eq("data", HOJE)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const todosExercicios = (treino?.snapshot_conteudo as unknown as ExercicioSnapshot[] | null) ?? [];
  // Divisões A, B, C... O aluno escolhe a do dia; se já treinou hoje, abre na que registrou.
  const divisoes = divisoesDoTreino(todosExercicios);
  const [divisaoEscolhida, setDivisaoEscolhida] = useState<string | null>(null);
  const divisaoHoje =
    divisaoEscolhida ?? (registroHoje?.divisao && divisoes.includes(registroHoje.divisao) ? registroHoje.divisao : divisoes[0] ?? "A");
  const exercicios = todosExercicios.filter((e) => (e.divisao || "A") === divisaoHoje);
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
      const ordensDoDia = new Set(exercicios.map((e) => e.ordem));
      const todosConcluidos =
        exercicios.length > 0 && exercicios.every((e) => novoProgresso[e.ordem]?.concluido) && listaDetalhes.some((d) => ordensDoDia.has(d.ordem));
      const { error } = await supabase.from("registro_treino").upsert(
        {
          organization_id: organization.id,
          aluno_id: alunoId,
          treino_id: treino?.id ?? null,
          data: HOJE,
          divisao: divisaoHoje,
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
      void queryClient.invalidateQueries({ queryKey: ["aluno-treino-streak", alunoId] });
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

  const totalConcluidos = exercicios.filter((e) => progresso[e.ordem]?.concluido).length;
  const treinoConcluidoHoje = !!registroHoje?.concluido;

  return (
    <div className="space-y-4 max-w-2xl lg:max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <Dumbbell className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Meu Treino</h1>
      </div>

      <Tabs defaultValue="treino">
        <TabsList>
          <TabsTrigger value="treino">Treino</TabsTrigger>
          <TabsTrigger value="calendario">Calendário</TabsTrigger>
        </TabsList>

        <TabsContent value="treino" className="space-y-4">
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

          {divisoes.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Qual treino hoje">
              {divisoes.map((d) => (
                <Button key={d} size="sm" variant={d === divisaoHoje ? "default" : "outline"} aria-pressed={d === divisaoHoje} onClick={() => setDivisaoEscolhida(d)}>
                  Treino {d}
                </Button>
              ))}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>
                {treino.titulo}
                {divisoes.length > 1 && <span className="text-muted-foreground font-normal"> · Treino {divisaoHoje}</span>}
              </CardTitle>
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
                        <ol className="mt-1.5 space-y-0.5" aria-label={`Séries de ${ex.nome_exercicio}`}>
                          {seriesDoExercicio(ex).map((serie, i) => (
                            <li key={i} className="text-xs flex items-center gap-1.5">
                              <span className="text-muted-foreground w-12">Série {i + 1}</span>
                              <span className="font-medium">{serie.reps} reps</span>
                              <span className="text-muted-foreground">· {serie.descanso_seg}s</span>
                              {serie.tecnica && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1">
                                  {rotuloTecnica(serie.tecnica)}
                                </Badge>
                              )}
                            </li>
                          ))}
                        </ol>
                        {ex.equipamento && <p className="text-[11px] text-muted-foreground mt-1">Equipamento: {ex.equipamento}</p>}
                        {ex.observacoes && <p className="text-xs text-muted-foreground mt-1">{ex.observacoes}</p>}
                        {ex.descricao_execucao && (
                          <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{ex.descricao_execucao}</p>
                        )}
                        {ex.gif_url && !ex.video_url && (
                          <MidiaExercicio imagemUrl={ex.gif_url} nome={ex.nome_exercicio} className="max-w-xs mt-2" />
                        )}

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
                              onClick={() => setVideoAberto({ url: ex.video_url!, imagem: ex.gif_url, nome: ex.nome_exercicio })}
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
        </TabsContent>

        <TabsContent value="calendario" className="space-y-4">
          <CalendarioTreinos rotina={<RotinaSemanal />} />
        </TabsContent>
      </Tabs>

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
          {/* Toca dentro do app: vídeo próprio no player nativo, YouTube embutido. Antes era um
              iframe com o link cru — link comum do YouTube não abre em iframe, e a tela ficava em branco. */}
          {videoAberto && <MidiaExercicio videoUrl={videoAberto.url} imagemUrl={videoAberto.imagem} nome={videoAberto.nome} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
