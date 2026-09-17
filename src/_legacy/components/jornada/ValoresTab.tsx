import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Clock, Calendar, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const TODOS_VALORES = [
  "Saúde", "Família", "Amizade", "Amor", "Liberdade",
  "Honestidade", "Respeito", "Gratidão", "Disciplina", "Crescimento",
  "Criatividade", "Generosidade", "Humildade", "Coragem", "Sabedoria",
  "Paz", "Alegria", "Aventura", "Simplicidade", "Responsabilidade",
  "Autonomia", "Equilíbrio", "Fé", "Justiça", "Compaixão",
];

const ETAPAS = [
  { titulo: "Escolha até 10 valores", subtitulo: "Selecione os valores que mais ressoam com você", max: 10, tempo: 60 },
  { titulo: "Reduza para 5 valores", subtitulo: "Escolha 5 valores da lista", max: 5, tempo: 30 },
  { titulo: "Escolha seus 3 valores finais", subtitulo: "Escolha 3 valores da lista", max: 3, tempo: 10 },
];

export default function ValoresTab() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [isPlaying, setIsPlaying] = useState(false);
  const [etapa, setEtapa] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [previousSelected, setPreviousSelected] = useState<string[]>([]);
  const [timer, setTimer] = useState(60);
  const [timerActive, setTimerActive] = useState(false);

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

  const saveMutation = useMutation({
    mutationFn: async (finalValues: string[]) => {
      const validade = new Date();
      validade.setMonth(validade.getMonth() + 6);

      const { error } = await supabase.from("aluno_valores").insert({
        user_id: user!.id,
        valores: finalValues,
        validade: validade.toISOString().split("T")[0],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aluno-valores"] });
      setIsPlaying(false);
      toast.success("Valores-guia salvos com sucesso!");
    },
    onError: () => toast.error("Erro ao salvar valores"),
  });

  useEffect(() => {
    if (!timerActive || timer <= 0) return;
    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          setTimerActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timerActive, timer]);

  const handleAdvance = useCallback(() => {
    if (etapa < 2) {
      setPreviousSelected(selected);
      setSelected([]);
      setEtapa((prev) => prev + 1);
      setTimer(ETAPAS[etapa + 1].tempo);
      setTimerActive(true);
    } else {
      saveMutation.mutate(selected);
    }
  }, [etapa, selected, saveMutation]);

  // Auto-advance when timer reaches 0 and has enough selections
  useEffect(() => {
    if (timer === 0 && timerActive === false && isPlaying) {
      if (selected.length >= ETAPAS[etapa].max) {
        handleAdvance();
      }
    }
  }, [timer, timerActive, isPlaying, selected.length, etapa, handleAdvance]);

  const toggleValor = (valor: string) => {
    setSelected((prev) => {
      if (prev.includes(valor)) return prev.filter((v) => v !== valor);
      if (prev.length >= ETAPAS[etapa].max) return prev;
      return [...prev, valor];
    });
  };

  const startActivity = () => {
    setIsPlaying(true);
    setEtapa(0);
    setSelected([]);
    setPreviousSelected([]);
    setTimer(ETAPAS[0].tempo);
    setTimerActive(true);
  };

  const displayValues = etapa === 0 ? TODOS_VALORES : previousSelected;

  if (isPlaying) {
    const progressPercent = (timer / ETAPAS[etapa].tempo) * 100;
    const canAdvance = selected.length >= ETAPAS[etapa].max || (etapa === 2 && selected.length === 3);

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        <div className="flex items-center justify-between">
          <span className="rounded-full bg-primary/10 text-primary text-xs font-bold px-3 py-1">
            Etapa {etapa + 1} de 3
          </span>
        </div>

        <div className="text-center space-y-1">
          <h2 className="text-xl font-bold">{ETAPAS[etapa].titulo}</h2>
          <p className="text-sm text-muted-foreground">{ETAPAS[etapa].subtitulo}</p>
        </div>

        <Card className="border-0 shadow-md">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-lg font-bold">{timer}s</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selected.length}/{ETAPAS[etapa].max} selecionados
                </span>
                {canAdvance && (
                  <Button size="sm" onClick={handleAdvance} disabled={saveMutation.isPending}>
                    {etapa < 2 ? "Avançar" : "Finalizar"}
                  </Button>
                )}
              </div>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {displayValues.map((valor) => {
            const isSelected = selected.includes(valor);
            return (
              <motion.button
                key={valor}
                whileTap={{ scale: 0.95 }}
                onClick={() => toggleValor(valor)}
                className={`rounded-xl border p-3 text-sm font-medium transition-all ${
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground shadow-lg"
                    : "border-border hover:border-primary/40 hover:bg-muted/50"
                }`}
              >
                {valor}
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    );
  }

  // Intro or View mode
  if (!valores) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center text-center space-y-6 py-8"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          className="flex h-20 w-20 items-center justify-center rounded-full gradient-primary"
        >
          <Heart className="h-10 w-10 text-primary-foreground" />
        </motion.div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold">Defina seus Valores-guia</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Você fará uma atividade em 3 etapas cronometradas para escolher os 3 valores que guiarão suas decisões pelos próximos 6 meses.
          </p>
        </div>

        <Card className="border-0 shadow-md w-full max-w-md">
          <CardContent className="p-4 space-y-3 text-left">
            <h3 className="flex items-center gap-2 font-semibold">
              <Target className="h-4 w-4 text-primary" />
              Como funciona:
            </h3>
            <div className="space-y-2 text-sm">
              <p>⏱️ <strong>Etapa 1:</strong> 60 segundos para escolher até 10 valores</p>
              <p>🔥 <strong>Etapa 2:</strong> 30 segundos para reduzir para 5 valores</p>
              <p>⚡ <strong>Etapa 3:</strong> 10 segundos para escolher os 3 valores finais</p>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Escolha com o coração! Não pense demais, deixe sua intuição guiar.
            </p>
          </CardContent>
        </Card>

        <Button onClick={startActivity} size="lg" className="font-semibold">
          Começar Atividade
        </Button>
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
          <h2 className="text-xl font-bold text-primary">Meus Valores-guia</h2>
          <p className="text-sm text-muted-foreground">Valores que guiam suas decisões</p>
        </div>
        <Button size="sm" variant="outline" onClick={startActivity}>
          Refazer
        </Button>
      </div>

      <Card className="border-0 shadow-md">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {(valores.valores as string[])?.map((valor: string) => (
              <motion.span
                key={valor}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-md"
              >
                {valor}
              </motion.span>
            ))}
          </div>

          {valores.validade && (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Esses valores ficam válidos até <strong>{new Date(valores.validade).toLocaleDateString("pt-BR")}</strong>.
              </p>
              <p>Você poderá revisar no dia <strong>{new Date(valores.validade).toLocaleDateString("pt-BR")}</strong>.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function Target(props: any) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  );
}
