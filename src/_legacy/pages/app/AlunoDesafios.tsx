import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { Trophy, Calendar, Star, CheckCircle2, Clock, Flame, XCircle, Award, PartyPopper } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

const TIPOS_EMOJI: Record<string, { emoji: string; label: string; unit: string }> = {
  sem_doce: { emoji: "🍬", label: "Sem Doce", unit: "vezes" },
  sem_alcool: { emoji: "🍺", label: "Sem Álcool", unit: "vezes" },
  consumo_agua: { emoji: "💧", label: "Consumo de Água", unit: "ml" },
  numero_treinos: { emoji: "💪", label: "Número de Treinos", unit: "treinos" },
  quilometros: { emoji: "🏃", label: "Quilômetros", unit: "km" },
  modalidades: { emoji: "🎯", label: "Modalidades", unit: "modalidades" },
  desempenho_dieta: { emoji: "🥗", label: "Desempenho na Dieta", unit: "%" },
  livre: { emoji: "⭐", label: "Desafio Livre", unit: "" },
};

export default function AlunoDesafios() {
  const { user } = useAuth();

  const { data: desafios = [] } = useQuery({
    queryKey: ["aluno-desafios", user?.id],
    queryFn: async () => {
      const { data: allDesafios } = await supabase
        .from("desafios" as any)
        .select("*")
        .order("data_fim", { ascending: false });

      if (!allDesafios) return [];

      const { data: participacoes } = await supabase
        .from("desafio_participantes" as any)
        .select("desafio_id")
        .eq("aluno_id", user!.id);

      const participacaoIds = new Set((participacoes || []).map((p: any) => p.desafio_id));

      return (allDesafios as any[]).filter(
        (d) => d.para_todos || participacaoIds.has(d.id)
      );
    },
    enabled: !!user,
  });

  const { data: progressoMap = {} } = useQuery({
    queryKey: ["aluno-desafio-progresso", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("desafio_progresso" as any)
        .select("*")
        .eq("aluno_id", user!.id);
      const map: Record<string, any> = {};
      (data || []).forEach((p: any) => {
        map[p.desafio_id] = p;
      });
      return map;
    },
    enabled: !!user,
  });

  // Fetch diet adherence data for auto-tracking
  const { data: dietaAdesao = [] } = useQuery({
    queryKey: ["aluno-dieta-adesao-desafios", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("dieta_adesao")
        .select("*")
        .eq("aluno_id", user!.id);
      return (data || []) as any[];
    },
    enabled: !!user,
  });

  // Fetch training records for auto-tracking
  const { data: registroTreino = [] } = useQuery({
    queryKey: ["aluno-registro-treino-desafios", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_treino")
        .select("*")
        .eq("aluno_id", user!.id);
      return (data || []) as any[];
    },
    enabled: !!user,
  });

  // Fetch calendar entries for modalidades
  const { data: calendarioTreino = [] } = useQuery({
    queryKey: ["aluno-calendario-desafios", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("treino_calendario")
        .select("*")
        .eq("aluno_id", user!.id);
      return (data || []) as any[];
    },
    enabled: !!user,
  });

  const calcAutoProgress = (desafio: any) => {
    const inicio = desafio.data_inicio;
    const fim = desafio.data_fim;
    const meta = desafio.meta_valor || 0;

    switch (desafio.tipo) {
      case "sem_doce": {
        const count = dietaAdesao.filter(
          (a: any) => a.data >= inicio && a.data <= fim && a.consumiu_doce
        ).length;
        return { valor: count, meta, unit: "vezes", isInverse: true };
      }
      case "sem_alcool": {
        const count = dietaAdesao.filter(
          (a: any) => a.data >= inicio && a.data <= fim && a.consumiu_alcool
        ).length;
        return { valor: count, meta, unit: "vezes", isInverse: true };
      }
      case "consumo_agua": {
        const total = dietaAdesao
          .filter((a: any) => a.data >= inicio && a.data <= fim)
          .reduce((sum: number, a: any) => sum + (a.agua_ml || 0), 0);
        return { valor: total, meta, unit: "ml" };
      }
      case "numero_treinos": {
        const count = registroTreino.filter(
          (r: any) => r.data >= inicio && r.data <= fim
        ).length;
        return { valor: count, meta, unit: "treinos" };
      }
      case "modalidades": {
        const tipos = new Set<string>();
        calendarioTreino
          .filter((c: any) => c.data >= inicio && c.data <= fim)
          .forEach((c: any) => {
            (c.tipos || []).forEach((t: string) => tipos.add(t));
          });
        return { valor: tipos.size, meta, unit: "modalidades" };
      }
      case "desempenho_dieta": {
        const entries = dietaAdesao.filter(
          (a: any) => a.data >= inicio && a.data <= fim
        );
        const avg = entries.length > 0
          ? entries.reduce((sum: number, a: any) => sum + (a.adesao_percentual || 0), 0) / entries.length
          : 0;
        return { valor: Math.round(avg), meta, unit: "%" };
      }
      default:
        return null;
    }
  };

  const now = new Date();
  const ativos = desafios.filter((d: any) => new Date(d.data_fim) >= now);
  const encerrados = desafios.filter((d: any) => new Date(d.data_fim) < now);

  // Count concluídos and pontos including auto-tracked challenges
  const { totalConcluidos, totalPontos } = (() => {
    let concluidos = 0;
    let pontos = 0;
    desafios.forEach((d: any) => {
      const progresso = progressoMap[d.id];
      const auto = calcAutoProgress(d);
      let isConcluido = progresso?.concluido || false;

      if (auto && !isConcluido) {
        const { valor, meta, isInverse } = auto as any;
        const ended = new Date(d.data_fim) < now;
        if (isInverse) {
          isConcluido = (valor <= meta) && (ended || progresso?.concluido);
        } else {
          isConcluido = meta > 0 && valor >= meta;
        }
      }

      if (isConcluido) {
        concluidos++;
        pontos += d.pontos || 0;
      }
    });
    return { totalConcluidos: concluidos, totalPontos: pontos };
  })();

  type ChallengeStatus = "cumprido" | "superado" | "falhado" | "em_andamento";

  const getChallengeStatus = (desafio: any): { status: ChallengeStatus; valor: number; meta: number; unit: string } | null => {
    const auto = calcAutoProgress(desafio);
    if (!auto) return null;
    const { valor, meta, unit, isInverse } = auto as any;

    const ended = new Date(desafio.data_fim) < now;
    const progresso = progressoMap[desafio.id];
    const manualDone = progresso?.concluido || false;

    if (isInverse) {
      // sem_doce / sem_alcool: meta is max allowed (usually 0)
      if (valor > meta) return { status: "falhado", valor, meta, unit };
      if (ended || manualDone) return { status: "cumprido", valor, meta, unit };
      return { status: "em_andamento", valor, meta, unit };
    } else {
      // normal: reach or exceed meta
      if (meta > 0 && valor > meta) return { status: "superado", valor, meta, unit };
      if (meta > 0 && valor >= meta) return { status: "cumprido", valor, meta, unit };
      if (ended && meta > 0 && valor < meta) return { status: "falhado", valor, meta, unit };
      return { status: "em_andamento", valor, meta, unit };
    }
  };

  const motivationalMessages = {
    cumprido: [
      "Você é disciplina pura! 💪",
      "Comprometimento nota 10!",
      "Resultado de quem não desiste!",
      "Orgulho define você! 🔥",
      "Consistência é seu superpoder!",
    ],
    superado: [
      "Você foi além do esperado! 🚀",
      "Máquina! Superou todas as expectativas!",
      "Nível acima de tudo! 👏",
      "Impressionante, continue assim!",
      "Você redefiniu seus limites! 🏆",
    ],
    falhado: [
      "Não desista, o próximo é seu! 💪",
      "Cada tentativa te fortalece!",
      "Amanhã é uma nova chance! 🌅",
      "Errar faz parte, desistir não!",
      "Use isso como combustível! 🔥",
    ],
    em_andamento: [
      "Você tá no caminho certo! 🎯",
      "Continue firme, falta pouco!",
      "Cada dia conta, siga em frente! 💪",
      "Foco total, você consegue!",
      "Não pare agora! 🔥",
    ],
  };

  const getMotivation = (status: ChallengeStatus, desafioId: string) => {
    const msgs = motivationalMessages[status];
    const idx = desafioId.charCodeAt(0) % msgs.length;
    return msgs[idx];
  };

  const StatusBanner = ({ status, valor, meta, unit, isInverse, desafioId }: { status: ChallengeStatus; valor: number; meta: number; unit: string; isInverse?: boolean; desafioId: string }) => {
    const motivation = getMotivation(status, desafioId);

    if (status === "em_andamento") {
      return (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-2 p-2.5 rounded-lg border bg-primary/5 border-primary/20 text-primary"
        >
          <Flame className="h-4 w-4" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold italic">{motivation}</p>
          </div>
        </motion.div>
      );
    }

    const config = {
      cumprido: {
        icon: <CheckCircle2 className="h-4 w-4" />,
        label: "Desafio Cumprido! 🎉",
        message: isInverse ? `Você manteve ${valor} ${unit} (máx: ${meta})` : `Meta de ${meta} ${unit} atingida!`,
        classes: "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400",
      },
      superado: {
        icon: <Award className="h-4 w-4" />,
        label: "Desafio Superado! 🏆",
        message: `Você alcançou ${valor} ${unit} — acima da meta de ${meta}!`,
        classes: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400",
      },
      falhado: {
        icon: <XCircle className="h-4 w-4" />,
        label: "Desafio não cumprido",
        message: isInverse
          ? `Consumiu ${valor} ${unit} (meta: máx ${meta})`
          : `Alcançou ${valor} de ${meta} ${unit}`,
        classes: "bg-destructive/10 border-destructive/30 text-destructive",
      },
    };

    const c = config[status];
    if (!c) return null;

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`flex items-center gap-2 p-2.5 rounded-lg border ${c.classes}`}
      >
        {c.icon}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold">{c.label}</p>
          <p className="text-[10px] opacity-80">{c.message}</p>
          <p className="text-[10px] font-medium italic mt-0.5">{motivation}</p>
        </div>
      </motion.div>
    );
  };

  const renderProgressInfo = (desafio: any) => {
    const auto = calcAutoProgress(desafio);
    if (!auto) return null;

    const { valor, meta, unit, isInverse } = auto as any;
    const statusInfo = getChallengeStatus(desafio);

    let percent = 0;
    let statusText = "";

    if (isInverse) {
      percent = meta === 0 ? (valor === 0 ? 100 : 0) : Math.max(0, 100 - ((valor / meta) * 100));
      statusText = `${valor} ${unit} (meta: máx ${meta})`;
    } else if (unit === "%") {
      percent = meta > 0 ? Math.min(100, (valor / meta) * 100) : 0;
      statusText = `${valor}% (meta: ${meta}%)`;
    } else {
      percent = meta > 0 ? Math.min(100, (valor / meta) * 100) : 0;
      statusText = `${valor} / ${meta} ${unit}`;
    }

    const progressColor = statusInfo?.status === "falhado"
      ? "[&>div]:bg-destructive"
      : statusInfo?.status === "superado"
        ? "[&>div]:bg-amber-500"
        : statusInfo?.status === "cumprido"
          ? "[&>div]:bg-green-500"
          : "";

    return (
      <div className="space-y-2">
        {statusInfo && (
          <StatusBanner
            status={statusInfo.status}
            valor={statusInfo.valor}
            meta={statusInfo.meta}
            unit={statusInfo.unit}
            isInverse={isInverse}
            desafioId={desafio.id}
          />
        )}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{statusText}</span>
            <span className="font-medium">{Math.round(percent)}%</span>
          </div>
          <Progress value={percent} className={`h-1.5 ${progressColor}`} />
        </div>
      </div>
    );
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="p-4 space-y-4">
      {/* Header */}
      <motion.div variants={item}>
        <h1 className="text-2xl font-bold text-primary">Desafios</h1>
        <p className="text-sm text-muted-foreground">Seus desafios e conquistas</p>
      </motion.div>

      {/* Stats */}
      <motion.div variants={item} className="grid grid-cols-3 gap-3">
        <Card className="border-0 shadow-md">
          <CardContent className="p-3 text-center">
            <Flame className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-lg font-bold">{ativos.length}</p>
            <p className="text-[10px] text-muted-foreground">Ativos</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-3 text-center">
            <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto mb-1" />
            <p className="text-lg font-bold">{totalConcluidos}</p>
            <p className="text-[10px] text-muted-foreground">Concluídos</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-md">
          <CardContent className="p-3 text-center">
            <Star className="h-5 w-5 text-amber-500 mx-auto mb-1" />
            <p className="text-lg font-bold">{totalPontos}</p>
            <p className="text-[10px] text-muted-foreground">Pontos</p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Active Challenges */}
      {ativos.length > 0 && (
        <motion.div variants={item} className="space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Flame className="h-4 w-4 text-primary" />
            Desafios Ativos
          </h2>
          {ativos.map((desafio: any) => {
            const tipoInfo = TIPOS_EMOJI[desafio.tipo] || TIPOS_EMOJI.livre;
            const progresso = progressoMap[desafio.id];
            const isDone = progresso?.concluido || false;
            const daysLeft = differenceInDays(new Date(desafio.data_fim), now);

            return (
              <motion.div key={desafio.id} variants={item}>
                <Card className={`border-0 shadow-md overflow-hidden transition-all ${isDone ? "ring-2 ring-green-500/30" : ""}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{tipoInfo.emoji}</span>
                        <div>
                          <h3 className="font-semibold text-sm">{desafio.titulo}</h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            {isDone ? (
                              <Badge className="text-[10px] bg-green-500/10 text-green-600 border-green-500/20">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Concluído
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">
                                <Clock className="h-3 w-3 mr-1" />
                                {daysLeft > 0 ? `${daysLeft} dias restantes` : "Último dia!"}
                              </Badge>
                            )}
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                              {desafio.pontos} pts
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {desafio.descricao && (
                      <p className="text-xs text-muted-foreground">{desafio.descricao}</p>
                    )}

                    {/* Auto-tracked progress */}
                    {desafio.tipo !== "livre" && renderProgressInfo(desafio)}

                    {/* Time progress for livre */}
                    {desafio.tipo === "livre" && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{format(new Date(desafio.data_inicio), "dd MMM", { locale: ptBR })}</span>
                          <span>{format(new Date(desafio.data_fim), "dd MMM", { locale: ptBR })}</span>
                        </div>
                        <Progress value={isDone ? 100 : 0} className="h-1.5" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Completed/Past Challenges */}
      {encerrados.length > 0 && (
        <motion.div variants={item} className="space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
            <Trophy className="h-4 w-4" />
            Desafios Encerrados
          </h2>
          {encerrados.map((desafio: any) => {
            const tipoInfo = TIPOS_EMOJI[desafio.tipo] || TIPOS_EMOJI.livre;
            const progresso = progressoMap[desafio.id];
            const isDone = progresso?.concluido || false;
            const statusInfo = desafio.tipo !== "livre" ? getChallengeStatus(desafio) : null;
            const isFailed = statusInfo?.status === "falhado";
            const isSuperado = statusInfo?.status === "superado";

            return (
              <Card key={desafio.id} className={`border-0 shadow-sm ${isFailed ? "opacity-60" : "opacity-75"}`}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{tipoInfo.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium truncate">{desafio.titulo}</h3>
                      <p className="text-[10px] text-muted-foreground">
                        {format(new Date(desafio.data_inicio), "dd/MM", { locale: ptBR })} - {format(new Date(desafio.data_fim), "dd/MM", { locale: ptBR })}
                      </p>
                    </div>
                    {isSuperado ? (
                      <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]">
                        <Award className="h-3 w-3 mr-1" />
                        Superado
                      </Badge>
                    ) : isDone || statusInfo?.status === "cumprido" ? (
                      <Badge className="bg-green-500/10 text-green-600 border-green-500/20 text-[10px]">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        +{desafio.pontos}pts
                      </Badge>
                    ) : isFailed ? (
                      <Badge variant="destructive" className="text-[10px]">
                        <XCircle className="h-3 w-3 mr-1" />
                        Falhou
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">Não concluído</Badge>
                    )}
                  </div>
                  {statusInfo && (
                    <StatusBanner
                      status={statusInfo.status}
                      valor={statusInfo.valor}
                      meta={statusInfo.meta}
                      unit={statusInfo.unit}
                      isInverse={desafio.tipo === "sem_doce" || desafio.tipo === "sem_alcool"}
                      desafioId={desafio.id}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </motion.div>
      )}

      {desafios.length === 0 && (
        <motion.div variants={item}>
          <Card className="border-0 shadow-md">
            <CardContent className="p-8 text-center">
              <Trophy className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nenhum desafio disponível no momento</p>
              <p className="text-xs text-muted-foreground mt-1">Novos desafios aparecerão aqui</p>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}
