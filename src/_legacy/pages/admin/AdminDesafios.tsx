import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import { Trophy, Plus, Trash2, Users, Calendar, CheckCircle2, XCircle, Edit2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

const TIPOS_DESAFIO = [
  { value: "sem_doce", label: "Sem Doce", emoji: "🍬", auto: true },
  { value: "sem_alcool", label: "Sem Álcool", emoji: "🍺", auto: true },
  { value: "consumo_agua", label: "Consumo de Água", emoji: "💧", auto: true },
  { value: "numero_treinos", label: "Número de Treinos", emoji: "💪", auto: true },
  { value: "quilometros", label: "Quilômetros", emoji: "🏃", auto: true },
  { value: "modalidades", label: "Modalidades", emoji: "🎯", auto: true },
  { value: "desempenho_dieta", label: "Desempenho na Dieta", emoji: "🥗", auto: true },
  { value: "livre", label: "Desafio Livre", emoji: "⭐", auto: false },
];

function getTipoInfo(tipo: string) {
  return TIPOS_DESAFIO.find((t) => t.value === tipo) || TIPOS_DESAFIO[7];
}

export default function AdminDesafios() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    titulo: "",
    descricao: "",
    tipo: "livre",
    meta_valor: "",
    data_inicio: "",
    data_fim: "",
    pontos: "10",
    para_todos: true,
  });
  const [selectedAlunos, setSelectedAlunos] = useState<string[]>([]);
  const [filterTab, setFilterTab] = useState<"todos" | "manuais">("todos");

  // Queries
  const { data: desafios = [] } = useQuery({
    queryKey: ["admin-desafios"],
    queryFn: async () => {
      const { data } = await supabase
        .from("desafios" as any)
        .select("*")
        .order("created_at", { ascending: false });
      return (data || []) as any[];
    },
  });

  const { data: alunos = [] } = useQuery({
    queryKey: ["admin-alunos-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .order("full_name");
      return (data || []) as any[];
    },
  });

  const { data: progressoMap = {} } = useQuery({
    queryKey: ["admin-desafio-progresso"],
    queryFn: async () => {
      const { data } = await supabase
        .from("desafio_progresso" as any)
        .select("*");
      const map: Record<string, any[]> = {};
      (data || []).forEach((p: any) => {
        if (!map[p.desafio_id]) map[p.desafio_id] = [];
        map[p.desafio_id].push(p);
      });
      return map;
    },
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        titulo: form.titulo,
        descricao: form.descricao || null,
        tipo: form.tipo,
        meta_valor: form.meta_valor ? Number(form.meta_valor) : null,
        data_inicio: form.data_inicio,
        data_fim: form.data_fim,
        pontos: Number(form.pontos) || 10,
        para_todos: form.para_todos,
        criado_por: user?.id,
      };

      if (editingId) {
        const { error } = await supabase
          .from("desafios" as any)
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;

        if (!form.para_todos) {
          await supabase
            .from("desafio_participantes" as any)
            .delete()
            .eq("desafio_id", editingId);
          if (selectedAlunos.length > 0) {
            const rows = selectedAlunos.map((aluno_id) => ({
              desafio_id: editingId,
              aluno_id,
            }));
            await supabase.from("desafio_participantes" as any).insert(rows);
          }
        }
      } else {
        const { data: newDesafio, error } = await supabase
          .from("desafios" as any)
          .insert(payload)
          .select()
          .single();
        if (error) throw error;

        if (!form.para_todos && selectedAlunos.length > 0) {
          const rows = selectedAlunos.map((aluno_id) => ({
            desafio_id: (newDesafio as any).id,
            aluno_id,
          }));
          await supabase.from("desafio_participantes" as any).insert(rows);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-desafios"] });
      toast.success(editingId ? "Desafio atualizado!" : "Desafio criado!");
      resetForm();
    },
    onError: () => toast.error("Erro ao salvar desafio"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("desafios" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-desafios"] });
      toast.success("Desafio excluído!");
    },
  });

  const toggleProgressoMutation = useMutation({
    mutationFn: async ({ desafioId, alunoId, concluido }: { desafioId: string; alunoId: string; concluido: boolean }) => {
      const { error } = await supabase
        .from("desafio_progresso" as any)
        .upsert(
          {
            desafio_id: desafioId,
            aluno_id: alunoId,
            concluido,
            concluido_por: concluido ? user?.id : null,
            concluido_em: concluido ? new Date().toISOString() : null,
          },
          { onConflict: "desafio_id,aluno_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-desafio-progresso"] });
    },
  });

  const resetForm = () => {
    setForm({
      titulo: "",
      descricao: "",
      tipo: "livre",
      meta_valor: "",
      data_inicio: "",
      data_fim: "",
      pontos: "10",
      para_todos: true,
    });
    setSelectedAlunos([]);
    setEditingId(null);
    setShowDialog(false);
  };

  const handleEdit = async (desafio: any) => {
    setForm({
      titulo: desafio.titulo,
      descricao: desafio.descricao || "",
      tipo: desafio.tipo,
      meta_valor: desafio.meta_valor?.toString() || "",
      data_inicio: desafio.data_inicio,
      data_fim: desafio.data_fim,
      pontos: desafio.pontos?.toString() || "10",
      para_todos: desafio.para_todos,
    });
    setEditingId(desafio.id);

    if (!desafio.para_todos) {
      const { data } = await supabase
        .from("desafio_participantes" as any)
        .select("aluno_id")
        .eq("desafio_id", desafio.id);
      setSelectedAlunos((data || []).map((p: any) => p.aluno_id));
    }

    setShowDialog(true);
  };

  const getMetaConfig = (tipo: string) => {
    switch (tipo) {
      case "sem_doce":
      case "sem_alcool":
        return { label: "Meta (quantidade máxima de vezes)", placeholder: "0", suffix: "vezes", defaultValue: "0" };
      case "consumo_agua":
        return { label: "Meta (ML de água)", placeholder: "Ex: 2000", suffix: "ml", defaultValue: "" };
      case "numero_treinos":
        return { label: "Meta (quantidade de treinos)", placeholder: "Ex: 12", suffix: "treinos", defaultValue: "" };
      case "modalidades":
        return { label: "Meta (quantidade de modalidades)", placeholder: "Ex: 3", suffix: "modalidades", defaultValue: "" };
      case "quilometros":
        return { label: "Meta (quilômetros)", placeholder: "Ex: 30", suffix: "km", defaultValue: "" };
      case "desempenho_dieta":
        return { label: "Meta (% de adesão à dieta)", placeholder: "Ex: 80", suffix: "%", defaultValue: "" };
      default:
        return null;
    }
  };

  const handleTipoChange = (tipo: string) => {
    const info = getTipoInfo(tipo);
    const metaConfig = getMetaConfig(tipo);
    setForm((prev) => ({
      ...prev,
      tipo,
      titulo: tipo !== "livre" ? info.label : prev.titulo,
      meta_valor: metaConfig?.defaultValue ?? prev.meta_valor,
    }));
  };

  const toggleAlunoSelection = (alunoId: string) => {
    setSelectedAlunos((prev) =>
      prev.includes(alunoId)
        ? prev.filter((id) => id !== alunoId)
        : [...prev, alunoId]
    );
  };

  const filteredDesafios = filterTab === "manuais"
    ? desafios.filter((d: any) => d.tipo === "livre")
    : desafios;

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-4 p-4">
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Desafios</h1>
          <p className="text-sm text-muted-foreground">Gerencie os desafios dos alunos</p>
        </div>
        <Button onClick={() => { resetForm(); setShowDialog(true); }} className="gap-2">
          <Plus className="h-4 w-4" />
          Novo Desafio
        </Button>
      </motion.div>

      {/* Filter tabs */}
      <motion.div variants={item} className="flex gap-2">
        <Button
          variant={filterTab === "todos" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterTab("todos")}
        >
          Todos ({desafios.length})
        </Button>
        <Button
          variant={filterTab === "manuais" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterTab("manuais")}
        >
          Manuais ({desafios.filter((d: any) => d.tipo === "livre").length})
        </Button>
      </motion.div>

      {/* Desafios list */}
      <div className="space-y-3">
        {filteredDesafios.map((desafio: any) => {
          const tipoInfo = getTipoInfo(desafio.tipo);
          const progresso = progressoMap[desafio.id] || [];
          const concluidos = progresso.filter((p: any) => p.concluido).length;
          const isActive = new Date(desafio.data_fim) >= new Date();

          return (
            <motion.div key={desafio.id} variants={item}>
              <Card className="border-0 shadow-md">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{tipoInfo.emoji}</span>
                      <div>
                        <h3 className="font-semibold text-sm">{desafio.titulo}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant={isActive ? "default" : "secondary"} className="text-[10px]">
                            {isActive ? "Ativo" : "Encerrado"}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {tipoInfo.auto ? "Automático" : "Manual"}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {desafio.pontos} pts
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(desafio)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate(desafio.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {desafio.descricao && (
                    <p className="text-xs text-muted-foreground">{desafio.descricao}</p>
                  )}

                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {format(new Date(desafio.data_inicio), "dd/MM", { locale: ptBR })} - {format(new Date(desafio.data_fim), "dd/MM", { locale: ptBR })}
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {desafio.para_todos ? "Todos" : "Selecionados"}
                    </div>
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      {concluidos} concluídos
                    </div>
                  </div>

                  {/* For manual challenges, show student checklist */}
                  {desafio.tipo === "livre" && (
                    <div className="border-t pt-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Controle Manual:</p>
                      <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto">
                        {alunos.map((aluno: any) => {
                          const prog = progresso.find((p: any) => p.aluno_id === aluno.user_id);
                          const isDone = prog?.concluido || false;
                          return (
                            <button
                              key={aluno.user_id}
                              onClick={() => toggleProgressoMutation.mutate({
                                desafioId: desafio.id,
                                alunoId: aluno.user_id,
                                concluido: !isDone,
                              })}
                              className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${
                                isDone
                                  ? "bg-green-500/10 text-green-700 dark:text-green-400"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              <span>{aluno.full_name}</span>
                              {isDone ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-muted-foreground/50" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          );
        })}

        {filteredDesafios.length === 0 && (
          <Card className="border-0 shadow-md">
            <CardContent className="p-8 text-center">
              <Trophy className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nenhum desafio criado ainda</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Desafio" : "Novo Desafio"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Tipo do Desafio</Label>
              <Select value={form.tipo} onValueChange={handleTipoChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_DESAFIO.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.emoji} {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Título</Label>
              <Input
                value={form.titulo}
                onChange={(e) => setForm((p) => ({ ...p, titulo: e.target.value }))}
                placeholder="Nome do desafio"
              />
            </div>

            <div>
              <Label>Descrição (opcional)</Label>
              <Textarea
                value={form.descricao}
                onChange={(e) => setForm((p) => ({ ...p, descricao: e.target.value }))}
                placeholder="Descreva o desafio..."
                rows={2}
              />
            </div>

            {form.tipo !== "livre" && (() => {
              const metaConfig = getMetaConfig(form.tipo);
              if (!metaConfig) return null;
              return (
                <div>
                  <Label>{metaConfig.label}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={form.meta_valor}
                      onChange={(e) => setForm((p) => ({ ...p, meta_valor: e.target.value }))}
                      placeholder={metaConfig.placeholder}
                      className="flex-1"
                    />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">{metaConfig.suffix}</span>
                  </div>
                </div>
              );
            })()}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data Início</Label>
                <Input
                  type="date"
                  value={form.data_inicio}
                  onChange={(e) => setForm((p) => ({ ...p, data_inicio: e.target.value }))}
                />
              </div>
              <div>
                <Label>Data Fim</Label>
                <Input
                  type="date"
                  value={form.data_fim}
                  onChange={(e) => setForm((p) => ({ ...p, data_fim: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label>Pontos</Label>
              <Input
                type="number"
                value={form.pontos}
                onChange={(e) => setForm((p) => ({ ...p, pontos: e.target.value }))}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>Para todos os alunos</Label>
              <Switch
                checked={form.para_todos}
                onCheckedChange={(checked) => setForm((p) => ({ ...p, para_todos: checked }))}
              />
            </div>

            {!form.para_todos && (
              <div>
                <Label className="mb-2 block">Selecionar Participantes</Label>
                <div className="max-h-48 overflow-y-auto space-y-1 border rounded-lg p-2">
                  {alunos.map((aluno: any) => (
                    <button
                      key={aluno.user_id}
                      onClick={() => toggleAlunoSelection(aluno.user_id)}
                      className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm transition-colors ${
                        selectedAlunos.includes(aluno.user_id)
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      <div className={`h-4 w-4 rounded border flex items-center justify-center ${
                        selectedAlunos.includes(aluno.user_id) ? "bg-primary border-primary" : "border-border"
                      }`}>
                        {selectedAlunos.includes(aluno.user_id) && (
                          <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
                        )}
                      </div>
                      {aluno.full_name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>Cancelar</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!form.titulo || !form.data_inicio || !form.data_fim || createMutation.isPending}
            >
              {editingId ? "Salvar" : "Criar Desafio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
