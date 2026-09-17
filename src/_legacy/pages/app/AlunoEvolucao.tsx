import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Scale,
  Calendar,
  Smile,
  Frown,
  Meh,
  ArrowDown,
  ArrowUp,
  Minus,
  Activity,
  Target,
  Trophy,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

const trendIcon = (current: number | null, previous: number | null) => {
  if (!current || !previous) return <Minus className="h-3 w-3 text-muted-foreground" />;
  if (current > previous) return <ArrowUp className="h-3 w-3 text-destructive" />;
  if (current < previous) return <ArrowDown className="h-3 w-3 text-primary" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
};

const metricLabels: Record<string, string> = {
  peso_kg: "Peso (kg)",
  gordura_percentual: "Gordura (%)",
  musculo_percentual: "Músculo (%)",
  cintura_cm: "Cintura (cm)",
  quadril_cm: "Quadril (cm)",
  braco_cm: "Braço (cm)",
  perna_cm: "Perna (cm)",
};

const metaDirectionLabel: Record<string, string> = {
  manter: "Manter",
  aumentar: "Aumentar",
  diminuir: "Diminuir",
};

function checkMetaStatus(
  metaDir: string | null,
  metaValor: number | null,
  currentVal: number | null,
  previousVal: number | null
): "atingida" | "superada" | "pendente" | null {
  if (!metaDir || currentVal == null || previousVal == null) return null;

  if (metaDir === "manter" && Math.abs(currentVal - previousVal) <= 0.5) return "atingida";
  if (metaDir === "diminuir" && currentVal < previousVal) {
    if (metaValor && currentVal <= metaValor) return "superada";
    return "atingida";
  }
  if (metaDir === "aumentar" && currentVal > previousVal) {
    if (metaValor && currentVal >= metaValor) return "superada";
    return "atingida";
  }
  return "pendente";
}

export default function AlunoEvolucao() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [chartMetric, setChartMetric] = useState<string>("peso_kg");

  // Realtime: refetch quando admin registra/edita medições para este aluno
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`aluno-evolucao-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "progresso_semanal", filter: `aluno_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["progresso-semanal", user.id] });
          queryClient.invalidateQueries({ queryKey: ["aluno-metrica-valores", user.id] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "metricas_customizadas", filter: `aluno_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["aluno-metricas-custom", user.id] });
          queryClient.invalidateQueries({ queryKey: ["aluno-metrica-valores", user.id] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "metrica_valores" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["aluno-metrica-valores", user.id] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  const { data: progressos = [], isLoading } = useQuery({
    queryKey: ["progresso-semanal", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("progresso_semanal")
        .select("*")
        .eq("aluno_id", user!.id)
        .order("data", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const { data: metricasCustom = [] } = useQuery({
    queryKey: ["aluno-metricas-custom", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("metricas_customizadas")
        .select("*")
        .eq("aluno_id", user!.id)
        .order("created_at");
      return data || [];
    },
    enabled: !!user,
  });

  const { data: metricaValores = [] } = useQuery({
    queryKey: ["aluno-metrica-valores", user?.id, progressos.map((p: any) => p.id).join(",")],
    queryFn: async () => {
      const progressoIds = progressos.map((p: any) => p.id);
      if (progressoIds.length === 0) return [];
      const { data } = await supabase
        .from("metrica_valores")
        .select("*, metricas_customizadas(nome)")
        .in("progresso_id", progressoIds);
      return data || [];
    },
    enabled: progressos.length > 0,
  });

  const { data: perfil } = useQuery({
    queryKey: ["aluno-perfil", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("aluno_perfil")
        .select("peso_kg")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const latest = progressos[0];
  const previous = progressos[1];

  const currentPeso = latest?.peso_kg ?? perfil?.peso_kg;

  const pesoChange = latest?.peso_kg && previous?.peso_kg
    ? (Number(latest.peso_kg) - Number(previous.peso_kg)).toFixed(1)
    : null;

  // Build metric labels only for metrics that have data
  const filledMetricKeys = new Set<string>();
  progressos.forEach((p: any) => {
    Object.keys(metricLabels).forEach((key) => {
      if (p[key] != null) filledMetricKeys.add(key);
    });
  });
  metricaValores.forEach((mv: any) => {
    filledMetricKeys.add(`custom_${mv.metrica_id}`);
  });

  const allMetricLabels: Record<string, string> = {};
  filledMetricKeys.forEach((key) => {
    if (metricLabels[key]) {
      allMetricLabels[key] = metricLabels[key];
    }
  });
  metricasCustom.forEach((m: any) => {
    const k = `custom_${m.id}`;
    if (filledMetricKeys.has(k)) {
      allMetricLabels[k] = m.nome;
    }
  });

  // Auto-select first available metric
  const availableKeys = Object.keys(allMetricLabels);
  const effectiveChartMetric = allMetricLabels[chartMetric] ? chartMetric : (availableKeys[0] || "peso_kg");

  const chartData = [...progressos]
    .reverse()
    .map((p: any) => {
      const row: any = {
        data: format(new Date(p.data + "T12:00:00"), "dd/MM", { locale: ptBR }),
      };
      Object.keys(metricLabels).forEach((key) => {
        if (p[key] != null) row[key] = Number(p[key]);
      });
      metricaValores
        .filter((mv: any) => mv.progresso_id === p.id)
        .forEach((mv: any) => {
          row[`custom_${mv.metrica_id}`] = Number(mv.valor);
        });
      return row;
    })
    .filter((row: any) => row[effectiveChartMetric] != null);

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-4 p-4 pb-24"
    >
      {/* Header */}
      <motion.div variants={item}>
        <h1 className="text-2xl font-bold text-primary">Minha Evolução</h1>
        <p className="text-sm text-muted-foreground">Acompanhe seu progresso</p>
      </motion.div>

      {/* Stats cards */}
      <motion.div variants={item} className="grid grid-cols-3 gap-2">
        <Card className="border-0 shadow-md">
          <CardContent className="p-3">
            <Scale className="h-4 w-4 text-primary mb-1" />
            <p className="text-lg font-bold">
              {currentPeso ? `${currentPeso}` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">Peso (kg)</p>
            {pesoChange && (
              <div className="flex items-center gap-0.5 mt-0.5">
                {trendIcon(Number(latest?.peso_kg), Number(previous?.peso_kg))}
                <span className="text-[10px] text-primary">
                  {parseFloat(pesoChange) > 0 ? "+" : ""}{pesoChange}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-3">
            <Activity className="h-4 w-4 text-primary mb-1" />
            <p className="text-lg font-bold">
              {latest?.musculo_percentual ? `${latest.musculo_percentual}` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">Músculo (kg)</p>
            {latest?.musculo_percentual && previous?.musculo_percentual && (
              <div className="flex items-center gap-0.5 mt-0.5">
                {(() => {
                  const diff = (Number(latest.musculo_percentual) - Number(previous.musculo_percentual)).toFixed(1);
                  const val = parseFloat(diff);
                  return <>
                    {val > 0 ? <ArrowUp className="h-3 w-3 text-primary" /> : val < 0 ? <ArrowDown className="h-3 w-3 text-destructive" /> : <Minus className="h-3 w-3 text-muted-foreground" />}
                    <span className="text-[10px] text-primary">{val > 0 ? "+" : ""}{diff}</span>
                  </>;
                })()}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-3">
            <TrendingUp className="h-4 w-4 text-primary mb-1" />
            <p className="text-lg font-bold">
              {latest?.gordura_percentual ? `${latest.gordura_percentual}` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">Gordura (%)</p>
            {latest?.gordura_percentual && previous?.gordura_percentual && (
              <div className="flex items-center gap-0.5 mt-0.5">
                {(() => {
                  const diff = (Number(latest.gordura_percentual) - Number(previous.gordura_percentual)).toFixed(1);
                  const val = parseFloat(diff);
                  return <>
                    {val > 0 ? <ArrowUp className="h-3 w-3 text-destructive" /> : val < 0 ? <ArrowDown className="h-3 w-3 text-primary" /> : <Minus className="h-3 w-3 text-muted-foreground" />}
                    <span className="text-[10px] text-primary">{val > 0 ? "+" : ""}{diff}</span>
                  </>;
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Chart - only show if there are filled metrics */}
      {availableKeys.length > 0 && (
        <motion.div variants={item}>
          <Card className="border-0 shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-5 w-5 text-primary" />
                Gráfico de Evolução
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {Object.entries(allMetricLabels).map(([key, label]) => (
                  <Button
                    key={key}
                    variant={effectiveChartMetric === key ? "default" : "outline"}
                    size="sm"
                    className="text-xs h-7 px-2.5"
                    onClick={() => setChartMetric(key)}
                  >
                    {label}
                  </Button>
                ))}
              </div>

              {chartData.length >= 2 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="data" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} className="text-muted-foreground" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey={effectiveChartMetric}
                      name={allMetricLabels[effectiveChartMetric]}
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 4, fill: "hsl(var(--primary))" }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground text-center px-4">
                    Registre pelo menos 2 medições para visualizar o gráfico
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* History */}
      <motion.div variants={item}>
        <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          Histórico de Registros
        </h3>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/50" />
            ))}
          </div>
        ) : progressos.length === 0 ? (
          <Card className="border-0 shadow-md">
            <CardContent className="flex flex-col items-center p-6 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">
                Nenhum registro ainda. Aguarde seu treinador registrar suas medições.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {progressos.map((p: any, idx: number) => {
              const pMetricValues = metricaValores.filter((mv: any) => mv.progresso_id === p.id);
              const nextRecord = progressos[idx + 1]; // previous chronologically

              // Build metas for this record
              const metas: { label: string; direction: string; target: number | null; status: "atingida" | "superada" | "pendente" | null }[] = [];

              // Check if THIS record has metas defined (they're goals for the NEXT period)
              if (p.meta) {
                // Find the next record (idx-1) to check if meta was achieved
                const nextIdx = idx - 1;
                const futureRecord = nextIdx >= 0 ? progressos[nextIdx] : null;
                const status = futureRecord
                  ? checkMetaStatus(p.meta, p.meta_peso_kg, futureRecord.peso_kg, p.peso_kg)
                  : null; // no future record yet = still pending
                metas.push({
                  label: "Peso",
                  direction: p.meta,
                  target: p.meta_peso_kg,
                  status: futureRecord ? status : "pendente",
                });
              }
              if (p.meta_gordura) {
                const nextIdx = idx - 1;
                const futureRecord = nextIdx >= 0 ? progressos[nextIdx] : null;
                const status = futureRecord
                  ? checkMetaStatus(p.meta_gordura, p.meta_gordura_valor, futureRecord.gordura_percentual, p.gordura_percentual)
                  : null;
                metas.push({
                  label: "Gordura",
                  direction: p.meta_gordura,
                  target: p.meta_gordura_valor,
                  status: futureRecord ? status : "pendente",
                });
              }
              if (p.meta_musculo) {
                const nextIdx = idx - 1;
                const futureRecord = nextIdx >= 0 ? progressos[nextIdx] : null;
                const status = futureRecord
                  ? checkMetaStatus(p.meta_musculo, p.meta_musculo_valor, futureRecord.musculo_percentual, p.musculo_percentual)
                  : null;
                metas.push({
                  label: "Músculo",
                  direction: p.meta_musculo,
                  target: p.meta_musculo_valor,
                  status: futureRecord ? status : "pendente",
                });
              }

              return (
                <Card key={p.id} className="border-0 shadow-md overflow-hidden">
                  <CardContent className="p-4 space-y-3">
                    {/* Date & Points */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">
                        {format(new Date(p.data + "T12:00:00"), "dd 'de' MMMM, yyyy", { locale: ptBR })}
                      </span>
                      {(p.pontos != null && p.pontos > 0) && (
                        <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] gap-1">
                          <Trophy className="h-3 w-3" />
                          {p.pontos} pts
                        </Badge>
                      )}
                    </div>

                    {p.data_proxima_avaliacao && (
                      <p className="text-[11px] text-muted-foreground">
                        Próxima avaliação: {format(new Date(p.data_proxima_avaliacao + "T12:00:00"), "dd/MM/yyyy")}
                      </p>
                    )}

                    {/* Measurements */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {p.peso_kg && <span>Peso: <strong className="text-foreground">{p.peso_kg} kg</strong></span>}
                      {p.gordura_percentual && <span>Gordura: <strong className="text-foreground">{p.gordura_percentual}%</strong></span>}
                      {p.musculo_percentual && <span>Músculo: <strong className="text-foreground">{p.musculo_percentual}</strong></span>}
                      {p.cintura_cm && <span>Cintura: <strong className="text-foreground">{p.cintura_cm} cm</strong></span>}
                      {p.quadril_cm && <span>Quadril: <strong className="text-foreground">{p.quadril_cm} cm</strong></span>}
                      {p.braco_cm && <span>Braço: <strong className="text-foreground">{p.braco_cm} cm</strong></span>}
                      {p.perna_cm && <span>Perna: <strong className="text-foreground">{p.perna_cm} cm</strong></span>}
                    </div>

                    {pMetricValues.length > 0 && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {pMetricValues.map((mv: any) => (
                          <span key={mv.id}>
                            {mv.metricas_customizadas?.nome}: <strong className="text-foreground">{mv.valor}/10</strong>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Metas Section */}
                    {metas.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-border/50">
                        <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
                          <Target className="h-3 w-3" />
                          Metas definidas
                        </p>
                        <div className="space-y-1">
                          {metas.map((meta, i) => (
                            <div
                              key={i}
                              className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs ${
                                meta.status === "superada"
                                  ? "bg-primary/10 text-primary"
                                  : meta.status === "atingida"
                                  ? "bg-primary/5 text-primary"
                                  : meta.status === "pendente"
                                  ? "bg-muted/50 text-muted-foreground"
                                  : "bg-muted/50 text-muted-foreground"
                              }`}
                            >
                              {meta.status === "superada" ? (
                                <Trophy className="h-3.5 w-3.5 shrink-0" />
                              ) : meta.status === "atingida" ? (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                              ) : (
                                <Circle className="h-3.5 w-3.5 shrink-0" />
                              )}
                              <span className="flex-1">
                                {meta.label}: {metaDirectionLabel[meta.direction] || meta.direction}
                                {meta.target != null ? ` para ${meta.target}` : ""}
                              </span>
                              {meta.status === "superada" && (
                                <Badge className="bg-primary text-primary-foreground text-[9px] px-1.5 py-0 h-4">
                                  Superada! 🎉
                                </Badge>
                              )}
                              {meta.status === "atingida" && (
                                <Badge variant="outline" className="text-primary border-primary/30 text-[9px] px-1.5 py-0 h-4">
                                  Atingida ✓
                                </Badge>
                              )}
                              {meta.status === "pendente" && (
                                <Badge variant="outline" className="text-muted-foreground text-[9px] px-1.5 py-0 h-4">
                                  Em andamento
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {p.observacoes && (
                      <p className="text-xs text-muted-foreground italic">{p.observacoes}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
