import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft,
  ChevronRight,
  Star,
  Flame,
  Heart,
  Target,
  Sparkles,
  Dumbbell,
  UtensilsCrossed,
  Droplets,
  Trophy,
  Wine,
  MessageSquare,
  Calendar,
  TrendingUp,
  Award,
  Zap,
  Scale,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { usePontuacaoMensal } from "@/hooks/usePontuacaoMensal";
import { useMediaTurma } from "@/hooks/useMediaTurma";
import { Users } from "lucide-react";

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function ScoreRing({ value, max, size = 120, label, color }: { value: number; max: number; size?: number; label: string; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  const radius = (size - 12) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
          <motion.circle
            cx={size / 2} cy={size / 2} r={radius} fill="none"
            stroke={color} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            className="text-2xl font-bold text-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            {value}
          </motion.span>
          <span className="text-[10px] text-muted-foreground">/{max}</span>
        </div>
      </div>
      <span className="text-xs font-semibold text-foreground">{label}</span>
    </div>
  );
}

interface ScoreItemProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  max: number;
  detail?: string;
}

function ScoreItem({ icon, label, value, max, detail }: ScoreItemProps) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="shrink-0 text-primary">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-foreground truncate">{label}</span>
          <span className="text-sm font-bold text-foreground shrink-0 ml-2">{value}/{max}</span>
        </div>
        <Progress value={pct} className="h-2" />
        {detail && <p className="text-[10px] text-muted-foreground mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

export default function AlunoPontuacao() {
  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(now.getMonth());
  const [currentYear, setCurrentYear] = useState(now.getFullYear());

  const pontuacao = usePontuacaoMensal(currentYear, currentMonth);
  const mediaTurma = useMediaTurma(
    currentYear, currentMonth,
    pontuacao.engajamentoTotal, pontuacao.performanceTotal,
    pontuacao.totalGeral, pontuacao.isLoading
  );

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear((y) => y - 1); }
    else setCurrentMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear((y) => y + 1); }
    else setCurrentMonth((m) => m + 1);
  };

  const getScoreLevel = (total: number) => {
    if (total >= 180) return { label: "Lendário", emoji: "🏆", color: "text-chart-4" };
    if (total >= 150) return { label: "Excelente", emoji: "⭐", color: "text-chart-2" };
    if (total >= 120) return { label: "Muito Bom", emoji: "💪", color: "text-primary" };
    if (total >= 80) return { label: "Bom", emoji: "👍", color: "text-chart-1" };
    if (total >= 40) return { label: "Em Evolução", emoji: "📈", color: "text-chart-5" };
    return { label: "Começando", emoji: "🌱", color: "text-muted-foreground" };
  };

  const level = getScoreLevel(pontuacao.totalGeral);

  return (
    <div className="space-y-4 pb-24 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Award className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
          Minha Pontuação
        </h1>
      </div>

      {/* Month Nav */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={prevMonth}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="text-center">
              <p className="text-sm font-semibold text-primary">
                {MONTH_NAMES[currentMonth]} {currentYear}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={nextMonth}>
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${currentMonth}-${currentYear}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="space-y-4"
        >
          {/* Total Score */}
          <Card className="overflow-hidden">
            <CardContent className="py-6">
              <div className="flex items-center justify-center gap-6 sm:gap-10">
                <ScoreRing value={pontuacao.engajamentoTotal} max={100} label="Engajamento" color="hsl(var(--primary))" />
                <div className="flex flex-col items-center gap-1">
                  <motion.p
                    className="text-4xl font-bold text-foreground"
                    initial={{ scale: 0.5 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200 }}
                  >
                    {pontuacao.totalGeral}
                  </motion.p>
                  <p className="text-xs text-muted-foreground">/200</p>
                  <Badge className={`${level.color} mt-1`} variant="outline">
                    {level.emoji} {level.label}
                  </Badge>
                </div>
                <ScoreRing value={pontuacao.performanceTotal} max={100} label="Performance" color="hsl(var(--chart-2))" />
              </div>
              <Progress
                value={(pontuacao.totalGeral / 200) * 100}
                className="mt-4 h-2.5 [&>div]:bg-gradient-to-r [&>div]:from-primary [&>div]:via-chart-4 [&>div]:to-chart-2"
              />
            </CardContent>
          </Card>

          {/* Comparação com a Turma */}
          {mediaTurma.totalAlunos > 0 && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Comparação com a Turma</span>
                  <Badge variant="outline" className="ml-auto text-[10px]">
                    {mediaTurma.totalAlunos} aluno{mediaTurma.totalAlunos !== 1 ? "s" : ""}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {/* Engajamento */}
                  <div className="text-center space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium">Engajamento</p>
                    <p className="text-lg font-bold text-foreground">{pontuacao.engajamentoTotal}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Turma: <span className="font-semibold">{mediaTurma.mediaEngajamento}</span>
                    </p>
                    <div className={`text-[10px] font-semibold ${pontuacao.engajamentoTotal >= mediaTurma.mediaEngajamento ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {pontuacao.engajamentoTotal >= mediaTurma.mediaEngajamento ? "▲ Acima" : "▼ Abaixo"}
                    </div>
                  </div>

                  {/* Total */}
                  <div className="text-center space-y-1 border-x border-border px-2">
                    <p className="text-[10px] text-muted-foreground font-medium">Total</p>
                    <p className="text-lg font-bold text-primary">{pontuacao.totalGeral}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Turma: <span className="font-semibold">{mediaTurma.mediaTotal}</span>
                    </p>
                    <div className={`text-[10px] font-semibold ${pontuacao.totalGeral >= mediaTurma.mediaTotal ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {pontuacao.totalGeral >= mediaTurma.mediaTotal ? "▲ Acima" : "▼ Abaixo"}
                    </div>
                  </div>

                  {/* Performance */}
                  <div className="text-center space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium">Performance</p>
                    <p className="text-lg font-bold text-foreground">{pontuacao.performanceTotal}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Turma: <span className="font-semibold">{mediaTurma.mediaPerformance}</span>
                    </p>
                    <div className={`text-[10px] font-semibold ${pontuacao.performanceTotal >= mediaTurma.mediaPerformance ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {pontuacao.performanceTotal >= mediaTurma.mediaPerformance ? "▲ Acima" : "▼ Abaixo"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Engagement Breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Engajamento
                <Badge variant="outline" className="ml-auto">{pontuacao.engajamentoTotal}/100</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <ScoreItem
                icon={<Heart className="h-4 w-4" />}
                label="Dedicação Diária"
                value={pontuacao.dedicacaoDiaria.total}
                max={25}
                detail={`${pontuacao.dedicacaoDiaria.base} dias + ${pontuacao.dedicacaoDiaria.bonus} bônus constância`}
              />
              <ScoreItem
                icon={<TrendingUp className="h-4 w-4" />}
                label="Progresso Semanal"
                value={pontuacao.progressoSemanal.total}
                max={15}
                detail={`${pontuacao.progressoSemanal.base} semanas + ${pontuacao.progressoSemanal.bonus} bônus`}
              />
              <ScoreItem
                icon={<Target className="h-4 w-4" />}
                label="Objetivos"
                value={pontuacao.objetivos.total}
                max={10}
              />
              <ScoreItem
                icon={<Sparkles className="h-4 w-4" />}
                label="Valores"
                value={pontuacao.valores.total}
                max={10}
              />
              <ScoreItem
                icon={<Star className="h-4 w-4" />}
                label="Compromissos Criados"
                value={pontuacao.compromissosCriados.total}
                max={15}
                detail={`${pontuacao.compromissosCriados.base} base + ${pontuacao.compromissosCriados.bonus} bônus`}
              />
              <ScoreItem
                icon={<MessageSquare className="h-4 w-4" />}
                label="Feed"
                value={pontuacao.feed.total}
                max={5}
              />
              <ScoreItem
                icon={<Calendar className="h-4 w-4" />}
                label="Calendário da Dieta"
                value={pontuacao.calendarioDieta.total}
                max={20}
              />
            </CardContent>
          </Card>

          {/* Performance Breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Flame className="h-4 w-4 text-chart-2" />
                Performance
                <Badge variant="outline" className="ml-auto bg-chart-2/10 text-chart-2 border-chart-2/30">
                  {pontuacao.performanceTotal}/100
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <ScoreItem
                icon={<Dumbbell className="h-4 w-4" />}
                label="Meta de Treino Semanal"
                value={pontuacao.metaTreino.total}
                max={15}
                detail={`${pontuacao.metaTreino.base} semanas batidas + ${pontuacao.metaTreino.bonus} bônus`}
              />
              <ScoreItem
                icon={<UtensilsCrossed className="h-4 w-4" />}
                label="Dieta Semanal ≥80%"
                value={pontuacao.dietaSemanal.total}
                max={15}
                detail={`${pontuacao.dietaSemanal.base} semanas + ${pontuacao.dietaSemanal.bonus} bônus`}
              />
              <ScoreItem
                icon={<Scale className="h-4 w-4" />}
                label="Metas do Mês (Corpo)"
                value={pontuacao.metasMes.total}
                max={25}
                detail={`${pontuacao.metasMes.metasBatidas} de 3 metas batidas`}
              />
              <ScoreItem
                icon={<Award className="h-4 w-4" />}
                label="Conquista Semanal"
                value={pontuacao.conquistaSemanal.total}
                max={10}
                detail={`${pontuacao.conquistaSemanal.base} semanas + ${pontuacao.conquistaSemanal.bonus} bônus`}
              />
              <ScoreItem
                icon={<Star className="h-4 w-4" />}
                label="Compromisso Cumprido"
                value={pontuacao.compromissoCumprido.total}
                max={10}
                detail={`${pontuacao.compromissoCumprido.base} semanas + ${pontuacao.compromissoCumprido.bonus} bônus`}
              />
              <ScoreItem
                icon={<Droplets className="h-4 w-4" />}
                label="Água ≥1.5L/dia"
                value={pontuacao.agua.total}
                max={5}
              />
              <ScoreItem
                icon={<Trophy className="h-4 w-4" />}
                label="Desafios"
                value={pontuacao.desafios.total}
                max={20}
              />
              <ScoreItem
                icon={<Target className="h-4 w-4" />}
                label="Modalidades"
                value={pontuacao.modalidades.total}
                max={5}
              />
              {pontuacao.penalidade.total > 0 && (
                <div className="flex items-center gap-3 py-2">
                  <Wine className="h-4 w-4 text-destructive shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-destructive">Penalidade Álcool</span>
                      <span className="text-sm font-bold text-destructive">-{pontuacao.penalidade.total}</span>
                    </div>
                    <p className="text-[10px] text-destructive/70">{pontuacao.penalidade.diasAlcool} dia(s) com álcool × -5</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Legend */}
          <Card>
            <CardContent className="py-3">
              <p className="text-xs text-muted-foreground text-center">
                🌱 0-39 Começando • 📈 40-79 Em Evolução • 👍 80-119 Bom
              </p>
              <p className="text-xs text-muted-foreground text-center mt-1">
                💪 120-149 Muito Bom • ⭐ 150-179 Excelente • 🏆 180+ Lendário
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
