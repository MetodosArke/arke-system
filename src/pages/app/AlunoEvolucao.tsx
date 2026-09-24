import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus, Trophy, CalendarClock, Activity, Crown, Lock } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { calcularStatusMetas, type StatusMeta } from "@/lib/evolucaoPontos";
import PontuacaoEngajamento from "@/components/aluno/PontuacaoEngajamento";
import type { Tables } from "@/integrations/supabase/types";
import { decimal } from "@/lib/numeros";

type Avaliacao = Tables<"avaliacoes_fisicas">;
type MetricaCustomizada = Tables<"metricas_customizadas">;
type MetricaValor = Tables<"metrica_valores">;

const STATUS_LABEL: Record<StatusMeta, { texto: string; variant: "default" | "secondary" | "outline" }> = {
  superada: { texto: "Superada! 🎉", variant: "default" },
  atingida: { texto: "Atingida ✓", variant: "secondary" },
  pendente: { texto: "Em andamento", variant: "outline" },
};

const METRICAS_BASE: { key: "peso_kg" | "percentual_gordura" | "musculo_percentual"; label: string }[] = [
  { key: "peso_kg", label: "Peso (kg)" },
  { key: "percentual_gordura", label: "% Gordura" },
  { key: "musculo_percentual", label: "% Músculo" },
];

function Delta({ atual, anterior, quantoMenorMelhor }: { atual: number | null; anterior: number | null; quantoMenorMelhor: boolean }) {
  if (atual == null || anterior == null) return null;
  const diff = atual - anterior;
  if (Math.abs(diff) < 0.05) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> estável
      </span>
    );
  }
  const melhorou = quantoMenorMelhor ? diff < 0 : diff > 0;
  const Icon = diff > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${melhorou ? "text-emerald-600" : "text-orange-500"}`}>
      <Icon className="h-3 w-3" /> {diff > 0 ? "+" : ""}
      {decimal(diff, 1)}
    </span>
  );
}

export default function AlunoEvolucao() {
  const { alunoId, planoAluno } = useAuth();
  const [chartMetric, setChartMetric] = useState<"peso_kg" | "percentual_gordura" | "musculo_percentual">("peso_kg");

  // Pelo plano, não pelo nível gravado: nível em quem não está no Método é só intenção.
  const ehElite = planoAluno === "elite";

  const { data: avaliacoes = [], isLoading } = useQuery({
    queryKey: ["aluno-evolucao", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("avaliacoes_fisicas")
        .select("*")
        .eq("aluno_id", alunoId!)
        .order("data_avaliacao", { ascending: false });
      if (error) throw error;
      return data as Avaliacao[];
    },
    enabled: !!alunoId,
  });

  const { data: metricas = [] } = useQuery({
    queryKey: ["aluno-metricas-customizadas", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("metricas_customizadas").select("*").eq("aluno_id", alunoId!).order("created_at");
      if (error) throw error;
      return data as MetricaCustomizada[];
    },
    enabled: !!alunoId,
  });

  const { data: metricaValores = [] } = useQuery({
    queryKey: ["aluno-metrica-valores", alunoId, avaliacoes.map((a) => a.id).join(",")],
    queryFn: async () => {
      if (avaliacoes.length === 0) return [];
      const { data, error } = await supabase
        .from("metrica_valores")
        .select("*")
        .in("avaliacao_id", avaliacoes.map((a) => a.id));
      if (error) throw error;
      return data as MetricaValor[];
    },
    enabled: avaliacoes.length > 0,
  });

  const metricaNomeById = useMemo(() => new Map(metricas.map((m) => [m.id, m.nome])), [metricas]);
  const valoresPorAvaliacao = useMemo(() => {
    const map = new Map<string, { nome: string; valor: number }[]>();
    metricaValores.forEach((v) => {
      const nome = metricaNomeById.get(v.metrica_id);
      if (!nome) return;
      const lista = map.get(v.avaliacao_id) ?? [];
      lista.push({ nome, valor: Number(v.valor) });
      map.set(v.avaliacao_id, lista);
    });
    return map;
  }, [metricaValores, metricaNomeById]);

  const ultima = avaliacoes[0] ?? null;
  const penultima = avaliacoes[1] ?? null;

  const chartData = useMemo(
    () =>
      [...avaliacoes]
        .reverse()
        .filter((a) => a[chartMetric] != null)
        .map((a) => ({
          data: new Date(a.data_avaliacao).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
          valor: Number(a[chartMetric]),
        })),
    [avaliacoes, chartMetric]
  );

  const metricasComDados = METRICAS_BASE.filter((m) => avaliacoes.some((a) => a[m.key] != null));

  return (
    <div className="space-y-4 max-w-2xl lg:max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Minha Evolução</h1>
      </div>

      {ehElite ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Crown className="h-4 w-4 text-primary" /> Relatório A.P.E.X.®/L.E.G.A.D.O.® — Exclusivo Elite
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Visão consolidada da sua evolução física e do seu engajamento no mês, num só lugar.
            </p>
          </CardHeader>
          <CardContent>
            <PontuacaoEngajamento />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Lock className="h-5 w-5 text-muted-foreground/60 shrink-0" />
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Crown className="h-3.5 w-3.5 text-primary" /> Relatório A.P.E.X.®/L.E.G.A.D.O.® — Exclusivo Elite
              </p>
              <p className="text-xs text-muted-foreground">
                Disponível para alunos no nível Elite. Pergunte à sua academia como fazer upgrade.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!isLoading && avaliacoes.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Sua primeira avaliação física ainda não foi registrada. Sua equipe vai te avisar assim que tiver novidade.
          </CardContent>
        </Card>
      )}

      {ultima && (
        <>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Card>
              <CardContent className="p-3 sm:p-4">
                <p className="text-xs text-muted-foreground">Peso</p>
                <p className="text-lg font-bold">{ultima.peso_kg != null ? `${ultima.peso_kg}kg` : "—"}</p>
                <Delta atual={ultima.peso_kg} anterior={penultima?.peso_kg ?? null} quantoMenorMelhor={false} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 sm:p-4">
                <p className="text-xs text-muted-foreground">Músculo</p>
                <p className="text-lg font-bold">{ultima.musculo_percentual != null ? `${ultima.musculo_percentual}%` : "—"}</p>
                <Delta atual={ultima.musculo_percentual} anterior={penultima?.musculo_percentual ?? null} quantoMenorMelhor={false} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 sm:p-4">
                <p className="text-xs text-muted-foreground">Gordura</p>
                <p className="text-lg font-bold">{ultima.percentual_gordura != null ? `${ultima.percentual_gordura}%` : "—"}</p>
                <Delta atual={ultima.percentual_gordura} anterior={penultima?.percentual_gordura ?? null} quantoMenorMelhor={true} />
              </CardContent>
            </Card>
          </div>

          {metricasComDados.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Gráfico de Progresso</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {metricasComDados.map((m) => (
                    <Button key={m.key} size="sm" variant={chartMetric === m.key ? "default" : "outline"} className="h-7 text-xs" onClick={() => setChartMetric(m.key)}>
                      {m.label}
                    </Button>
                  ))}
                </div>
                {chartData.length >= 2 ? (
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="data" fontSize={11} tickLine={false} />
                        <YAxis fontSize={11} tickLine={false} width={36} domain={["auto", "auto"]} />
                        <Tooltip />
                        <Line type="monotone" dataKey="valor" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">Registre pelo menos 2 avaliações para ver o gráfico.</p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Histórico de Avaliações</h2>
            {avaliacoes.map((av, idx) => {
              const anterior = avaliacoes[idx + 1] ?? null;
              const statusMetas = calcularStatusMetas(anterior, av);
              const metricasDaAvaliacao = valoresPorAvaliacao.get(av.id) ?? [];
              return (
                <Card key={av.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{new Date(av.data_avaliacao).toLocaleDateString("pt-BR")}</span>
                      {av.pontos > 0 && (
                        <Badge variant="secondary" className="gap-1">
                          <Trophy className="h-3 w-3" /> {av.pontos} pts
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {av.peso_kg != null && <Badge variant="outline">Peso: {av.peso_kg}kg</Badge>}
                      {av.percentual_gordura != null && <Badge variant="outline">Gordura: {av.percentual_gordura}%</Badge>}
                      {av.musculo_percentual != null && <Badge variant="outline">Músculo: {av.musculo_percentual}%</Badge>}
                      {av.perim_cintura != null && <Badge variant="outline">Cintura: {av.perim_cintura}cm</Badge>}
                      {av.perim_quadril != null && <Badge variant="outline">Quadril: {av.perim_quadril}cm</Badge>}
                      {av.perim_braco != null && <Badge variant="outline">Braço: {av.perim_braco}cm</Badge>}
                      {av.perim_coxa != null && <Badge variant="outline">Coxa: {av.perim_coxa}cm</Badge>}
                      {metricasDaAvaliacao.map((m) => (
                        <Badge key={m.nome} variant="outline">
                          {m.nome}: {m.valor}/10
                        </Badge>
                      ))}
                    </div>
                    {(statusMetas.peso || statusMetas.gordura || statusMetas.musculo) && (
                      <div className="pt-1">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Metas definidas</p>
                        <div className="flex flex-wrap gap-1.5">
                          {statusMetas.peso && <Badge variant={STATUS_LABEL[statusMetas.peso].variant}>Peso: {STATUS_LABEL[statusMetas.peso].texto}</Badge>}
                          {statusMetas.gordura && <Badge variant={STATUS_LABEL[statusMetas.gordura].variant}>Gordura: {STATUS_LABEL[statusMetas.gordura].texto}</Badge>}
                          {statusMetas.musculo && <Badge variant={STATUS_LABEL[statusMetas.musculo].variant}>Músculo: {STATUS_LABEL[statusMetas.musculo].texto}</Badge>}
                        </div>
                      </div>
                    )}
                    {av.data_proxima_avaliacao && (
                      <p className="text-xs text-primary flex items-center gap-1">
                        <CalendarClock className="h-3.5 w-3.5" /> Próxima avaliação: {new Date(av.data_proxima_avaliacao).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                    {av.observacoes && <p className="text-xs text-muted-foreground italic">{av.observacoes}</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
