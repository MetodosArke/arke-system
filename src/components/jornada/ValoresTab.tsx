import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Heart } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type AlunoValores = Tables<"aluno_valores">;

const TODOS_VALORES = [
  "Saúde",
  "Família",
  "Amizade",
  "Amor",
  "Liberdade",
  "Honestidade",
  "Respeito",
  "Gratidão",
  "Disciplina",
  "Crescimento",
  "Criatividade",
  "Generosidade",
  "Humildade",
  "Coragem",
  "Sabedoria",
  "Paz",
  "Alegria",
  "Aventura",
  "Simplicidade",
  "Responsabilidade",
  "Autonomia",
  "Equilíbrio",
  "Fé",
  "Justiça",
  "Compaixão",
];

const ETAPAS = [
  { titulo: "Etapa 1 de 3", subtitulo: "Escolha até 10 valores que mais ressoam com você", max: 10, tempo: 60 },
  { titulo: "Etapa 2 de 3", subtitulo: "Reduza para 5 valores essenciais", max: 5, tempo: 30 },
  { titulo: "Etapa 3 de 3", subtitulo: "Escolha os 3 valores que mais te definem", max: 3, tempo: 10 },
];

export default function ValoresTab() {
  const { alunoId, organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isPlaying, setIsPlaying] = useState(false);
  const [stage, setStage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [previousSelected, setPreviousSelected] = useState<string[]>([]);
  const [timer, setTimer] = useState(ETAPAS[0].tempo);

  const { data: atual, isLoading } = useQuery({
    queryKey: ["aluno-valores", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aluno_valores")
        .select("*")
        .eq("aluno_id", alunoId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as AlunoValores | null;
    },
    enabled: !!alunoId,
  });

  const salvar = useMutation({
    mutationFn: async (valores: string[]) => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const validade = new Date();
      validade.setMonth(validade.getMonth() + 6);
      const { error } = await supabase.from("aluno_valores").insert({
        organization_id: organization.id,
        aluno_id: alunoId,
        valores,
        validade: validade.toISOString().slice(0, 10),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Seus valores-guia foram definidos!" });
      void queryClient.invalidateQueries({ queryKey: ["aluno-valores", alunoId] });
      setIsPlaying(false);
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  const avancarEtapa = () => {
    if (stage >= 2) {
      salvar.mutate(selected);
      return;
    }
    setPreviousSelected(selected);
    setSelected([]);
    setStage((s) => s + 1);
    setTimer(ETAPAS[stage + 1].tempo);
  };

  useEffect(() => {
    if (!isPlaying) return;
    if (timer <= 0) return;
    const interval = setInterval(() => setTimer((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(interval);
  }, [isPlaying, timer, stage]);

  useEffect(() => {
    if (isPlaying && timer === 0 && selected.length >= ETAPAS[stage].max) {
      avancarEtapa();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer]);

  const iniciar = () => {
    setStage(0);
    setSelected([]);
    setPreviousSelected([]);
    setTimer(ETAPAS[0].tempo);
    setIsPlaying(true);
  };

  const toggleValor = (valor: string) => {
    setSelected((prev) => {
      if (prev.includes(valor)) return prev.filter((v) => v !== valor);
      if (prev.length >= ETAPAS[stage].max) return prev;
      return [...prev, valor];
    });
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (isPlaying) {
    const etapa = ETAPAS[stage];
    const opcoes = stage === 0 ? TODOS_VALORES : previousSelected;
    return (
      <Card>
        <CardContent className="p-4 space-y-4">
          <Badge variant="secondary">{etapa.titulo}</Badge>
          <div>
            <h3 className="font-semibold">{etapa.subtitulo}</h3>
          </div>
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold text-lg tabular-nums">{timer}s</span>
              <span className="text-xs text-muted-foreground">
                {selected.length}/{etapa.max} selecionados
              </span>
            </div>
            <Progress value={(timer / etapa.tempo) * 100} />
          </div>
          <div className="flex flex-wrap gap-2">
            {opcoes.map((valor) => {
              const isSelected = selected.includes(valor);
              return (
                <Button key={valor} type="button" size="sm" variant={isSelected ? "default" : "outline"} onClick={() => toggleValor(valor)}>
                  {valor}
                </Button>
              );
            })}
          </div>
          {selected.length >= etapa.max && (
            <Button className="w-full" onClick={avancarEtapa} disabled={salvar.isPending}>
              {stage >= 2 ? (salvar.isPending ? "Salvando..." : "Finalizar") : "Avançar"}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!atual) {
    return (
      <Card>
        <CardContent className="p-4 flex flex-col items-center text-center gap-3 py-8">
          <div className="h-14 w-14 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
            <Heart className="h-7 w-7 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground max-w-xs">
            Descubra seus valores-guia num exercício rápido de 3 etapas: vamos reduzindo suas escolhas até chegar nos 3 valores que mais te definem.
          </p>
          <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground space-y-1 text-left">
            <p>⏱️ 60s — escolha até 10 valores</p>
            <p>⏱️ 30s — reduza para 5</p>
            <p>⏱️ 10s — escolha os 3 finais</p>
          </div>
          <Button onClick={iniciar}>Começar Atividade</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Heart className="h-4 w-4 text-primary" /> Meus Valores-guia
          </h3>
          <Button size="sm" variant="outline" onClick={iniciar}>
            Refazer
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {atual.valores.map((v) => (
            <Badge key={v} className="text-sm px-3 py-1">
              {v}
            </Badge>
          ))}
        </div>
        {atual.validade && (
          <p className="text-xs text-muted-foreground">
            Válidos até {new Date(atual.validade).toLocaleDateString("pt-BR")} — você poderá revisar nessa data.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
