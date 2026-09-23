import { dataBrasilia, hojeBrasilia } from "@/lib/dataBrasilia";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Users, X } from "lucide-react";
import type { Enums } from "@/integrations/supabase/types";

type AgendamentoStatus = Enums<"agendamento_status">;

interface Turma {
  id: string;
  nome: string;
  capacidade_maxima: number;
  horario_inicio: string;
  horario_fim: string;
  dias_semana: number[];
}

// A data da academia, nao a do aparelho: aluno viajando veria uma semana
// diferente da que a academia ve, e o banco decide com Sao Paulo.
const hojeISO = hojeBrasilia;

function somarDias(dataISO: string, delta: number) {
  // Meio-dia deixa o passo de 24h imune a virada de horario de verao.
  const d = new Date(`${dataISO}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return dataBrasilia(d);
}

function weekdayISO(dataISO: string) {
  const d = new Date(`${dataISO}T12:00:00`);
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function formatarDataLabel(dataISO: string) {
  const d = new Date(`${dataISO}T12:00:00`);
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

export default function AlunoAgenda() {
  const { organization, alunoId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dataSelecionada, setDataSelecionada] = useState(hojeISO());

  const weekday = useMemo(() => weekdayISO(dataSelecionada), [dataSelecionada]);

  const { data: turmas = [] } = useQuery({
    queryKey: ["aluno-agenda-turmas", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("turmas")
        .select("id, nome, capacidade_maxima, horario_inicio, horario_fim, dias_semana")
        .eq("organization_id", organization!.id)
        .eq("ativa", true)
        .order("horario_inicio");
      if (error) throw error;
      return data as Turma[];
    },
    enabled: !!organization?.id,
  });

  const turmasDoDia = turmas.filter((t) => t.dias_semana.includes(weekday));

  const { data: agendamentosDoDia = [] } = useQuery({
    queryKey: ["aluno-agenda-agendamentos-dia", organization?.id, dataSelecionada],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agendamentos")
        .select("id, turma_id, aluno_id, status")
        .eq("organization_id", organization!.id)
        .eq("data", dataSelecionada)
        .in("status", ["agendado", "presente"]);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: meusAgendamentos = [] } = useQuery({
    queryKey: ["aluno-agenda-meus-agendamentos", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agendamentos")
        .select("id, turma_id, data, status, turmas(nome, horario_inicio, horario_fim)")
        .eq("aluno_id", alunoId!)
        .in("status", ["agendado", "lista_espera"])
        .gte("data", hojeISO())
        .order("data");
      if (error) throw error;
      return data;
    },
    enabled: !!alunoId,
  });

  const ocupacaoPorTurma = new Map<string, number>();
  for (const a of agendamentosDoDia) {
    ocupacaoPorTurma.set(a.turma_id, (ocupacaoPorTurma.get(a.turma_id) ?? 0) + 1);
  }
  const jaAgendadoHoje = new Set(agendamentosDoDia.filter((a) => a.aluno_id === alunoId).map((a) => a.turma_id));

  const agendar = useMutation({
    mutationFn: async (turma: Turma) => {
      if (!organization || !alunoId) return;
      const lotada = (ocupacaoPorTurma.get(turma.id) ?? 0) >= turma.capacidade_maxima;
      const { error } = await supabase.from("agendamentos").insert({
        organization_id: organization.id,
        turma_id: turma.id,
        aluno_id: alunoId,
        data: dataSelecionada,
        status: lotada ? "lista_espera" : "agendado",
      });
      if (error) throw error;
      return lotada;
    },
    onSuccess: (lotada) => {
      toast({
        title: lotada ? "Você entrou na lista de espera" : "Vaga reservada",
        description: lotada ? "Avisamos se abrir vaga." : "Te esperamos na turma!",
      });
      void queryClient.invalidateQueries({ queryKey: ["aluno-agenda-agendamentos-dia"] });
      void queryClient.invalidateQueries({ queryKey: ["aluno-agenda-meus-agendamentos"] });
    },
    onError: (error: Error) => {
      const jaAgendada = error.message.includes("duplicate") || error.message.includes("unique");
      toast({
        title: "Não foi possível agendar",
        description: jaAgendada ? "Você já tem vaga nessa turma nesse dia." : error.message,
        variant: "destructive",
      });
    },
  });

  const cancelar = useMutation({
    mutationFn: async (agendamentoId: string) => {
      const { error } = await supabase.from("agendamentos").update({ status: "cancelado" }).eq("id", agendamentoId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Agendamento cancelado" });
      void queryClient.invalidateQueries({ queryKey: ["aluno-agenda-agendamentos-dia"] });
      void queryClient.invalidateQueries({ queryKey: ["aluno-agenda-meus-agendamentos"] });
    },
    onError: (error: Error) => toast({ title: "Erro ao cancelar", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Agenda</h1>
      </div>

      <Card>
        <CardContent className="py-3 flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={() => setDataSelecionada((d) => somarDias(d, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium capitalize">{formatarDataLabel(dataSelecionada)}</span>
          <Button variant="ghost" size="icon" onClick={() => setDataSelecionada((d) => somarDias(d, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {turmasDoDia.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma turma nesse dia.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {turmasDoDia.map((turma) => {
            const ocupacao = ocupacaoPorTurma.get(turma.id) ?? 0;
            const lotada = ocupacao >= turma.capacidade_maxima;
            const jaAgendado = jaAgendadoHoje.has(turma.id);
            return (
              <Card key={turma.id}>
                <CardContent className="py-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{turma.nome}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {turma.horario_inicio.slice(0, 5)}–{turma.horario_fim.slice(0, 5)}
                      <Users className="h-3 w-3 ml-1.5" /> {ocupacao}/{turma.capacidade_maxima}
                    </p>
                  </div>
                  {jaAgendado ? (
                    <Badge>Reservado</Badge>
                  ) : (
                    <Button size="sm" variant={lotada ? "outline" : "default"} onClick={() => agendar.mutate(turma)} disabled={agendar.isPending}>
                      {lotada ? "Lista de espera" : "Reservar"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Meus próximos agendamentos</CardTitle>
        </CardHeader>
        <CardContent>
          {meusAgendamentos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum agendamento futuro.</p>
          ) : (
            <ul className="space-y-2">
              {meusAgendamentos.map((a) => {
                const turma = Array.isArray(a.turmas) ? a.turmas[0] : a.turmas;
                return (
                  <li key={a.id} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0 last:pb-0">
                    <div>
                      <span className="font-medium">{turma?.nome}</span>
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        — {new Date(`${a.data}T12:00:00`).toLocaleDateString("pt-BR")} · {turma?.horario_inicio?.slice(0, 5)}
                        {a.status === "lista_espera" && " · lista de espera"}
                      </span>
                    </div>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => cancelar.mutate(a.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
