import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dumbbell, Play, ChevronDown, ChevronUp, Clock, MapPin, Calendar, CheckCircle2, RefreshCw, History, Flame, CalendarDays, MessageCircle, Send, Paperclip, Video, Loader2, Info } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { sendChatPush } from "@/lib/sendChatPush";
import CalendarioTreinos from "@/components/aluno/CalendarioTreinos";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

export default function AlunoTreinos() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [expandedTreino, setExpandedTreino] = useState<string | null>(null);
  const [mensagemTexto, setMensagemTexto] = useState("");
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const today = new Date().toISOString().split("T")[0];

  // Fetch active workouts (divisions filtered by date)
  const { data: treinosDivisoes = [], isLoading: loadingDiv } = useQuery({
    queryKey: ["aluno-treinos-divisoes", user?.id, today],
    queryFn: async () => {
      const { data } = await supabase
        .from("treinos")
        .select(`
          id, titulo, tipo, status, descricao, grupo_id,
          validade_inicio, validade_fim,
          duracao_esperada_min, distancia_esperada_km,
          treino_exercicios(
            id, ordem, series, repeticoes, descanso_seg, observacoes,
            exercicio_id,
            exercicios(id, nome, descricao, grupo_muscular, video_url, imagem_url)
          )
        `)
        .eq("aluno_id", user!.id)
        .eq("status", "ativo")
        .neq("tipo", "avulso")
        .lte("validade_inicio", today)
        .gte("validade_fim", today)
        .order("created_at", { ascending: true })
        .order("tipo", { ascending: true });
      return data || [];
    },
    enabled: !!user,
  });

  // Fetch avulso workouts
  const { data: avulsos = [], isLoading: loadingAvulsos } = useQuery({
    queryKey: ["aluno-treinos-avulsos", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("treinos")
        .select(`
          id, titulo, tipo, status, descricao,
          duracao_esperada_min, distancia_esperada_km,
          validade_inicio, validade_fim
        `)
        .eq("aluno_id", user!.id)
        .eq("status", "ativo")
        .eq("tipo", "avulso")
        .order("created_at", { ascending: true });
      return data || [];
    },
    enabled: !!user,
  });

  const isLoading = loadingDiv || loadingAvulsos;

  // Fetch today's started/completed treinos
  const { data: treinoStatusMap = {} } = useQuery({
    queryKey: ["aluno-treinos-iniciados", user?.id, today],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_treino")
        .select("treino_id, nota, registro_serie(id)")
        .eq("aluno_id", user!.id)
        .eq("data", today);
      const map: Record<string, "iniciado" | "concluido"> = {};
      const treinoRegistros = new Map<string, any[]>();
      (data || []).forEach((r: any) => {
        const arr = treinoRegistros.get(r.treino_id) || [];
        arr.push(r);
        treinoRegistros.set(r.treino_id, arr);
      });
      treinoRegistros.forEach((regs, treinoId) => {
        const hasNotCompleted = regs.some((r: any) => r.nota === null);
        const hasCompleted = regs.some((r: any) => r.nota !== null);
        if (hasNotCompleted) {
          map[treinoId] = "iniciado";
        } else if (hasCompleted) {
          map[treinoId] = "concluido";
        }
      });
      return map;
    },
    enabled: !!user,
  });

  // Fetch total completed registros for counter
  const { data: completedCounts = {} } = useQuery({
    queryKey: ["aluno-registros-completed-count", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_treino")
        .select("treino_id, nota")
        .eq("aluno_id", user!.id)
        .not("nota", "is", null);
      const map: Record<string, number> = {};
      (data || []).forEach((r: any) => {
        map[r.treino_id] = (map[r.treino_id] || 0) + 1;
      });
      return map;
    },
    enabled: !!user,
  });

  // Ordered list of treino_ids most recently completed (all-time, newest first)
  const { data: ultimosConcluidos = [] } = useQuery({
    queryKey: ["aluno-ultimos-concluidos", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_treino")
        .select("treino_id, data, created_at")
        .eq("aluno_id", user!.id)
        .not("nota", "is", null)
        .order("data", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
      return (data || []).map((r: any) => r.treino_id as string);
    },
    enabled: !!user,
  });


  // Fetch recent workout history - by division/avulso
  const { data: historicoRecente = [] } = useQuery({
    queryKey: ["aluno-historico-recente", user?.id],
    queryFn: async () => {
      const { data: registros } = await supabase
        .from("registro_treino")
        .select("id, treino_id, data, nota, duracao_min, treinos(titulo, tipo, grupo_id)")
        .eq("aluno_id", user!.id)
        .not("nota", "is", null)
        .order("data", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(15);

      return registros || [];
    },
    enabled: !!user,
  });

  // Messages query for trainer chat
  const { data: mensagensTreino = [] } = useQuery({
    queryKey: ["mensagens-treino", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("mensagens_treino" as any)
        .select("*")
        .eq("aluno_id", user.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!user?.id,
  });

  // Marca mensagens do treinador como lidas ao visualizar a tela
  useEffect(() => {
    if (!user?.id) return;
    const hasUnread = mensagensTreino.some(
      (m: any) => m.remetente_tipo === "treinador" && !m.lida
    );
    if (!hasUnread) return;
    (async () => {
      await supabase
        .from("mensagens_treino" as any)
        .update({ lida: true })
        .eq("aluno_id", user.id)
        .eq("remetente_tipo", "treinador")
        .eq("lida", false);
      queryClient.invalidateQueries({ queryKey: ["mensagens-treino"] });
      queryClient.invalidateQueries({ queryKey: ["aluno-msgs-treino", user.id] });
    })();
  }, [user?.id, mensagensTreino, queryClient]);

  const sendMensagemTreino = useMutation({
    mutationFn: async () => {
      if (!user?.id || !mensagemTexto.trim()) return;
      const { error } = await supabase
        .from("mensagens_treino" as any)
        .insert({
          aluno_id: user.id,
          remetente_id: user.id,
          remetente_tipo: 'aluno',
          mensagem: mensagemTexto.trim(),
        } as any);
      if (error) throw error;
      void sendChatPush({
        recipientRole: "admin",
        title: "Nova mensagem de aluno (treino)",
        body: mensagemTexto.trim().slice(0, 140),
        url: "/#/admin/alunos",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mensagens-treino"] });
      setMensagemTexto("");
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" });
    },
  });

  const handleVideoUpload = async (file: File) => {
    if (!user?.id) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Vídeo muito grande", description: "O tamanho máximo é 10MB.", variant: "destructive" });
      return;
    }
    setUploadingVideo(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("chat-videos").upload(path, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("chat-videos").getPublicUrl(path);
      const { error } = await supabase.from("mensagens_treino" as any).insert({
        aluno_id: user.id,
        remetente_id: user.id,
        remetente_tipo: 'aluno',
        mensagem: '📹 Vídeo',
        video_url: urlData.publicUrl,
      } as any);
      if (error) throw error;
      void sendChatPush({
        recipientRole: "admin",
        title: "Nova mensagem de aluno (treino)",
        body: "📹 Vídeo enviado",
        url: "/#/admin/alunos",
      });
      queryClient.invalidateQueries({ queryKey: ["mensagens-treino"] });
    } catch (err: any) {
      toast({ title: "Erro ao enviar vídeo", description: err.message, variant: "destructive" });
    } finally {
      setUploadingVideo(false);
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagensTreino]);

  // Group treinos by grupo_id into rotinas
  const rotinaMap = new Map<string, any[]>();
  treinosDivisoes.forEach((t: any) => {
    if (t.grupo_id) {
      const arr = rotinaMap.get(t.grupo_id) || [];
      arr.push(t);
      rotinaMap.set(t.grupo_id, arr);
    } else {
      const arr = rotinaMap.get(t.id) || [];
      arr.push(t);
      rotinaMap.set(t.id, arr);
    }
  });

  // Ensure each rotina's divisions are sorted by tipo (A, B, C, D...) so the
  // "next" logic is deterministic even when created_at is identical.
  rotinaMap.forEach((arr) => {
    arr.sort((a: any, b: any) => String(a.tipo || "").localeCompare(String(b.tipo || "")));
  });

  const rotinas = Array.from(rotinaMap.entries());

  const countForTreino = (treinoId: string) =>
    completedCounts[treinoId] || 0;

  // Next = the item right after the most recently completed one (all-time),
  // so the rotation persists across days instead of resetting daily.
  const getNextInRotation = (lista: any[]): string | null => {
    if (!lista.length) return null;
    const ids = lista.map((t: any) => t.id);
    const lastCompletedId = ultimosConcluidos.find((id: string) => ids.includes(id));
    if (!lastCompletedId) {
      const neverDone = lista.find((t: any) => !completedCounts[t.id]);
      return (neverDone || lista[0]).id;
    }
    const idx = ids.indexOf(lastCompletedId);
    return ids[(idx + 1) % ids.length];
  };

  const getNextTreinoId = (divisoes: any[]): string | null => getNextInRotation(divisoes);

  const nextAvulsoId = getNextInRotation(avulsos);
  const nextAvulso = avulsos.find((a: any) => a.id === nextAvulsoId) || null;

  // Get the first rotina info for the hero banner
  const firstRotina = rotinas.length > 0 ? rotinas[0] : null;
  const heroFirst = firstRotina ? firstRotina[1][0] : null;
  const heroNextId = firstRotina ? getNextTreinoId(firstRotina[1]) : null;
  const heroNextDiv = firstRotina
    ? firstRotina[1].find((d: any) => d.id === heroNextId) || firstRotina[1][0]
    : null;


  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-4 p-4"
    >
      {/* Page header */}
      <motion.div variants={item}>
        <h1 className="text-2xl font-bold text-primary">Meu Treino</h1>
        <p className="text-sm text-muted-foreground">Acompanhe e execute sua rotina de treino personalizada</p>
      </motion.div>

      <Tabs defaultValue="treinos" className="w-full">
        <TabsList className="w-full max-w-xs">
          <TabsTrigger value="treinos" className="flex-1 gap-1.5">
            <Dumbbell className="h-3.5 w-3.5" />
            Treinos
          </TabsTrigger>
          <TabsTrigger value="calendario" className="flex-1 gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            Calendário
          </TabsTrigger>
        </TabsList>

        <TabsContent value="treinos" className="mt-4">

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : treinosDivisoes.length === 0 && avulsos.length === 0 ? (
        <Card className="border-0 shadow-md">
          <CardContent className="flex flex-col items-center p-8 text-center">
            <Dumbbell className="h-10 w-10 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              Nenhum treino ativo no momento. Seu professor vai montar sua rotina em breve!
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Hero banner - Seu Treino Ativo */}
          {heroFirst && (
            <motion.div variants={item}>
              <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary via-primary/90 to-accent p-5 text-primary-foreground shadow-lg">
                {/* Decorative dumbbell icon */}
                <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-20">
                  <Dumbbell className="h-24 w-24 rotate-12" />
                </div>

                <div className="relative z-10">
                  <div className="flex items-center gap-2 text-sm opacity-90 mb-1">
                    <Clock className="h-4 w-4" />
                    <span>Seu Treino Ativo</span>
                  </div>

                  <h2 className="text-xl font-bold mb-1">
                    {heroFirst.descricao || heroFirst.titulo || "Rotina de Treino"}
                  </h2>

                  <div className="flex flex-wrap items-center gap-3 mt-3">
                    {heroFirst.validade_inicio && heroFirst.validade_fim && (
                      <span className="flex items-center gap-1.5 text-sm opacity-90">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(new Date(heroFirst.validade_inicio + "T12:00:00"), "dd/MM")} - {format(new Date(heroFirst.validade_fim + "T12:00:00"), "dd/MM")}
                      </span>
                    )}
                    {heroNextDiv && (
                      <Badge className="bg-primary-foreground/20 text-primary-foreground border-0 text-xs">
                        Próximo: Treino {heroNextDiv.tipo}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Two-column layout: Divisions + History */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            {/* Left column: Divisões de Treino */}
            <motion.div variants={item} className="space-y-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Dumbbell className="h-5 w-5 text-primary" />
                Divisões de Treino
              </h3>

              {rotinas.map(([grupoId, divisoes]) => {
                const nextTreinoId = getNextTreinoId(divisoes);

                return divisoes.map((treino: any) => {
                  const exercicios = (treino.treino_exercicios || []).sort(
                    (a: any, b: any) => a.ordem - b.ordem
                  );
                  const isDivExpanded = expandedTreino === treino.id;
                  const concluidos = countForTreino(treino.id);
                  const isNext = treino.id === nextTreinoId;

                  return (
                    <div
                      key={treino.id}
                      className={cn(
                        "rounded-xl border overflow-hidden transition-all",
                        isNext ? "border-primary ring-2 ring-primary/20 shadow-md" : "border-border/60"
                      )}
                    >
                      {/* Division header */}
                      <div
                        className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => setExpandedTreino(isDivExpanded ? null : treino.id)}
                      >
                        <div className="flex items-center gap-2">
                          <Dumbbell className="h-4 w-4 text-primary" />
                          <span className="font-semibold">Treino {treino.tipo}</span>
                          {isNext && (
                            <Badge className="text-[10px] px-1.5 py-0 bg-primary text-primary-foreground">
                              Próximo
                            </Badge>
                          )}
                          {concluidos > 0 && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {concluidos}x
                            </Badge>
                          )}
                        </div>
                        {isDivExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>

                      {/* Exercise list preview */}
                      {!isDivExpanded && exercicios.length > 0 && (
                        <div className="px-4 pb-2 space-y-1">
                          {exercicios.map((ex: any, idx: number) => (
                            <p key={ex.id} className="text-xs text-muted-foreground">
                              {idx + 1}. {ex.exercicios?.nome} - {ex.series}x{ex.repeticoes}
                            </p>
                          ))}
                        </div>
                      )}

                      {/* Expanded exercise list */}
                      <AnimatePresence>
                        {isDivExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 pb-2 space-y-3 border-t border-border/30 pt-3">
                              {exercicios.map((ex: any, idx: number) => (
                                <div key={ex.id} className="space-y-1">
                                  <p className="text-sm font-medium">
                                    {idx + 1}. {ex.exercicios?.nome}
                                  </p>
                                  <p className="text-xs text-muted-foreground pl-4">
                                    {ex.series}x{ex.repeticoes} · {ex.descanso_seg}s descanso
                                  </p>
                                  {ex.observacoes && (
                                    <div className="ml-4 mt-1 flex items-start gap-1.5 rounded-md bg-muted/50 px-2.5 py-1.5">
                                      <Info className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                                      <p className="text-[11px] text-muted-foreground">
                                        {ex.observacoes}
                                      </p>
                                    </div>
                                  )}
                                  {ex.exercicios?.descricao && !ex.observacoes && (
                                    <div className="ml-4 mt-1 flex items-start gap-1.5 rounded-md bg-muted/50 px-2.5 py-1.5">
                                      <Info className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                                      <p className="text-[11px] text-muted-foreground">
                                        {ex.exercicios.descricao}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Start button */}
                      <div className="p-4 pt-1">
                        {treinoStatusMap[treino.id] === "concluido" ? (
                          <div className="flex items-center justify-between gap-2 py-1">
                            <div className="flex items-center gap-2 text-sm font-medium text-primary">
                              <CheckCircle2 className="h-4 w-4" />
                              Treino Concluído
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/app/treino/${treino.id}`);
                              }}
                            >
                              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                              Refazer
                            </Button>
                          </div>
                        ) : (
                          <Button
                            className="w-full"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/app/treino/${treino.id}`);
                            }}
                          >
                            <Play className="mr-2 h-3.5 w-3.5" />
                            {treinoStatusMap[treino.id] === "iniciado" ? "Continuar" : "Iniciar"} Treino {treino.tipo}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                });
              })}

              {/* Treinos Avulsos */}
              {avulsos.length > 0 && (
                <div className="space-y-4 mt-2">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Clock className="h-5 w-5 text-primary" />
                    Treinos Avulsos
                  </h3>
                  {avulsos.map((ta: any) => {
                    const isNextAvulso = ta.id === nextAvulsoId;
                    return (
                      <div
                        key={ta.id}
                        className={cn(
                          "rounded-xl border overflow-hidden transition-all",
                          isNextAvulso ? "border-primary ring-2 ring-primary/20 shadow-md" : "border-border/60"
                        )}
                      >
                        <div className="p-4">
                          <div className="flex items-center gap-2 mb-1">
                            <Clock className="h-4 w-4 text-primary" />
                            <span className="font-semibold text-sm">{ta.titulo}</span>
                            {isNextAvulso && (
                              <Badge className="text-[10px] px-1.5 py-0 bg-primary text-primary-foreground">
                                Próximo: {ta.titulo}

                              </Badge>
                            )}
                          </div>
                          {ta.descricao && (
                            <p className="text-xs text-muted-foreground mb-2 pl-6">{ta.descricao}</p>
                          )}
                          <div className="flex items-center gap-4 text-xs text-muted-foreground pl-6">
                            {ta.duracao_esperada_min && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {ta.duracao_esperada_min} min
                              </span>
                            )}
                            {ta.distancia_esperada_km && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {ta.distancia_esperada_km} km
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="p-4 pt-0">
                          {treinoStatusMap[ta.id] === "concluido" ? (
                            <div className="flex items-center justify-between gap-2 py-1">
                              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                                <CheckCircle2 className="h-4 w-4" />
                                Treino Concluído
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/app/treino-avulso/${ta.id}`);
                                }}
                              >
                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                Refazer
                              </Button>
                            </div>
                          ) : (
                            <Button
                              className="w-full"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/app/treino-avulso/${ta.id}`);
                              }}
                            >
                              <Play className="mr-2 h-3.5 w-3.5" />
                              {treinoStatusMap[ta.id] === "iniciado" ? "Continuar" : "Iniciar"} {ta.titulo}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>

            {/* Right column: Histórico Recente */}
            <motion.div variants={item} className="space-y-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                Histórico Recente
              </h3>

              <Card className="border-0 shadow-sm max-h-[360px] overflow-hidden flex flex-col">
                <CardContent className="p-4 overflow-y-auto no-scrollbar">
                  <div className="flex items-center gap-2 mb-4 text-sm font-semibold text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    Últimos Treinos
                  </div>

                  {historicoRecente.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      Nenhum treino concluído ainda
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {historicoRecente.map((reg: any) => (
                        <div
                          key={reg.id}
                          className="py-2 border-b border-border/30 last:border-0"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-sm font-medium">
                              {(reg.treinos as any)?.tipo && (reg.treinos as any)?.tipo !== "avulso"
                                ? `Treino ${(reg.treinos as any).tipo}`
                                : (reg.treinos as any)?.titulo || "Treino"}
                            </p>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {format(new Date(reg.data + "T12:00:00"), "dd/MM", { locale: ptBR })}
                            </span>
                          </div>


                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {reg.nota && (
                              <span className="flex items-center gap-1">
                                <Flame className="h-3 w-3 text-primary" />
                                Intensidade: {reg.nota}/10
                              </span>
                            )}
                            {reg.duracao_min && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {reg.duracao_min}min
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Right column: Chat com Treinador */}
            <motion.div variants={item} className="mt-6 lg:mt-0">
              <Card className="border-0 shadow-md">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MessageCircle className="h-5 w-5 text-primary" />
                    Mensagens para o Treinador
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="h-[240px] overflow-y-auto space-y-3 rounded-lg bg-muted/20 p-3">
                    {mensagensTreino.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Envie uma mensagem para seu treinador sobre seus treinos.
                      </p>
                    ) : (
                      mensagensTreino.map((msg: any) => {
                        const isMine = msg.remetente_tipo === 'aluno';
                        return (
                          <div
                            key={msg.id}
                            className={cn(
                              "flex flex-col max-w-[80%]",
                              isMine ? "ml-auto items-end" : "mr-auto items-start"
                            )}
                          >
                            <span className={cn(
                              "text-[10px] font-semibold mb-0.5 px-1",
                              isMine ? "text-primary" : "text-emerald-600"
                            )}>
                              {isMine ? "Você" : "Treinador"}
                            </span>
                            <div
                              className={cn(
                                "rounded-2xl px-3 py-2",
                                isMine
                                  ? "bg-primary text-primary-foreground rounded-br-sm"
                                  : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100 rounded-bl-sm"
                              )}
                            >
                              {msg.video_url ? (
                                <video
                                  src={msg.video_url}
                                  controls
                                  preload="metadata"
                                  className="rounded-lg max-w-[220px] max-h-[160px]"
                                />
                              ) : (
                                <p className="text-sm whitespace-pre-wrap">{msg.mensagem}</p>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                              {format(new Date(msg.created_at), "dd/MM HH:mm", { locale: ptBR })}
                            </span>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleVideoUpload(file);
                    }}
                  />
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (mensagemTexto.trim()) sendMensagemTreino.mutate();
                    }}
                    className="flex items-center gap-2"
                  >
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={uploadingVideo}
                      onClick={() => videoInputRef.current?.click()}
                      title="Anexar vídeo"
                    >
                      {uploadingVideo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                    </Button>
                    <Input
                      placeholder="Escreva sua mensagem..."
                      value={mensagemTexto}
                      onChange={(e) => setMensagemTexto(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!mensagemTexto.trim() || sendMensagemTreino.isPending}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </>
      )}

        </TabsContent>

        <TabsContent value="calendario" className="mt-4">
          <CalendarioTreinos />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
