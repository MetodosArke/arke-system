import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, ArrowUpCircle } from "lucide-react";
import type { Tables, Enums } from "@/integrations/supabase/types";

type Tarefa = Tables<"tarefas">;
type Prioridade = Enums<"tarefa_prioridade">;
type Status = Enums<"tarefa_status">;

const PRIORIDADE_VARIANT: Record<Prioridade, "default" | "secondary" | "destructive"> = {
  baixa: "secondary",
  media: "default",
  alta: "default",
  critica: "destructive",
};

const PRIORIDADE_LABEL: Record<Prioridade, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  critica: "Crítica",
};

const STATUS_LABEL: Record<Status, string> = {
  aberta: "Aberta",
  em_andamento: "Em andamento",
  aguardando: "Aguardando",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

const FILTRO_STATUS_OPCOES: Status[] = ["aberta", "em_andamento", "aguardando"];

export default function AdminDashboard() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tarefaSelecionada, setTarefaSelecionada] = useState<Tarefa | null>(null);
  const [desfecho, setDesfecho] = useState("");
  const [filtroPrioridade, setFiltroPrioridade] = useState<Prioridade | "todas">("todas");
  const [filtroStatus, setFiltroStatus] = useState<Status | "todas">("todas");

  const { data: tarefas = [], isLoading } = useQuery({
    queryKey: ["tarefas-fila", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas")
        .select("*")
        .eq("organization_id", organization!.id)
        .in("status", FILTRO_STATUS_OPCOES)
        .order("sla_prazo", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const tarefasFiltradas = useMemo(() => {
    return tarefas.filter((t) => {
      if (filtroPrioridade !== "todas" && t.prioridade !== filtroPrioridade) return false;
      if (filtroStatus !== "todas" && t.status !== filtroStatus) return false;
      return true;
    });
  }, [tarefas, filtroPrioridade, filtroStatus]);

  const concluirTarefa = useMutation({
    mutationFn: async () => {
      if (!tarefaSelecionada) return;
      const { error } = await supabase
        .from("tarefas")
        .update({ status: "concluida", desfecho_acao: desfecho })
        .eq("id", tarefaSelecionada.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Tarefa encerrada", description: "Desfecho registrado com sucesso." });
      setTarefaSelecionada(null);
      setDesfecho("");
      void queryClient.invalidateQueries({ queryKey: ["tarefas-fila", organization?.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível encerrar", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Minha Fila</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={filtroPrioridade} onValueChange={(v) => setFiltroPrioridade(v as Prioridade | "todas")}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Prioridade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as prioridades</SelectItem>
            {(Object.keys(PRIORIDADE_LABEL) as Prioridade[]).map((p) => (
              <SelectItem key={p} value={p}>{PRIORIDADE_LABEL[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filtroStatus} onValueChange={(v) => setFiltroStatus(v as Status | "todas")}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todos os status</SelectItem>
            {FILTRO_STATUS_OPCOES.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!isLoading && tarefasFiltradas.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma pendência encontrada com esses filtros.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {tarefasFiltradas.map((tarefa) => (
          <Card key={tarefa.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm font-semibold">{tarefa.motivo}</CardTitle>
                <div className="flex items-center gap-1.5 shrink-0">
                  {tarefa.escalada_em && (
                    <Badge variant="outline" className="text-orange-600 dark:text-orange-400 border-orange-500/40">
                      <ArrowUpCircle className="h-3 w-3 mr-1" /> Escalada
                    </Badge>
                  )}
                  <Badge variant={PRIORIDADE_VARIANT[tarefa.prioridade]}>{PRIORIDADE_LABEL[tarefa.prioridade]}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Prazo: {new Date(tarefa.sla_prazo).toLocaleString("pt-BR")} · Status: {STATUS_LABEL[tarefa.status]}
              </p>
              {tarefa.acao && <p className="text-sm">{tarefa.acao}</p>}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTarefaSelecionada(tarefa);
                  setDesfecho("");
                }}
              >
                Registrar desfecho e encerrar
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!tarefaSelecionada} onOpenChange={(open) => !open && setTarefaSelecionada(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Encerrar pendência</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="desfecho">Desfecho da ação (obrigatório)</Label>
            <Textarea
              id="desfecho"
              value={desfecho}
              onChange={(e) => setDesfecho(e.target.value)}
              placeholder="O que foi feito e qual foi o resultado?"
            />
          </div>
          <DialogFooter>
            <Button
              disabled={!desfecho.trim() || concluirTarefa.isPending}
              onClick={() => concluirTarefa.mutate()}
            >
              Encerrar com desfecho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
