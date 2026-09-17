import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LifeBuoy, Dumbbell, CalendarClock, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CHECKIN_OPTIONS: { value: "funcionando_bem" | "preciso_ajuste" | "com_dificuldade" | "quero_falar_com_alguem"; label: string }[] = [
  { value: "funcionando_bem", label: "Funcionando bem" },
  { value: "preciso_ajuste", label: "Preciso de ajuste" },
  { value: "com_dificuldade", label: "Com dificuldade" },
  { value: "quero_falar_com_alguem", label: "Quero falar com alguém" },
];

export default function AlunoDashboard() {
  const { alunoId, organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [askOpen, setAskOpen] = useState(false);

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

  const registrarCheckin = useMutation({
    mutationFn: async (status: (typeof CHECKIN_OPTIONS)[number]["value"]) => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const { error } = await supabase.from("checkins").insert({
        organization_id: organization.id,
        aluno_id: alunoId,
        status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Registrado!", description: "Sua equipe foi avisada. Obrigado por compartilhar." });
      setAskOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["aluno-checkins-semana", alunoId] });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível registrar", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Dumbbell className="h-4 w-4 text-primary" /> Próxima Ação
          </CardTitle>
        </CardHeader>
        <CardContent>
          {treinoAtivo ? (
            <div>
              <p className="font-semibold">{treinoAtivo.titulo}</p>
              {treinoAtivo.validade_fim && (
                <p className="text-xs text-muted-foreground mt-1">
                  Válido até {new Date(treinoAtivo.validade_fim).toLocaleDateString("pt-BR")}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum treino publicado ainda. Sua equipe vai te avisar assim que estiver pronto.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-primary" /> Progresso Semanal
          </CardTitle>
        </CardHeader>
        <CardContent>
          {checkins.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {checkins.map((c) => (
                <Badge key={c.id} variant="secondary">
                  {CHECKIN_OPTIONS.find((o) => o.value === c.status)?.label ?? c.status}
                </Badge>
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

      {!askOpen ? (
        <Button className="w-full" size="lg" onClick={() => setAskOpen(true)}>
          <LifeBuoy className="mr-2 h-4 w-4" /> Como está sendo seguir seu plano?
        </Button>
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
                onClick={() => registrarCheckin.mutate(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
