import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { Target, CheckCircle2, Calendar, Eye, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { toast } from "sonner";

const OBJETIVOS_DISPONIVEIS = [
  "Emagrecer",
  "Ganhar massa muscular",
  "Melhorar condicionamento físico",
  "Reduzir estresse e ansiedade",
  "Aumentar energia e disposição",
  "Melhorar postura",
  "Aumentar flexibilidade",
  "Melhorar qualidade do sono",
  "Ganhar força",
  "Melhorar saúde do coração",
  "Aumentar autoestima",
  "Competir em eventos esportivos",
  "Prevenir doenças",
  "Socializar e fazer amigos",
  "Ter um estilo de vida mais ativo",
];

export default function ObjetivosTab() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [isRevising, setIsRevising] = useState(false);
  const [step, setStep] = useState(0); // 0=reflexão, 1=seleção, 2=visão
  const [selectedObjetivos, setSelectedObjetivos] = useState<string[]>([]);
  const [conquistas, setConquistas] = useState("");
  const [dificuldades, setDificuldades] = useState("");
  const [visao3Meses, setVisao3Meses] = useState("");
  const [visao3Anos, setVisao3Anos] = useState("");

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

  const objetivosAnteriores = (objetivos?.objetivos || []) as string[];

  const saveMutation = useMutation({
    mutationFn: async () => {
      const proximaRevisao = new Date();
      proximaRevisao.setMonth(proximaRevisao.getMonth() + 3);

      const objetivosFinais =
        selectedObjetivos.length === 0 ? objetivosAnteriores : selectedObjetivos;

      const { error } = await supabase.from("aluno_objetivos").insert({
        user_id: user!.id,
        objetivos: objetivosFinais,
        conquistas,
        dificuldades,
        visao_3_meses: visao3Meses,
        visao_3_anos: visao3Anos,
        proxima_revisao: proximaRevisao.toISOString().split("T")[0],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aluno-objetivos"] });
      setIsRevising(false);
      toast.success("Objetivos salvos com sucesso!");
    },
    onError: () => toast.error("Erro ao salvar objetivos"),
  });

  const toggleObjetivo = (obj: string) => {
    setSelectedObjetivos((prev) => {
      if (prev.includes(obj)) return prev.filter((o) => o !== obj);
      if (prev.length >= 3) return prev;
      return [...prev, obj];
    });
  };

  const startRevision = () => {
    const prev = (objetivos?.objetivos || []) as string[];
    setSelectedObjetivos(prev.filter((o) => OBJETIVOS_DISPONIVEIS.includes(o)));
    setConquistas("");
    setDificuldades("");
    setVisao3Meses(objetivos?.visao_3_meses || "");
    setVisao3Anos(objetivos?.visao_3_anos || "");
    setStep(0);
    setIsRevising(true);
  };

  if (isRevising) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="reflexao"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              className="space-y-4"
            >
              <div>
                <h2 className="text-xl font-bold text-primary">Revisão de Objetivos</h2>
                <p className="text-sm text-muted-foreground">Antes de revisar seus objetivos, vamos refletir sobre o período</p>
              </div>

              <Card className="border-0 shadow-md">
                <CardContent className="p-4 space-y-4">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Como foi este período?
                  </h3>

                  {objetivos?.objetivos && objetivos.objetivos.length > 0 && (
                    <div className="rounded-lg bg-muted/50 p-3 border-l-4 border-primary">
                      <p className="text-sm">
                        <span className="text-muted-foreground">Seus objetivos anteriores: </span>
                        <span className="font-semibold">{(objetivos.objetivos as string[]).join(", ")}</span>
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Quais foram suas maiores conquistas?</label>
                    <Textarea
                      placeholder="Descreva suas conquistas nos últimos 3 meses..."
                      value={conquistas}
                      onChange={(e) => setConquistas(e.target.value)}
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Quais foram suas maiores dificuldades?</label>
                    <Textarea
                      placeholder="Descreva os desafios que enfrentou..."
                      value={dificuldades}
                      onChange={(e) => setDificuldades(e.target.value)}
                      rows={3}
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setIsRevising(false)}>Cancelar</Button>
                <Button onClick={() => setStep(1)} className="gap-1">
                  Continuar para Objetivos
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="selecao"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              className="space-y-4"
            >
              <div>
                <h2 className="text-xl font-bold text-primary">Revisar Meus Objetivos</h2>
                <p className="text-sm text-muted-foreground">Escolha 3 objetivos que guiarão sua jornada</p>
              </div>

              <Card className="border-0 shadow-md">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-primary" />
                    <span className="font-semibold">Selecione seus 3 objetivos principais</span>
                  </div>
                  <span className="inline-block rounded-full bg-primary/10 text-primary text-xs font-bold px-3 py-1">
                    {selectedObjetivos.length}/3 selecionados
                  </span>

                  {objetivosAnteriores.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Últimos selecionados: <span className="font-medium text-foreground">{objetivosAnteriores.join(", ")}</span>. Se salvar sem selecionar nada, eles serão mantidos.
                    </p>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {OBJETIVOS_DISPONIVEIS.map((obj) => {
                      const isSelected = selectedObjetivos.includes(obj);
                      return (
                        <motion.button
                          key={obj}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => toggleObjetivo(obj)}
                          className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm transition-all ${
                            isSelected
                              ? "border-primary bg-primary/10 text-primary font-semibold"
                              : "border-border hover:border-primary/40"
                          }`}
                        >
                          {isSelected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                          <span>{obj}</span>
                        </motion.button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card className="border-0 shadow-md">
                  <CardContent className="p-4 space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <Calendar className="h-4 w-4 text-primary" />
                      Como você se imagina em 3 meses?
                    </label>
                    <Textarea
                      placeholder="Descreva como você se vê em 3 meses alcançando esses objetivos..."
                      value={visao3Meses}
                      onChange={(e) => setVisao3Meses(e.target.value)}
                      rows={3}
                    />
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-md">
                  <CardContent className="p-4 space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <Eye className="h-4 w-4 text-primary" />
                      Como você se imagina em 3 anos?
                    </label>
                    <Textarea
                      placeholder="Descreva sua visão de longo prazo..."
                      value={visao3Anos}
                      onChange={(e) => setVisao3Anos(e.target.value)}
                      rows={3}
                    />
                  </CardContent>
                </Card>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(0)} className="gap-1">
                  <ChevronLeft className="h-4 w-4" />
                  Voltar
                </Button>
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={
                    saveMutation.isPending ||
                    (selectedObjetivos.length !== 0 && selectedObjetivos.length !== 3 && !(selectedObjetivos.length === 0 && objetivosAnteriores.length > 0))
                  }
                  className="gap-1"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Salvar Objetivos
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  // View mode
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-primary">Meus Objetivos</h2>
          <p className="text-sm text-muted-foreground">Seus objetivos atuais e visão de futuro</p>
        </div>
        <Button size="sm" onClick={startRevision} variant="outline">
          {objetivos ? "Revisar" : "Definir Objetivos"}
        </Button>
      </div>

      {objetivos ? (
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 space-y-4">
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 font-semibold">
                <Target className="h-5 w-5 text-primary" />
                Objetivos Atuais
              </h3>
              {(objetivos.objetivos as string[])?.map((obj: string) => (
                <div key={obj} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span className="text-primary font-medium">{obj}</span>
                </div>
              ))}
            </div>

            <div className="border-t pt-3 space-y-3">
              {objetivos.visao_3_meses && (
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    Como me vejo em 3 meses:
                  </p>
                  <p className="text-sm">{objetivos.visao_3_meses}</p>
                </div>
              )}

              {objetivos.visao_3_anos && (
                <div className="rounded-lg bg-primary/5 p-3 space-y-1">
                  <p className="flex items-center gap-2 text-xs font-semibold text-primary">
                    <Eye className="h-3 w-3" />
                    Como me vejo em 3 anos:
                  </p>
                  <p className="text-sm">{objetivos.visao_3_anos}</p>
                </div>
              )}

              {objetivos.proxima_revisao && (
                <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-3">
                  <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    Próxima revisão agendada: {new Date(objetivos.proxima_revisao).toLocaleDateString("pt-BR")}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-md">
          <CardContent className="flex flex-col items-center p-8 text-center space-y-3">
            <Target className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              Você ainda não definiu seus objetivos. Defina agora para ter clareza no seu progresso!
            </p>
            <Button onClick={startRevision}>Definir Objetivos</Button>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
