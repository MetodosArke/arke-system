import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Handshake, HeartPulse, Loader2, TimerOff, UserMinus } from "lucide-react";
import type { Enums } from "@/integrations/supabase/types";

type Chamado = {
  tarefa_id: string;
  aluno_id: string;
  aluno_nome: string;
  organizacao_id: string;
  organizacao_nome: string;
  tipo: Enums<"tarefa_tipo">;
  motivo: string;
  prioridade: Enums<"tarefa_prioridade">;
  status: Enums<"tarefa_status">;
  sla_prazo: string | null;
  atrasada: boolean;
  fase: Enums<"fase_jornada"> | null;
  dias_inativo: number | null;
  constancia: number | null;
  nivel: string | null;
  nao_lidas: number;
};

const ICONE: Partial<Record<Enums<"tarefa_tipo">, typeof HeartPulse>> = {
  dor: HeartPulse,
  inercia: UserMinus,
  ciclo_travado: TimerOff,
  instrucao_presencial: Handshake,
};

const FASE_ROTULO: Record<string, string> = {
  mapa: "M.A.P.A.®",
  base: "B.A.S.E.®",
  rota: "R.O.T.A.®",
  apex: "A.P.E.X.®",
  legado: "L.E.G.A.D.O.®",
};

const prazoRelativo = (iso: string | null) => {
  if (!iso) return "sem prazo";
  const horas = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000);
  if (horas < 0) return `vencido há ${Math.abs(horas)}h`;
  if (horas < 24) return `vence em ${horas}h`;
  return `vence em ${Math.round(horas / 24)}d`;
};

/**
 * Os chamados que a célula de Mentor da ArkeFit precisa tratar.
 *
 * Duas coisas que esta tela existe para resolver, e que decidem se o BPO fecha:
 *
 * **O contexto vem na própria linha.** Fase, dias sem sinal e constância já
 * chegam de `get_fila_mentor()`. Sem isso o mentor abriria a ficha de cada
 * aluno para descobrir se o caso é resgate, ajuste ou acionamento da academia
 * — uma consulta por linha da fila, que é exatamente o que derruba quantos
 * alunos um mentor consegue servir. E esse número **é** a economia unitária do
 * modelo: a R$ 49 por aluno, um mentor precisa servir muita gente para se
 * pagar, e a diferença entre 50 e 250 está em quanto a tela decide por ele.
 *
 * **A ação sai daqui, não de outra tela.** Resolver com desfecho, mandar
 * instrução presencial para a academia e liberar a progressão são as três
 * saídas reais de um chamado; obrigar a navegar para cada uma seria o mesmo
 * problema por outro caminho.
 */
export function FilaChamadosMentor() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [instrucaoPara, setInstrucaoPara] = useState<Chamado | null>(null);
  const [instrucao, setInstrucao] = useState("");
  const [resolvendo, setResolvendo] = useState<Chamado | null>(null);
  const [desfecho, setDesfecho] = useState("");

  const { data: fila = [], isLoading } = useQuery({
    queryKey: ["fila-chamados-mentor"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_fila_mentor");
      if (error) throw error;
      return (data ?? []) as Chamado[];
    },
    refetchInterval: 60_000,
  });

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: ["fila-chamados-mentor"] });
  };

  const resolver = useMutation({
    mutationFn: async ({ chamado, texto }: { chamado: Chamado; texto: string }) => {
      // Desfecho obrigatório: é a regra do ciclo de atendimento do projeto —
      // uma pendência só se encerra quando há desfecho registrado.
      const { error } = await supabase
        .from("tarefas")
        .update({ status: "concluida", desfecho_acao: texto, acao: "Atendimento do Mentor ArkeFit" })
        .eq("id", chamado.tarefa_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Chamado encerrado", description: "O desfecho ficou registrado no histórico do aluno." });
      setResolvendo(null);
      setDesfecho("");
      invalidar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível encerrar", description: e.message, variant: "destructive" }),
  });

  const enviarInstrucao = useMutation({
    mutationFn: async ({ chamado, texto }: { chamado: Chamado; texto: string }) => {
      const { error } = await supabase.rpc("criar_instrucao_presencial", {
        _aluno_id: chamado.aluno_id,
        _instrucao: texto,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Instrução enviada",
        description: "A academia recebe na fila dela o que fazer no acolhimento presencial.",
      });
      setInstrucaoPara(null);
      setInstrucao("");
      invalidar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível enviar", description: e.message, variant: "destructive" }),
  });

  const liberar = useMutation({
    mutationFn: async (chamado: Chamado) => {
      const { error } = await supabase.rpc("liberar_progressao_aluno", {
        _aluno_id: chamado.aluno_id,
        _observacao: "Progressão liberada pelo Mentor ArkeFit após avaliação do relato.",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Progressão liberada", description: "A justificativa foi para o prontuário do aluno." });
      invalidar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível liberar", description: e.message, variant: "destructive" }),
  });

  const vencidos = fila.filter((c) => c.atrasada).length;

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* A carga da célula em números. É o instrumento que responde quantos
          alunos um mentor aguenta — a pergunta que decide a margem do BPO. */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-medium">{fila.length} chamado(s) na fila</span>
        {vencidos > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {vencidos} fora do SLA
          </span>
        )}
      </div>

      {fila.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhum chamado aberto. Os alunos que fogem do fluxo automático aparecem aqui.
        </p>
      ) : (
        fila.map((c) => {
          const Icone = ICONE[c.tipo] ?? AlertTriangle;
          return (
            <div
              key={c.tarefa_id}
              className={`rounded-md border p-3 ${c.atrasada ? "border-destructive/50 bg-destructive/5" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Icone className="h-4 w-4 text-muted-foreground" />
                    {c.aluno_nome}
                    <span className="text-xs font-normal text-muted-foreground">· {c.organizacao_nome}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{c.motivo}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={c.prioridade === "critica" ? "destructive" : "secondary"} className="text-[10px]">
                    {c.prioridade}
                  </Badge>
                  <span className={`text-[11px] ${c.atrasada ? "text-destructive" : "text-muted-foreground"}`}>
                    {prazoRelativo(c.sla_prazo)}
                  </span>
                </div>
              </div>

              {/* O contexto da decisão, já resolvido pelo banco. */}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {c.fase && <span>Fase {FASE_ROTULO[c.fase] ?? c.fase}</span>}
                {c.nivel && <span>· {c.nivel}</span>}
                {c.dias_inativo !== null && (
                  <span className={c.dias_inativo >= 5 ? "text-orange-600 dark:text-orange-400" : ""}>
                    · {c.dias_inativo === 0 ? "ativo hoje" : `${c.dias_inativo}d sem sinal`}
                  </span>
                )}
                {c.constancia !== null && <span>· constância {c.constancia}%</span>}
                {Number(c.nao_lidas) > 0 && (
                  <span className="text-primary">· {c.nao_lidas} mensagem(ns) esperando resposta</span>
                )}
              </div>

              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setResolvendo(c)}>
                  Encerrar com desfecho
                </Button>
                <Button size="sm" variant="outline" onClick={() => setInstrucaoPara(c)}>
                  <Handshake className="mr-1.5 h-3.5 w-3.5" />
                  Instrução presencial
                </Button>
                {c.tipo === "dor" && (
                  <Button size="sm" variant="outline" disabled={liberar.isPending} onClick={() => liberar.mutate(c)}>
                    Liberar progressão
                  </Button>
                )}
              </div>
            </div>
          );
        })
      )}

      <Dialog open={!!resolvendo} onOpenChange={(a) => !a && setResolvendo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Encerrar o chamado</DialogTitle>
            <DialogDescription>
              O desfecho é obrigatório e fica no histórico do aluno: é o que permite, depois, entender o que foi feito
              sem depender da memória de quem atendeu.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="desfecho-chamado">O que foi feito e como terminou</Label>
            <Input
              id="desfecho-chamado"
              value={desfecho}
              onChange={(e) => setDesfecho(e.target.value)}
              placeholder="Ex.: falei com o aluno, viagem de trabalho, volta na semana que vem"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResolvendo(null)}>
              Voltar
            </Button>
            <Button
              disabled={!desfecho.trim() || resolver.isPending}
              onClick={() => resolvendo && resolver.mutate({ chamado: resolvendo, texto: desfecho.trim() })}
            >
              Encerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!instrucaoPara} onOpenChange={(a) => !a && setInstrucaoPara(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Instrução presencial para a academia</DialogTitle>
            <DialogDescription>
              O que só acontece no salão. A academia recebe isto como pendência dela — pronta para executar, sem ter de
              investigar nada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="texto-instrucao">Instrução</Label>
            <Input
              id="texto-instrucao"
              value={instrucao}
              onChange={(e) => setInstrucao(e.target.value)}
              placeholder="Ex.: acolher na chegada hoje; já ajustamos a ficha por relato de dor no joelho"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInstrucaoPara(null)}>
              Voltar
            </Button>
            <Button
              disabled={!instrucao.trim() || enviarInstrucao.isPending}
              onClick={() => instrucaoPara && enviarInstrucao.mutate({ chamado: instrucaoPara, texto: instrucao.trim() })}
            >
              Enviar para a academia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
