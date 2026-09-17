import { useState, useMemo, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FileText,
  Download,
  Eye,
  UtensilsCrossed,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Droplets,
  TrendingUp,
  Candy,
  Wine,
  MessageCircle,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  addMonths,
  subMonths,
  isToday,
  isSameMonth,
  startOfWeek,
  endOfWeek,
  isSameDay,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { sendChatPush } from "@/lib/sendChatPush";

const SACIEDADE_OPTIONS = [
  { value: "sem_fome", label: "Bem saciado, sem fome", emoji: "😊" },
  { value: "fome_leve", label: "Fome leve, controlável", emoji: "😐" },
  { value: "fome_moderada", label: "Fome moderada", emoji: "😕" },
  { value: "muita_fome", label: "Muita fome", emoji: "😫" },
];

const FOME_PERIODOS = ["Manhã", "Tarde", "Noite"] as const;

export default function AlunoDieta() {
  const [mensagemTexto, setMensagemTexto] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [adesaoPercentual, setAdesaoPercentual] = useState(50);
  const [consumiuDoce, setConsumiuDoce] = useState(false);
  const [consumiuAlcool, setConsumiuAlcool] = useState(false);
  const [aguaMl, setAguaMl] = useState(0);
  const [nivelSaciedade, setNivelSaciedade] = useState("");
  const [fomeManha, setFomeManha] = useState(false);
  const [fomeTarde, setFomeTarde] = useState(false);
  const [fomeNoite, setFomeNoite] = useState(false);
  const [observacoes, setObservacoes] = useState("");

  const { data: dietas = [], isLoading } = useQuery({
    queryKey: ["aluno-dietas", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("dietas")
        .select("*")
        .eq("aluno_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const dietaAtual = dietas[0];

  // Fetch adherence records for current month
  const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");

  const { data: adesoes = [] } = useQuery({
    queryKey: ["dieta-adesao", user?.id, monthStart, monthEnd],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("dieta_adesao" as any)
        .select("*")
        .eq("aluno_id", user.id)
        .gte("data", monthStart)
        .lte("data", monthEnd);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!user?.id,
  });

  // Calculate weekly stats
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 0 });
  const weekAdesoes = adesoes.filter((a: any) => {
    const d = new Date(a.data);
    return d >= weekStart && d <= weekEnd;
  });

  const weekDoces = weekAdesoes.filter((a: any) => a.consumiu_doce).length;
  const weekAlcool = weekAdesoes.filter((a: any) => a.consumiu_alcool).length;
  const weekAguaTotal = weekAdesoes.reduce((sum: number, a: any) => sum + (a.agua_ml || 0), 0);
  const weekAguaMedia = weekAdesoes.length > 0 ? Math.round(weekAguaTotal / weekAdesoes.length) : 0;

  // Weekly saciedade stats
  const weekSaciedadeOk = weekAdesoes.filter((a: any) => a.nivel_saciedade === "sem_fome").length;
  const weekSaciedadeLeve = weekAdesoes.filter((a: any) => a.nivel_saciedade === "fome_leve").length;
  const weekSaciedadeModerada = weekAdesoes.filter((a: any) => a.nivel_saciedade === "fome_moderada").length;
  const weekSaciedadeMuita = weekAdesoes.filter((a: any) => a.nivel_saciedade === "muita_fome").length;
  const weekFomeManha = weekAdesoes.filter((a: any) => a.fome_manha).length;
  const weekFomeTarde = weekAdesoes.filter((a: any) => a.fome_tarde).length;
  const weekFomeNoite = weekAdesoes.filter((a: any) => a.fome_noite).length;

  // Monthly stats
  const monthAdesoes = adesoes;
  const monthMedia = monthAdesoes.length > 0
    ? Math.round(monthAdesoes.reduce((sum: number, a: any) => sum + (a.adesao_percentual || 0), 0) / monthAdesoes.length)
    : 0;
  const monthDiasRegistrados = monthAdesoes.length;
  const monthDias100 = monthAdesoes.filter((a: any) => a.adesao_percentual === 100).length;

  const monthDoces = monthAdesoes.filter((a: any) => a.consumiu_doce).length;
  const monthAlcool = monthAdesoes.filter((a: any) => a.consumiu_alcool).length;
  const monthAguaTotal = monthAdesoes.reduce((sum: number, a: any) => sum + (a.agua_ml || 0), 0);
  const monthAguaMedia = monthAdesoes.length > 0 ? Math.round(monthAguaTotal / monthAdesoes.length) : 0;

  // Calendar days
  const calendarDays = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start, end });
    const startPadding = getDay(start);
    return { days, startPadding };
  }, [currentMonth]);

  const getAdesaoForDate = (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    return adesoes.find((a: any) => a.data === dateStr);
  };

  const getColorForAdesao = (pct: number) => {
    if (pct >= 80) return "bg-emerald-500 text-white";
    if (pct >= 50) return "bg-primary/80 text-primary-foreground";
    if (pct >= 30) return "bg-orange-400 text-white";
    return "bg-red-400 text-white";
  };

  const openAdesaoDialog = (date: Date) => {
    setSelectedDate(date);
    const existing = getAdesaoForDate(date);
    if (existing) {
      setAdesaoPercentual(existing.adesao_percentual || 0);
      setConsumiuDoce(existing.consumiu_doce || false);
      setConsumiuAlcool(existing.consumiu_alcool || false);
      setAguaMl(existing.agua_ml || 0);
      setNivelSaciedade(existing.nivel_saciedade || "");
      setFomeManha(existing.fome_manha || false);
      setFomeTarde(existing.fome_tarde || false);
      setFomeNoite(existing.fome_noite || false);
      setObservacoes(existing.observacoes || "");
    } else {
      setAdesaoPercentual(50);
      setConsumiuDoce(false);
      setConsumiuAlcool(false);
      setAguaMl(0);
      setNivelSaciedade("");
      setFomeManha(false);
      setFomeTarde(false);
      setFomeNoite(false);
      setObservacoes("");
    }
    setDialogOpen(true);
  };

  const saveAdesao = useMutation({
    mutationFn: async () => {
      if (!user?.id || !selectedDate || !dietaAtual) return;
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      const existing = getAdesaoForDate(selectedDate);

      const payload = {
        aluno_id: user.id,
        dieta_id: dietaAtual.id,
        data: dateStr,
        adesao_percentual: adesaoPercentual,
        consumiu_doce: consumiuDoce,
        consumiu_alcool: consumiuAlcool,
        agua_ml: aguaMl,
        nivel_saciedade: nivelSaciedade || null,
        fome_manha: fomeManha,
        fome_tarde: fomeTarde,
        fome_noite: fomeNoite,
        observacoes: observacoes || null,
      };

      if (existing) {
        const { error } = await supabase
          .from("dieta_adesao" as any)
          .update(payload as any)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("dieta_adesao" as any)
          .insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dieta-adesao"] });
      toast({ title: "Adesão registrada!" });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  // Messages query
  const { data: mensagens = [] } = useQuery({
    queryKey: ["mensagens-dieta", user?.id, dietaAtual?.id],
    queryFn: async () => {
      if (!user?.id || !dietaAtual?.id) return [];
      const { data, error } = await supabase
        .from("mensagens_dieta" as any)
        .select("*")
        .eq("dieta_id", dietaAtual.id)
        .eq("aluno_id", user.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!user?.id && !!dietaAtual?.id,
  });

  // Marca mensagens da nutricionista como lidas ao visualizar a tela
  useEffect(() => {
    if (!user?.id) return;
    const hasUnread = mensagens.some(
      (m: any) => m.remetente_tipo === "nutricionista" && !m.lida
    );
    if (!hasUnread) return;
    (async () => {
      await supabase
        .from("mensagens_dieta" as any)
        .update({ lida: true })
        .eq("aluno_id", user.id)
        .eq("remetente_tipo", "nutricionista")
        .eq("lida", false);
      queryClient.invalidateQueries({ queryKey: ["mensagens-dieta"] });
      queryClient.invalidateQueries({ queryKey: ["aluno-msgs-dieta", user.id] });
    })();
  }, [user?.id, mensagens, queryClient]);

  const sendMensagem = useMutation({
    mutationFn: async () => {
      if (!user?.id || !dietaAtual?.id || !mensagemTexto.trim()) return;
      const { error } = await supabase
        .from("mensagens_dieta" as any)
        .insert({
          dieta_id: dietaAtual.id,
          aluno_id: user.id,
          remetente_id: user.id,
          remetente_tipo: 'aluno',
          mensagem: mensagemTexto.trim(),
        } as any);
      if (error) throw error;
      void sendChatPush({
        recipientRole: "admin",
        title: "Nova mensagem de aluno (dieta)",
        body: mensagemTexto.trim().slice(0, 140),
        url: "/#/admin/dietas",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mensagens-dieta"] });
      setMensagemTexto("");
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  const showFomeHorario = nivelSaciedade && nivelSaciedade !== "sem_fome";

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted/50" />
        ))}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 p-4"
    >
      <div>
        <h2 className="text-xl font-bold">Minha Dieta</h2>
        <p className="text-xs text-muted-foreground">
          Acompanhe sua dieta e registre sua adesão diária
        </p>
      </div>

      {dietas.length === 0 ? (
        <Card className="border-0 shadow-md">
          <CardContent className="py-8">
            <div className="flex flex-col items-center justify-center text-center">
              <UtensilsCrossed className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                Seu plano alimentar ficará disponível aqui quando o professor enviar.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Dieta Atual */}
          {dietaAtual && (
            <Card className="border-0 shadow-md overflow-hidden">
              <div className="h-1 gradient-primary" />
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-5 w-5 text-primary" />
                  Dieta Atual
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="font-semibold">{dietaAtual.titulo}</p>
                  {(dietaAtual as any).descricao && (
                    <p className="text-sm text-muted-foreground">
                      {(dietaAtual as any).descricao}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Enviada em:{" "}
                    {format(new Date(dietaAtual.created_at), "dd/MM/yyyy", {
                      locale: ptBR,
                    })}
                  </p>
                </div>

                {dietaAtual.arquivo_url && (
                  <Button
                    className="w-full gap-2"
                    onClick={() => window.open(dietaAtual.arquivo_url!, "_blank")}
                  >
                    <Download className="h-4 w-4" />
                    Baixar Dieta (PDF)
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Calendário de Adesão */}
          <Card className="border-0 shadow-md">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="h-5 w-5 text-primary" />
                  Calendário de Adesão
                </CardTitle>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm font-medium min-w-[120px] text-center capitalize">
                    {format(currentMonth, "MMMM yyyy", { locale: ptBR })}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Week headers */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
                  <div
                    key={d}
                    className="text-center text-xs font-medium text-muted-foreground py-1"
                  >
                    {d}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: calendarDays.startPadding }).map((_, i) => (
                  <div key={`pad-${i}`} />
                ))}
                {calendarDays.days.map((day) => {
                  const adesao = getAdesaoForDate(day);
                  const today = isToday(day);
                  const future = day > new Date();

                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => !future && dietaAtual && openAdesaoDialog(day)}
                      disabled={future || !dietaAtual}
                      className={cn(
                        "relative flex flex-col items-center justify-center rounded-lg p-1 min-h-[44px] text-xs transition-all",
                        today && !adesao && "ring-2 ring-primary/50",
                        future
                          ? "opacity-30 cursor-default"
                          : "hover:bg-muted/50 cursor-pointer",
                        adesao && getColorForAdesao(adesao.adesao_percentual)
                      )}
                    >
                      <span className={cn("font-medium", adesao && "text-inherit")}>
                        {format(day, "d")}
                      </span>
                      {adesao && (
                        <span className="text-[10px] leading-none font-bold">
                          {adesao.adesao_percentual}%
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground justify-center flex-wrap">
                <div className="flex items-center gap-1">
                  <div className="h-3 w-3 rounded bg-emerald-500" />
                  <span>≥80%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-3 w-3 rounded bg-primary/80" />
                  <span>≥50%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-3 w-3 rounded bg-orange-400" />
                  <span>≥30%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-3 w-3 rounded bg-red-400" />
                  <span>&lt;30%</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Esta Semana */}
          <Card className="border-0 shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-5 w-5 text-primary" />
                Esta Semana
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col items-center rounded-lg bg-muted/40 p-3">
                  <Candy className="h-5 w-5 text-pink-500 mb-1" />
                  <span className="text-xs text-muted-foreground">Doces</span>
                  <span className="text-lg font-bold text-pink-500">{weekDoces}x</span>
                </div>
                <div className="flex flex-col items-center rounded-lg bg-muted/40 p-3">
                  <Wine className="h-5 w-5 text-purple-500 mb-1" />
                  <span className="text-xs text-muted-foreground">Álcool</span>
                  <span className="text-lg font-bold text-purple-500">{weekAlcool}x</span>
                </div>
                <div className="flex flex-col items-center rounded-lg bg-muted/40 p-3">
                  <Droplets className="h-5 w-5 text-blue-500 mb-1" />
                  <span className="text-xs text-muted-foreground">Água (média)</span>
                  <span className="text-lg font-bold text-blue-500">
                    {weekAguaMedia > 0 ? `${weekAguaMedia}ml` : "—"}
                  </span>
                </div>
              </div>

              {/* Saciedade stats */}
              {weekAdesoes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Saciedade</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-2">
                      <span className="text-xs">😊 Saciado</span>
                      <span className="text-sm font-bold text-emerald-600">{weekSaciedadeOk}d</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-blue-500/10 px-3 py-2">
                      <span className="text-xs">😐 Fome leve</span>
                      <span className="text-sm font-bold text-blue-600">{weekSaciedadeLeve}d</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-orange-500/10 px-3 py-2">
                      <span className="text-xs">😕 Moderada</span>
                      <span className="text-sm font-bold text-orange-600">{weekSaciedadeModerada}d</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-red-500/10 px-3 py-2">
                      <span className="text-xs">😫 Muita fome</span>
                      <span className="text-sm font-bold text-red-600">{weekSaciedadeMuita}d</span>
                    </div>
                  </div>

                  {(weekFomeManha > 0 || weekFomeTarde > 0 || weekFomeNoite > 0) && (
                    <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                      <span className="font-medium">Fome:</span>
                      {weekFomeManha > 0 && <span>☀️ Manhã {weekFomeManha}x</span>}
                      {weekFomeTarde > 0 && <span>🌤️ Tarde {weekFomeTarde}x</span>}
                      {weekFomeNoite > 0 && <span>🌙 Noite {weekFomeNoite}x</span>}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Este Mês */}
          <Card className="border-0 shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-5 w-5 text-emerald-500" />
                Este Mês
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col items-center rounded-lg bg-muted/40 p-3">
                  <span className="text-2xl font-bold text-primary">{monthMedia}%</span>
                  <span className="text-xs text-muted-foreground">Média</span>
                </div>
                <div className="flex flex-col items-center rounded-lg bg-muted/40 p-3">
                  <span className="text-2xl font-bold text-foreground">{monthDiasRegistrados}</span>
                  <span className="text-xs text-muted-foreground">Dias Registrados</span>
                </div>
                <div className="flex flex-col items-center rounded-lg bg-muted/40 p-3">
                  <span className="text-2xl font-bold text-emerald-500">{monthDias100}</span>
                  <span className="text-xs text-muted-foreground">Dias 100%</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col items-center rounded-lg bg-muted/40 p-3">
                  <Candy className="h-5 w-5 text-pink-500 mb-1" />
                  <span className="text-xs text-muted-foreground">Doces</span>
                  <span className="text-lg font-bold text-pink-500">{monthDoces}x</span>
                </div>
                <div className="flex flex-col items-center rounded-lg bg-muted/40 p-3">
                  <Wine className="h-5 w-5 text-purple-500 mb-1" />
                  <span className="text-xs text-muted-foreground">Álcool</span>
                  <span className="text-lg font-bold text-purple-500">{monthAlcool}x</span>
                </div>
                <div className="flex flex-col items-center rounded-lg bg-muted/40 p-3">
                  <Droplets className="h-5 w-5 text-blue-500 mb-1" />
                  <span className="text-xs text-muted-foreground">Água (média)</span>
                  <span className="text-lg font-bold text-blue-500">
                    {monthAguaMedia > 0 ? `${monthAguaMedia}ml` : "—"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Dietas anteriores */}
          {dietas.length > 1 && (
            <Card className="border-0 shadow-md">
              <CardHeader>
                <CardTitle className="text-base text-muted-foreground">
                  Planos Anteriores
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {dietas.slice(1).map((dieta) => (
                  <div
                    key={dieta.id}
                    className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5 gap-2"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{dieta.titulo}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(dieta.created_at), "dd/MM/yyyy", {
                            locale: ptBR,
                          })}
                        </p>
                      </div>
                    </div>
                    {dieta.arquivo_url && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => window.open(dieta.arquivo_url!, "_blank")}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Mensagens para Nutricionista */}
          {dietaAtual && (
            <Card className="border-0 shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageCircle className="h-5 w-5 text-primary" />
                  Mensagens
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Chat area with scroll */}
                <div className="h-[280px] overflow-y-auto space-y-3 rounded-lg bg-muted/20 p-3">
                  {mensagens.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Envie uma mensagem para seu nutricionista sobre a dieta.
                    </p>
                  ) : (
                    mensagens.map((msg: any) => {
                      const isMine = msg.remetente_tipo === 'aluno';
                      return (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex flex-col max-w-[80%]",
                            isMine ? "ml-auto items-end" : "mr-auto items-start"
                          )}
                        >
                          <span className={cn(
                            "text-[10px] font-semibold mb-0.5 px-1",
                            isMine ? "text-primary" : "text-emerald-600"
                          )}>
                            {isMine ? "Você" : "Nutricionista"}
                          </span>
                          <div
                            className={cn(
                              "rounded-2xl px-3 py-2",
                              isMine
                                ? "bg-primary text-primary-foreground rounded-br-sm"
                                : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100 rounded-bl-sm"
                            )}
                          >
                            <p className="text-sm whitespace-pre-wrap">{msg.mensagem}</p>
                          </div>
                          <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                            {format(new Date(msg.created_at), "dd/MM HH:mm", { locale: ptBR })}
                          </span>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (mensagemTexto.trim()) sendMensagem.mutate();
                  }}
                  className="flex items-center gap-2"
                >
                  <Input
                    placeholder="Escreva sua mensagem..."
                    value={mensagemTexto}
                    onChange={(e) => setMensagemTexto(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!mensagemTexto.trim() || sendMensagem.isPending}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Adesão Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Registrar Adesão
              {selectedDate &&
                ` - ${format(selectedDate, "dd/MM/yyyy", { locale: ptBR })}`}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Adesão slider */}
            <div className="space-y-3">
              <Label>Quanto você seguiu a dieta hoje?</Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[adesaoPercentual]}
                  onValueChange={(v) => setAdesaoPercentual(v[0])}
                  min={0}
                  max={100}
                  step={10}
                  className="flex-1"
                />
                <span
                  className={cn(
                    "text-lg font-bold min-w-[52px] text-right",
                    adesaoPercentual >= 80
                      ? "text-emerald-500"
                      : adesaoPercentual >= 50
                      ? "text-primary"
                      : "text-orange-500"
                  )}
                >
                  {adesaoPercentual}%
                </span>
              </div>
            </div>

            {/* Checkboxes */}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                <Checkbox
                  checked={consumiuDoce}
                  onCheckedChange={(v) => setConsumiuDoce(v === true)}
                />
                <span className="text-sm">🍰 Consumiu doce?</span>
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                <Checkbox
                  checked={consumiuAlcool}
                  onCheckedChange={(v) => setConsumiuAlcool(v === true)}
                />
                <span className="text-sm">🍷 Consumiu álcool?</span>
              </label>
            </div>

            {/* Água */}
            <div className="space-y-2">
              <Label>Consumo de Água (ml)</Label>
              <div className="flex items-center gap-2">
                <Droplets className="h-5 w-5 text-blue-500 shrink-0" />
                <Input
                  type="number"
                  value={aguaMl || ""}
                  onChange={(e) => setAguaMl(Number(e.target.value))}
                  placeholder="0"
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground">ml</span>
              </div>
              <p className="text-xs text-muted-foreground">
                💡 Meta recomendada: 2000-3000ml por dia
              </p>
            </div>

            {/* Saciedade */}
            <div className="space-y-2">
              <Label>Nível de Saciedade</Label>
              <Select value={nivelSaciedade} onValueChange={setNivelSaciedade}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {SACIEDADE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.emoji} {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Fome horários */}
            {showFomeHorario && (
              <div className="space-y-2">
                <Label>Quando sentiu fome?</Label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex items-center gap-2 rounded-lg border border-border p-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
                    <Checkbox
                      checked={fomeManha}
                      onCheckedChange={(v) => setFomeManha(v === true)}
                    />
                    <span className="text-sm">Manhã</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-border p-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
                    <Checkbox
                      checked={fomeTarde}
                      onCheckedChange={(v) => setFomeTarde(v === true)}
                    />
                    <span className="text-sm">Tarde</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-border p-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
                    <Checkbox
                      checked={fomeNoite}
                      onCheckedChange={(v) => setFomeNoite(v === true)}
                    />
                    <span className="text-sm">Noite</span>
                  </label>
                </div>
              </div>
            )}

            {/* Observações */}
            <div className="space-y-2">
              <Label>Observações (opcional)</Label>
              <Textarea
                placeholder="Como foi seu dia? Alguma dificuldade?"
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => saveAdesao.mutate()} disabled={saveAdesao.isPending}>
              {saveAdesao.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
