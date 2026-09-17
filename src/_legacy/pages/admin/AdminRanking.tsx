import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Trophy, Medal, ChevronLeft, ChevronRight, Plus, Crown, Flame, Dumbbell, Droplets, Utensils, Target, Trash2, CheckCircle2, Pencil } from "lucide-react";
import { useAdminRankingData, RankingAluno } from "@/hooks/useAdminRankingData";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

// ... keep existing code (MONTH_NAMES, METRICAS, getMetricValue, getMetricLabel, getMetricSuffix, RankingPodium, RankingTable)
const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const METRICAS = [
  { value: "pontuacao_geral", label: "Pontuação Geral", icon: Trophy },
  { value: "engajamento", label: "Engajamento", icon: Flame },
  { value: "performance", label: "Performance", icon: Target },
  { value: "km_corridos", label: "KM Total", icon: Droplets },
  { value: "treinos", label: "Treinos Realizados", icon: Dumbbell },
  { value: "dieta", label: "Média Dieta (%)", icon: Utensils },
  { value: "modalidades", label: "Modalidades", icon: Medal },
  { value: "gordura", label: "Gordura (%)", icon: Target },
  { value: "musculo", label: "Massa Muscular (kg)", icon: Dumbbell },
  { value: "km_natacao", label: "Natação (km)", icon: Droplets },
  { value: "km_ciclismo", label: "Ciclismo (km)", icon: Droplets },
  { value: "km_corrida", label: "Corrida (km)", icon: Droplets },
];

function getMetricValue(aluno: RankingAluno, metrica: string): number {
  switch (metrica) {
    case "pontuacao_geral": return aluno.total;
    case "engajamento": return aluno.engajamento;
    case "performance": return aluno.performance;
    case "km_corridos": return aluno.kmCorridos;
    case "km_natacao": return aluno.kmNatacao;
    case "km_ciclismo": return aluno.kmCiclismo;
    case "km_corrida": return aluno.kmCorrida;
    case "treinos": return aluno.treinosRealizados;
    case "dieta": return aluno.dietaMedia;
    case "modalidades": return aluno.modalidades;
    case "gordura": return aluno.gorduraPercentual ?? 0;
    case "musculo": return aluno.musculoPercentual ?? 0;
    default: return aluno.total;
  }
}

function getMetricLabel(metrica: string): string {
  return METRICAS.find((m) => m.value === metrica)?.label || metrica;
}

function getMetricSuffix(metrica: string): string {
  switch (metrica) {
    case "km_corridos":
    case "km_natacao":
    case "km_ciclismo":
    case "km_corrida": return " km";
    case "dieta": return "%";
    case "gordura": return "%";
    case "musculo": return "kg";
    case "pontuacao_geral":
    case "engajamento":
    case "performance": return " pts";
    default: return "";
  }
}

function RankingPodium({ top3 }: { top3: RankingAluno[] }) {
  if (top3.length === 0) return null;
  const podiumOrder = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3;
  const heights = ["h-20", "h-28", "h-16"];
  const orderMap = top3.length >= 3 ? [1, 0, 2] : [0, 1, 2];

  return (
    <div className="flex items-end justify-center gap-3 py-6">
      {podiumOrder.map((aluno, idx) => {
        if (!aluno) return null;
        const rank = orderMap[idx] + 1;
        const isFirst = rank === 1;
        return (
          <motion.div
            key={aluno.userId}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="flex flex-col items-center"
          >
            <div className="relative mb-2">
              {isFirst && <Crown className="absolute -top-4 left-1/2 -translate-x-1/2 h-5 w-5 text-yellow-500" />}
              <Avatar className={cn("border-2", isFirst ? "h-16 w-16 border-yellow-500" : rank === 2 ? "h-14 w-14 border-gray-400" : "h-12 w-12 border-amber-700")}>
                <AvatarImage src={aluno.avatarUrl || undefined} />
                <AvatarFallback className="text-xs">{aluno.nome.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </div>
            <p className="text-xs font-medium text-center max-w-[80px] truncate">{aluno.nome.split(" ")[0]}</p>
            <p className={cn("text-sm font-bold", isFirst ? "text-yellow-600" : "text-muted-foreground")}>{aluno.total} pts</p>
            <div className={cn(
              "w-16 rounded-t-lg mt-2 flex items-center justify-center",
              isFirst ? "bg-yellow-500/20 h-28" : rank === 2 ? "bg-gray-400/20 h-20" : "bg-amber-700/20 h-16"
            )}>
              <span className={cn("text-2xl font-black", isFirst ? "text-yellow-600" : "text-muted-foreground")}>{rank}°</span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function RankingTable({ data, metrica }: { data: RankingAluno[]; metrica: string }) {
  const sorted = [...data].sort((a, b) => getMetricValue(b, metrica) - getMetricValue(a, metrica));
  const suffix = getMetricSuffix(metrica);

  return (
    <div className="space-y-2">
      {sorted.map((aluno, idx) => {
        const rank = idx + 1;
        const value = getMetricValue(aluno, metrica);
        return (
          <motion.div
            key={aluno.userId}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.03 }}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-lg",
              rank === 1 ? "bg-yellow-500/10 border border-yellow-500/30" :
              rank === 2 ? "bg-muted/60 border border-border/50" :
              rank === 3 ? "bg-amber-500/5 border border-amber-500/20" :
              "bg-muted/30"
            )}
          >
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
              rank === 1 ? "bg-yellow-500 text-yellow-950" :
              rank === 2 ? "bg-gray-400 text-white" :
              rank === 3 ? "bg-amber-700 text-white" :
              "bg-muted text-muted-foreground"
            )}>
              {rank}
            </div>
            <Avatar className="h-9 w-9">
              <AvatarImage src={aluno.avatarUrl || undefined} />
              <AvatarFallback className="text-xs">{aluno.nome.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{aluno.nome}</p>
              {metrica === "pontuacao_geral" && (
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span>E: {aluno.engajamento}</span>
                  <span>P: {aluno.performance}</span>
                </div>
              )}
            </div>
            <div className="text-right">
              <p className={cn("text-sm font-bold", rank <= 3 ? "text-primary" : "text-foreground")}>
                {["km_corridos", "km_natacao", "km_ciclismo", "km_corrida"].includes(metrica) ? value.toFixed(1) : value}{suffix}
              </p>
            </div>
          </motion.div>
        );
      })}
      {sorted.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">Nenhum aluno encontrado</p>
      )}
    </div>
  );
}

export default function AdminRanking() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(now.getMonth());
  const [currentYear, setCurrentYear] = useState(now.getFullYear());
  const [rankingMetrica, setRankingMetrica] = useState("pontuacao_geral");
  const [showCompDialog, setShowCompDialog] = useState(false);
  const [editingComp, setEditingComp] = useState<any>(null);

  // Competition form
  const [compTitulo, setCompTitulo] = useState("");
  const [compDescricao, setCompDescricao] = useState("");
  const [compInicio, setCompInicio] = useState("");
  const [compFim, setCompFim] = useState("");
  const [compMetrica, setCompMetrica] = useState("pontuacao_geral");
  const [compParaTodos, setCompParaTodos] = useState(true);
  const [compSelectedAlunos, setCompSelectedAlunos] = useState<string[]>([]);

  const { rankings, isLoading } = useAdminRankingData(currentYear, currentMonth);

  const { data: competicoes = [] } = useQuery({
    queryKey: ["admin-competicoes"],
    queryFn: async () => {
      const { data } = await supabase.from("competicoes").select("*").order("created_at", { ascending: false });
      return data || [];
    },
  });

  // Fetch ALL competition participants at once
  const { data: allParticipantes = [] } = useQuery({
    queryKey: ["admin-comp-participantes"],
    queryFn: async () => {
      const { data } = await supabase.from("competicao_participantes").select("*");
      return (data || []) as any[];
    },
  });

  const { data: alunosList = [] } = useQuery({
    queryKey: ["admin-alunos-comp"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name").order("full_name");
      return (data || []) as any[];
    },
  });

  const resetForm = () => {
    setCompTitulo("");
    setCompDescricao("");
    setCompInicio("");
    setCompFim("");
    setCompMetrica("pontuacao_geral");
    setCompParaTodos(true);
    setCompSelectedAlunos([]);
    setEditingComp(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setShowCompDialog(true);
  };

  const openEditDialog = (comp: any) => {
    setEditingComp(comp);
    setCompTitulo(comp.titulo);
    setCompDescricao(comp.descricao || "");
    setCompInicio(comp.data_inicio);
    setCompFim(comp.data_fim);
    setCompMetrica(comp.metrica);
    setCompParaTodos(comp.para_todos);
    // Load existing participants
    const participantIds = allParticipantes
      .filter((p: any) => p.competicao_id === comp.id)
      .map((p: any) => p.aluno_id);
    setCompSelectedAlunos(participantIds);
    setShowCompDialog(true);
  };

  const saveComp = useMutation({
    mutationFn: async () => {
      if (editingComp) {
        // UPDATE existing
        const { error } = await supabase.from("competicoes").update({
          titulo: compTitulo,
          descricao: compDescricao || null,
          data_inicio: compInicio,
          data_fim: compFim,
          metrica: compMetrica,
          para_todos: compParaTodos,
        } as any).eq("id", editingComp.id);
        if (error) throw error;

        // Delete old participants and re-insert
        await supabase.from("competicao_participantes").delete().eq("competicao_id", editingComp.id);
        if (!compParaTodos && compSelectedAlunos.length > 0) {
          const rows = compSelectedAlunos.map((aluno_id) => ({
            competicao_id: editingComp.id,
            aluno_id,
          }));
          await supabase.from("competicao_participantes" as any).insert(rows);
        }
      } else {
        // CREATE new
        const { data: newComp, error } = await supabase.from("competicoes").insert({
          titulo: compTitulo,
          descricao: compDescricao || null,
          data_inicio: compInicio,
          data_fim: compFim,
          metrica: compMetrica,
          para_todos: compParaTodos,
          criado_por: user?.id,
        } as any).select().single();
        if (error) throw error;

        if (!compParaTodos && compSelectedAlunos.length > 0 && newComp) {
          const rows = compSelectedAlunos.map((aluno_id) => ({
            competicao_id: (newComp as any).id,
            aluno_id,
          }));
          await supabase.from("competicao_participantes" as any).insert(rows);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-competicoes"] });
      queryClient.invalidateQueries({ queryKey: ["admin-comp-participantes"] });
      toast.success(editingComp ? "Competição atualizada!" : "Competição criada!");
      setShowCompDialog(false);
      resetForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteComp = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("competicoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-competicoes"] });
      queryClient.invalidateQueries({ queryKey: ["admin-comp-participantes"] });
      toast.success("Competição removida!");
    },
  });

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(currentYear - 1); }
    else setCurrentMonth(currentMonth - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(currentYear + 1); }
    else setCurrentMonth(currentMonth + 1);
  };

  const sorted = [...rankings].sort((a, b) => getMetricValue(b, rankingMetrica) - getMetricValue(a, rankingMetrica));
  const top3 = sorted.slice(0, 3);

  // Filter rankings by competition participants
  const getCompRanking = (comp: any): RankingAluno[] => {
    if (comp.para_todos) return rankings;
    const participantIds = allParticipantes
      .filter((p: any) => p.competicao_id === comp.id)
      .map((p: any) => p.aluno_id);
    return rankings.filter((r) => participantIds.includes(r.userId));
  };

  const toggleParticipant = (userId: string) => {
    setCompSelectedAlunos((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Ranking & Competições</h1>
          <p className="text-sm text-muted-foreground">Acompanhe o desempenho dos alunos</p>
        </div>
      </div>

      <Tabs defaultValue="ranking" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="ranking" className="gap-2">
            <Trophy className="h-4 w-4" />
            Rankings
          </TabsTrigger>
          <TabsTrigger value="competicoes" className="gap-2">
            <Medal className="h-4 w-4" />
            Compeitções
          </TabsTrigger>
        </TabsList>

        {/* RANKINGS TAB */}
        <TabsContent value="ranking" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <Button variant="ghost" size="icon" onClick={prevMonth}>
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <h3 className="text-lg font-bold capitalize">
                  {MONTH_NAMES[currentMonth]} {currentYear}
                </h3>
                <Button variant="ghost" size="icon" onClick={nextMonth}>
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {METRICAS.map((m) => (
                  <Button
                    key={m.value}
                    variant={rankingMetrica === m.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setRankingMetrica(m.value)}
                    className="gap-1.5"
                  >
                    <m.icon className="h-3.5 w-3.5" />
                    {m.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {isLoading ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-8 text-center text-muted-foreground">
                Calculando ranking...
              </CardContent>
            </Card>
          ) : (
            <>
              {rankingMetrica === "pontuacao_geral" && top3.length > 0 && (
                <Card className="border-0 shadow-sm overflow-hidden">
                  <CardContent className="p-0">
                    <RankingPodium top3={top3} />
                  </CardContent>
                </Card>
              )}
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-primary" />
                    {getMetricLabel(rankingMetrica)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <RankingTable data={rankings} metrica={rankingMetrica} />
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* COMPETIÇÕES TAB */}
        <TabsContent value="competicoes" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={openCreateDialog} className="gap-2">
              <Plus className="h-4 w-4" />
              Nova Competição
            </Button>
          </div>

          {competicoes.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-8 text-center">
                <Trophy className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">Nenhuma competição criada ainda</p>
                <p className="text-xs text-muted-foreground mt-1">Crie competições para engajar seus alunos</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {competicoes.map((comp: any) => {
                const hoje = new Date();
                const inicio = new Date(comp.data_inicio + "T00:00:00");
                const fim = new Date(comp.data_fim + "T23:59:59");
                const isAtiva = hoje >= inicio && hoje <= fim;
                const isEncerrada = hoje > fim;
                const compRanking = getCompRanking(comp);
                const participantCount = comp.para_todos
                  ? rankings.length
                  : allParticipantes.filter((p: any) => p.competicao_id === comp.id).length;

                return (
                  <Card key={comp.id} className={cn("border-0 shadow-sm", isAtiva && "ring-2 ring-primary/30")}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-base">{comp.titulo}</CardTitle>
                            <Badge variant={isAtiva ? "default" : isEncerrada ? "secondary" : "outline"}>
                              {isAtiva ? "Ativa" : isEncerrada ? "Encerrada" : "Pendente"}
                            </Badge>
                          </div>
                          {comp.descricao && <p className="text-xs text-muted-foreground mt-1">{comp.descricao}</p>}
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(comp)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteComp.mutate(comp.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>📅 {format(inicio, "dd/MM/yyyy")} - {format(fim, "dd/MM/yyyy")}</span>
                        <Badge variant="outline" className="text-xs">
                          {getMetricLabel(comp.metrica)}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        👥 {comp.para_todos ? "Todos os alunos" : `${participantCount} participante(s)`}
                      </div>

                      {(isAtiva || isEncerrada) && (
                        <RankingTable data={compRanking} metrica={comp.metrica} />
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create/Edit competition dialog */}
      <Dialog open={showCompDialog} onOpenChange={(open) => { if (!open) { setShowCompDialog(false); resetForm(); } else setShowCompDialog(true); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingComp ? "Editar Competição" : "Nova Competição"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Título</Label>
              <Input value={compTitulo} onChange={(e) => setCompTitulo(e.target.value)} placeholder="Ex: Desafio de Corrida - Abril" />
            </div>
            <div>
              <Label>Descrição (opcional)</Label>
              <Textarea value={compDescricao} onChange={(e) => setCompDescricao(e.target.value)} placeholder="Descreva a competição..." rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data Início</Label>
                <Input type="date" value={compInicio} onChange={(e) => setCompInicio(e.target.value)} />
              </div>
              <div>
                <Label>Data Fim</Label>
                <Input type="date" value={compFim} onChange={(e) => setCompFim(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Métrica</Label>
              <Select value={compMetrica} onValueChange={setCompMetrica}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRICAS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Para todos os alunos</Label>
              <Switch checked={compParaTodos} onCheckedChange={setCompParaTodos} />
            </div>
            {!compParaTodos && (
              <div>
                <Label className="mb-2 block">Selecionar Participantes</Label>
                <div className="max-h-48 overflow-y-auto space-y-1 border rounded-lg p-2">
                  {alunosList.map((aluno: any) => (
                    <button
                      key={aluno.user_id}
                      onClick={() => toggleParticipant(aluno.user_id)}
                      className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm transition-colors ${
                        compSelectedAlunos.includes(aluno.user_id)
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      <div className={`h-4 w-4 rounded border flex items-center justify-center ${
                        compSelectedAlunos.includes(aluno.user_id) ? "bg-primary border-primary" : "border-border"
                      }`}>
                        {compSelectedAlunos.includes(aluno.user_id) && (
                          <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
                        )}
                      </div>
                      {aluno.full_name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setShowCompDialog(false); resetForm(); }}>Cancelar</Button>
              <Button onClick={() => saveComp.mutate()} disabled={!compTitulo || !compInicio || !compFim || saveComp.isPending}>
                {saveComp.isPending ? "Salvando..." : editingComp ? "Salvar Alterações" : "Criar Competição"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
