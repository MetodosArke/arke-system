import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Clock, Plus, X, ChevronLeft, Check, Info, CalendarDays, ClipboardList, MapPin, Lightbulb } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DIAS_SEMANA = [
  { key: 1, label: "Segunda", full: "Segunda-feira" },
  { key: 2, label: "Terça", full: "Terça-feira" },
  { key: 3, label: "Quarta", full: "Quarta-feira" },
  { key: 4, label: "Quinta", full: "Quinta-feira" },
  { key: 5, label: "Sexta", full: "Sexta-feira" },
  { key: 6, label: "Sábado", full: "Sábado" },
  { key: 0, label: "Domingo", full: "Domingo" },
];

const ATIVIDADES = [
  { nome: "Treino", cor: "bg-emerald-600", text: "text-white" },
  { nome: "Descanso", cor: "bg-teal-500", text: "text-white" },
  { nome: "Trabalho", cor: "bg-blue-500", text: "text-white" },
  { nome: "Trajeto", cor: "bg-yellow-500", text: "text-white" },
  { nome: "Estudos", cor: "bg-purple-500", text: "text-white" },
  { nome: "Diversão", cor: "bg-pink-500", text: "text-white" },
  { nome: "Sono", cor: "bg-indigo-800", text: "text-white" },
  { nome: "Refeição", cor: "bg-orange-500", text: "text-white" },
  { nome: "Outro", cor: "bg-gray-500", text: "text-white" },
];

const HORAS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

type EntradaRotina = {
  id?: string;
  atividade: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fim: string;
  descricao?: string;
};

type HorarioSugerido = {
  dia: number;
  diaLabel: string;
  hora_inicio: string;
  hora_fim: string;
  local: string;
  descricao: string;
};

type DiaHorario = {
  horario: string;
  local: string;
};

// "welcome" | "manual" | "grid" | "sugestoes"
type Step = "welcome" | "manual" | "grid" | "sugestoes";

export default function AlunoRotina() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [entradas, setEntradas] = useState<EntradaRotina[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EntradaRotina | null>(null);

  // Dialog form state
  const [formAtividade, setFormAtividade] = useState("Trabalho");
  const [formHoraInicio, setFormHoraInicio] = useState("08:00");
  const [formHoraFim, setFormHoraFim] = useState("18:00");
  const [formDescricao, setFormDescricao] = useState("");
  const [formDias, setFormDias] = useState<number[]>([]);
  const [formTargetDia, setFormTargetDia] = useState<number>(1);

  const [step, setStep] = useState<Step>("welcome");
  const [initialStepResolved, setInitialStepResolved] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const userChangedRef = useRef(false);
  const [sugestoes, setSugestoes] = useState<HorarioSugerido[]>([]);
  const [selectedSugestoes, setSelectedSugestoes] = useState<number[]>([]);

  // Manual form state
  const [manualDias, setManualDias] = useState<number[]>([]);
  const [manualGlobalHorario, setManualGlobalHorario] = useState("");
  const [manualGlobalLocal, setManualGlobalLocal] = useState("");
  const [manualDiaHorarios, setManualDiaHorarios] = useState<Record<number, DiaHorario>>({});

  // Drag state
  const [dragging, setDragging] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const { data: rotinaData, isLoading } = useQuery({
    queryKey: ["rotina-semanal"],
    queryFn: async () => {
      const { data } = await supabase
        .from("rotina_semanal" as any)
        .select("*")
        .eq("user_id", user!.id)
        .order("dia_semana");
      return (data as any[]) || [];
    },
    enabled: !!user,
  });

  const { data: planoData } = useQuery({
    queryKey: ["plano-treino-semanal"],
    queryFn: async () => {
      const { data } = await supabase
        .from("plano_treino_semanal" as any)
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data as any;
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (initialStepResolved) return;
    if (rotinaData && rotinaData.length > 0) {
      setEntradas(
        rotinaData.map((r: any) => ({
          id: r.id,
          atividade: r.atividade,
          dia_semana: r.dia_semana,
          hora_inicio: r.hora_inicio || "08:00",
          hora_fim: r.hora_fim || "18:00",
          descricao: "",
        }))
      );
      setStep("grid");
      setInitialStepResolved(true);
      // Mark initial load done after a tick so auto-save doesn't trigger on load
      setTimeout(() => setInitialLoadDone(true), 200);
    } else if (planoData && planoData.dias_treino && planoData.dias_treino.length > 0) {
      setStep("grid");
      setInitialStepResolved(true);
      setTimeout(() => setInitialLoadDone(true), 200);
    } else if (rotinaData !== undefined && planoData !== undefined) {
      setInitialStepResolved(true);
      setTimeout(() => setInitialLoadDone(true), 200);
    }
  }, [rotinaData, planoData, initialStepResolved]);

  // Auto-save whenever entradas change from user interaction (not initial load)
  useEffect(() => {
    if (!initialLoadDone) return;
    if (!user) return;
    if (!userChangedRef.current) return;
    userChangedRef.current = false;
    const entradasSnapshot = [...entradas];
    saveRotinaMutation.mutate(entradasSnapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entradas, initialLoadDone]);

  const saveRotinaMutation = useMutation({
    mutationFn: async (snapshot: EntradaRotina[]) => {
      await supabase.from("rotina_semanal" as any).delete().eq("user_id", user!.id);
      const toInsert = snapshot.map((e) => ({
        user_id: user!.id,
        dia_semana: e.dia_semana,
        atividade: e.atividade,
        hora_inicio: e.hora_inicio,
        hora_fim: e.hora_fim,
      }));
      if (toInsert.length > 0) {
        const { error } = await supabase
          .from("rotina_semanal" as any)
          .insert(toInsert as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rotina-semanal"] });
      toast.success("Rotina salva!");
    },
    onError: () => toast.error("Erro ao salvar rotina"),
  });

  const saveManualMutation = useMutation({
    mutationFn: async () => {
      const diasTreino = manualDias.map((d) => DIAS_SEMANA.find((ds) => ds.key === d)?.full || "");
      const horario = manualGlobalHorario || Object.values(manualDiaHorarios)[0]?.horario || "";
      const local = manualGlobalLocal || Object.values(manualDiaHorarios)[0]?.local || "";

      const payload = {
        user_id: user!.id,
        dias_treino: diasTreino,
        horario_preferido: horario,
        local_treino: local,
        updated_at: new Date().toISOString(),
      } as any;

      if (planoData?.id) {
        const { error } = await supabase
          .from("plano_treino_semanal" as any)
          .update(payload)
          .eq("id", planoData.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("plano_treino_semanal" as any)
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plano-treino-semanal"] });
      toast.success("Gestão de tempo salva! 💪");
    },
    onError: () => toast.error("Erro ao salvar"),
  });

  const savePlanoMutation = useMutation({
    mutationFn: async () => {
      const selected = selectedSugestoes.map((i) => sugestoes[i]);
      const diasTreino = [...new Set(selected.map((s) => DIAS_SEMANA.find((d) => d.key === s.dia)?.full || ""))];
      const horario = selected[0]?.hora_inicio || "";
      const local = selected[0]?.local || "";

      const payload = {
        user_id: user!.id,
        dias_treino: diasTreino,
        horario_preferido: horario,
        local_treino: local,
        updated_at: new Date().toISOString(),
      } as any;

      if (planoData?.id) {
        const { error } = await supabase
          .from("plano_treino_semanal" as any)
          .update(payload)
          .eq("id", planoData.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("plano_treino_semanal" as any)
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plano-treino-semanal"] });
      toast.success("Horários de treino confirmados! 💪");
    },
    onError: () => toast.error("Erro ao salvar horários"),
  });

  // Dialog helpers
  const openNewDialog = (diaKey?: number, hora?: string, atividade?: string) => {
    setEditingEntry(null);
    setFormAtividade(atividade || "Trabalho");
    setFormHoraInicio(hora || "08:00");
    const endHour = hora ? Math.min(parseInt(hora) + 1, 23) : 18;
    setFormHoraFim(`${String(endHour).padStart(2, "0")}:00`);
    setFormDescricao("");
    setFormTargetDia(diaKey ?? 1);
    setFormDias([]);
    setDialogOpen(true);
  };

  const openEditDialog = (entry: EntradaRotina, idx: number) => {
    setEditingEntry({ ...entry, id: String(idx) });
    setFormAtividade(entry.atividade);
    setFormHoraInicio(entry.hora_inicio);
    setFormHoraFim(entry.hora_fim);
    setFormDescricao(entry.descricao || "");
    setFormTargetDia(entry.dia_semana);
    setFormDias([]);
    setDialogOpen(true);
  };

  const handleAddEntry = () => {
    userChangedRef.current = true;
    const diasToAdd = formDias.length > 0 ? formDias : [formTargetDia];
    const newEntries = diasToAdd.map((dia) => ({
      atividade: formAtividade,
      dia_semana: dia,
      hora_inicio: formHoraInicio,
      hora_fim: formHoraFim,
      descricao: formDescricao,
    }));

    if (editingEntry?.id != null) {
      const idx = parseInt(editingEntry.id);
      setEntradas((prev) => {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          atividade: formAtividade,
          hora_inicio: formHoraInicio,
          hora_fim: formHoraFim,
          descricao: formDescricao,
        };
        return updated;
      });
    } else {
      setEntradas((prev) => [...prev, ...newEntries]);
    }
    setDialogOpen(false);
  };

  const removeEntry = (idx: number) => {
    userChangedRef.current = true;
    setEntradas((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleDiaRepetir = (dia: number) => {
    setFormDias((prev) =>
      prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia]
    );
  };

  const findTrainingSlots = () => {
    const slots: HorarioSugerido[] = [];

    if (planoData && planoData.dias_treino) {
      planoData.dias_treino.forEach((diaName: string) => {
        const dia = DIAS_SEMANA.find((d) => d.full === diaName);
        if (dia) {
          slots.push({
            dia: dia.key,
            diaLabel: dia.full,
            hora_inicio: planoData.horario_preferido || "",
            hora_fim: "",
            local: planoData.local_treino || "",
            descricao: "Horário cadastrado manualmente",
          });
        }
      });
    }

    if (slots.length === 0) {
      toast.info("Nenhum horário cadastrado. Cadastre seus horários de treino.");
      setStep("manual");
      return;
    }

    setSugestoes(slots);
    setSelectedSugestoes(slots.map((_, i) => i));
    if (entradas.length > 0) {
      saveRotinaMutation.mutate([...entradas]);
    }
    setStep("sugestoes");
  };

  const toggleSugestao = (idx: number) => {
    setSelectedSugestoes((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const getAtividadeCor = (nome: string) => {
    return ATIVIDADES.find((a) => a.nome === nome)?.cor || "bg-gray-400";
  };

  const getEntriesForCell = (diaKey: number, hora: string) => {
    const horaNum = parseInt(hora.split(":")[0]);
    return entradas
      .map((e, idx) => {
        if (e.dia_semana !== diaKey) return null;
        const startH = parseInt(e.hora_inicio.split(":")[0]);
        const startM = parseInt(e.hora_inicio.split(":")[1] || "0");
        const endH = parseInt(e.hora_fim.split(":")[0]);
        const endM = parseInt(e.hora_fim.split(":")[1] || "0");

        // Convert to total minutes for precise comparison
        const startTotal = startH * 60 + startM;
        let endTotal = endH * 60 + endM;
        // Treat 00:00 end time as midnight (24:00 = 1440 min)
        if (endTotal <= startTotal && endH === 0 && endM === 0) endTotal = 1440;
        const cellStart = horaNum * 60;
        const cellEnd = cellStart + 60;

        // Check if this entry overlaps this cell at all
        if (startTotal >= cellEnd || endTotal <= cellStart) return null;

        // Calculate visual coverage percentage for this cell
        const overlapStart = Math.max(startTotal, cellStart);
        const overlapEnd = Math.min(endTotal, cellEnd);
        const coverage = (overlapEnd - overlapStart) / 60; // 0 to 1

        return { ...e, idx, coverage };
      })
      .filter(Boolean) as (EntradaRotina & { idx: number; coverage: number })[];
  };

  // Drag handlers - fixed to properly set activity before opening dialog
  const handleDragStart = (atividade: string) => {
    setDragging(atividade);
  };

  const handleDragEnd = () => {
    setDragging(null);
  };

  const handleCellDrop = (diaKey: number, hora: string) => {
    if (dragging) {
      const atv = dragging;
      setDragging(null);
      // Use setTimeout to ensure state is clean before opening dialog
      setTimeout(() => {
        openNewDialog(diaKey, hora, atv);
      }, 50);
    }
  };

  const handleCellClick = (diaKey: number, hora: string) => {
    const existing = getEntriesForCell(diaKey, hora);
    if (existing.length === 0) {
      openNewDialog(diaKey, hora);
    }
  };

  // Manual form helpers
  const toggleManualDia = (key: number) => {
    setManualDias((prev) =>
      prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]
    );
  };

  const applyGlobalToAll = () => {
    if (!manualGlobalHorario && !manualGlobalLocal) {
      toast.error("Preencha o horário ou local antes de aplicar");
      return;
    }
    const updated: Record<number, DiaHorario> = {};
    manualDias.forEach((d) => {
      updated[d] = {
        horario: manualGlobalHorario || manualDiaHorarios[d]?.horario || "",
        local: manualGlobalLocal || manualDiaHorarios[d]?.local || "",
      };
    });
    setManualDiaHorarios(updated);
    toast.success("Horário aplicado a todos os dias!");
  };

  const updateDiaHorario = (dia: number, field: "horario" | "local", value: string) => {
    setManualDiaHorarios((prev) => ({
      ...prev,
      [dia]: { ...prev[dia], [field]: value },
    }));
  };

  // Load existing plano into manual form
  useEffect(() => {
    if (planoData && step === "manual") {
      const diasKeys = (planoData.dias_treino || []).map((nome: string) => {
        return DIAS_SEMANA.find((d) => d.full === nome)?.key;
      }).filter((k: any) => k !== undefined);
      setManualDias(diasKeys);
      setManualGlobalHorario(planoData.horario_preferido || "");
      setManualGlobalLocal(planoData.local_treino || "");
      const horarios: Record<number, DiaHorario> = {};
      diasKeys.forEach((k: number) => {
        horarios[k] = {
          horario: planoData.horario_preferido || "",
          local: planoData.local_treino || "",
        };
      });
      setManualDiaHorarios(horarios);
    }
  }, [planoData, step]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  // ===================== WELCOME SCREEN =====================
  if (step === "welcome") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-16 px-4 space-y-6 max-w-md mx-auto text-center"
      >
        <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
          <CalendarDays className="h-10 w-10 text-primary" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-foreground">Gestão de Tempo para Treinos</h2>
          <p className="text-muted-foreground text-sm">
            Vamos configurar sua rotina semanal para encontrar os melhores horários de treino.
          </p>
        </div>

        <Card className="w-full border-primary/20 bg-primary/5">
          <CardContent className="p-5 space-y-4">
            <p className="text-sm font-medium text-foreground">
              Você já tem uma rotina definida e quer mapear seus compromissos visualmente?
            </p>

            <div className="flex flex-col gap-3">
              <Button
                onClick={() => setStep("grid")}
                className="w-full gap-2"
              >
                <CalendarDays className="h-4 w-4" />
                Sim, usar o Programador de Rotina
              </Button>
              <Button
                variant="outline"
                onClick={() => setStep("manual")}
                className="w-full gap-2"
              >
                <ClipboardList className="h-4 w-4" />
                Não, incluir manualmente
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // ===================== MANUAL ENTRY SCREEN =====================
  if (step === "manual") {
    const selectedDiasOrdered = DIAS_SEMANA.filter((d) => manualDias.includes(d.key));

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-6 pb-8 max-w-2xl mx-auto"
      >
        <div>
          <h2 className="text-xl font-bold text-primary">Gestão de Tempo para Treinos</h2>
          <p className="text-sm text-muted-foreground">
            Configure seus dias e horários de treino para manter a consistência
          </p>
        </div>

        {/* Tip banner */}
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3">
          <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            <strong>Dica:</strong> Treinar perto do trabalho ou de casa economiza tempo no deslocamento e aumenta a chance de você manter a rotina!
          </p>
        </div>

        {/* Select training days */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Selecione os Dias de Treino</h3>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {DIAS_SEMANA.map((dia) => (
              <label
                key={dia.key}
                className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
                  manualDias.includes(dia.key)
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-border hover:border-primary/30"
                }`}
              >
                <Checkbox
                  checked={manualDias.includes(dia.key)}
                  onCheckedChange={() => toggleManualDia(dia.key)}
                />
                <span className="text-sm font-medium">{dia.full}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Define schedules - only show when days are selected */}
        <AnimatePresence>
          {manualDias.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4 overflow-hidden"
            >
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Defina os Horários</h3>
              </div>

              {/* Apply to all */}
              <Card className="border-muted">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Aplicar mesmo horário para todos os dias</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Horário</Label>
                      <Input
                        type="time"
                        value={manualGlobalHorario}
                        onChange={(e) => setManualGlobalHorario(e.target.value)}
                        placeholder="--:--"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> Local próximo
                      </Label>
                      <Input
                        value={manualGlobalLocal}
                        onChange={(e) => setManualGlobalLocal(e.target.value)}
                        placeholder="Ex: Academia perto do trabalho"
                      />
                    </div>
                  </div>

                  <Button
                    onClick={applyGlobalToAll}
                    className="w-full"
                  >
                    Aplicar a Todos os Dias Selecionados
                  </Button>
                </CardContent>
              </Card>

              {/* Individual days */}
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground font-medium">Ou personalize cada dia:</p>
                {selectedDiasOrdered.map((dia) => (
                  <motion.div
                    key={dia.key}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-2"
                  >
                    <h4 className="text-sm font-semibold">{dia.full}</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Horário</Label>
                        <Input
                          type="time"
                          value={manualDiaHorarios[dia.key]?.horario || ""}
                          onChange={(e) => updateDiaHorario(dia.key, "horario", e.target.value)}
                          placeholder="--:--"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> Local próximo
                        </Label>
                        <Input
                          value={manualDiaHorarios[dia.key]?.local || ""}
                          onChange={(e) => updateDiaHorario(dia.key, "local", e.target.value)}
                          placeholder="Ex: Academia perto do trabalho"
                        />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom actions */}
        <div className="flex flex-col sm:flex-row items-stretch gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => setStep("grid")}
            className="gap-1 text-xs"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Usar Programador de Rotina
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            onClick={() => setStep("welcome")}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => saveManualMutation.mutate()}
            disabled={manualDias.length === 0 || saveManualMutation.isPending}
            className="gap-1"
          >
            <CalendarDays className="h-4 w-4" />
            Salvar Gestão de Tempo
          </Button>
        </div>
      </motion.div>
    );
  }

  // ===================== SUGESTOES SCREEN =====================
  if (step === "sugestoes") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-4 pb-8"
      >
        <div>
          <h2 className="text-xl font-bold text-primary">Horários Sugeridos para Treino</h2>
          <p className="text-sm text-muted-foreground">
            Seus horários de treino cadastrados
          </p>
        </div>

        {sugestoes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sugestoes.map((sug, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-4 space-y-1">
                    <div className="flex items-start justify-between">
                      <p className="font-semibold text-sm">{sug.diaLabel}</p>
                      <button
                        onClick={() => {
                          const updated = sugestoes.filter((_, i) => i !== idx);
                          setSugestoes(updated);
                          setSelectedSugestoes(updated.map((_, i) => i));
                          // Also remove from plano
                          const remaining = updated.map((s) => DIAS_SEMANA.find((d) => d.key === s.dia)?.full || "");
                          const payload = {
                            user_id: user!.id,
                            dias_treino: remaining,
                            horario_preferido: updated[0]?.hora_inicio || "",
                            local_treino: updated[0]?.local || "",
                            updated_at: new Date().toISOString(),
                          } as any;
                          if (planoData?.id) {
                            supabase.from("plano_treino_semanal" as any).update(payload).eq("id", planoData.id).then(() => {
                              queryClient.invalidateQueries({ queryKey: ["plano-treino-semanal"] });
                            });
                          }
                          toast.success("Horário removido");
                        }}
                        className="text-destructive hover:bg-destructive/10 rounded p-1 transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {sug.hora_inicio && (
                      <p className="text-sm text-primary font-medium flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {sug.hora_inicio}{sug.hora_fim ? ` - ${sug.hora_fim}` : ""}
                      </p>
                    )}
                    {sug.local && <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" />{sug.local}</p>}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        ) : (
          <Card className="border-dashed border-muted-foreground/30">
            <CardContent className="p-8 text-center space-y-2">
              <Clock className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Nenhum horário cadastrado ainda</p>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => setStep("grid")} className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Voltar ao Calendário
          </Button>
          <div className="flex-1" />
          <Button
            onClick={() => setStep("manual")}
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            Cadastrar Horários
          </Button>
        </div>
      </motion.div>
    );
  }

  // ===================== GRID / CALENDAR SCREEN =====================
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4 pb-8"
    >
      <div>
        <h2 className="text-xl font-bold text-primary">Monte sua Rotina Semanal</h2>
        <p className="text-sm text-muted-foreground">
          Arraste as atividades para os horários da semana
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3">
        <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 dark:text-amber-300">
          <strong>Como usar:</strong> Arraste os boxes coloridos para o calendário e solte no horário desejado!
        </p>
      </div>

      <div className="flex gap-4">
        {/* Activity sidebar */}
        <div className="shrink-0 space-y-2 w-[110px] sm:w-[130px]">
          <h3 className="text-sm font-semibold">Atividades</h3>
          {ATIVIDADES.map((atv) => (
            <div
              key={atv.nome}
              draggable
              onDragStart={() => handleDragStart(atv.nome)}
              onDragEnd={handleDragEnd}
              className={`${atv.cor} ${atv.text} rounded-lg px-3 py-2.5 cursor-grab active:cursor-grabbing shadow-sm transition-transform hover:scale-105`}
            >
              <p className="text-xs font-bold">{atv.nome}</p>
              <p className="text-[9px] opacity-80">Arraste para o grid</p>
            </div>
          ))}
        </div>

        {/* Weekly grid */}
        <div className="flex-1 min-w-0 overflow-x-auto" ref={gridRef}>
          <div className="min-w-[500px]">
            <div className="flex items-center gap-1 mb-2">
              <h3 className="text-sm font-semibold">Grade Semanal</h3>
            </div>

            {/* Grid header */}
            <div className="grid grid-cols-[50px_repeat(7,1fr)] text-[10px] font-medium text-muted-foreground border-b pb-1 mb-0.5">
              <div>Horário</div>
              {DIAS_SEMANA.map((d) => (
                <div key={d.key} className="text-center">{d.label}</div>
              ))}
            </div>

            {/* Grid rows */}
            <div className="border rounded-lg overflow-hidden">
              {HORAS.map((hora) => (
                <div
                  key={hora}
                  className="grid grid-cols-[50px_repeat(7,1fr)] border-b last:border-b-0 h-[28px]"
                >
                  <div className="text-[10px] text-muted-foreground flex items-center px-1 border-r bg-muted/30">
                    {hora}
                  </div>
                  {DIAS_SEMANA.map((dia) => {
                    const cellEntries = getEntriesForCell(dia.key, hora);
                    const horaNum = parseInt(hora);
                    const isFirstHour = cellEntries.length > 0 && cellEntries.some((e) => {
                      const startH = parseInt(e.hora_inicio.split(":")[0]);
                      return startH === horaNum;
                    });

                    return (
                      <div
                        key={dia.key}
                        className={`border-r last:border-r-0 relative cursor-pointer transition-colors ${
                          cellEntries.length > 0
                            ? ""
                            : dragging
                            ? "hover:bg-primary/10"
                            : "hover:bg-muted/50"
                        }`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.add("bg-primary/10");
                        }}
                        onDragLeave={(e) => {
                          e.currentTarget.classList.remove("bg-primary/10");
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove("bg-primary/10");
                          handleCellDrop(dia.key, hora);
                        }}
                        onClick={() => handleCellClick(dia.key, hora)}
                      >
                        {cellEntries.length > 0 && (() => {
                          const entry = cellEntries[0];
                          const coverage = entry.coverage;
                          // Determine if partial: starts partway or ends partway through this cell
                          const startH = parseInt(entry.hora_inicio.split(":")[0]);
                          const startM = parseInt(entry.hora_inicio.split(":")[1] || "0");
                          const isPartialStart = startH === horaNum && startM > 0;
                          const topPercent = isPartialStart ? (startM / 60) * 100 : 0;
                          const heightPercent = coverage * 100;

                          return (
                            <div
                              className={`absolute inset-x-0 ${getAtividadeCor(entry.atividade)} opacity-60`}
                              style={{
                                top: `${topPercent}%`,
                                height: `${heightPercent}%`,
                              }}
                            >
                              {isFirstHour && (
                                <div className="px-1 py-0.5">
                                  <span className="text-[8px] text-white font-bold truncate block">
                                    {entry.atividade}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Summary */}
      {entradas.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Atividades adicionadas ({entradas.length})</h3>
          <div className="flex flex-wrap gap-2">
            {entradas.map((entry, idx) => {
              const dia = DIAS_SEMANA.find((d) => d.key === entry.dia_semana);
              return (
                <div
                  key={idx}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${getAtividadeCor(entry.atividade)} text-white`}
                >
                  <span className="font-medium">
                    {dia?.label} {entry.hora_inicio}-{entry.hora_fim}
                  </span>
                  <button onClick={() => removeEntry(idx)} className="hover:bg-white/20 rounded p-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-2 pt-2">
        <Button variant="outline" onClick={() => { userChangedRef.current = true; setEntradas([]); }} className="sm:flex-1">
          Limpar Tudo
        </Button>
        <Button
          onClick={findTrainingSlots}
          disabled={saveRotinaMutation.isPending}
          className="sm:flex-1 gap-1"
        >
          <Clock className="h-4 w-4" />
          Encontrar Horários para Treino
        </Button>
      </div>

      {/* Configure Activity Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configurar Atividade</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Tipo de Atividade</Label>
              <Select value={formAtividade} onValueChange={setFormAtividade}>
                <SelectTrigger>
                  <div className="flex items-center gap-2">
                    <div className={`h-3 w-3 rounded-full ${getAtividadeCor(formAtividade)}`} />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {ATIVIDADES.map((a) => (
                    <SelectItem key={a.nome} value={a.nome}>
                      <div className="flex items-center gap-2">
                        <div className={`h-3 w-3 rounded-full ${a.cor}`} />
                        {a.nome}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm">Hora Início</Label>
                <Input type="time" value={formHoraInicio} onChange={(e) => setFormHoraInicio(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Hora Fim</Label>
                <Input type="time" value={formHoraFim} onChange={(e) => setFormHoraFim(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Descrição (opcional)</Label>
              <Input
                placeholder="Ex: Trabalho no escritório, Aula de inglês..."
                value={formDescricao}
                onChange={(e) => setFormDescricao(e.target.value)}
              />
            </div>

            {!editingEntry && (
              <div className="space-y-2">
                <Label className="text-sm flex items-center gap-2">
                  📋 Repetir em outros dias?
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  {DIAS_SEMANA.map((dia) => (
                    <label key={dia.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={formDias.includes(dia.key)}
                        onCheckedChange={() => toggleDiaRepetir(dia.key)}
                      />
                      {dia.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAddEntry} className="gap-1">
                <Plus className="h-4 w-4" />
                {editingEntry ? "Salvar" : "Adicionar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
