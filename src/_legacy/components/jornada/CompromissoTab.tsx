import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { motion } from "framer-motion";
import { Heart, Target, Plus, X, CheckCircle2, Sparkles, ChevronLeft } from "lucide-react";
import { toast } from "sonner";

function getWeekKey() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
  const weekNum = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${weekNum}`;
}

interface Meta {
  id?: string;
  texto: string;
  objetivo_vinculado: string;
  valor_vinculado: string;
  concluida: boolean;
}

export default function CompromissoTab() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [isCreating, setIsCreating] = useState(false);
  const [metas, setMetas] = useState<Meta[]>([
    { texto: "", objetivo_vinculado: "", valor_vinculado: "", concluida: false },
  ]);

  const { data: objetivos } = useQuery({
    queryKey: ["aluno-objetivos", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("aluno_objetivos")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const { data: valores } = useQuery({
    queryKey: ["aluno-valores", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("aluno_valores")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const { data: compromisso } = useQuery({
    queryKey: ["compromisso-semanal", user?.id, getWeekKey()],
    queryFn: async () => {
      const { data } = await supabase
        .from("compromisso_semanal")
        .select("*")
        .eq("user_id", user!.id)
        .eq("semana", getWeekKey())
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const { data: compromissoMetas = [] } = useQuery({
    queryKey: ["compromisso-metas", compromisso?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("compromisso_metas")
        .select("*")
        .eq("compromisso_id", compromisso!.id)
        .order("created_at");
      return data || [];
    },
    enabled: !!compromisso?.id,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const validMetas = metas.filter((m) => m.texto.trim());
      if (validMetas.length === 0) throw new Error("Adicione pelo menos uma meta");

      const { data: comp, error: compError } = await supabase
        .from("compromisso_semanal")
        .upsert(
          { user_id: user!.id, semana: getWeekKey() },
          { onConflict: "user_id,semana" }
        )
        .select()
        .single();

      if (compError) throw compError;

      // Delete existing metas for this week
      await supabase.from("compromisso_metas").delete().eq("compromisso_id", comp.id);

      const { error: metasError } = await supabase.from("compromisso_metas").insert(
        validMetas.map((m) => ({
          compromisso_id: comp.id,
          texto: m.texto,
          objetivo_vinculado: m.objetivo_vinculado || null,
          valor_vinculado: m.valor_vinculado || null,
          concluida: false,
        }))
      );

      if (metasError) throw metasError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compromisso-semanal"] });
      queryClient.invalidateQueries({ queryKey: ["compromisso-metas"] });
      setIsCreating(false);
      toast.success("Compromissos salvos com sucesso!");
    },
    onError: (e) => toast.error(e.message || "Erro ao salvar"),
  });

  const toggleMetaMutation = useMutation({
    mutationFn: async ({ id, concluida }: { id: string; concluida: boolean }) => {
      const { error } = await supabase
        .from("compromisso_metas")
        .update({ concluida })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compromisso-metas"] });
    },
  });

  const addMeta = () => {
    if (metas.length >= 3) return;
    setMetas([...metas, { texto: "", objetivo_vinculado: "", valor_vinculado: "", concluida: false }]);
  };

  const removeMeta = (index: number) => {
    setMetas(metas.filter((_, i) => i !== index));
  };

  const updateMeta = (index: number, field: keyof Meta, value: string) => {
    const updated = [...metas];
    (updated[index] as any)[field] = value;
    setMetas(updated);
  };

  const completedCount = compromissoMetas.filter((m: any) => m.concluida).length;
  const totalCount = compromissoMetas.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const motivationalMessage = () => {
    if (progressPercent === 0) return "💙 Tudo bem! Toda jornada começa com um primeiro passo.";
    if (progressPercent < 50) return "💪 Bom começo! Continue se dedicando!";
    if (progressPercent < 100) return "💪 Ótimo trabalho! Você está no caminho certo!";
    return "🏆 Parabéns! Você completou todos os compromissos!";
  };

  const objetivosList = (objetivos?.objetivos as string[]) || [];
  const valoresList = (valores?.valores as string[]) || [];

  if (isCreating) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <div>
          <h2 className="text-xl font-bold text-primary">Meu Compromisso Comigo Mesmo</h2>
          <p className="text-sm text-muted-foreground">
            Defina pequenas metas para esta semana que te aproximem dos seus objetivos
          </p>
        </div>

        <Card className="border-0 shadow-md border-l-4 border-l-primary">
          <CardContent className="p-4">
            <p className="text-sm">
              <Sparkles className="inline h-4 w-4 text-primary mr-1" />
              <strong>Dica:</strong> Escolha até 3 metas realistas. Ex: "Passar uma noite com a família", "Não beber bebidas alcoólicas", "Dormir 7h por noite"
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardContent className="p-4 space-y-4">
            <h3 className="flex items-center gap-2 font-semibold">
              <Target className="h-5 w-5 text-primary" />
              Minhas Metas da Semana
            </h3>

            {metas.map((meta, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-2 border-b pb-4 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <Input
                    placeholder={`Meta ${index + 1}: Ex: Passar uma noite com a família, meditar 10 minutos por dia`}
                    value={meta.texto}
                    onChange={(e) => updateMeta(index, "texto", e.target.value)}
                    className="flex-1"
                  />
                  {metas.length > 1 && (
                    <button onClick={() => removeMeta(index)} className="text-muted-foreground hover:text-destructive">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {meta.texto && (
                  <div className="space-y-2 pl-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Esta meta me ajuda a alcançar:</label>
                      <select
                        value={meta.objetivo_vinculado}
                        onChange={(e) => updateMeta(index, "objetivo_vinculado", e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Selecione um objetivo</option>
                        {objetivosList.map((obj) => (
                          <option key={obj} value={obj}>{obj}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Esta meta reflete meu valor:</label>
                      <select
                        value={meta.valor_vinculado}
                        onChange={(e) => updateMeta(index, "valor_vinculado", e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Selecione um valor</option>
                        {valoresList.map((val) => (
                          <option key={val} value={val}>{val}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </motion.div>
            ))}

            {metas.length < 3 && (
              <button
                onClick={addMeta}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                <Plus className="h-4 w-4" />
                Adicionar outra meta
              </button>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => setIsCreating(false)} className="w-full sm:w-auto">Cancelar</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || metas.every((m) => !m.texto.trim())}
            className="gap-1 w-full sm:w-auto"
          >
            <CheckCircle2 className="h-4 w-4" />
            Salvar Compromissos
          </Button>
        </div>
      </motion.div>
    );
  }

  // View mode
  if (!compromisso || compromissoMetas.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <div>
          <h2 className="text-xl font-bold text-primary">Meu Compromisso Comigo Mesmo</h2>
          <p className="text-sm text-muted-foreground">Defina suas metas semanais e mantenha seu compromisso com você mesmo</p>
        </div>
        <Card className="border-0 shadow-md">
          <CardContent className="flex flex-col items-center p-8 text-center space-y-3">
            <Heart className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              Você ainda não definiu suas metas desta semana.
            </p>
            <Button onClick={() => {
              setMetas([{ texto: "", objetivo_vinculado: "", valor_vinculado: "", concluida: false }]);
              setIsCreating(true);
            }}>
              <Plus className="mr-2 h-4 w-4" />
              Criar Compromisso
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-primary">Meu Compromisso Comigo Mesmo</h2>
          <p className="text-sm text-muted-foreground">Acompanhe suas metas semanais</p>
        </div>
      </div>

      <Card className="border-0 shadow-md">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold">
              <Sparkles className="h-5 w-5 text-primary" />
              Progresso da Semana
            </h3>
            <span className="rounded-full bg-green-500 text-white text-xs font-bold px-3 py-1">
              {progressPercent}% Completo
            </span>
          </div>

          <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-3">
            <p className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {motivationalMessage()}
            </p>
          </div>

          <div className="space-y-3">
            {compromissoMetas.map((meta: any) => (
              <motion.div
                key={meta.id}
                layout
                className={`rounded-xl border p-4 transition-all ${
                  meta.concluida
                    ? "border-green-400 bg-green-50 dark:bg-green-950/20"
                    : "border-border"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={meta.concluida}
                    onCheckedChange={(checked) =>
                      toggleMetaMutation.mutate({ id: meta.id, concluida: !!checked })
                    }
                  />
                  <div className="flex-1 space-y-1">
                    <p className={`text-sm font-medium ${meta.concluida ? "line-through text-muted-foreground" : ""}`}>
                      {meta.texto}
                    </p>
                    {meta.objetivo_vinculado && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Target className="h-3 w-3 text-primary" />
                        <strong>Objetivo:</strong> {meta.objetivo_vinculado}
                      </p>
                    )}
                    {meta.valor_vinculado && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Heart className="h-3 w-3 text-primary" />
                        <strong>Valor:</strong> {meta.valor_vinculado}
                      </p>
                    )}
                  </div>
                  {meta.concluida && (
                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-2 sm:justify-between">
        <Button variant="outline" onClick={() => window.history.back()} className="w-full sm:w-auto">
          Voltar ao Dashboard
        </Button>
        <Button
          onClick={() => {
            setMetas([{ texto: "", objetivo_vinculado: "", valor_vinculado: "", concluida: false }]);
            setIsCreating(true);
          }}
          className="gap-1 w-full sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          Nova Semana
        </Button>
      </div>
    </motion.div>
  );
}
