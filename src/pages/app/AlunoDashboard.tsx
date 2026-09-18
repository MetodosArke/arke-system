import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  LifeBuoy,
  Dumbbell,
  UtensilsCrossed,
  TrendingUp,
  AlertTriangle,
  Droplet,
  CalendarClock,
  Minus,
  Plus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { RegistrarAlertaCard } from "@/components/aluno/RegistrarAlertaCard";
import type { Enums } from "@/integrations/supabase/types";

type CheckinStatus = Enums<"checkin_status">;
type MotivoDificuldade = Enums<"motivo_dificuldade">;

const CHECKIN_OPTIONS: { value: CheckinStatus; label: string }[] = [
  { value: "funcionando_bem", label: "Funcionando bem" },
  { value: "preciso_ajuste", label: "Preciso de ajuste" },
  { value: "com_dificuldade", label: "Com dificuldade" },
  { value: "quero_falar_com_alguem", label: "Quero falar com alguém" },
];

const CHECKIN_LABEL: Record<CheckinStatus, string> = {
  funcionando_bem: "Funcionando bem",
  preciso_ajuste: "Preciso de ajuste",
  com_dificuldade: "Com dificuldade",
  quero_falar_com_alguem: "Quero falar com alguém",
};

const MOTIVO_OPTIONS: { value: MotivoDificuldade; label: string }[] = [
  { value: "tempo", label: "Tempo" },
  { value: "execucao", label: "Execução" },
  { value: "alimentacao", label: "Alimentação" },
  { value: "desconforto_dor", label: "Desconforto/Dor" },
  { value: "motivacao", label: "Motivação" },
];

const FASE_LABEL: Record<string, string> = {
  mapa: "M.A.P.A.® — Descobrir",
  base: "B.A.S.E.® — Estruturar",
  rota: "R.O.T.A.® — Sustentar",
  apex: "A.P.E.X.® — Expandir",
  legado: "L.E.G.A.D.O.® — Perpetuar",
};

const META_AGUA_ML = 2000;
const HOJE = new Date().toISOString().slice(0, 10);

export default function AlunoDashboard() {
  const { alunoId, organization, faseJornada } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [askOpen, setAskOpen] = useState(false);
  const [motivoPendente, setMotivoPendente] = useState<CheckinStatus | null>(null);

  const { data: treinoAtivo } = useQuery({
    queryKey: ["aluno-treino-ativo", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("treinos")
        .select("id, titulo, validade_fim")
        .eq("aluno_id", alunoId!)
        .eq("status", "ativo")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const { data: dietaAtiva } = useQuery({
    queryKey: ["aluno-dieta-ativa", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("dietas")
        .select("id, titulo")
        .eq("aluno_id", alunoId!)
        .eq("status", "ativo")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const { data: checkins = [] } = useQuery({
    queryKey: ["aluno-checkins-semana", alunoId],
    queryFn: async () => {
      const seteDiasAtras = new Date();
      seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
      const { data } = await supabase
        .from("checkins")
        .select("id, status, created_at")
        .eq("aluno_id", alunoId!)
        .gte("created_at", seteDiasAtras.toISOString())
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!alunoId,
  });

  const { data: habitoHoje } = useQuery({
    queryKey: ["aluno-habito-hoje", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_habito")
        .select("*")
        .eq("aluno_id", alunoId!)
        .eq("data", HOJE)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const registrarCheckin = useMutation({
    mutationFn: async (params: { status: CheckinStatus; motivo?: MotivoDificuldade }) => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const { error } = await supabase.from("checkins").insert({
        organization_id: organization.id,
        aluno_id: alunoId,
        status: params.status,
        motivo_dificuldade: params.motivo ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Registrado!", description: "Sua equipe foi avisada. Obrigado por compartilhar." });
      setAskOpen(false);
      setMotivoPendente(null);
      void queryClient.invalidateQueries({ queryKey: ["aluno-checkins-semana", alunoId] });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível registrar", description: error.message, variant: "destructive" });
    },
  });

  const ajustarAgua = useMutation({
    mutationFn: async (deltaMl: number) => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const novoTotal = Math.max(0, (habitoHoje?.agua_ml ?? 0) + deltaMl);
      const { error } = await supabase.from("registro_habito").upsert(
        {
          organization_id: organization.id,
          aluno_id: alunoId,
          data: HOJE,
          agua_ml: novoTotal,
        },
        { onConflict: "aluno_id,data" }
      );
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["aluno-habito-hoje", alunoId] }),
    onError: (error: Error) => {
      toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" });
    },
  });

  const escolherStatus = (status: CheckinStatus) => {
    if (status === "com_dificuldade") {
      setMotivoPendente(status);
      return;
    }
    registrarCheckin.mutate({ status });
  };

  const aguaMl = habitoHoje?.agua_ml ?? 0;
  const aguaPct = Math.min(100, Math.round((aguaMl / META_AGUA_ML) * 100));

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {faseJornada && (
        <Badge variant="outline" className="text-xs">
          {FASE_LABEL[faseJornada] ?? faseJornada}
        </Badge>
      )}

      {/* Resumo da jornada: atalhos mobile-first */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <button
          onClick={() => navigate("/app/treinos")}
          className="text-left rounded-xl border border-border bg-card p-3 sm:p-4 hover:bg-accent/50 transition-colors"
        >
          <Dumbbell className="h-5 w-5 text-primary mb-1.5" />
          <p className="text-sm font-semibold">Treino de Hoje</p>
          <p className="text-xs text-muted-foreground truncate">{treinoAtivo?.titulo ?? "Nenhum treino ativo"}</p>
        </button>

        <button
          onClick={() => navigate("/app/dieta")}
          className="text-left rounded-xl border border-border bg-card p-3 sm:p-4 hover:bg-accent/50 transition-colors"
        >
          <UtensilsCrossed className="h-5 w-5 text-primary mb-1.5" />
          <p className="text-sm font-semibold">Minha Dieta</p>
          <p className="text-xs text-muted-foreground truncate">{dietaAtiva?.titulo ?? "Nenhuma dieta ativa"}</p>
        </button>

        <button
          onClick={() => document.getElementById("meu-progresso")?.scrollIntoView({ behavior: "smooth" })}
          className="text-left rounded-xl border border-border bg-card p-3 sm:p-4 hover:bg-accent/50 transition-colors"
        >
          <TrendingUp className="h-5 w-5 text-primary mb-1.5" />
          <p className="text-sm font-semibold">Meu Progresso</p>
          <p className="text-xs text-muted-foreground">{checkins.length} check-in(s) essa semana</p>
        </button>

        <button
          onClick={() => document.getElementById("registrar-alerta")?.scrollIntoView({ behavior: "smooth" })}
          className="text-left rounded-xl border border-border bg-card p-3 sm:p-4 hover:bg-accent/50 transition-colors"
        >
          <AlertTriangle className="h-5 w-5 text-primary mb-1.5" />
          <p className="text-sm font-semibold">Registrar Alerta</p>
          <p className="text-xs text-muted-foreground">Dor ou problema de rotina</p>
        </button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Droplet className="h-4 w-4 text-primary" /> Diário de Hábitos — Água
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{aguaMl} ml / {META_AGUA_ML} ml</p>
            <div className="flex items-center gap-1.5">
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                disabled={ajustarAgua.isPending || aguaMl <= 0}
                onClick={() => ajustarAgua.mutate(-250)}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                disabled={ajustarAgua.isPending}
                onClick={() => ajustarAgua.mutate(250)}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <Progress value={aguaPct} />
        </CardContent>
      </Card>

      <div id="meu-progresso" className="space-y-4 scroll-mt-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" /> Progresso Semanal
            </CardTitle>
          </CardHeader>
          <CardContent>
            {checkins.length > 0 ? (
              <div className="space-y-2">
                {checkins.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0 last:pb-0">
                    <Badge variant="secondary">{CHECKIN_LABEL[c.status]}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Você ainda não registrou como está indo esta semana.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-primary" /> Próximo Evento de Acompanhamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Em breve — sua equipe vai agendar os próximos passos.</p>
          </CardContent>
        </Card>
      </div>

      {!askOpen ? (
        <Button className="w-full" size="lg" onClick={() => setAskOpen(true)}>
          <LifeBuoy className="mr-2 h-4 w-4" /> Como está sendo seguir seu plano?
        </Button>
      ) : motivoPendente ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">O que está sendo mais difícil?</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MOTIVO_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant="outline"
                disabled={registrarCheckin.isPending}
                onClick={() => registrarCheckin.mutate({ status: motivoPendente, motivo: option.value })}
              >
                {option.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Como está sendo seguir seu plano?</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CHECKIN_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant="outline"
                disabled={registrarCheckin.isPending}
                onClick={() => escolherStatus(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      <div id="registrar-alerta" className="scroll-mt-4">
        <RegistrarAlertaCard />
      </div>
    </div>
  );
}
