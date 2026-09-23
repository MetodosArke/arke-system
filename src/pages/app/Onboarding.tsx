import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Compass, ShieldCheck } from "lucide-react";
import {
  CAIXA_CONSENTIMENTO_SAUDE,
  TEXTO_CONSENTIMENTO_SAUDE,
  VERSAO_CONSENTIMENTO_SAUDE,
} from "@/lib/consentimentoSaude";

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
  qualidade_sono: string;
  nivel_estresse: string;
  frequencia_semanal_desejada: string;
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
  qualidade_sono: "",
  nivel_estresse: "",
  frequencia_semanal_desejada: "",
};

type StepField = {
  key: keyof AnamneseForm;
  label: string;
  placeholder: string;
  type?: "text" | "number";
};

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
      { key: "frequencia_semanal_desejada", label: "Quantos dias por semana você quer treinar?", placeholder: "Ex.: 3", type: "number" },
      { key: "qualidade_sono", label: "Como está a qualidade do seu sono?", placeholder: "Ex.: durmo bem, tenho insônia, durmo pouco..." },
      { key: "nivel_estresse", label: "Como está seu nível de estresse hoje?", placeholder: "Ex.: baixo, moderado, alto" },
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
  {
    title: "Privacidade e Consentimento",
    description: "Antes de liberar seu plano, precisamos do seu consentimento para tratar os dados de saúde que você compartilhou.",
    fields: [],
  },
];

const draftKey = (alunoId: string) => `arke_onboarding_draft:${alunoId}`;

export default function Onboarding() {
  const { alunoId, organization, metodoArkeAtivo, rolesLoaded, anamneseCompleta, refreshAluno } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<AnamneseForm>(EMPTY_FORM);
  const [consentimentoAceito, setConsentimentoAceito] = useState(false);
  const [rascunhoRestaurado, setRascunhoRestaurado] = useState(false);

  // Restaura o rascunho salvo (se houver) assim que soubermos quem é o
  // aluno — evita perder respostas de um formulário de 5 etapas por causa
  // de uma queda de conexão ou fechamento acidental da aba.
  useEffect(() => {
    if (!alunoId || rascunhoRestaurado) return;
    try {
      const raw = localStorage.getItem(draftKey(alunoId));
      if (raw) {
        const draft = JSON.parse(raw) as { form: AnamneseForm; stepIndex: number };
        setForm((prev) => ({ ...prev, ...draft.form }));
        if (typeof draft.stepIndex === "number") {
          setStepIndex(Math.min(draft.stepIndex, STEPS.length - 1));
        }
      }
    } catch {
      // rascunho corrompido — ignora e segue com o formulário em branco.
    }
    setRascunhoRestaurado(true);
  }, [alunoId, rascunhoRestaurado]);

  // Salva o rascunho a cada mudança — nunca o consentimento LGPD, que
  // precisa ser reafirmado explicitamente em cada sessão de preenchimento.
  useEffect(() => {
    if (!alunoId || !rascunhoRestaurado) return;
    try {
      localStorage.setItem(draftKey(alunoId), JSON.stringify({ form, stepIndex }));
    } catch {
      // localStorage indisponível (modo privado, cota cheia etc.) — segue sem autosave.
    }
  }, [alunoId, rascunhoRestaurado, form, stepIndex]);

  const isLastStep = stepIndex === STEPS.length - 1;
  const step = STEPS[stepIndex];
  const isConsentStep = step.fields.length === 0;

  const concluirOnboarding = useMutation({
    mutationFn: async () => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      if (!consentimentoAceito) throw new Error("É necessário aceitar o termo de consentimento para continuar.");

      const { frequencia_semanal_desejada, ...formTexto } = form;

      const { error: anamneseError } = await supabase.from("anamnese_acolhimento").upsert(
        {
          organization_id: organization.id,
          aluno_id: alunoId,
          ...formTexto,
          frequencia_semanal_desejada: frequencia_semanal_desejada
            ? parseInt(frequencia_semanal_desejada, 10)
            : null,
          concluida_em: new Date().toISOString(),
          consentimento_lgpd_aceito_em: new Date().toISOString(),
          consentimento_lgpd_versao: VERSAO_CONSENTIMENTO_SAUDE,
        },
        { onConflict: "aluno_id" }
      );
      if (anamneseError) throw anamneseError;

      // Deliverable do M.A.P.A.®: agenda o Acolhimento (consulta inicial) com a equipe
      const { error: tarefaError } = await supabase.from("tarefas").insert({
        organization_id: organization.id,
        aluno_id: alunoId,
        motivo: "Agendar consulta de Acolhimento (M.A.P.A.®)",
        prioridade: "media",
        sla_prazo: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        origem_evento: `agendar_acolhimento:${alunoId}`,
        tipo: "anamnese",
      });
      if (tarefaError && !tarefaError.message.includes("duplicate")) throw tarefaError;

      // Nunca deixa o aluno cair num dashboard vazio: publica um treino
      // de adaptação genérico agora, até o professor montar a ficha
      // personalizada. Falha aqui não deve travar a conclusão do
      // onboarding — só loga, o aluno ainda pode navegar normalmente.
      const { error: treinoBoasVindasError } = await supabase.functions.invoke("publicar-treino-boas-vindas");
      if (treinoBoasVindasError) {
        console.error("Error publishing welcome treino", treinoBoasVindasError);
      }
    },
    onSuccess: async () => {
      toast({ title: "Tudo pronto!", description: "Sua equipe já foi avisada para agendar seu acolhimento." });
      if (alunoId) {
        try {
          localStorage.removeItem(draftKey(alunoId));
        } catch {
          // sem problema — o onboarding já foi concluído no banco.
        }
      }
      await refreshAluno();
      navigate("/app", { replace: true });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível enviar", description: error.message, variant: "destructive" });
    },
  });

  // Este onboarding é a experiência do produto Método ARKE — não o
  // cadastro básico de aluno matriculado na academia. Quem chegar aqui
  // por link direto sem ter aderido ao método (ou já tiver concluído) é
  // redirecionado de volta, sem disparar os efeitos colaterais da
  // conclusão (treino de boas-vindas, tarefa de acolhimento).
  // O redirecionamento vem depois de todos os hooks: antes ele ficava antes do
  // useMutation, e o número de hooks mudava entre renderizações ("Rendered
  // fewer hooks than expected") quando a adesão ou a anamnese mudavam com a
  // tela aberta.
  if (rolesLoaded && alunoId && (!metodoArkeAtivo || anamneseCompleta)) {
    return <Navigate to="/app" replace />;
  }

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
          {step.fields.map((field) =>
            field.type === "number" ? (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={field.key}>{field.label}</Label>
                <Input
                  id={field.key}
                  type="number"
                  min={0}
                  max={7}
                  value={form[field.key]}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                />
              </div>
            ) : (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={field.key}>{field.label}</Label>
                <Textarea
                  id={field.key}
                  value={form[field.key]}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                />
              </div>
            )
          )}

          {isConsentStep && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex items-center gap-2 text-primary">
                <ShieldCheck className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">LGPD — Dados de Saúde</span>
              </div>
              <p className="text-sm text-muted-foreground">{TEXTO_CONSENTIMENTO_SAUDE}</p>
              <div className="flex items-start gap-2 pt-1">
                <Checkbox
                  id="consentimento-lgpd"
                  checked={consentimentoAceito}
                  onCheckedChange={(checked) => setConsentimentoAceito(checked === true)}
                />
                <Label htmlFor="consentimento-lgpd" className="text-sm font-normal leading-snug">
                  {CAIXA_CONSENTIMENTO_SAUDE}
                </Label>
              </div>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button
              variant="ghost"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            >
              Voltar
            </Button>
            {isLastStep ? (
              <Button
                disabled={concluirOnboarding.isPending || !consentimentoAceito}
                onClick={() => concluirOnboarding.mutate()}
              >
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
