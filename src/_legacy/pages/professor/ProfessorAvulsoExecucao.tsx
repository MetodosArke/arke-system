import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Play, Pause, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";

export default function ProfessorAvulsoExecucao() {
  const { treinoId } = useParams();
  const [searchParams] = useSearchParams();
  const alunoId = searchParams.get("alunoId") || "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [duracao, setDuracao] = useState<number | string>("");
  const [distancia, setDistancia] = useState<number | string>("");
  const [nota, setNota] = useState(5);
  const [desconforto, setDesconforto] = useState(false);
  const [desconfortoDesc, setDesconfortoDesc] = useState("");
  const [feedback, setFeedback] = useState("");

  const { data: treino, isLoading } = useQuery({
    queryKey: ["prof-avulso-exec", treinoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("treinos")
        .select("id, titulo, descricao, duracao_esperada_min, distancia_esperada_km")
        .eq("id", treinoId!)
        .single();
      return data;
    },
    enabled: !!treinoId,
  });

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  const formatTime = (totalSec: number) => {
    const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
    const s = (totalSec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const toggleStopwatch = () => {
    if (!running && seconds === 0) setRunning(true);
    else if (running) { setRunning(false); const mins = Math.ceil(seconds / 60); if (!duracao) setDuracao(mins); }
    else setRunning(true);
  };

  const finalizarMutation = useMutation({
    mutationFn: async () => {
      if (running) setRunning(false);
      const { error } = await supabase.from("registro_treino").insert({
        treino_id: treinoId!,
        aluno_id: alunoId,
        nota,
        duracao_min: Number(duracao) || Math.ceil(seconds / 60) || null,
        feedback: feedback || null,
        desconforto,
        desconforto_descricao: desconfortoDesc || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Treino concluído!");
      queryClient.invalidateQueries({ queryKey: ["prof-treinos-status"] });
      queryClient.invalidateQueries({ queryKey: ["prof-historico"] });
      navigate("/professor");
    },
    onError: () => toast.error("Erro ao salvar treino."),
  });

  if (isLoading) return <div className="p-4 space-y-4"><div className="h-8 w-48 animate-pulse rounded bg-muted" /><div className="h-64 animate-pulse rounded-lg bg-muted/50" /></div>;
  if (!treino) return <div className="p-4 text-center"><p className="text-muted-foreground">Treino não encontrado.</p><Button variant="outline" className="mt-4" onClick={() => navigate("/professor")}>Voltar</Button></div>;

  return (
    <div className="p-4 space-y-6 pb-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/professor")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">{treino.titulo}</h1>
            <Badge variant="secondary" className="text-xs mt-1">Modo Professor</Badge>
            {treino.descricao && <p className="text-sm text-muted-foreground">{treino.descricao}</p>}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => navigate("/professor")}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-primary/20 p-6">
        <span className="text-5xl font-mono font-bold tracking-wider tabular-nums" style={{ lineHeight: 1.1 }}>{formatTime(seconds)}</span>
        <p className="text-sm text-muted-foreground">Tempo de Treino</p>
        <Button onClick={toggleStopwatch} className={running ? "bg-destructive hover:bg-destructive/90" : ""}>
          {running ? <><Pause className="mr-2 h-4 w-4" />Pausar</> : <><Play className="mr-2 h-4 w-4" />{seconds > 0 ? "Retomar" : "Iniciar"}</>}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div><Label>Duração (min)</Label><Input type="number" min={0} placeholder={treino.duracao_esperada_min ? String(treino.duracao_esperada_min) : ""} value={duracao} onChange={e => setDuracao(e.target.value === "" ? "" : Number(e.target.value))} /></div>
        <div><Label>Distância (km)</Label><Input type="number" min={0} step="0.1" placeholder={treino.distancia_esperada_km ? String(treino.distancia_esperada_km) : ""} value={distancia} onChange={e => setDistancia(e.target.value === "" ? "" : Number(e.target.value))} /></div>
      </div>

      <div>
        <Label className="mb-3 block">Intensidade (1-10)</Label>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Slider value={[nota]} onValueChange={([v]) => setNota(v)} min={1} max={10} step={1} />
            <div className="flex justify-between mt-1 text-[10px] text-muted-foreground"><span>Leve</span><span>Moderado</span><span>Intenso</span></div>
          </div>
          <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary text-primary-foreground font-bold text-sm shrink-0">{nota}</div>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center gap-2">
          <Checkbox id="desc" checked={desconforto} onCheckedChange={checked => setDesconforto(!!checked)} />
          <Label htmlFor="desc" className="cursor-pointer font-normal text-sm">Desconforto ou dor durante o treino</Label>
        </div>
      </div>
      {desconforto && <div><Label>Descreva</Label><Textarea value={desconfortoDesc} onChange={e => setDesconfortoDesc(e.target.value)} placeholder="Onde e como..." /></div>}

      <div><Label>Observações</Label><Textarea value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="Como foi o treino?" rows={4} /></div>

      <div className="flex gap-3 pt-2">
        <Button variant="outline" className="flex-1" onClick={() => navigate("/professor")}>Cancelar</Button>
        <Button className="flex-1" disabled={finalizarMutation.isPending} onClick={() => finalizarMutation.mutate()}>
          <CheckCircle2 className="mr-2 h-4 w-4" />{finalizarMutation.isPending ? "Salvando..." : "Concluir"}
        </Button>
      </div>
    </div>
  );
}
