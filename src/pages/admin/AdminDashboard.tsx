import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { cn } from "@/lib/utils";
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
  Dumbbell,
  UtensilsCrossed,
  FileText,
  Clock,
} from "lucide-react";
import type { Tables, Enums } from "@/integrations/supabase/types";

type Tarefa = Tables<"tarefas">;
type Anamnese = Tables<"anamnese_acolhimento">;
type Prioridade = Enums<"tarefa_prioridade">;
type Status = Enums<"tarefa_status">;
type Tipo = Enums<"tarefa_tipo">;

// Quais ações rápidas de prescrição fazem sentido para cada tipo de alerta.
const ACOES_RAPIDAS: Record<Tipo, ("treino" | "dieta")[]> = {
  ativacao: [],
  anamnese: ["treino", "dieta"],
  dor: ["treino"],
  barreira: ["treino"],
  ajuste: ["treino", "dieta"],
  outro: [],
};

const ANAMNESE_CAMPOS: { key: keyof Anamnese; label: string }[] = [
  { key: "objetivo_principal", label: "Objetivo principal" },
  { key: "expectativas", label: "Expectativas com a ARKE" },
  { key: "rotina_diaria", label: "Rotina diária" },
  { key: "tempo_disponivel", label: "Tempo disponível para treinar" },
  { key: "experiencias_exercicio", label: "Experiências anteriores com exercício" },
  { key: "dores_lesoes", label: "Dores ou lesões" },
  { key: "medicamentos", label: "Medicamentos" },
  { key: "estilo_treino", label: "Estilo de treino preferido" },
  { key: "alimentacao_rotina", label: "Rotina alimentar" },
  { key: "alimentos_gosta", label: "Alimentos que gosta" },
  { key: "alimentos_nao_gosta", label: "Alimentos que não gosta / não pode comer" },
];

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

// Indicadores visuais de SLA: vermelho para dor/vencido, amarelo para
// anamnese, verde para pedidos de ajuste. Demais tipos ficam neutros.
const TIPO_COLOR_CLASS: Record<Tipo, string> = {
  ativacao: "",
  anamnese: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40",
  dor: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/40",
  barreira: "",
  ajuste: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
  outro: "",
};

const FILTRO_STATUS_OPCOES: Status[] = ["aberta", "em_andamento", "aguardando"];

export default function AdminDashboard() {
  const { organization, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tarefaSelecionada, setTarefaSelecionada] = useState<Tarefa | null>(null);
  const [desfecho, setDesfecho] = useState("");
  const [filtroPrioridade, setFiltroPrioridade] = useState<Prioridade | "todas">("todas");
  const [filtroStatus, setFiltroStatus] = useState<Status | "todas">("todas");
  const [escopo, setEscopo] = useState<"minha" | "organizacao">("minha");
  const [anamneseAlunoId, setAnamneseAlunoId] = useState<string | null>(null);

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

  const { data: anamnese, isLoading: isLoadingAnamnese } = useQuery({
    queryKey: ["anamnese-aluno", anamneseAlunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anamnese_acolhimento")
        .select("*")
        .eq("aluno_id", anamneseAlunoId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!anamneseAlunoId,
  });

  const prescrever = (tipo: "treino" | "dieta", alunoId: string) => {
    navigate(tipo === "treino" ? "/admin/treinos" : "/admin/dietas", { state: { alunoId } });
  };

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
              const vencida = new Date(tarefa.sla_prazo).getTime() < Date.now();
              return (
                <Card key={tarefa.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <CardTitle className="text-sm font-semibold">{tarefa.motivo}</CardTitle>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="outline" className={cn("gap-1 font-normal", TIPO_COLOR_CLASS[tarefa.tipo])}>
                            <TipoIcon className="h-3 w-3" />
                            {TIPO_LABEL[tarefa.tipo]}
                          </Badge>
                          {vencida && (
                            <Badge variant="outline" className="gap-1 font-normal bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/40">
                              <Clock className="h-3 w-3" />
                              Vencido
                            </Badge>
                          )}
                        </div>
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
                      {tarefa.aluno_id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAnamneseAlunoId(tarefa.aluno_id)}
                        >
                          <FileText className="h-3.5 w-3.5 mr-1" />
                          Ver Anamnese
                        </Button>
                      )}
                      {tarefa.aluno_id &&
                        ACOES_RAPIDAS[tarefa.tipo].map((acao) => (
                          <Button
                            key={acao}
                            size="sm"
                            variant="outline"
                            onClick={() => prescrever(acao, tarefa.aluno_id!)}
                          >
                            {acao === "treino" ? (
                              <Dumbbell className="h-3.5 w-3.5 mr-1" />
                            ) : (
                              <UtensilsCrossed className="h-3.5 w-3.5 mr-1" />
                            )}
                            Prescrever {acao === "treino" ? "Treino" : "Dieta"}
                          </Button>
                        ))}
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
            <DialogTitle>Registrar parecer técnico e encerrar</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="desfecho">Parecer técnico / desfecho da ação (obrigatório)</Label>
            <Textarea
              id="desfecho"
              value={desfecho}
              onChange={(e) => setDesfecho(e.target.value)}
              placeholder='Ex.: "Anamnese analisada e treino de acolhimento B.A.S.E.® montado."'
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

      <Dialog open={!!anamneseAlunoId} onOpenChange={(open) => !open && setAnamneseAlunoId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Anamnese de Acolhimento (M.A.P.A.®)</DialogTitle>
          </DialogHeader>
          {isLoadingAnamnese && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {!isLoadingAnamnese && !anamnese && (
            <p className="text-sm text-muted-foreground">Este aluno ainda não concluiu a anamnese de acolhimento.</p>
          )}
          {anamnese && (
            <div className="space-y-3">
              {ANAMNESE_CAMPOS.map(({ key, label }) =>
                anamnese[key] ? (
                  <div key={key} className="space-y-0.5">
                    <p className="text-xs font-semibold text-muted-foreground">{label}</p>
                    <p className="text-sm whitespace-pre-wrap">{String(anamnese[key])}</p>
                  </div>
                ) : null
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
