import { useState, useEffect, useCallback } from "react";
import TreinoExecucaoBase from "./ProfessorTreinoExecucaoBase";
import ProfessorAvulsoExecucao from "./ProfessorAvulsoExecucaoInline";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dumbbell, Play, ChevronDown, ChevronUp, Clock, MapPin,
  Calendar, CheckCircle2, RefreshCw, X, Plus, Search, User, Flame, Info,
  HeartPulse,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ReuniaoAcolhimentoForm from "@/components/admin/prontuario/ReuniaoAcolhimentoForm";

function AcolhimentoCollapsible({ alunoId }: { alunoId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border border-border/60 shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          <HeartPulse className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Reunião de Acolhimento</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3 pt-0 border-t border-border/30">
              <ReuniaoAcolhimentoForm alunoId={alunoId} readOnly />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

interface AlunoTab {
  id: string;
  alunoId: string;
  alunoName: string;
}

function AlunoWorkoutView({ alunoId, onStartTreino, onStartAvulso }: { alunoId: string; onStartTreino: (treinoId: string) => void; onStartAvulso: (treinoId: string) => void }) {
  const navigate = useNavigate();
  const [expandedTreino, setExpandedTreino] = useState<string | null>(null);
  const today = new Date().toISOString().split("T")[0];

  const { data: treinosDivisoes = [], isLoading: loadingDiv } = useQuery({
    queryKey: ["prof-treinos-divisoes", alunoId, today],
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
        .eq("aluno_id", alunoId)
        .eq("status", "ativo")
        .neq("tipo", "avulso")
        .lte("validade_inicio", today)
        .gte("validade_fim", today)
        .order("created_at", { ascending: true });
      return data || [];
    },
  });

  const { data: avulsos = [], isLoading: loadingAvulsos } = useQuery({
    queryKey: ["prof-treinos-avulsos", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("treinos")
        .select(`
          id, titulo, tipo, status, descricao,
          duracao_esperada_min, distancia_esperada_km,
          validade_inicio, validade_fim
        `)
        .eq("aluno_id", alunoId)
        .eq("status", "ativo")
        .eq("tipo", "avulso")
        .order("created_at", { ascending: true });
      return data || [];
    },
  });

  const isLoading = loadingDiv || loadingAvulsos;

  const { data: treinoStatusMap = {} } = useQuery({
    queryKey: ["prof-treinos-status", alunoId, today],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_treino")
        .select("treino_id, nota, registro_serie(id)")
        .eq("aluno_id", alunoId)
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
        if (hasNotCompleted) map[treinoId] = "iniciado";
        else if (hasCompleted) map[treinoId] = "concluido";
      });
      return map;
    },
  });

  const { data: completedCounts = {} } = useQuery({
    queryKey: ["prof-registros-count", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_treino")
        .select("treino_id, nota")
        .eq("aluno_id", alunoId)
        .not("nota", "is", null);
      const map: Record<string, number> = {};
      (data || []).forEach((r: any) => {
        map[r.treino_id] = (map[r.treino_id] || 0) + 1;
      });
      return map;
    },
  });

  const { data: historicoRecente = [] } = useQuery({
    queryKey: ["prof-historico", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_treino")
        .select("id, treino_id, data, nota, duracao_min, treinos(titulo, tipo, grupo_id)")
        .eq("aluno_id", alunoId)
        .not("nota", "is", null)
        .order("data", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(10);
      return data || [];
    },
  });

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
  const rotinas = Array.from(rotinaMap.entries());

  const getNextTreinoId = (divisoes: any[]): string | null => {
    const notDone = divisoes.find((d: any) => treinoStatusMap[d.id] !== "concluido");
    return notDone?.id || divisoes[0]?.id || null;
  };

  const heroFirst = rotinas.length > 0 ? rotinas[0][1][0] : null;
  const heroNextDiv = rotinas.length > 0
    ? rotinas[0][1].find((d: any) => treinoStatusMap[d.id] !== "concluido") || rotinas[0][1][0]
    : null;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted/50" />
        ))}
      </div>
    );
  }

  if (treinosDivisoes.length === 0 && avulsos.length === 0) {
    return (
      <Card className="border-0 shadow-md">
        <CardContent className="flex flex-col items-center p-8 text-center">
          <Dumbbell className="h-10 w-10 text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">
            Nenhum treino ativo para este aluno.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Hero */}
      {heroFirst && (
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary via-primary/90 to-accent p-4 text-primary-foreground shadow-lg">
          <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-20">
            <Dumbbell className="h-20 w-20 rotate-12" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-sm opacity-90 mb-1">
              <Clock className="h-4 w-4" />
              <span>Treino Ativo</span>
            </div>
            <h2 className="text-lg font-bold mb-1">
              {heroFirst.descricao || heroFirst.titulo}
            </h2>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              {heroFirst.validade_inicio && heroFirst.validade_fim && (
                <span className="flex items-center gap-1.5 text-xs opacity-90">
                  <Calendar className="h-3 w-3" />
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
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* Divisões */}
        <div className="space-y-3">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Dumbbell className="h-4 w-4 text-primary" />
            Divisões de Treino
          </h3>

          {rotinas.map(([grupoId, divisoes]) => {
            const nextTreinoId = getNextTreinoId(divisoes);
            return divisoes.map((treino: any) => {
              const exercicios = (treino.treino_exercicios || []).sort((a: any, b: any) => a.ordem - b.ordem);
              const isDivExpanded = expandedTreino === treino.id;
              const concluidos = completedCounts[treino.id] || 0;
              const isNext = treino.id === nextTreinoId;

              return (
                <div
                  key={treino.id}
                  className={cn(
                    "rounded-xl border overflow-hidden transition-all",
                    isNext ? "border-primary ring-2 ring-primary/20 shadow-md" : "border-border/60"
                  )}
                >
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedTreino(isDivExpanded ? null : treino.id)}
                  >
                    <div className="flex items-center gap-2">
                      <Dumbbell className="h-4 w-4 text-primary" />
                      <span className="font-semibold text-sm">Treino {treino.tipo}</span>
                      {isNext && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-primary text-primary-foreground">Próximo</Badge>
                      )}
                      {concluidos > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{concluidos}x</Badge>
                      )}
                    </div>
                    {isDivExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>

                  {!isDivExpanded && exercicios.length > 0 && (
                    <div className="px-3 pb-2 space-y-0.5">
                      {exercicios.map((ex: any, idx: number) => (
                        <p key={ex.id} className="text-xs text-muted-foreground">
                          {idx + 1}. {ex.exercicios?.nome} - {ex.series}x{ex.repeticoes}
                        </p>
                      ))}
                    </div>
                  )}

                  <AnimatePresence>
                    {isDivExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-3 pb-2 space-y-2 border-t border-border/30 pt-2">
                          {exercicios.map((ex: any, idx: number) => (
                            <div key={ex.id} className="space-y-0.5">
                              <p className="text-sm font-medium">{idx + 1}. {ex.exercicios?.nome}</p>
                              <p className="text-xs text-muted-foreground pl-4">
                                {ex.series}x{ex.repeticoes} · {ex.descanso_seg}s descanso
                              </p>
                              {ex.observacoes && (
                                <div className="ml-4 mt-0.5 flex items-start gap-1.5 rounded-md bg-muted/50 px-2 py-1">
                                  <Info className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                                  <p className="text-[11px] text-muted-foreground">{ex.observacoes}</p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="p-3 pt-1">
                    {treinoStatusMap[treino.id] === "concluido" ? (
                      <div className="flex items-center justify-between gap-2 py-1">
                        <div className="flex items-center gap-2 text-sm font-medium text-primary">
                          <CheckCircle2 className="h-4 w-4" />
                          Concluído
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onStartTreino(treino.id)}
                        >
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                          Refazer
                        </Button>
                      </div>
                    ) : (
                      <Button
                        className="w-full"
                        size="sm"
                        onClick={() => onStartTreino(treino.id)}
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

          {/* Avulsos */}
          {avulsos.length > 0 && (
            <div className="space-y-3 mt-2">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Treinos Avulsos
              </h3>
              {avulsos.map((ta: any) => (
                <div key={ta.id} className="rounded-xl border border-border/60 overflow-hidden">
                  <div className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="h-4 w-4 text-primary" />
                      <span className="font-semibold text-sm">{ta.titulo}</span>
                    </div>
                    {ta.descricao && <p className="text-xs text-muted-foreground mb-1 pl-6">{ta.descricao}</p>}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pl-6">
                      {ta.duracao_esperada_min && (
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{ta.duracao_esperada_min} min</span>
                      )}
                      {ta.distancia_esperada_km && (
                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{ta.distancia_esperada_km} km</span>
                      )}
                    </div>
                  </div>
                  <div className="p-3 pt-0">
                    {treinoStatusMap[ta.id] === "concluido" ? (
                      <div className="flex items-center justify-between gap-2 py-1">
                        <div className="flex items-center gap-2 text-sm font-medium text-primary">
                          <CheckCircle2 className="h-4 w-4" />
                          Concluído
                        </div>
                        <Button variant="outline" size="sm" onClick={() => onStartAvulso(ta.id)}>
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                          Refazer
                        </Button>
                      </div>
                    ) : (
                      <Button className="w-full" size="sm" onClick={() => onStartAvulso(ta.id)}>
                        <Play className="mr-2 h-3.5 w-3.5" />
                        {treinoStatusMap[ta.id] === "iniciado" ? "Continuar" : "Iniciar"} {ta.titulo}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Histórico */}
        <div className="space-y-3">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Histórico Recente
          </h3>
          <Card className="border-0 shadow-sm max-h-[320px] overflow-hidden flex flex-col">
            <CardContent className="p-3 overflow-y-auto no-scrollbar">
              {historicoRecente.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhum treino concluído</p>
              ) : (
                <div className="space-y-2">
                  {historicoRecente.map((reg: any) => (
                    <div key={reg.id} className="py-1.5 border-b border-border/30 last:border-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-sm font-medium">
                          {(reg.treinos as any)?.grupo_id ? `Treino ${(reg.treinos as any)?.tipo || ""}` : (reg.treinos as any)?.titulo || "Avulso"}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(reg.data + "T12:00:00"), "dd/MM", { locale: ptBR })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {reg.nota && (
                          <span className="flex items-center gap-1">
                            <Flame className="h-3 w-3 text-primary" />
                            {reg.nota}/10
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
        </div>
      </div>
    </div>
  );
}

export default function ProfessorTreinos() {
  const [tabs, setTabs] = useState<AlunoTab[]>(() => {
    try {
      const saved = sessionStorage.getItem("prof-tabs");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [activeTab, setActiveTab] = useState<string>(() => {
    return sessionStorage.getItem("prof-active-tab") || "";
  });
  const [searchAluno, setSearchAluno] = useState("");

  // Persist tabs to sessionStorage
  useEffect(() => {
    sessionStorage.setItem("prof-tabs", JSON.stringify(tabs));
  }, [tabs]);

  useEffect(() => {
    sessionStorage.setItem("prof-active-tab", activeTab);
  }, [activeTab]);

  // Track active execution per tab: { tabId: { type: 'treino' | 'avulso', treinoId: string } }
  const [executions, setExecutions] = useState<Record<string, { type: 'treino' | 'avulso'; treinoId: string }>>({});

  const startExecution = useCallback((tabId: string, type: 'treino' | 'avulso', treinoId: string) => {
    setExecutions(prev => ({ ...prev, [tabId]: { type, treinoId } }));
  }, []);

  const stopExecution = useCallback((tabId: string) => {
    setExecutions(prev => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  const { data: alunos = [] } = useQuery({
    queryKey: ["prof-alunos"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .eq("status", "active")
        .order("full_name");
      return data || [];
    },
  });

  const addTab = (alunoId: string) => {
    if (tabs.length >= 3) return;
    if (tabs.find((t) => t.alunoId === alunoId)) {
      setActiveTab(tabs.find((t) => t.alunoId === alunoId)!.id);
      return;
    }
    const aluno = alunos.find((a: any) => a.user_id === alunoId);
    if (!aluno) return;
    const newTab: AlunoTab = {
      id: crypto.randomUUID(),
      alunoId: aluno.user_id,
      alunoName: aluno.full_name,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTab(newTab.id);
    setSearchAluno("");
  };

  const removeTab = (tabId: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTab === tabId && next.length > 0) {
        setActiveTab(next[next.length - 1].id);
      } else if (next.length === 0) {
        setActiveTab("");
      }
      return next;
    });
  };

  const filteredAlunos = searchAluno
    ? alunos.filter((a: any) => a.full_name.toLowerCase().includes(searchAluno.toLowerCase()))
    : alunos;

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-primary flex items-center gap-2">
          <Dumbbell className="h-6 w-6" />
          Acompanhamento de Treinos
        </h1>
        <p className="text-sm text-muted-foreground">
          Selecione até 3 alunos para acompanhar seus treinos
        </p>
      </div>

      {/* Student selector */}
      {tabs.length < 3 && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar aluno..."
              className="pl-10"
              value={searchAluno}
              onChange={(e) => setSearchAluno(e.target.value)}
            />
            {searchAluno && filteredAlunos.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                {filteredAlunos.map((a: any) => (
                  <button
                    key={a.user_id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center gap-2"
                    onClick={() => addTab(a.user_id)}
                  >
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    {a.full_name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Select onValueChange={addTab}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Selecionar aluno" />
            </SelectTrigger>
            <SelectContent>
              {alunos.map((a: any) => (
                <SelectItem key={a.user_id} value={a.user_id}>
                  {a.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Tabs */}
      {tabs.length === 0 ? (
        <Card className="border-0 shadow-md">
          <CardContent className="flex flex-col items-center p-12 text-center">
            <User className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground font-medium">
              Selecione um aluno para começar
            </p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Use o seletor acima para escolher até 3 alunos
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start gap-1 h-auto flex-wrap">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="flex items-center gap-1.5 pr-1 data-[state=active]:shadow-sm"
              >
                <User className="h-3.5 w-3.5" />
                <span className="max-w-[120px] truncate text-xs">{tab.alunoName}</span>
                <button
                  className="ml-1 p-0.5 rounded-full hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTab(tab.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </TabsTrigger>
            ))}
            {tabs.length < 3 && (
              <div className="flex items-center text-xs text-muted-foreground ml-2">
                <Plus className="h-3 w-3 mr-0.5" />
                {3 - tabs.length} restante{3 - tabs.length > 1 ? "s" : ""}
              </div>
            )}
          </TabsList>

          {tabs.map((tab) => {
            const exec = executions[tab.id];
            return (
              <TabsContent key={tab.id} value={tab.id} className="mt-4">
                {exec?.type === 'treino' ? (
                  <TreinoExecucaoBase
                    alunoIdOverride={tab.alunoId}
                    backPath="/professor"
                    treinoIdProp={exec.treinoId}
                    onBack={() => stopExecution(tab.id)}
                  />
                ) : exec?.type === 'avulso' ? (
                  <ProfessorAvulsoExecucao
                    treinoId={exec.treinoId}
                    alunoId={tab.alunoId}
                    onBack={() => stopExecution(tab.id)}
                  />
                ) : (
                  <div className="space-y-4">
                    {/* Acolhimento collapsible */}
                    <AcolhimentoCollapsible alunoId={tab.alunoId} />
                    <AlunoWorkoutView
                      alunoId={tab.alunoId}
                      onStartTreino={(treinoId) => startExecution(tab.id, 'treino', treinoId)}
                      onStartAvulso={(treinoId) => startExecution(tab.id, 'avulso', treinoId)}
                    />
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </div>
  );
}
