import { hojeBrasilia, formatarDataBR } from "@/lib/dataBrasilia";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Trophy, CheckCircle2, Flame } from "lucide-react";
import {
  calcularValorAtual,
  statusDesafio,
  progressoPercentual,
  DESAFIO_TIPO_LABEL,
  type DadosPeriodoAluno,
} from "@/lib/desafioProgresso";
import type { Tables } from "@/integrations/supabase/types";

type Desafio = Tables<"desafios">;

const STATUS_STYLE: Record<string, { label: string; badge: "default" | "secondary" | "destructive" | "outline" }> = {
  cumprido: { label: "Concluído ✓", badge: "secondary" },
  superado: { label: "Superado! 🎉", badge: "default" },
  falhado: { label: "Não concluído", badge: "destructive" },
  em_andamento: { label: "Em andamento", badge: "outline" },
};

export default function AlunoDesafios() {
  const { alunoId } = useAuth();

  const { data: desafios = [], isLoading } = useQuery({
    queryKey: ["aluno-desafios", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("desafios").select("*").order("data_inicio", { ascending: false });
      if (error) throw error;
      return data as Desafio[];
    },
    enabled: !!alunoId,
  });

  const { data: progressoManual = {} } = useQuery({
    queryKey: ["aluno-desafio-progresso", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("desafio_progresso").select("desafio_id, concluido").eq("aluno_id", alunoId!);
      if (error) throw error;
      const map: Record<string, boolean> = {};
      (data ?? []).forEach((p) => (map[p.desafio_id] = p.concluido));
      return map;
    },
    enabled: !!alunoId && desafios.length > 0,
  });

  const periodo = useMemo(() => {
    if (desafios.length === 0) return null;
    const inicios = desafios.map((d) => d.data_inicio).sort();
    const fins = desafios.map((d) => d.data_fim).sort();
    return { inicio: inicios[0], fim: fins[fins.length - 1] };
  }, [desafios]);

  const { data: dietaAdesoes = [] } = useQuery({
    queryKey: ["aluno-desafios-dieta-adesao", alunoId, periodo?.inicio, periodo?.fim],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dieta_adesao")
        .select("data, consumiu_doce, consumiu_alcool, agua_ml, adesao_percentual")
        .eq("aluno_id", alunoId!)
        .gte("data", periodo!.inicio)
        .lte("data", periodo!.fim);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!alunoId && !!periodo,
  });

  const { data: registrosTreino = [] } = useQuery({
    queryKey: ["aluno-desafios-registro-treino", alunoId, periodo?.inicio, periodo?.fim],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registro_treino")
        .select("data, concluido")
        .eq("aluno_id", alunoId!)
        .eq("concluido", true)
        .gte("data", periodo!.inicio)
        .lte("data", periodo!.fim);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!alunoId && !!periodo,
  });

  const { data: calendarioTreino = [] } = useQuery({
    queryKey: ["aluno-desafios-calendario-treino", alunoId, periodo?.inicio, periodo?.fim],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treino_calendario")
        .select("data, tipos")
        .eq("aluno_id", alunoId!)
        .gte("data", periodo!.inicio)
        .lte("data", periodo!.fim);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!alunoId && !!periodo,
  });

  const dadosPeriodo = (dataInicio: string, dataFim: string): DadosPeriodoAluno => {
    const dietaNoRange = dietaAdesoes.filter((d) => d.data >= dataInicio && d.data <= dataFim);
    const treinosNoRange = registrosTreino.filter((r) => r.data >= dataInicio && r.data <= dataFim);
    const calendarioNoRange = calendarioTreino.filter((c) => c.data >= dataInicio && c.data <= dataFim);
    const modalidades = new Set<string>();
    calendarioNoRange.forEach((c) => (c.tipos ?? []).forEach((t) => modalidades.add(t)));
    return {
      diasComDoce: dietaNoRange.filter((d) => d.consumiu_doce).length,
      diasComAlcool: dietaNoRange.filter((d) => d.consumiu_alcool).length,
      aguaTotalMl: dietaNoRange.reduce((s, d) => s + (d.agua_ml ?? 0), 0),
      treinosConcluidos: treinosNoRange.length,
      modalidadesDistintas: modalidades.size,
      adesaoDietaMedia: dietaNoRange.length > 0 ? dietaNoRange.reduce((s, d) => s + d.adesao_percentual, 0) / dietaNoRange.length : 0,
    };
  };

  const hoje = hojeBrasilia();
  const ativos = desafios.filter((d) => d.data_fim >= hoje);
  const encerrados = desafios.filter((d) => d.data_fim < hoje);
  const totalPontos = desafios.reduce((soma, d) => {
    const dados = dadosPeriodo(d.data_inicio, d.data_fim);
    const valorAtual = calcularValorAtual(d.tipo, dados);
    const status = statusDesafio(d.tipo, d.meta_valor, valorAtual, !!progressoManual[d.id], d.data_fim < hoje);
    return soma + (status === "cumprido" || status === "superado" ? d.pontos : 0);
  }, 0);

  const renderCard = (d: Desafio) => {
    const dados = dadosPeriodo(d.data_inicio, d.data_fim);
    const valorAtual = calcularValorAtual(d.tipo, dados);
    const encerrado = d.data_fim < hoje;
    const status = statusDesafio(d.tipo, d.meta_valor, valorAtual, !!progressoManual[d.id], encerrado);
    const pct = d.tipo === "livre" ? (progressoManual[d.id] ? 100 : 0) : progressoPercentual(d.tipo, d.meta_valor, valorAtual);
    const info = DESAFIO_TIPO_LABEL[d.tipo];
    const style = STATUS_STYLE[status];

    return (
      <Card key={d.id}>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold flex items-center gap-1.5">
                {info.emoji} {d.titulo}
              </p>
              {d.descricao && <p className="text-xs text-muted-foreground">{d.descricao}</p>}
            </div>
            <Badge variant={style.badge} className="shrink-0">
              {style.label}
            </Badge>
          </div>
          <Progress value={pct} className={status === "falhado" ? "[&>div]:bg-destructive" : status === "superado" ? "[&>div]:bg-emerald-500" : undefined} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            {d.tipo !== "livre" && valorAtual != null && d.meta_valor != null && (
              <span>
                {valorAtual} / {d.meta_valor} {info.unidade}
              </span>
            )}
            <span className="flex items-center gap-1 ml-auto">
              <Trophy className="h-3 w-3" /> {d.pontos} pts
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {formatarDataBR(d.data_inicio)} — {formatarDataBR(d.data_fim)}
          </p>
          {d.tipo === "livre" && !progressoManual[d.id] && !encerrado && (
            <p className="text-[10px] text-muted-foreground italic">Sua equipe confirma a conclusão desse desafio.</p>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <Trophy className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Desafios</h1>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-lg font-bold text-primary">{ativos.length}</p>
            <p className="text-[10px] text-muted-foreground">Ativos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-lg font-bold text-emerald-600">{encerrados.length}</p>
            <p className="text-[10px] text-muted-foreground">Encerrados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-lg font-bold text-primary flex items-center justify-center gap-1">
              <Flame className="h-4 w-4" /> {totalPontos}
            </p>
            <p className="text-[10px] text-muted-foreground">Total Pontos</p>
          </CardContent>
        </Card>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {!isLoading && desafios.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Nenhum desafio disponível no momento.</CardContent>
        </Card>
      )}

      {ativos.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" /> Desafios Ativos
          </h2>
          {ativos.map(renderCard)}
        </div>
      )}

      {encerrados.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Desafios Encerrados</h2>
          {encerrados.map(renderCard)}
        </div>
      )}
    </div>
  );
}
