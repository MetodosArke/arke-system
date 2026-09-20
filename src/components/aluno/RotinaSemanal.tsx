import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarClock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const MODALIDADE_OPTIONS = [
  "Descanso",
  "Treino A",
  "Treino B",
  "Treino C",
  "Treino D",
  "Yoga",
  "Pilates",
  "Funcional",
  "CrossFit",
  "Musculação",
  "Caminhada",
  "Corrida",
  "Natação",
  "Ciclismo",
  "Alongamento",
  "HIIT",
];

interface RotinaEntry {
  dia_semana: number;
  modalidade: string | null;
}

// Programador de Rotina Semanal: o que o aluno planeja treinar em cada
// dia da semana (um modelo recorrente, tipo "toda segunda é Treino A") —
// diferente do calendário mensal, que é o registro real, dia a dia, do
// que de fato aconteceu.
export default function RotinaSemanal() {
  const { alunoId, organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendente, setPendente] = useState<number | null>(null);

  const { data: rotina = [] } = useQuery({
    queryKey: ["aluno-rotina-semanal", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aluno_rotina_semanal")
        .select("dia_semana, modalidade")
        .eq("aluno_id", alunoId!);
      if (error) throw error;
      return data as RotinaEntry[];
    },
    enabled: !!alunoId,
  });

  const salvarDia = useMutation({
    mutationFn: async ({ diaSemana, modalidade }: { diaSemana: number; modalidade: string }) => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const { error } = await supabase.from("aluno_rotina_semanal").upsert(
        {
          organization_id: organization.id,
          aluno_id: alunoId,
          dia_semana: diaSemana,
          modalidade: modalidade === "Descanso" ? null : modalidade,
        },
        { onConflict: "aluno_id,dia_semana" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["aluno-rotina-semanal", alunoId] });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
      setPendente(null);
    },
    onSettled: () => setPendente(null),
  });

  const modalidadePorDia = (dia: number) => rotina.find((r) => r.dia_semana === dia)?.modalidade ?? "Descanso";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-primary" /> Minha Rotina da Semana
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Planeje o que treinar em cada dia — é só um guia, o registro real fica no calendário.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {DIAS_SEMANA.map((label, dia) => (
          <div key={dia} className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium w-20 shrink-0">{label}</span>
            <div className="flex-1 max-w-[200px]">
              <Select
                value={modalidadePorDia(dia)}
                onValueChange={(v) => {
                  setPendente(dia);
                  salvarDia.mutate({ diaSemana: dia, modalidade: v });
                }}
                disabled={pendente === dia}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODALIDADE_OPTIONS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
