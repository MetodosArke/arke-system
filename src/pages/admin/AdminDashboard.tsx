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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  ClipboardList,
  ArrowUpCircle,
  UserCheck,
  HeartPulse,
  ClipboardEdit,
  RouteOff,
  MessageCircleWarning,
  LogIn,
  CircleHelp,
} from "lucide-react";
import type { Tables, Enums } from "@/integrations/supabase/types";

type Tarefa = Tables<"tarefas">;
type Prioridade = Enums<"tarefa_prioridade">;
type Status = Enums<"tarefa_status">;
type Tipo = Enums<"tarefa_tipo">;

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

// Ordem de prioridade para o ordenamento da fila: crítica primeiro.
const PRIORIDADE_PESO: Record<Prioridade, number> = {
  critica: 0,
  alta: 1,
  media: 2,
  baixa: 3,
};

const STATUS_LABEL: Record<Status, string> = {
  aberta: "Aberta",
  em_andamento: "Em andamento",
  aguardando: "Aguardando",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

const TIPO_LABEL: Record<Tipo, string> = {
  ativacao: "Ativação pendente",
  anamnese: "Nova anamnese (M.A.P.A.®)",
  dor: "Dor / desconforto",
  barreira: "Barreira de rotina",
  ajuste: "Pedido de ajuste",
  outro: "Outro",
};

const TIPO_ICON: Record<Tipo, typeof HeartPulse> = {
  ativacao: LogIn,
  anamnese: ClipboardEdit,
  dor: HeartPulse,
  barreira: RouteOff,
  ajuste: MessageCircleWarning,
  outro: CircleHelp,
};

const FILTRO_STATUS_OPCOES: Status[] = ["aberta", "em_andamento", "aguardando"];

export default function AdminDashboard() {
  const { organization, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tarefaSelecionada, setTarefaSelecionada] = useState<Tarefa | null>(null);
  const [desfecho, setDesfecho] = useState("");
  const [filtroPrioridade, setFiltroPrioridade] = useState<Prioridade | "todas">("todas");
  const [filtroStatus, setFiltroStatus] = useState<Status | "todas">("todas");
  const [escopo, setEscopo] = useState<"minha" | "organizacao">("minha");

  const { data: tarefas = [], isLoading } = useQuery({
    queryKey: ["tarefas-fila", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas")
        .select("*")
        .eq("organization_id", organization!.id)
        .in("status", FILTRO_STATUS_OPCOES);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const tarefasOrdenadas = useMemo(
    () =>
      [...tarefas].sort((a, b) => {
        const pesoDiff = PRIORIDADE_PESO[a.prioridade] - PRIORIDADE_PESO[b.prioridade];
        if (pesoDiff !== 0) return pesoDiff;
        return new Date(a.sla_prazo).getTime() - new Date(b.sla_prazo).getTime();
      }),
    [tarefas]
  );

  const minhaFila = useMemo(
    () => tarefasOrdenadas.filter((t) => t.responsavel_id === user?.id || t.responsavel_id === null),
    [tarefasOrdenadas, user?.id]
  );

  const tarefasEscopo = escopo === "minha" ? minhaFila : tarefasOrdenadas;

  const tarefasFiltradas = useMemo(() => {
    return tarefasEscopo.filter((t) => {
      if (filtroPrioridade !== "todas" && t.prioridade !== filtroPrioridade) return false;
      if (filtroStatus !== "todas" && t.status !== filtroStatus) return false;
      return true;
    });
  }, [tarefasEscopo, filtroPrioridade, filtroStatus]);

  const assumirTarefa = useMutation({
    mutationFn: async (tarefaId: string) => {
      if (!user) throw new Error("Usuário não autenticado");
      const { error } = await supabase.from("tarefas").update({ responsavel_id: user.id }).eq("id", tarefaId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Pendência assumida", description: "Ela agora está na sua fila." });
      void queryClient.invalidateQueries({ queryKey: ["tarefas-fila", organization?.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível assumir", description: error.message, variant: "destructive" });
    },
  });

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

      <Tabs value={escopo} onValueChange={(v) => setEscopo(v as "minha" | "organizacao")}>
        <TabsList>
          <TabsTrigger value="minha">Minha Fila</TabsTrigger>
          <TabsTrigger value="organizacao">Fila da Organização</TabsTrigger>
        </TabsList>

        <TabsContent value={escopo} className="space-y-4 mt-4">
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
            {tarefasFiltradas.map((tarefa) => {
              const TipoIcon = TIPO_ICON[tarefa.tipo];
              const semResponsavel = !tarefa.responsavel_id;
              const souResponsavel = tarefa.responsavel_id === user?.id;
              return (
                <Card key={tarefa.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <CardTitle className="text-sm font-semibold">{tarefa.motivo}</CardTitle>
                        <Badge variant="outline" className="gap-1 font-normal">
                          <TipoIcon className="h-3 w-3" />
                          {TIPO_LABEL[tarefa.tipo]}
                        </Badge>
                      </div>
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
                      {!semResponsavel && !souResponsavel && " · Responsável: outro membro da equipe"}
                      {souResponsavel && " · Responsável: você"}
                    </p>
                    {tarefa.acao && <p className="text-sm">{tarefa.acao}</p>}
                    <div className="flex flex-wrap gap-2">
                      {semResponsavel && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={assumirTarefa.isPending}
                          onClick={() => assumirTarefa.mutate(tarefa.id)}
                        >
                          <UserCheck className="h-3.5 w-3.5 mr-1" />
                          Assumir
                        </Button>
                      )}
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
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

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
