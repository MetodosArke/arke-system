import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Compass } from "lucide-react";

interface AnamneseForm {
  objetivo_principal: string;
  rotina_diaria: string;
  experiencias_exercicio: string;
  dores_lesoes: string;
  medicamentos: string;
  tempo_disponivel: string;
  estilo_treino: string;
  alimentos_gosta: string;
  alimentos_nao_gosta: string;
  alimentacao_rotina: string;
  expectativas: string;
}

const EMPTY_FORM: AnamneseForm = {
  objetivo_principal: "",
  rotina_diaria: "",
  experiencias_exercicio: "",
  dores_lesoes: "",
  medicamentos: "",
  tempo_disponivel: "",
  estilo_treino: "",
  alimentos_gosta: "",
  alimentos_nao_gosta: "",
  alimentacao_rotina: "",
  expectativas: "",
};

type StepField = { key: keyof AnamneseForm; label: string; placeholder: string };

const STEPS: { title: string; description: string; fields: StepField[] }[] = [
  {
    title: "Bem-vindo(a) à ARKE",
    description: "Antes de montarmos seu plano, queremos te conhecer melhor. Isso leva menos de 3 minutos.",
    fields: [
      { key: "objetivo_principal", label: "Qual é o seu principal objetivo agora?", placeholder: "Ex.: emagrecer, ganhar força, melhorar disposição..." },
      { key: "expectativas", label: "O que você espera alcançar com a ARKE?", placeholder: "Conte com suas palavras" },
    ],
  },
  {
    title: "Sua rotina",
    description: "Isso nos ajuda a montar algo que caiba na sua vida real.",
    fields: [
      { key: "rotina_diaria", label: "Como é a sua rotina no dia a dia?", placeholder: "Trabalho, estudo, horários..." },
      { key: "tempo_disponivel", label: "Quanto tempo você tem disponível para treinar?", placeholder: "Ex.: 3x por semana, 40 minutos" },
    ],
  },
  {
    title: "Experiência e saúde",
    description: "Sem julgamento — essas informações protegem você durante o treino.",
    fields: [
      { key: "experiencias_exercicio", label: "Já treinou antes? Como foi essa experiência?", placeholder: "O que gostou, o que não gostou" },
      { key: "dores_lesoes", label: "Tem alguma dor, lesão ou limitação física?", placeholder: "Se não tiver, pode deixar em branco" },
      { key: "medicamentos", label: "Usa algum medicamento relevante para o treino?", placeholder: "Opcional" },
      { key: "estilo_treino", label: "Prefere algum estilo de treino?", placeholder: "Ex.: musculação, funcional, em casa..." },
    ],
  },
  {
    title: "Alimentação",
    description: "Últimos detalhes antes de liberar seu plano.",
    fields: [
      { key: "alimentacao_rotina", label: "Como costuma ser sua alimentação hoje?", placeholder: "Refeições, horários, hábitos" },
      { key: "alimentos_gosta", label: "Alimentos que você gosta", placeholder: "Opcional" },
      { key: "alimentos_nao_gosta", label: "Alimentos que você não gosta ou não pode comer", placeholder: "Opcional" },
    ],
  },
];

export default function Onboarding() {
  const { alunoId, organization, refreshAluno } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<AnamneseForm>(EMPTY_FORM);

  const isLastStep = stepIndex === STEPS.length - 1;
  const step = STEPS[stepIndex];

  const concluirOnboarding = useMutation({
    mutationFn: async () => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");

      const { error: anamneseError } = await supabase.from("anamnese_acolhimento").upsert(
        {
          organization_id: organization.id,
          aluno_id: alunoId,
          ...form,
          concluida_em: new Date().toISOString(),
        },
        { onConflict: "aluno_id" }
      );
      if (anamneseError) throw anamneseError;

      // Deliverable do M.A.P.A.®: agenda o Acolhimento (consulta inicial) com a equipe
      const { error: tarefaError } = await supabase.from("tarefas").insert({
        organization_id: organization.id,
        aluno_id: alunoId,
        motivo: "Agendar consulta de Acolhimento (M.A.P.A.®)",
        prioridade: "alta",
        sla_prazo: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        origem_evento: `agendar_acolhimento:${alunoId}`,
      });
      if (tarefaError && !tarefaError.message.includes("duplicate")) throw tarefaError;
    },
    onSuccess: async () => {
      toast({ title: "Tudo pronto!", description: "Sua equipe já foi avisada para agendar seu acolhimento." });
      await refreshAluno();
      navigate("/app", { replace: true });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível enviar", description: error.message, variant: "destructive" });
    },
  });

  const updateField = (key: keyof AnamneseForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <Compass className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-wide">M.A.P.A.® — Descobrir</span>
          </div>
          <Progress value={((stepIndex + 1) / STEPS.length) * 100} className="mt-2" />
          <CardTitle className="mt-3">{step.title}</CardTitle>
          <p className="text-sm text-muted-foreground">{step.description}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {step.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key}>{field.label}</Label>
              <Textarea
                id={field.key}
                value={form[field.key]}
                onChange={(e) => updateField(field.key, e.target.value)}
                placeholder={field.placeholder}
              />
            </div>
          ))}

          <div className="flex justify-between pt-2">
            <Button
              variant="ghost"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            >
              Voltar
            </Button>
            {isLastStep ? (
              <Button disabled={concluirOnboarding.isPending} onClick={() => concluirOnboarding.mutate()}>
                Concluir
              </Button>
            ) : (
              <Button onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}>
                Próximo
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
