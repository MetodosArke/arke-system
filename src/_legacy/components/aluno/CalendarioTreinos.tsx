import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Calendar as CalendarIcon,
  Clock, MapPin, Flame, Dumbbell, Pencil, X
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isSameDay, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const INTENSIDADE_OPTIONS = [
  { value: "leve", label: "Leve 🧘", emoji: "🧘" },
  { value: "moderada", label: "Moderada 💪", emoji: "💪" },
  { value: "intensa", label: "Intensa 🔥", emoji: "🔥" },
  { value: "maxima", label: "Máxima 💀", emoji: "💀" },
];

const TIPO_BASE = [
  "Treino A", "Treino B", "Treino C", "Treino D",
  "Yoga", "Pilates", "Funcional", "CrossFit", "Musculação",
  "Caminhada", "Alongamento", "HIIT", "Dança", "Artes Marciais",
];
const TIPO_STORAGE_KEY = "calendario-tipos-customizados";

export default function CalendarioTreinos() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalValue, setGoalValue] = useState(3);

  // Form state
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
    } catch { return []; }
  });

  const allTipoSuggestions = useMemo(
    () => Array.from(new Set([...TIPO_BASE, ...customTipos])).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [customTipos]
  );
  const inputTrim = formTipoInput.trim();
  const filteredSuggestions = useMemo(
    () => allTipoSuggestions.filter(
      (s) => s.toLowerCase().includes(inputTrim.toLowerCase()) && !formTipos.includes(s)
    ),
    [allTipoSuggestions, inputTrim, formTipos]
  );
  const showAddNew = inputTrim.length > 0 && !allTipoSuggestions.some(
    (s) => s.toLowerCase() === inputTrim.toLowerCase()
  );

  const handleAddNewTipo = () => {
    const novo = inputTrim;
    if (!novo) return;
    const next = Array.from(new Set([...customTipos, novo]));
    setCustomTipos(next);
    try { localStorage.setItem(TIPO_STORAGE_KEY, JSON.stringify(next)); } catch {}
    addTipoTag(novo);
  };

  // Fetch calendar entries
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  const { data: calendarEntries = [] } = useQuery({
    queryKey: ["treino-calendario", user?.id, format(monthStart, "yyyy-MM")],
    queryFn: async () => {
      const { data } = await supabase
        .from("treino_calendario")
        .select("*")
        .eq("aluno_id", user!.id)
        .gte("data", format(monthStart, "yyyy-MM-dd"))
        .lte("data", format(monthEnd, "yyyy-MM-dd"))
        .order("data");
      return data || [];
    },
    enabled: !!user,
  });

  // Also fetch registro_treino for completed workouts from the system
  const { data: registroEntries = [] } = useQuery({
    queryKey: ["registro-calendario", user?.id, format(monthStart, "yyyy-MM")],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_treino")
        .select("id, treino_id, data, nota, duracao_min, treinos(titulo, tipo, grupo_id)")
        .eq("aluno_id", user!.id)
        .not("nota", "is", null)
        .gte("data", format(monthStart, "yyyy-MM-dd"))
        .lte("data", format(monthEnd, "yyyy-MM-dd"))
        .order("data");
      return data || [];
    },
    enabled: !!user,
  });

  // Fetch meta semanal
  const { data: perfil } = useQuery({
    queryKey: ["aluno-perfil-meta", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("aluno_perfil")
        .select("meta_semanal_dias")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const metaSemanalDias = (perfil as any)?.meta_semanal_dias ?? 3;

  // Add calendar entry mutation
  const addEntry = useMutation({
    mutationFn: async (entry: any) => {
      const { error } = await supabase.from("treino_calendario").insert(entry);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["treino-calendario"] });
      toast.success("Treino adicionado ao calendário!");
      resetForm();
      setShowAddDialog(false);
    },
    onError: () => toast.error("Erro ao salvar treino"),
  });

  // Delete calendar entry mutation
  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("treino_calendario").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["treino-calendario"] });
      toast.success("Treino removido!");
    },
    onError: () => toast.error("Erro ao remover treino"),
  });

  // Update meta semanal
  const updateMeta = useMutation({
    mutationFn: async (dias: number) => {
      const { error } = await supabase
        .from("aluno_perfil")
        .update({ meta_semanal_dias: dias } as any)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aluno-perfil-meta"] });
      setEditingGoal(false);
      toast.success("Meta atualizada!");
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
      toast.error("Adicione pelo menos um tipo de treino");
      return;
    }
    addEntry.mutate({
      aluno_id: user!.id,
      data: format(selectedDate!, "yyyy-MM-dd"),
      tipos: formTipos,
      duracao_min: formDuracao ? parseInt(formDuracao) : null,
      distancia_km: formDistancia ? parseFloat(formDistancia) : null,
      intensidade: formIntensidade,
      detalhes: formDetalhes || null,
      observacoes: formObservacoes || null,
    });
  };

  const addTipoTag = (tipo: string) => {
    if (tipo && !formTipos.includes(tipo)) {
      setFormTipos([...formTipos, tipo]);
    }
    setFormTipoInput("");
  };

  const removeTipoTag = (tipo: string) => {
    setFormTipos(formTipos.filter((t) => t !== tipo));
  };

  // Build calendar grid
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days: Date[] = [];
  let day = calendarStart;
  while (day <= calendarEnd) {
    days.push(day);
    day = addDays(day, 1);
  }

  // Merge entries by date
  const entriesByDate = useMemo(() => {
    const map: Record<string, Array<{ id: string; label: string; source: "manual" | "system" }>> = {};

    calendarEntries.forEach((e: any) => {
      const dateKey = e.data;
      if (!map[dateKey]) map[dateKey] = [];
      e.tipos.forEach((t: string) => {
        map[dateKey].push({ id: e.id, label: t, source: "manual" });
      });
    });

    registroEntries.forEach((r: any) => {
      const dateKey = r.data;
      if (!map[dateKey]) map[dateKey] = [];
      const t = (r.treinos as any) || {};
      const label =
        t.grupo_id && t.tipo && t.tipo !== "avulso"
          ? `Treino ${t.tipo}`
          : t.titulo || "Treino";
      map[dateKey].push({ id: r.id, label, source: "system" });
    });

    return map;
  }, [calendarEntries, registroEntries]);

  // Weekly stats calculation
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

    calendarEntries.forEach((e: any) => {
      if (e.data >= weekStartStr && e.data <= weekEndStr) {
        treinos++;
        if (e.duracao_min) minutos += e.duracao_min;
        if (e.distancia_km) distancia += parseFloat(e.distancia_km);
        e.tipos.forEach((t: string) => modalidades.add(t));
      }
    });

    registroEntries.forEach((r: any) => {
      if (r.data >= weekStartStr && r.data <= weekEndStr) {
        treinos++;
        if (r.duracao_min) minutos += r.duracao_min;
        const treino = r.treinos;
        if (treino) {
          const label = treino.tipo === 'avulso' ? treino.titulo : `Treino ${treino.tipo}`;
          modalidades.add(label);
        }
      }
    });

    return { treinos, minutos, distancia, modalidades: modalidades.size };
  }, [calendarEntries, registroEntries, weekStartStr, weekEndStr]);

  // Modality km breakdown (monthly)
  const modalityKm = useMemo(() => {
    const MODALITIES = ["Natação", "Ciclismo", "Corrida"];
    const km: Record<string, number> = {};
    MODALITIES.forEach(m => km[m] = 0);

    calendarEntries.forEach((e: any) => {
      if (e.distancia_km && e.tipos) {
        const dist = parseFloat(e.distancia_km);
        e.tipos.forEach((t: string) => {
          if (MODALITIES.includes(t)) {
            km[t] += dist;
          }
        });
      }
    });

    return MODALITIES.filter(m => km[m] > 0).map(m => ({ label: m, km: km[m] }));
  }, [calendarEntries]);

  // Monthly stats (for top bar)
  const monthlyStats = useMemo(() => {
    let treinos = 0;
    let minutos = 0;
    let distancia = 0;
    const modalidades = new Set<string>();

    calendarEntries.forEach((e: any) => {
      treinos++;
      if (e.duracao_min) minutos += e.duracao_min;
      if (e.distancia_km) distancia += parseFloat(e.distancia_km);
      e.tipos.forEach((t: string) => modalidades.add(t));
    });

    registroEntries.forEach((r: any) => {
      treinos++;
      if (r.duracao_min) minutos += r.duracao_min;
      const treino = r.treinos;
      if (treino) {
        const label = treino.tipo === 'avulso' ? treino.titulo : `Treino ${treino.tipo}`;
        modalidades.add(label);
      }
    });

    return { treinos, minutos, distancia, modalidades: modalidades.size };
  }, [calendarEntries, registroEntries]);

  // Days with workouts in the current week
  const weekDaysWithWorkouts = useMemo(() => {
    const daysSet = new Set<string>();
    calendarEntries.forEach((e: any) => {
      if (e.data >= weekStartStr && e.data <= weekEndStr) daysSet.add(e.data);
    });
    registroEntries.forEach((r: any) => {
      if (r.data >= weekStartStr && r.data <= weekEndStr) daysSet.add(r.data);
    });
    return daysSet.size;
  }, [calendarEntries, registroEntries, weekStartStr, weekEndStr]);

  const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  return (
    <div className="space-y-5">
      {/* Stats bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: "🏋️", label: "Treinos na Semana", value: weeklyStats.treinos, color: "text-purple-600" },
          { icon: "⏱️", label: "Minutos Totais", value: weeklyStats.minutos, color: "text-green-600" },
          { icon: "📍", label: "Distância (km)", value: weeklyStats.distancia.toFixed(1), color: "text-red-500" },
          { icon: "⚡", label: "Modalidades", value: weeklyStats.modalidades, color: "text-orange-500" },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="text-2xl">{stat.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className={cn("text-xl font-bold", stat.color)}>{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Calendar + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Calendar */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-4">
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <h3 className="text-lg font-bold capitalize">
                {format(currentMonth, "MMMM yyyy", { locale: ptBR })}
              </h3>
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>

            {/* Week headers */}
            <div className="grid grid-cols-7 mb-2">
              {weekDays.map((d) => (
                <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
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
                    onClick={() => {
                      setSelectedDate(dayItem);
                    }}
                  >
                    <span className={cn(
                      "text-xs font-medium",
                      isTodayDate && "text-primary font-bold"
                    )}>
                      {format(dayItem, "d")}
                    </span>

                    <div className="mt-1 space-y-0.5">
                      {entries.slice(0, 3).map((entry, eIdx) => (
                        <div
                          key={eIdx}
                          className={cn(
                            "text-[10px] px-1 py-0.5 rounded truncate",
                            entry.source === "system"
                              ? "bg-primary/20 text-primary"
                              : "bg-accent/20 text-accent-foreground"
                          )}
                        >
                          {entry.label}
                        </div>
                      ))}
                      {entries.length > 3 && (
                        <span className="text-[9px] text-muted-foreground">+{entries.length - 3}</span>
                      )}
                    </div>

                    {/* Add button on hover */}
                    {isCurrentMonth && isSelected && (
                      <button
                        className="absolute bottom-1 right-1 text-[10px] text-primary hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAddDialog(true);
                        }}
                      >
                        + Adicionar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Selected day entries */}
            {selectedDate && entriesByDate[format(selectedDate, "yyyy-MM-dd")]?.length > 0 && (
              <div className="mt-4 border-t pt-3 space-y-2">
                <p className="text-sm font-medium">
                  Treinos em {format(selectedDate, "dd/MM/yyyy")}
                </p>
                {entriesByDate[format(selectedDate, "yyyy-MM-dd")]
                  ?.map((entry, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "w-2 h-2 rounded-full",
                          entry.source === "system" ? "bg-primary" : "bg-accent"
                        )} />
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

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Resumo da Semana */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <CalendarIcon className="h-4 w-4 text-primary" />
                <h4 className="font-bold text-sm">Resumo da Semana</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                {format(weekStart, "dd 'de' MMM", { locale: ptBR })} - {format(weekEnd, "dd 'de' MMM", { locale: ptBR })}
              </p>

              {/* Meta Semanal */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium">Meta Semanal (Dias)</span>
                <div className="flex items-center gap-2">
                  {editingGoal ? (
                    <>
                      <Input
                        type="number"
                        min={1}
                        max={7}
                        value={goalValue}
                        onChange={(e) => setGoalValue(parseInt(e.target.value) || 1)}
                        className="w-14 h-7 text-center text-sm"
                      />
                      <Button size="sm" className="h-7 px-2 text-xs" onClick={() => updateMeta.mutate(goalValue)}>
                        OK
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className={cn(
                        "font-bold text-lg",
                        weekDaysWithWorkouts >= metaSemanalDias ? "text-green-600" : "text-primary"
                      )}>
                        {weekDaysWithWorkouts}/{metaSemanalDias}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => {
                          setGoalValue(metaSemanalDias);
                          setEditingGoal(true);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Weekly stats grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{weeklyStats.treinos}</p>
                  <p className="text-[10px] text-muted-foreground">Treinos Totais</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{weeklyStats.minutos}</p>
                  <p className="text-[10px] text-muted-foreground">Minutos</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-600">{weeklyStats.distancia.toFixed(1)}</p>
                  <p className="text-[10px] text-muted-foreground">Distância (km)</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{weeklyStats.modalidades}</p>
                  <p className="text-[10px] text-muted-foreground">Modalidades</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Kilometragem por Modalidade */}
          {modalityKm.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="h-4 w-4 text-primary" />
                  <h4 className="font-bold text-sm">Kilometragem do Mês</h4>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  {format(currentMonth, "MMMM yyyy", { locale: ptBR })}
                </p>
                <div className="space-y-2">
                  {modalityKm.map((m) => (
                    <div key={m.label} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                      <span className="text-sm font-medium flex items-center gap-2">
                        {m.label === "Natação" ? "🏊" : m.label === "Ciclismo" ? "🚴" : "🏃"}
                        {m.label}
                      </span>
                      <span className="text-sm font-bold text-primary">{m.km.toFixed(1)} km</span>
                    </div>
                  ))}
                  {modalityKm.length > 1 && (
                    <div className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2 mt-1">
                      <span className="text-sm font-semibold">Total</span>
                      <span className="text-sm font-bold text-primary">
                        {modalityKm.reduce((s, m) => s + m.km, 0).toFixed(1)} km
                      </span>
                    </div>
                  )}
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
        </div>
      </div>

      {/* Add Treino Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Adicionar Treino - {selectedDate ? format(selectedDate, "dd/MM/yyyy") : ""}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Tipos de Treino */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Modalidade</label>
              {(() => {
                const QUICK_OPTIONS = ["Natação", "Ciclismo", "Corrida"];
                const hasQuickSelected = formTipos.some((t) => QUICK_OPTIONS.includes(t));
                return (
                  <>
                    {/* Quick select buttons - only one allowed */}
                     <div className="flex flex-wrap gap-2 mb-3">
                       {[
                         { label: "🏊 Natação", value: "Natação" },
                         { label: "🚴 Ciclismo", value: "Ciclismo" },
                         { label: "🏃 Corrida", value: "Corrida" },
                       ].map((mod) => {
                         const isSelected = formTipos.includes(mod.value);
                         const isOtherSelected = hasQuickSelected && !isSelected;
                         return (
                           <Button
                             key={mod.value}
                             type="button"
                             size="sm"
                             variant={isSelected ? "default" : "outline"}
                             className={isOtherSelected ? "opacity-50 cursor-not-allowed" : ""}
                              onClick={() => {
                                if (isOtherSelected) return;
                                if (isSelected) {
                                  setFormTipos([]);
                                } else {
                                  setFormTipos([mod.value]);
                                  setFormTipoInput("");
                                }
                              }}
                           >
                             {mod.label}
                           </Button>
                         );
                       })}
                     </div>

                    {/* Free text - disabled when quick option is selected */}
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
                                onMouseDown={(e) => { e.preventDefault(); addTipoTag(s); }}
                              >
                                {s}
                              </button>
                            ))}
                            {showAddNew && (
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-muted transition-colors flex items-center gap-2 border-t"
                                onMouseDown={(e) => { e.preventDefault(); handleAddNewTipo(); }}
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

            {/* Duration & Distance */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Duração (minutos)</label>
                <Input
                  type="number"
                  placeholder="Ex: 60"
                  value={formDuracao}
                  onChange={(e) => setFormDuracao(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Distância (km)</label>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Ex: 5.5"
                  value={formDistancia}
                  onChange={(e) => setFormDistancia(e.target.value)}
                />
              </div>
            </div>

            {/* Intensidade */}
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

            {/* Detalhes */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Outros exercícios/detalhes</label>
              <Textarea
                placeholder="Descreva outros exercícios que não estão na lista..."
                value={formDetalhes}
                onChange={(e) => setFormDetalhes(e.target.value)}
                rows={3}
              />
            </div>

            {/* Observações */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Observações</label>
              <Textarea
                placeholder="Como foi o treino? Como se sentiu? Alguma observação..."
                value={formObservacoes}
                onChange={(e) => setFormObservacoes(e.target.value)}
                rows={3}
              />
            </div>

            {/* Buttons */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { resetForm(); setShowAddDialog(false); }}>
                Cancelar
              </Button>
              <Button onClick={handleAddTreino} disabled={addEntry.isPending}>
                Salvar Treino
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
