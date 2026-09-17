import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trophy, Medal, Crown, Flame, Target, Dumbbell, Droplets, Utensils } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useAdminRankingData, RankingAluno } from "@/hooks/useAdminRankingData";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

const ALL_METRICAS: Record<string, { label: string; suffix: string }> = {
  pontuacao_geral: { label: "Pontuação Geral", suffix: " pts" },
  engajamento: { label: "Engajamento", suffix: " pts" },
  performance: { label: "Performance", suffix: " pts" },
  km_corridos: { label: "KM Total", suffix: " km" },
  km_natacao: { label: "Natação (km)", suffix: " km" },
  km_ciclismo: { label: "Ciclismo (km)", suffix: " km" },
  km_corrida: { label: "Corrida (km)", suffix: " km" },
  treinos: { label: "Treinos Realizados", suffix: "" },
  dieta: { label: "Média Dieta", suffix: "%" },
  modalidades: { label: "Modalidades", suffix: "" },
  gordura: { label: "Gordura (%)", suffix: "%" },
  musculo: { label: "Massa Muscular (kg)", suffix: " kg" },
};

function getMetricValue(aluno: RankingAluno, metrica: string): number {
  switch (metrica) {
    case "pontuacao_geral": return aluno.total;
    case "engajamento": return aluno.engajamento;
    case "performance": return aluno.performance;
    case "km_corridos": return aluno.kmCorridos;
    case "km_natacao": return aluno.kmNatacao;
    case "km_ciclismo": return aluno.kmCiclismo;
    case "km_corrida": return aluno.kmCorrida;
    case "treinos": return aluno.treinosRealizados;
    case "dieta": return aluno.dietaMedia;
    case "modalidades": return aluno.modalidades;
    case "gordura": return aluno.gorduraPercentual ?? 0;
    case "musculo": return aluno.musculoPercentual ?? 0;
    default: return aluno.total;
  }
}

export default function AlunoCompeticoes() {
  const { user } = useAuth();
  const now = new Date();

  const { data: competicoes = [], isLoading: loadingComp } = useQuery({
    queryKey: ["aluno-competicoes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("competicoes")
        .select("*")
        .order("data_inicio", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!user,
  });

  const { data: participacoes = [] } = useQuery({
    queryKey: ["aluno-competicao-participacoes", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("competicao_participantes" as any)
        .select("competicao_id")
        .eq("aluno_id", user!.id);
      return (data || []) as any[];
    },
    enabled: !!user,
  });

  const participacaoIds = useMemo(
    () => new Set(participacoes.map((p: any) => p.competicao_id)),
    [participacoes]
  );

  // Filter competitions the student is part of
  const minhasCompeticoes = useMemo(
    () =>
      competicoes.filter(
        (c: any) => c.para_todos || participacaoIds.has(c.id)
      ),
    [competicoes, participacaoIds]
  );

  const ativas = minhasCompeticoes.filter((c: any) => {
    const fim = new Date(c.data_fim + "T23:59:59");
    const inicio = new Date(c.data_inicio + "T00:00:00");
    return now >= inicio && now <= fim;
  });

  const encerradas = minhasCompeticoes.filter((c: any) => {
    const fim = new Date(c.data_fim + "T23:59:59");
    return now > fim;
  });

  const pendentes = minhasCompeticoes.filter((c: any) => {
    const inicio = new Date(c.data_inicio + "T00:00:00");
    return now < inicio;
  });

  if (loadingComp) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-4 p-4">
      <motion.div variants={item}>
        <h1 className="text-2xl font-bold text-primary">Competições</h1>
        <p className="text-sm text-muted-foreground">Suas competições e rankings</p>
      </motion.div>

      {/* Stats */}
      <motion.div variants={item} className="grid grid-cols-3 gap-3">
        <Card className="border-0 shadow-md">
          <CardContent className="p-3 text-center">
            <Flame className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-lg font-bold">{ativas.length}</p>
            <p className="text-[10px] text-muted-foreground">Ativas</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-3 text-center">
            <Trophy className="h-5 w-5 text-amber-500 mx-auto mb-1" />
            <p className="text-lg font-bold">{encerradas.length}</p>
            <p className="text-[10px] text-muted-foreground">Encerradas</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-3 text-center">
            <Medal className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
            <p className="text-lg font-bold">{minhasCompeticoes.length}</p>
            <p className="text-[10px] text-muted-foreground">Total</p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Active competitions */}
      {ativas.length > 0 && (
        <motion.div variants={item} className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Flame className="h-4 w-4 text-primary" />
            Competições Ativas
          </h2>
          {ativas.map((comp: any) => (
            <CompetitionCard key={comp.id} comp={comp} userId={user!.id} />
          ))}
        </motion.div>
      )}

      {/* Pending */}
      {pendentes.length > 0 && (
        <motion.div variants={item} className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
            <Medal className="h-4 w-4" />
            Em Breve
          </h2>
          {pendentes.map((comp: any) => (
            <Card key={comp.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-sm">{comp.titulo}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Começa em {format(new Date(comp.data_inicio), "dd/MM/yyyy", { locale: ptBR })}
                    </p>
                  </div>
                  <Badge variant="outline">Pendente</Badge>
                </div>
                {comp.descricao && (
                  <p className="text-xs text-muted-foreground mt-2">{comp.descricao}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </motion.div>
      )}

      {/* Ended */}
      {encerradas.length > 0 && (
        <motion.div variants={item} className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
            <Trophy className="h-4 w-4" />
            Encerradas
          </h2>
          {encerradas.map((comp: any) => (
            <CompetitionCard key={comp.id} comp={comp} userId={user!.id} />
          ))}
        </motion.div>
      )}

      {minhasCompeticoes.length === 0 && (
        <motion.div variants={item}>
          <Card className="border-0 shadow-md">
            <CardContent className="p-8 text-center">
              <Trophy className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nenhuma competição disponível</p>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}

function CompetitionCard({ comp, userId }: { comp: any; userId: string }) {
  const now = new Date();
  const inicio = new Date(comp.data_inicio + "T00:00:00");
  const fim = new Date(comp.data_fim + "T23:59:59");
  const isAtiva = now >= inicio && now <= fim;
  const isEncerrada = now > fim;

  // Use the competition month for ranking data
  const compMonth = inicio.getMonth();
  const compYear = inicio.getFullYear();
  const { rankings, isLoading } = useAdminRankingData(compYear, compMonth);

  // Filter rankings by participants if not para_todos
  const { data: compParticipantes = [] } = useQuery({
    queryKey: ["comp-participantes", comp.id],
    queryFn: async () => {
      if (comp.para_todos) return [];
      const { data } = await supabase
        .from("competicao_participantes" as any)
        .select("aluno_id")
        .eq("competicao_id", comp.id);
      return (data || []) as any[];
    },
    enabled: !comp.para_todos,
  });

  const participantIds = useMemo(() => {
    if (comp.para_todos) return null;
    return new Set(compParticipantes.map((p: any) => p.aluno_id));
  }, [comp.para_todos, compParticipantes]);

  const filteredRankings = useMemo(() => {
    if (!participantIds) return rankings;
    return rankings.filter((r) => participantIds.has(r.userId));
  }, [rankings, participantIds]);

  const sorted = useMemo(
    () => [...filteredRankings].sort((a, b) => getMetricValue(b, comp.metrica) - getMetricValue(a, comp.metrica)),
    [filteredRankings, comp.metrica]
  );

  const myRank = sorted.findIndex((r) => r.userId === userId) + 1;
  const myData = sorted.find((r) => r.userId === userId);
  const myValue = myData ? getMetricValue(myData, comp.metrica) : 0;
  const metricInfo = ALL_METRICAS[comp.metrica] || { label: comp.metrica, suffix: "" };

  return (
    <Card className={cn("border-0 shadow-md", isAtiva && "ring-2 ring-primary/20")}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{comp.titulo}</CardTitle>
              <Badge variant={isAtiva ? "default" : "secondary"}>
                {isAtiva ? "Ativa" : "Encerrada"}
              </Badge>
            </div>
            {comp.descricao && <p className="text-xs text-muted-foreground mt-1">{comp.descricao}</p>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>📅 {format(inicio, "dd/MM", { locale: ptBR })} - {format(fim, "dd/MM", { locale: ptBR })}</span>
          <Badge variant="outline" className="text-xs">{metricInfo.label}</Badge>
        </div>

        {/* My performance card */}
        {myData && (
          <Card className="border bg-primary/5 border-primary/20">
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                  myRank === 1 ? "bg-yellow-500 text-yellow-950" :
                  myRank === 2 ? "bg-gray-400 text-white" :
                  myRank === 3 ? "bg-amber-700 text-white" :
                  "bg-primary text-primary-foreground"
                )}>
                  {myRank}°
                </div>
                <div>
                  <p className="text-xs font-medium">Sua posição</p>
                  <p className="text-lg font-bold text-primary">
                    {["km_corridos", "km_natacao", "km_ciclismo", "km_corrida"].includes(comp.metrica) ? myValue.toFixed(1) : myValue}
                    {metricInfo.suffix}
                  </p>
                </div>
              </div>
              {myRank === 1 && <Crown className="h-6 w-6 text-yellow-500" />}
            </CardContent>
          </Card>
        )}

        {/* Ranking list */}
        {isLoading ? (
          <p className="text-xs text-muted-foreground text-center py-4">Calculando ranking...</p>
        ) : (
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {sorted.map((aluno, idx) => {
              const rank = idx + 1;
              const value = getMetricValue(aluno, comp.metrica);
              const isMe = aluno.userId === userId;
              return (
                <div
                  key={aluno.userId}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm",
                    isMe ? "bg-primary/10 ring-1 ring-primary/30" :
                    rank === 1 ? "bg-yellow-500/10" :
                    rank <= 3 ? "bg-muted/50" :
                    "bg-muted/20"
                  )}
                >
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                    rank === 1 ? "bg-yellow-500 text-yellow-950" :
                    rank === 2 ? "bg-gray-400 text-white" :
                    rank === 3 ? "bg-amber-700 text-white" :
                    "bg-muted text-muted-foreground"
                  )}>
                    {rank}
                  </div>
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={aluno.avatarUrl || undefined} />
                    <AvatarFallback className="text-[10px]">{aluno.nome.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-xs truncate", isMe && "font-semibold")}>
                      {aluno.nome.split(" ").slice(0, 2).join(" ")}
                      {isMe && " (você)"}
                    </p>
                  </div>
                  <span className={cn("text-xs font-bold", rank <= 3 ? "text-primary" : "text-foreground")}>
                    {["km_corridos", "km_natacao", "km_ciclismo", "km_corrida"].includes(comp.metrica) ? value.toFixed(1) : value}
                    {metricInfo.suffix}
                  </span>
                </div>
              );
            })}
            {sorted.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhum participante encontrado</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
