import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Tarefa = Tables<"tarefas">;

const PRIORIDADE_VARIANT: Record<Tarefa["prioridade"], "default" | "secondary" | "destructive"> = {
  baixa: "secondary",
  media: "default",
  alta: "default",
  critica: "destructive",
};

export default function AdminDashboard() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tarefaSelecionada, setTarefaSelecionada] = useState<Tarefa | null>(null);
  const [desfecho, setDesfecho] = useState("");

  const { data: tarefas = [], isLoading } = useQuery({
    queryKey: ["tarefas-fila", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas")
        .select("*")
        .eq("organization_id", organization!.id)
        .in("status", ["aberta", "em_andamento", "aguardando"])
        .order("sla_prazo", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
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

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!isLoading && tarefas.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma pendência em aberto. Tudo em dia!
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {tarefas.map((tarefa) => (
          <Card key={tarefa.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm font-semibold">{tarefa.motivo}</CardTitle>
                <Badge variant={PRIORIDADE_VARIANT[tarefa.prioridade]}>{tarefa.prioridade}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Prazo: {new Date(tarefa.sla_prazo).toLocaleString("pt-BR")}
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
