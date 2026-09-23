import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Calendar as CalendarIcon,
  MapPin,
  Timer,
  Pencil,
  X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  isToday,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface CalendarioEntry {
  id: string;
  data: string;
  tipos: string[];
  duracao_min: number | null;
  distancia_km: number | null;
}

// Treino da ficha concluído no app. Não tem duração: quem registra minutos é o
// lançamento manual do calendário.
interface RegistroEntry {
  id: string;
  data: string;
  divisao: string | null;
  treinos: { titulo: string } | null;
}

const INTENSIDADE_OPTIONS = [
  { value: "leve", label: "Leve 🧘" },
  { value: "moderada", label: "Moderada 💪" },
  { value: "intensa", label: "Intensa 🔥" },
  { value: "maxima", label: "Máxima 💀" },
];

const TIPO_BASE = [
  "Treino A",
  "Treino B",
  "Treino C",
  "Treino D",
  "Yoga",
  "Pilates",
  "Funcional",
  "CrossFit",
  "Musculação",
  "Caminhada",
  "Alongamento",
  "HIIT",
  "Dança",
  "Artes Marciais",
];
const TIPO_STORAGE_KEY = "arkefit-calendario-tipos-customizados";
const QUICK_OPTIONS = ["Natação", "Ciclismo", "Corrida"];
const MODALITY_EMOJI: Record<string, string> = { Natação: "🏊", Ciclismo: "🚴", Corrida: "🏃" };

// Cor por modalidade (em vez de só manual/sistema) — cada tipo de treino
// sempre cai na mesma cor, então o aluno reconhece o padrão de olho no mês
// inteiro (ex.: todo treino de Yoga sempre laranja).
const MODALITY_CHIP_COLORS = [
  "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  "bg-purple-500/20 text-purple-700 dark:text-purple-300",
  "bg-pink-500/20 text-pink-700 dark:text-pink-300",
  "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300",
  "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  "bg-red-500/20 text-red-700 dark:text-red-300",
];
const MODALITY_DOT_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-red-500",
];

function indiceModalidade(label: string) {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return hash % MODALITY_CHIP_COLORS.length;
}
const corChipModalidade = (label: string) => MODALITY_CHIP_COLORS[indiceModalidade(label)];
const corDotModalidade = (label: string) => MODALITY_DOT_COLORS[indiceModalidade(label)];

/**
 * Aba Calendário do aluno, na ordem que se lê de cima para baixo: metas da
 * semana e o calendário com tudo o que foi treinado. Pensada para caber num
 * print: um bloco de números só, sem o antigo "Resumo da Semana" que repetia
 * os quatro de cima.
 *
 * O card "Minha Rotina da Semana" saiu daqui em 23/09/2026 e virou a aba
 * *Compromisso* da Jornada. A separação é entre intenção e execução: dizer em
 * que dias pretendo treinar é compromisso, e o calendário é o registro do que
 * de fato aconteceu. A meta semanal fica, porque é a régua contra a qual o
 * registro é lido.
 */
export default function CalendarioTreinos() {
  const { alunoId, organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalValue, setGoalValue] = useState(3);

  const [formTipos, setFormTipos] = useState<string[]>([]);
  const [formTipoInput, setFormTipoInput] = useState("");
  const [formDuracao, setFormDuracao] = useState("");
  const [formDistancia, setFormDistancia] = useState("");
  const [formIntensidade, setFormIntensidade] = useState("moderada");
  const [formDetalhes, setFormDetalhes] = useState("");
  const [formObservacoes, setFormObservacoes] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [customTipos, setCustomTipos] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(TIPO_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const allTipoSuggestions = useMemo(
    () => Array.from(new Set([...TIPO_BASE, ...customTipos])).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [customTipos]
  );
  const inputTrim = formTipoInput.trim();
  const filteredSuggestions = useMemo(
    () => allTipoSuggestions.filter((s) => s.toLowerCase().includes(inputTrim.toLowerCase()) && !formTipos.includes(s)),
    [allTipoSuggestions, inputTrim, formTipos]
  );
  const showAddNew = inputTrim.length > 0 && !allTipoSuggestions.some((s) => s.toLowerCase() === inputTrim.toLowerCase());

  const handleAddNewTipo = () => {
    const novo = inputTrim;
    if (!novo) return;
    const next = Array.from(new Set([...customTipos, novo]));
    setCustomTipos(next);
    try {
      localStorage.setItem(TIPO_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* localStorage indisponível — segue sem persistir sugestões customizadas */
    }
    addTipoTag(novo);
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  const { data: calendarEntries = [] } = useQuery({
    queryKey: ["treino-calendario", alunoId, format(monthStart, "yyyy-MM")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treino_calendario")
        .select("id, data, tipos, duracao_min, distancia_km")
        .eq("aluno_id", alunoId!)
        .gte("data", format(monthStart, "yyyy-MM-dd"))
        .lte("data", format(monthEnd, "yyyy-MM-dd"))
        .order("data");
      if (error) throw error;
      return (data ?? []) as CalendarioEntry[];
    },
    enabled: !!alunoId,
  });

  // Treinos da ficha concluídos no app. Esta consulta pedia uma coluna que não
  // existe (duracao_min) e não conferia o erro: nenhum treino concluído
  // aparecia no calendário. Hoje o erro sobe, e o teste
  // colunasConsultas.guarda confere as colunas pedidas.
  const { data: registroEntries = [] } = useQuery({
    queryKey: ["registro-calendario", alunoId, format(monthStart, "yyyy-MM")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registro_treino")
        .select("id, data, divisao, treinos(titulo)")
        .eq("aluno_id", alunoId!)
        .eq("concluido", true)
        .gte("data", format(monthStart, "yyyy-MM-dd"))
        .lte("data", format(monthEnd, "yyyy-MM-dd"))
        .order("data");
      if (error) throw error;
      return (data ?? []) as RegistroEntry[];
    },
    enabled: !!alunoId,
  });

  const { data: perfil } = useQuery({
    queryKey: ["aluno-meta-semanal", alunoId],
    queryFn: async () => {
      const { data } = await supabase.from("alunos").select("meta_semanal_dias").eq("id", alunoId!).maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const metaSemanalDias = perfil?.meta_semanal_dias ?? 3;

  const addEntry = useMutation({
    mutationFn: async (entry: {
      data: string;
      tipos: string[];
      duracao_min: number | null;
      distancia_km: number | null;
      intensidade: string;
      detalhes: string | null;
      observacoes: string | null;
    }) => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const { error } = await supabase.from("treino_calendario").insert({ ...entry, organization_id: organization.id, aluno_id: alunoId });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["treino-calendario"] });
      toast({ title: "Treino adicionado ao calendário!" });
      resetForm();
      setShowAddDialog(false);
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar treino", description: error.message, variant: "destructive" }),
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("treino_calendario").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["treino-calendario"] });
      toast({ title: "Treino removido!" });
    },
    onError: (error: Error) => toast({ title: "Erro ao remover", description: error.message, variant: "destructive" }),
  });

  const updateMeta = useMutation({
    mutationFn: async (dias: number) => {
      if (!alunoId) throw new Error("Cadastro de aluno não encontrado");
      const { error } = await supabase.from("alunos").update({ meta_semanal_dias: dias }).eq("id", alunoId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["aluno-meta-semanal"] });
      setEditingGoal(false);
      toast({ title: "Meta atualizada!" });
    },
  });

  const resetForm = () => {
    setFormTipos([]);
    setFormTipoInput("");
    setFormDuracao("");
    setFormDistancia("");
    setFormIntensidade("moderada");
    setFormDetalhes("");
    setFormObservacoes("");
  };

  const handleAddTreino = () => {
    if (formTipos.length === 0) {
      toast({ title: "Adicione pelo menos um tipo de treino", variant: "destructive" });
      return;
    }
    addEntry.mutate({
      data: format(selectedDate!, "yyyy-MM-dd"),
      tipos: formTipos,
      duracao_min: formDuracao ? parseInt(formDuracao, 10) : null,
      distancia_km: formDistancia ? parseFloat(formDistancia) : null,
      intensidade: formIntensidade,
      detalhes: formDetalhes || null,
      observacoes: formObservacoes || null,
    });
  };

  const addTipoTag = (tipo: string) => {
    if (tipo && !formTipos.includes(tipo)) setFormTipos([...formTipos, tipo]);
    setFormTipoInput("");
  };

  const removeTipoTag = (tipo: string) => setFormTipos(formTipos.filter((t) => t !== tipo));

  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days: Date[] = [];
  for (let day = calendarStart; day <= calendarEnd; day = addDays(day, 1)) days.push(day);

  const entriesByDate = useMemo(() => {
    const map: Record<string, Array<{ id: string; label: string; source: "manual" | "system" }>> = {};
    calendarEntries.forEach((e) => {
      if (!map[e.data]) map[e.data] = [];
      e.tipos.forEach((t) => map[e.data].push({ id: e.id, label: t, source: "manual" }));
    });
    registroEntries.forEach((r) => {
      if (!map[r.data]) map[r.data] = [];
      map[r.data].push({ id: r.id, label: r.divisao ? `Treino ${r.divisao}` : r.treinos?.titulo ?? "Treino", source: "system" });
    });
    return map;
  }, [calendarEntries, registroEntries]);

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 0 });
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  const weeklyStats = useMemo(() => {
    let treinos = 0;
    let minutos = 0;
    let distancia = 0;
    const modalidades = new Set<string>();
    calendarEntries.forEach((e) => {
      if (e.data >= weekStartStr && e.data <= weekEndStr) {
        treinos++;
        if (e.duracao_min) minutos += e.duracao_min;
        if (e.distancia_km) distancia += Number(e.distancia_km);
        e.tipos.forEach((t) => modalidades.add(t));
      }
    });
    registroEntries.forEach((r) => {
      if (r.data >= weekStartStr && r.data <= weekEndStr) {
        treinos++;
        if (r.treinos?.titulo) modalidades.add(r.treinos.titulo);
      }
    });
    return { treinos, minutos, distancia, modalidades: modalidades.size };
  }, [calendarEntries, registroEntries, weekStartStr, weekEndStr]);

  const modalityKm = useMemo(() => {
    const km: Record<string, number> = {};
    QUICK_OPTIONS.forEach((m) => (km[m] = 0));
    calendarEntries.forEach((e) => {
      if (e.distancia_km && e.tipos) {
        const dist = Number(e.distancia_km);
        e.tipos.forEach((t) => {
          if (QUICK_OPTIONS.includes(t)) km[t] += dist;
        });
      }
    });
    return QUICK_OPTIONS.filter((m) => km[m] > 0).map((m) => ({ label: m, km: km[m] }));
  }, [calendarEntries]);

  const weekDaysWithWorkouts = useMemo(() => {
    const daysSet = new Set<string>();
    calendarEntries.forEach((e) => {
      if (e.data >= weekStartStr && e.data <= weekEndStr) daysSet.add(e.data);
    });
    registroEntries.forEach((r) => {
      if (r.data >= weekStartStr && r.data <= weekEndStr) daysSet.add(r.data);
    });
    return daysSet.size;
  }, [calendarEntries, registroEntries, weekStartStr, weekEndStr]);

  const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const metaBatida = weekDaysWithWorkouts >= metaSemanalDias;
  const progressoMeta = Math.min(100, Math.round((weekDaysWithWorkouts / Math.max(1, metaSemanalDias)) * 100));

  return (
    <div className="space-y-5">
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-primary" /> Metas de Treino Semanal
              </h3>
              <p className="text-xs text-muted-foreground">
                {format(weekStart, "dd de MMM", { locale: ptBR })} – {format(weekEnd, "dd de MMM", { locale: ptBR })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {editingGoal ? (
                <>
                  <Input
                    type="number"
                    min={1}
                    max={7}
                    value={goalValue}
                    onChange={(e) => setGoalValue(parseInt(e.target.value, 10) || 1)}
                    className="w-14 h-8 text-center text-sm"
                    aria-label="Meta de dias por semana"
                  />
                  <Button size="sm" className="h-8 px-2 text-xs" onClick={() => updateMeta.mutate(goalValue)}>
                    OK
                  </Button>
                </>
              ) : (
                <>
                  <span className={cn("font-bold text-2xl tabular-nums", metaBatida ? "text-green-600" : "text-primary")}>
                    {weekDaysWithWorkouts}/{metaSemanalDias}
                  </span>
                  <span className="text-xs text-muted-foreground">dias</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Editar meta semanal"
                    onClick={() => {
                      setGoalValue(metaSemanalDias);
                      setEditingGoal(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={progressoMeta} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn("h-full transition-all", metaBatida ? "bg-green-600" : "bg-primary")} style={{ width: `${progressoMeta}%` }} />
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: "Treinos", value: weeklyStats.treinos },
              { label: "Minutos", value: weeklyStats.minutos },
              { label: "Km", value: weeklyStats.distancia.toFixed(1) },
              { label: "Modalidades", value: weeklyStats.modalidades },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-lg font-bold text-primary tabular-nums">{stat.value}</p>
                <p className="text-[10px] text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <h3 className="text-lg font-bold capitalize">{format(currentMonth, "MMMM yyyy", { locale: ptBR })}</h3>
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>

            <div className="grid grid-cols-7 mb-2">
              {weekDays.map((d) => (
                <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {days.map((dayItem, idx) => {
                const dateKey = format(dayItem, "yyyy-MM-dd");
                const entries = entriesByDate[dateKey] || [];
                const isCurrentMonth = isSameMonth(dayItem, currentMonth);
                const isSelected = selectedDate && isSameDay(dayItem, selectedDate);
                const isTodayDate = isToday(dayItem);
                return (
                  <div
                    key={idx}
                    className={cn(
                      "min-h-[80px] border border-border/30 p-1 cursor-pointer transition-colors hover:bg-muted/30 relative",
                      !isCurrentMonth && "opacity-40",
                      isSelected && "ring-2 ring-primary bg-primary/5",
                      isTodayDate && "bg-accent/10"
                    )}
                    onClick={() => setSelectedDate(dayItem)}
                  >
                    <div className="flex items-center justify-between">
                      <span className={cn("text-xs font-medium", isTodayDate && "text-primary font-bold")}>{format(dayItem, "d")}</span>
                      {isCurrentMonth && (
                        <button
                          className={cn(
                            "h-4 w-4 rounded-full flex items-center justify-center text-primary/60 hover:bg-primary/15 hover:text-primary transition-colors",
                            isSelected && "bg-primary/10 text-primary"
                          )}
                          title="Adicionar treino neste dia"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDate(dayItem);
                            setShowAddDialog(true);
                          }}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {entries.slice(0, 3).map((entry, eIdx) => (
                        <div
                          key={eIdx}
                          className={cn("text-[10px] px-1 py-0.5 rounded truncate", corChipModalidade(entry.label))}
                        >
                          {entry.label}
                        </div>
                      ))}
                      {entries.length > 3 && <span className="text-[9px] text-muted-foreground">+{entries.length - 3}</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedDate && entriesByDate[format(selectedDate, "yyyy-MM-dd")]?.length > 0 && (
              <div className="mt-4 border-t pt-3 space-y-2">
                <p className="text-sm font-medium">Treinos em {format(selectedDate, "dd/MM/yyyy")}</p>
                {entriesByDate[format(selectedDate, "yyyy-MM-dd")]?.map((entry, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={cn("w-2 h-2 rounded-full", corDotModalidade(entry.label))} />
                      <span className="text-sm">{entry.label}</span>
                    </div>
                    {entry.source === "manual" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={() => deleteEntry.mutate(entry.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
      </Card>

        {modalityKm.length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="h-4 w-4 text-primary" />
                <h4 className="font-bold text-sm">Kilometragem do Mês</h4>
              </div>
              <div className="space-y-2">
                {modalityKm.map((m) => (
                  <div key={m.label} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                    <span className="text-sm font-medium flex items-center gap-2">
                      {MODALITY_EMOJI[m.label]} {m.label}
                    </span>
                    <span className="text-sm font-bold text-primary">{m.km.toFixed(1)} km</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      <Button
        className="w-full"
        onClick={() => {
          if (!selectedDate) setSelectedDate(new Date());
          setShowAddDialog(true);
        }}
      >
        <Plus className="mr-2 h-4 w-4" />
        Adicionar Treino
      </Button>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Adicionar Treino - {selectedDate ? format(selectedDate, "dd/MM/yyyy") : ""}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Modalidade</label>
              {(() => {
                const hasQuickSelected = formTipos.some((t) => QUICK_OPTIONS.includes(t));
                return (
                  <>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {QUICK_OPTIONS.map((mod) => {
                        const isSelected = formTipos.includes(mod);
                        const isOtherSelected = hasQuickSelected && !isSelected;
                        return (
                          <Button
                            key={mod}
                            type="button"
                            size="sm"
                            variant={isSelected ? "default" : "outline"}
                            className={isOtherSelected ? "opacity-50 cursor-not-allowed" : ""}
                            onClick={() => {
                              if (isOtherSelected) return;
                              setFormTipos(isSelected ? [] : [mod]);
                              setFormTipoInput("");
                            }}
                          >
                            {MODALITY_EMOJI[mod]} {mod}
                          </Button>
                        );
                      })}
                    </div>

                    {!hasQuickSelected && (
                      <div className="relative">
                        <Input
                          placeholder="Digite ou escolha um tipo..."
                          value={formTipoInput}
                          onChange={(e) => {
                            setFormTipoInput(e.target.value);
                            setShowSuggestions(true);
                          }}
                          onFocus={() => setShowSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && formTipoInput.trim()) {
                              e.preventDefault();
                              if (showAddNew) handleAddNewTipo();
                              else addTipoTag(formTipoInput.trim());
                            }
                          }}
                        />
                        {showSuggestions && (filteredSuggestions.length > 0 || showAddNew) && (
                          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
                            {filteredSuggestions.map((s) => (
                              <button
                                key={s}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  addTipoTag(s);
                                }}
                              >
                                {s}
                              </button>
                            ))}
                            {showAddNew && (
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-muted transition-colors flex items-center gap-2 border-t"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  handleAddNewTipo();
                                }}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Adicionar &quot;{inputTrim}&quot;
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {formTipos.length > 0 && !hasQuickSelected && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {formTipos.map((t) => (
                          <Badge key={t} variant="secondary" className="gap-1 pr-1">
                            {t}
                            <button onClick={() => removeTipoTag(t)}>
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Duração (minutos)</label>
                <Input type="number" placeholder="Ex: 60" value={formDuracao} onChange={(e) => setFormDuracao(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Distância (km)</label>
                <Input type="number" step="0.1" placeholder="Ex: 5.5" value={formDistancia} onChange={(e) => setFormDistancia(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Intensidade</label>
              <Select value={formIntensidade} onValueChange={setFormIntensidade}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTENSIDADE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Outros exercícios/detalhes</label>
              <Textarea
                placeholder="Descreva outros exercícios que não estão na lista..."
                value={formDetalhes}
                onChange={(e) => setFormDetalhes(e.target.value)}
                rows={3}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Observações</label>
              <Textarea
                placeholder="Como foi o treino? Como se sentiu? Alguma observação..."
                value={formObservacoes}
                onChange={(e) => setFormObservacoes(e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  resetForm();
                  setShowAddDialog(false);
                }}
              >
                Cancelar
              </Button>
              <Button onClick={handleAddTreino} disabled={addEntry.isPending}>
                <Timer className="mr-1.5 h-3.5 w-3.5" />
                Salvar Treino
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
