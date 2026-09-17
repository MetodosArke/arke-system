import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  Scale,
  
  Calendar,
  Users,
  Plus,
  Smile,
  Frown,
  Meh,
  ArrowDown,
  ArrowUp,
  Minus,
  Trash2,
  Pencil,
  Activity,
  Lightbulb,
  X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useSearchParams } from "react-router-dom";
import { ptBR } from "date-fns/locale";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MEDIDAS_OPTIONS = [
  { key: "braco_direito_cm", label: "Braço Direito" },
  { key: "braco_esquerdo_cm", label: "Braço Esquerdo" },
  { key: "coxa_direita_cm", label: "Coxa Direita" },
  { key: "coxa_esquerda_cm", label: "Coxa Esquerda" },
  { key: "panturrilha_direita_cm", label: "Panturrilha Direita" },
  { key: "panturrilha_esquerda_cm", label: "Panturrilha Esquerda" },
  { key: "abdomen_cm", label: "Abdômen" },
  { key: "cintura_cm", label: "Cintura" },
  { key: "peito_cm", label: "Peito" },
  { key: "gluteos_cm", label: "Glúteos" },
];

const metricLabels: Record<string, string> = {
  peso_kg: "Peso (kg)",
  gordura_percentual: "% Gordura",
  musculo_percentual: "(kg) Músculo",
  cintura_cm: "Cintura (cm)",
  braco_direito_cm: "Braço Dir. (cm)",
  braco_esquerdo_cm: "Braço Esq. (cm)",
  coxa_direita_cm: "Coxa Dir. (cm)",
  coxa_esquerda_cm: "Coxa Esq. (cm)",
  panturrilha_direita_cm: "Pant. Dir. (cm)",
  panturrilha_esquerda_cm: "Pant. Esq. (cm)",
  abdomen_cm: "Abdômen (cm)",
  peito_cm: "Peito (cm)",
  gluteos_cm: "Glúteos (cm)",
};

function calcularPontos(current: any, previous: any | null): { pontos: number; metasAtingidas: string[] } {
  if (!previous) return { pontos: 0, metasAtingidas: [] };
  const metasAtingidas: string[] = [];
  let pontos = 0;

  const checkMeta = (
    metaDir: string | null,
    metaValor: number | null,
    currentVal: number | null,
    previousVal: number | null,
    label: string
  ) => {
    if (!metaDir || !currentVal || !previousVal) return;
    let atingiu = false;
    let superou = false;

    if (metaDir === "manter" && Math.abs(currentVal - previousVal) <= 0.5) {
      atingiu = true;
    } else if (metaDir === "diminuir" && currentVal < previousVal) {
      atingiu = true;
      if (metaValor && currentVal <= metaValor) superou = true;
    } else if (metaDir === "aumentar" && currentVal > previousVal) {
      atingiu = true;
      if (metaValor && currentVal >= metaValor) superou = true;
    }

    if (superou) {
      pontos += 30;
      metasAtingidas.push(`${label} (superou!)`);
    } else if (atingiu) {
      pontos += 20;
      metasAtingidas.push(label);
    }
  };

  checkMeta(previous.meta, previous.meta_peso_kg, current.peso_kg, previous.peso_kg, "Peso");
  checkMeta(previous.meta_gordura, previous.meta_gordura_valor, current.gordura_percentual, previous.gordura_percentual, "Gordura");
  checkMeta(previous.meta_musculo, previous.meta_musculo_valor, current.musculo_percentual, previous.musculo_percentual, "Músculo");

  return { pontos, metasAtingidas };
}

export default function AdminEvolucao() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialAlunos = searchParams.get("alunos")?.split(",").filter(Boolean) || [];
  const initialFilter = searchParams.get("filter") || "";
  const [selectedAluno, setSelectedAluno] = useState<string>(initialAlunos[0] || "");
  const [filteredAlunoIds, setFilteredAlunoIds] = useState<string[]>(initialAlunos);
  const [evalFilter, setEvalFilter] = useState<string>(initialFilter);

  useEffect(() => {
    const alunos = searchParams.get("alunos")?.split(",").filter(Boolean) || [];
    const filter = searchParams.get("filter") || "";
    if (alunos.length > 0) {
      setFilteredAlunoIds(alunos);
      setSelectedAluno(alunos[0]);
      setEvalFilter(filter);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);
  const [chartMetric, setChartMetric] = useState<string>("peso_kg");
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [novaMetricaNome, setNovaMetricaNome] = useState("");
  const [selectedMedidas, setSelectedMedidas] = useState<string[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Realtime: refetch quando houver inserts/updates/deletes para o aluno selecionado
  useEffect(() => {
    if (!selectedAluno) return;
    const channel = supabase
      .channel(`admin-evolucao-${selectedAluno}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "progresso_semanal", filter: `aluno_id=eq.${selectedAluno}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["admin-progresso", selectedAluno] });
          queryClient.invalidateQueries({ queryKey: ["admin-metrica-valores", selectedAluno] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "metricas_customizadas", filter: `aluno_id=eq.${selectedAluno}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["admin-metricas-custom", selectedAluno] });
          queryClient.invalidateQueries({ queryKey: ["admin-metrica-valores", selectedAluno] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "metrica_valores" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["admin-metrica-valores", selectedAluno] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedAluno, queryClient]);

  const [form, setForm] = useState({
    data_avaliacao: new Date().toISOString().split("T")[0],
    peso_kg: "",
    gordura_percentual: "",
    musculo_percentual: "",
    meta: "manter",
    meta_peso_kg: "",
    meta_gordura: "diminuir",
    meta_gordura_valor: "",
    meta_musculo: "aumentar",
    meta_musculo_valor: "",
    medidas: {} as Record<string, string>,
    observacoes: "",
    metricaValoresForm: {} as Record<string, string>,
    data_proxima_avaliacao: "",
  });

  const resetForm = () => {
    setForm({
      data_avaliacao: new Date().toISOString().split("T")[0],
      peso_kg: "", gordura_percentual: "", musculo_percentual: "",
      meta: "manter", meta_peso_kg: "",
      meta_gordura: "diminuir", meta_gordura_valor: "",
      meta_musculo: "aumentar", meta_musculo_valor: "",
      medidas: {}, observacoes: "",
      metricaValoresForm: {},
      data_proxima_avaliacao: "",
    });
    setSelectedMedidas([]);
  };

  const { data: alunos = [] } = useQuery({
    queryKey: ["admin-alunos-list"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name").order("full_name");
      return data || [];
    },
  });

  const { data: metricasCustom = [] } = useQuery({
    queryKey: ["admin-metricas-custom", selectedAluno],
    queryFn: async () => {
      const { data } = await supabase.from("metricas_customizadas").select("*").eq("aluno_id", selectedAluno).order("created_at");
      return data || [];
    },
    enabled: !!selectedAluno,
  });

  const { data: progressos = [], isLoading } = useQuery({
    queryKey: ["admin-progresso", selectedAluno],
    queryFn: async () => {
      const { data, error } = await supabase.from("progresso_semanal").select("*").eq("aluno_id", selectedAluno).order("data", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedAluno,
  });

  const { data: metricaValores = [] } = useQuery({
    queryKey: ["admin-metrica-valores", selectedAluno],
    queryFn: async () => {
      const progressoIds = progressos.map((p: any) => p.id);
      if (progressoIds.length === 0) return [];
      const { data } = await supabase.from("metrica_valores").select("*, metricas_customizadas(nome)").in("progresso_id", progressoIds);
      return data || [];
    },
    enabled: progressos.length > 0,
  });

  const { data: perfil } = useQuery({
    queryKey: ["admin-aluno-perfil", selectedAluno],
    queryFn: async () => {
      const { data } = await supabase.from("aluno_perfil").select("peso_kg, altura_cm").eq("user_id", selectedAluno).maybeSingle();
      return data;
    },
    enabled: !!selectedAluno,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const previous = progressos[0]; // latest existing record
      const insertData: any = {
        aluno_id: selectedAluno,
        data: form.data_avaliacao,
        peso_kg: form.peso_kg ? parseFloat(form.peso_kg) : null,
        gordura_percentual: form.gordura_percentual ? parseFloat(form.gordura_percentual) : null,
        musculo_percentual: form.musculo_percentual ? parseFloat(form.musculo_percentual) : null,
        meta: form.meta || null,
        meta_peso_kg: form.meta_peso_kg ? parseFloat(form.meta_peso_kg) : null,
        meta_gordura: form.meta_gordura || null,
        meta_gordura_valor: form.meta_gordura_valor ? parseFloat(form.meta_gordura_valor) : null,
        meta_musculo: form.meta_musculo || null,
        meta_musculo_valor: form.meta_musculo_valor ? parseFloat(form.meta_musculo_valor) : null,
        observacoes: form.observacoes || null,
        data_proxima_avaliacao: form.data_proxima_avaliacao || null,
      };

      // Add selected body measurements
      MEDIDAS_OPTIONS.forEach(({ key }) => {
        insertData[key] = form.medidas[key] ? parseFloat(form.medidas[key]) : null;
      });

      // Calculate points based on previous record
      if (previous) {
        const { pontos } = calcularPontos(
          { peso_kg: insertData.peso_kg, gordura_percentual: insertData.gordura_percentual, musculo_percentual: insertData.musculo_percentual },
          previous
        );
        insertData.pontos = pontos;
      } else {
        insertData.pontos = 0;
      }

      const { data: inserted, error } = await supabase.from("progresso_semanal").insert(insertData).select().single();
      if (error) throw error;

      // Save custom metric values
      const metricEntries = Object.entries(form.metricaValoresForm).filter(([_, v]) => v !== "" && v != null);
      if (metricEntries.length > 0) {
        const metricInserts = metricEntries.map(([metricaId, valor]) => ({
          metrica_id: metricaId,
          progresso_id: inserted.id,
          valor: parseFloat(valor as string),
        }));
        await supabase.from("metrica_valores").insert(metricInserts);
      }

      return inserted;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-progresso"] });
      queryClient.invalidateQueries({ queryKey: ["admin-metrica-valores"] });
      setShowDialog(false);
      resetForm();
      toast({ title: "Medição registrada com sucesso!" });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const createMetricaMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("metricas_customizadas").insert({
        nome: novaMetricaNome, aluno_id: selectedAluno, criado_por: user?.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-metricas-custom"] });
      setNovaMetricaNome("");
      toast({ title: "Métrica criada!" });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const deleteMetricaMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("metricas_customizadas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-metricas-custom"] });
      queryClient.invalidateQueries({ queryKey: ["admin-metrica-valores"] });
      toast({ title: "Métrica removida" });
    },
  });

  const deleteProgressoMutation = useMutation({
    mutationFn: async (id: string) => {
      // Delete related metrica_valores first
      await supabase.from("metrica_valores").delete().eq("progresso_id", id);
      const { error } = await supabase.from("progresso_semanal").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-progresso"] });
      queryClient.invalidateQueries({ queryKey: ["admin-metrica-valores"] });
      toast({ title: "Medição excluída com sucesso!" });
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    },
  });

  const updateProgressoMutation = useMutation({
    mutationFn: async () => {
      if (!editingId) throw new Error("Nenhum registro selecionado");
      const updateData: any = {
        data: form.data_avaliacao,
        peso_kg: form.peso_kg ? parseFloat(form.peso_kg) : null,
        gordura_percentual: form.gordura_percentual ? parseFloat(form.gordura_percentual) : null,
        musculo_percentual: form.musculo_percentual ? parseFloat(form.musculo_percentual) : null,
        meta: form.meta || null,
        meta_peso_kg: form.meta_peso_kg ? parseFloat(form.meta_peso_kg) : null,
        meta_gordura: form.meta_gordura || null,
        meta_gordura_valor: form.meta_gordura_valor ? parseFloat(form.meta_gordura_valor) : null,
        meta_musculo: form.meta_musculo || null,
        meta_musculo_valor: form.meta_musculo_valor ? parseFloat(form.meta_musculo_valor) : null,
        observacoes: form.observacoes || null,
        data_proxima_avaliacao: form.data_proxima_avaliacao || null,
      };
      MEDIDAS_OPTIONS.forEach(({ key }) => {
        updateData[key] = form.medidas[key] ? parseFloat(form.medidas[key]) : null;
      });
      const { error } = await supabase.from("progresso_semanal").update(updateData).eq("id", editingId);
      if (error) throw error;

      // Update custom metric values: delete old, insert new
      await supabase.from("metrica_valores").delete().eq("progresso_id", editingId);
      const metricEntries = Object.entries(form.metricaValoresForm).filter(([_, v]) => v !== "" && v != null);
      if (metricEntries.length > 0) {
        const metricInserts = metricEntries.map(([metricaId, valor]) => ({
          metrica_id: metricaId,
          progresso_id: editingId,
          valor: parseFloat(valor as string),
        }));
        await supabase.from("metrica_valores").insert(metricInserts);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-progresso"] });
      setShowDialog(false);
      setEditingId(null);
      resetForm();
      toast({ title: "Medição atualizada com sucesso!" });
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (p: any) => {
    setEditingId(p.id);
    const medidas: Record<string, string> = {};
    const activeMedidas: string[] = [];
    MEDIDAS_OPTIONS.forEach(({ key }) => {
      if (p[key] != null) {
        medidas[key] = String(p[key]);
        activeMedidas.push(key);
      }
    });
    setSelectedMedidas(activeMedidas);
    // Load existing metric values for this record
    const existingMetricValues: Record<string, string> = {};
    metricaValores
      .filter((mv: any) => mv.progresso_id === p.id)
      .forEach((mv: any) => {
        existingMetricValues[mv.metrica_id] = String(mv.valor);
      });
    setForm({
      data_avaliacao: p.data,
      peso_kg: p.peso_kg != null ? String(p.peso_kg) : "",
      gordura_percentual: p.gordura_percentual != null ? String(p.gordura_percentual) : "",
      musculo_percentual: p.musculo_percentual != null ? String(p.musculo_percentual) : "",
      meta: p.meta || "manter",
      meta_peso_kg: p.meta_peso_kg != null ? String(p.meta_peso_kg) : "",
      meta_gordura: p.meta_gordura || "diminuir",
      meta_gordura_valor: p.meta_gordura_valor != null ? String(p.meta_gordura_valor) : "",
      meta_musculo: p.meta_musculo || "aumentar",
      meta_musculo_valor: p.meta_musculo_valor != null ? String(p.meta_musculo_valor) : "",
      medidas,
      observacoes: p.observacoes || "",
      metricaValoresForm: existingMetricValues,
      data_proxima_avaliacao: p.data_proxima_avaliacao || "",
    });
    setShowDialog(true);
  };

  const latest = progressos[0];
  const previous = progressos[1];
  const currentPeso = latest?.peso_kg ?? perfil?.peso_kg;
  

  const totalPontos = progressos.reduce((sum: number, p: any) => sum + (p.pontos || 0), 0);

  const isPrimeiraMedicao = progressos.length === 0;

  const allMetricLabels = { ...metricLabels };
  metricasCustom.forEach((m: any) => {
    allMetricLabels[`custom_${m.id}`] = m.nome;
  });

  const chartData = [...progressos]
    .reverse()
    .map((p: any) => {
      const row: any = {
        data: format(new Date(p.data + "T12:00:00"), "dd/MM", { locale: ptBR }),
      };
      Object.keys(metricLabels).forEach((key) => {
        if (p[key] != null) row[key] = Number(p[key]);
      });
      metricaValores
        .filter((mv: any) => mv.progresso_id === p.id)
        .forEach((mv: any) => {
          row[`custom_${mv.metrica_id}`] = Number(mv.valor);
        });
      return row;
    })
    .filter((row: any) => row[chartMetric] != null);

  const toggleMedida = (key: string) => {
    setSelectedMedidas((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Evolução dos Alunos</h1>
          <p className="text-sm text-muted-foreground">Acompanhe o progresso de cada aluno</p>
        </div>
        {selectedAluno && (
          <Button onClick={() => setShowDialog(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Registrar Evolução
          </Button>
        )}
      </div>

      {/* Aluno selector */}
      <Card className="border-0 shadow-md">
        <CardContent className="p-4 space-y-3">
          {evalFilter && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1 text-xs">
                {evalFilter === "vencida" ? "🔴 Avaliação vencida" : "🟡 Avaliação a vencer"}
                <X className="h-3 w-3 cursor-pointer" onClick={() => { setEvalFilter(""); setFilteredAlunoIds([]); }} />
              </Badge>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-primary shrink-0" />
            <Select value={selectedAluno} onValueChange={setSelectedAluno}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Selecione um aluno" />
              </SelectTrigger>
              <SelectContent>
                {(filteredAlunoIds.length > 0
                  ? alunos.filter((a: any) => filteredAlunoIds.includes(a.user_id))
                  : alunos
                ).map((a: any) => (
                  <SelectItem key={a.user_id} value={a.user_id}>
                    {a.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!selectedAluno ? (
        <Card className="border-0 shadow-md">
          <CardContent className="flex flex-col items-center p-8 text-center">
            <TrendingUp className="h-10 w-10 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              Selecione um aluno para visualizar sua evolução
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="border-0 shadow-md">
              <CardContent className="p-4">
                <Scale className="h-5 w-5 text-primary mb-2" />
                <p className="text-2xl font-bold">{currentPeso ? `${currentPeso} kg` : "—"}</p>
                <p className="text-xs text-muted-foreground">Peso Atual</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-md">
              <CardContent className="p-4">
                <Calendar className="h-5 w-5 text-primary mb-2" />
                <p className="text-2xl font-bold">{progressos.length}</p>
                <p className="text-xs text-muted-foreground">Medições</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-md">
              <CardContent className="p-4">
                <TrendingUp className="h-5 w-5 text-primary mb-2" />
                <p className="text-2xl font-bold">{totalPontos} pts</p>
                <p className="text-xs text-muted-foreground">Pontuação Total</p>
              </CardContent>
            </Card>
          </div>

          {/* Chart */}
          <Card className="border-0 shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-5 w-5 text-primary" />
                Gráfico de Evolução
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {Object.entries(allMetricLabels).map(([key, label]) => (
                  <Button
                    key={key}
                    variant={chartMetric === key ? "default" : "outline"}
                    size="sm"
                    className="text-xs h-7 px-2.5"
                    onClick={() => setChartMetric(key)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {chartData.length >= 2 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="data" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
                    <Line type="monotone" dataKey={chartMetric} name={allMetricLabels[chartMetric]} stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4, fill: "hsl(var(--primary))" }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground text-center px-4">
                    {progressos.length === 0 ? "Nenhum registro" : "Registre pelo menos 2 medições para o gráfico"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* History Table */}
          <Card className="border-0 shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                Histórico de Medições
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {progressos.length === 0 ? (
                <div className="flex flex-col items-center p-6 text-center">
                  <TrendingUp className="h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">Nenhum registro</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Data</TableHead>
                        <TableHead className="text-xs">Peso</TableHead>
                        <TableHead className="text-xs">% Gordura</TableHead>
                        <TableHead className="text-xs">(kg) Músculo</TableHead>
                        <TableHead className="text-xs">Metas Atingidas</TableHead>
                         <TableHead className="text-xs text-right">Pontos</TableHead>
                        <TableHead className="text-xs text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {progressos.map((p: any, idx: number) => {
                        const prev = progressos[idx + 1];
                        const { metasAtingidas } = prev
                          ? calcularPontos(p, prev)
                          : { metasAtingidas: [] };
                        return (
                          <TableRow key={p.id}>
                            <TableCell className="text-xs font-medium">
                              {format(new Date(p.data + "T12:00:00"), "dd/MM/yy")}
                            </TableCell>
                            <TableCell className="text-xs">
                              {p.peso_kg ? `${p.peso_kg} kg` : "—"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {p.gordura_percentual ? `${p.gordura_percentual}%` : "—"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {p.musculo_percentual ? `${p.musculo_percentual}` : "—"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {metasAtingidas.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {metasAtingidas.map((m, i) => (
                                    <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">
                                      {m}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">
                                  {idx === progressos.length - 1 ? "1ª medição" : "—"}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-right font-semibold text-primary">
                              {p.pontos || 0}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(p)}>
                                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7">
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Excluir medição?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Esta ação não pode ser desfeita. A medição de {format(new Date(p.data + "T12:00:00"), "dd/MM/yyyy")} será removida permanentemente.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => deleteProgressoMutation.mutate(p.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                        Excluir
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Register Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) { setEditingId(null); resetForm(); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              {editingId ? "Editar Medição" : isPrimeiraMedicao ? "Primeira Medição e Metas Iniciais" : "Registrar Nova Medição"}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editingId) {
                updateProgressoMutation.mutate();
              } else {
                saveMutation.mutate();
              }
            }}
            className="space-y-5"
          >
            {/* Data + Próxima Avaliação */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium">Data</Label>
                <Input
                  type="date"
                  value={form.data_avaliacao}
                  onChange={(e) => setForm({ ...form, data_avaliacao: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs font-medium">Próxima Avaliação</Label>
                <Input
                  type="date"
                  value={form.data_proxima_avaliacao}
                  onChange={(e) => setForm({ ...form, data_proxima_avaliacao: e.target.value })}
                />
              </div>
            </div>

            {/* Peso */}
            <div>
              <Label className="text-xs font-medium">Peso Atual (kg)</Label>
              <Input type="number" step="0.1" placeholder="" value={form.peso_kg} onChange={(e) => setForm({ ...form, peso_kg: e.target.value })} />
              {!editingId && latest?.meta && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Meta anterior: {latest.meta === "manter" ? "Manter" : latest.meta === "aumentar" ? "Aumentar" : "Diminuir"}
                  {latest.meta_peso_kg ? ` → ${latest.meta_peso_kg} kg` : ""}
                </p>
              )}
            </div>

            {/* Meta Peso + % Gordura */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium">Nova Meta de Peso (kg)</Label>
                {!editingId && latest?.meta_peso_kg && (
                  <p className="text-[10px] text-muted-foreground">Anterior: {latest.meta_peso_kg} kg</p>
                )}
                <div className="flex gap-2">
                  <Select value={form.meta} onValueChange={(v) => setForm({ ...form, meta: v })}>
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manter">Manter</SelectItem>
                      <SelectItem value="aumentar">Aumentar</SelectItem>
                      <SelectItem value="diminuir">Diminuir</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="number" step="0.1" placeholder="Nova meta" value={form.meta_peso_kg} onChange={(e) => setForm({ ...form, meta_peso_kg: e.target.value })} className="flex-1" />
                </div>
              </div>
              <div>
                <Label className="text-xs font-medium">% Gordura Atual</Label>
                <Input type="number" step="0.1" placeholder="" value={form.gordura_percentual} onChange={(e) => setForm({ ...form, gordura_percentual: e.target.value })} />
                {!editingId && latest?.meta_gordura && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Meta anterior: {latest.meta_gordura === "manter" ? "Manter" : latest.meta_gordura === "aumentar" ? "Aumentar" : "Diminuir"}
                    {latest.meta_gordura_valor ? ` → ${latest.meta_gordura_valor}%` : ""}
                  </p>
                )}
              </div>
            </div>

            {/* Meta Gordura + Músculo */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium">Nova Meta % Gordura</Label>
                {!editingId && latest?.meta_gordura_valor && (
                  <p className="text-[10px] text-muted-foreground">Anterior: {latest.meta_gordura_valor}%</p>
                )}
                <div className="flex gap-2">
                  <Select value={form.meta_gordura} onValueChange={(v) => setForm({ ...form, meta_gordura: v })}>
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manter">Manter</SelectItem>
                      <SelectItem value="aumentar">Aumentar</SelectItem>
                      <SelectItem value="diminuir">Diminuir</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="number" step="0.1" placeholder="Nova meta" value={form.meta_gordura_valor} onChange={(e) => setForm({ ...form, meta_gordura_valor: e.target.value })} className="flex-1" />
                </div>
              </div>
              <div>
                <Label className="text-xs font-medium">(kg) Músculo Atual</Label>
                <Input type="number" step="0.1" placeholder="" value={form.musculo_percentual} onChange={(e) => setForm({ ...form, musculo_percentual: e.target.value })} />
                {!editingId && latest?.meta_musculo && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Meta anterior: {latest.meta_musculo === "manter" ? "Manter" : latest.meta_musculo === "aumentar" ? "Aumentar" : "Diminuir"}
                    {latest.meta_musculo_valor ? ` → ${latest.meta_musculo_valor} kg` : ""}
                  </p>
                )}
              </div>
            </div>

            {/* Meta Músculo */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium">Nova Meta (kg) Músculo</Label>
                {!editingId && latest?.meta_musculo_valor && (
                  <p className="text-[10px] text-muted-foreground">Anterior: {latest.meta_musculo_valor} kg</p>
                )}
                <div className="flex gap-2">
                  <Select value={form.meta_musculo} onValueChange={(v) => setForm({ ...form, meta_musculo: v })}>
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manter">Manter</SelectItem>
                      <SelectItem value="aumentar">Aumentar</SelectItem>
                      <SelectItem value="diminuir">Diminuir</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="number" step="0.1" placeholder="Nova meta" value={form.meta_musculo_valor} onChange={(e) => setForm({ ...form, meta_musculo_valor: e.target.value })} className="flex-1" />
                </div>
              </div>
            </div>

            <Separator />

            {/* Medidas Corporais com Checkboxes */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Medidas Corporais Adicionais (cm)</h4>
              <p className="text-xs text-muted-foreground">Selecione quais medidas deseja registrar:</p>
              <div className="grid grid-cols-2 gap-2">
                {MEDIDAS_OPTIONS.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      id={`medida-${key}`}
                      checked={selectedMedidas.includes(key)}
                      onCheckedChange={() => toggleMedida(key)}
                    />
                    <Label htmlFor={`medida-${key}`} className="text-xs cursor-pointer">{label}</Label>
                  </div>
                ))}
              </div>

              {/* Inputs for selected measurements */}
              {selectedMedidas.length > 0 && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  {selectedMedidas.map((key) => {
                    const opt = MEDIDAS_OPTIONS.find((o) => o.key === key);
                    return (
                      <div key={key}>
                        <Label className="text-xs">{opt?.label} (cm)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder=""
                          value={form.medidas[key] || ""}
                          onChange={(e) =>
                            setForm({ ...form, medidas: { ...form.medidas, [key]: e.target.value } })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Métricas Personalizadas inline */}
            <Separator />
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Métricas Personalizadas
              </h4>
              {metricasCustom.length > 0 && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {metricasCustom.map((m: any) => (
                      <Badge key={m.id} variant="secondary" className="gap-1.5 pr-1">
                        {m.nome}
                        <button type="button" onClick={() => deleteMetricaMutation.mutate(m.id)} className="ml-1 rounded-full p-0.5 hover:bg-destructive/20 transition-colors">
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  {/* Value inputs for each custom metric */}
                  <div className="grid grid-cols-2 gap-3">
                    {metricasCustom.map((m: any) => (
                      <div key={m.id}>
                        <Label className="text-xs">{m.nome} (0-10)</Label>
                        <Input
                          type="number"
                          min="0"
                          max="10"
                          step="1"
                          placeholder="0-10"
                          value={form.metricaValoresForm[m.id] || ""}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              metricaValoresForm: { ...form.metricaValoresForm, [m.id]: e.target.value },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Ex: Qualidade do sono..."
                  value={novaMetricaNome}
                  onChange={(e) => setNovaMetricaNome(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={createMetricaMutation.isPending || !novaMetricaNome.trim()}
                  onClick={() => {
                    if (!novaMetricaNome.trim()) return;
                    createMetricaMutation.mutate();
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Criar
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Avaliada de 0 a 10 em cada registro</p>
            </div>



            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1">
              <p className="text-xs font-semibold flex items-center gap-1.5 text-primary">
                <Lightbulb className="h-3.5 w-3.5" />
                Sistema de Pontuação:
              </p>
              <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
                <li>Atingir meta: +20 pontos por meta</li>
                <li>Superar meta (além do objetivo): +30 pontos por meta</li>
                <li>A primeira medição apenas define as metas iniciais para o próximo período e não gera pontos.</li>
              </ul>
            </div>

            <Button type="submit" className="w-full" disabled={saveMutation.isPending || updateProgressoMutation.isPending}>
              {(saveMutation.isPending || updateProgressoMutation.isPending)
                ? "Salvando..."
                : editingId
                ? "Salvar Alterações"
                : isPrimeiraMedicao
                ? "Registrar Primeira Medição"
                : "Registrar Medição"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
