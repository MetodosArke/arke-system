import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Clock, Lightbulb, HeartPulse, Pill, Dumbbell, UtensilsCrossed, Save, Loader2,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";

interface Props {
  alunoId: string;
  readOnly?: boolean;
}

const SECTIONS = [
  {
    key: "rotina",
    title: "Rotina Diária",
    icon: Clock,
    fields: [
      { key: "rotina_diaria", placeholder: "Descreva aqui a rotina diária da pessoa (horários de acordar, trabalho, sono, etc.)" },
    ],
  },
  {
    key: "experiencias",
    title: "Experiências com Exercício e Dieta",
    icon: Lightbulb,
    fields: [
      { key: "experiencias_exercicio", placeholder: "Experiências anteriores com exercícios e dieta" },
      { key: "experiencias_gostou", placeholder: "O que mais gostou de fazer" },
      { key: "experiencias_nao_gostou", placeholder: "O que menos gostou de fazer" },
    ],
  },
  {
    key: "saude",
    title: "Dores, Lesões e Doenças",
    icon: HeartPulse,
    fields: [
      { key: "dores_lesoes", placeholder: "Relate dores, lesões anteriores, cirurgias ou doenças diagnosticadas" },
    ],
  },
  {
    key: "medicamentos",
    title: "Medicamentos em Uso",
    icon: Pill,
    fields: [
      { key: "medicamentos", placeholder: "Liste todos os medicamentos, suplementos ou tratamentos em uso atual" },
    ],
  },
  {
    key: "treino",
    title: "Elaboração de Treino",
    icon: Dumbbell,
    fields: [
      { key: "tempo_disponivel", placeholder: "Tempo disponível para treinar (dias/horários por semana)" },
      { key: "estilo_treino", placeholder: "Estilo de treino preferido (força, hipertrofia, funcional, emagrecimento, etc.)" },
      { key: "exercicios_nao_gosta", placeholder: "Exercícios que a pessoa NÃO gosta de jeito algum (que desmotivam)" },
    ],
  },
  {
    key: "nutricao",
    title: "Nutrição",
    icon: UtensilsCrossed,
    fields: [
      { key: "alimentos_gosta", placeholder: "Alimentos que mais gosta de comer" },
      { key: "alimentos_nao_gosta", placeholder: "Alimentos que não gosta de comer" },
      { key: "alimentacao_rotina", placeholder: "Como deve ser a alimentação considerando a rotina (ex: lanches rápidos e fáceis de preparar no trabalho, refeições pré-prontas, etc.)" },
    ],
  },
];

type FormData = Record<string, string>;

export default function ReuniaoAcolhimentoForm({ alunoId, readOnly = false }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormData>({});

  const { data: existing, isLoading } = useQuery({
    queryKey: ["reuniao-acolhimento", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("reuniao_acolhimento" as any)
        .select("*")
        .eq("aluno_id", alunoId)
        .maybeSingle();
      return data as any;
    },
    enabled: !!alunoId,
  });

  useEffect(() => {
    if (existing) {
      const d: FormData = {};
      SECTIONS.forEach((s) =>
        s.fields.forEach((f) => {
          d[f.key] = (existing as any)[f.key] || "";
        })
      );
      setForm(d);
    } else {
      setForm({});
    }
  }, [existing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (existing?.id) {
        await supabase
          .from("reuniao_acolhimento" as any)
          .update({ ...form, updated_at: new Date().toISOString() } as any)
          .eq("id", existing.id);
      } else {
        await supabase
          .from("reuniao_acolhimento" as any)
          .insert({ aluno_id: alunoId, criado_por: user?.id, ...form } as any);
      }
    },
    onSuccess: () => {
      toast.success("Reunião de acolhimento salva!");
      queryClient.invalidateQueries({ queryKey: ["reuniao-acolhimento", alunoId] });
    },
    onError: () => toast.error("Erro ao salvar"),
  });

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const hasAnyData = SECTIONS.some((s) => s.fields.some((f) => form[f.key]?.trim()));

  if (readOnly && !hasAnyData) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center text-muted-foreground">
          <HeartPulse className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nenhuma reunião de acolhimento registrada</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="text-center mb-2">
        <h2 className="text-xl font-bold text-foreground" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
          Reunião de Acolhimento
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <Card key={section.key} className="border border-border/60 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  {section.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {section.fields.map((field) => (
                  readOnly ? (
                    <div key={field.key} className="rounded-lg bg-muted/50 px-3 py-2">
                      <p className="text-sm text-foreground whitespace-pre-wrap">
                        {form[field.key] || <span className="text-muted-foreground italic">Não preenchido</span>}
                      </p>
                    </div>
                  ) : (
                    <Textarea
                      key={field.key}
                      placeholder={field.placeholder}
                      value={form[field.key] || ""}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      rows={section.fields.length === 1 ? 4 : 2}
                      className="resize-none text-sm"
                    />
                  )
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!readOnly && (
        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="w-full sm:w-auto"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Salvar Acolhimento
          </Button>
        </div>
      )}
    </motion.div>
  );
}
