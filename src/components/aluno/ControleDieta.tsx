import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { CalendarDays, ChevronLeft, ChevronRight, Droplets, TrendingUp, Candy, Wine, PartyPopper } from "lucide-react";
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
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { marcacoesDoPlano, percentualAdesao, respondidas, type Marcacoes, type RefeicaoPlano } from "@/lib/adesaoDieta";

const INCREMENTOS_AGUA_ML = [200, 300, 500];

interface DietaAdesao {
  id: string;
  data: string;
  adesao_percentual: number;
  consumiu_doce: boolean;
  consumiu_alcool: boolean;
  agua_ml: number;
  nivel_saciedade: string | null;
  fome_manha: boolean;
  fome_tarde: boolean;
  fome_noite: boolean;
  observacoes: string | null;
  refeicoes_marcadas: Marcacoes | null;
}

const SACIEDADE_OPTIONS = [
  { value: "sem_fome", label: "Bem saciado, sem fome", emoji: "😊" },
  { value: "fome_leve", label: "Fome leve, controlável", emoji: "😐" },
  { value: "fome_moderada", label: "Fome moderada", emoji: "😕" },
  { value: "muita_fome", label: "Muita fome", emoji: "😫" },
];

function getColorForAdesao(pct: number) {
  if (pct >= 80) return "bg-emerald-500 text-white";
  if (pct >= 50) return "bg-primary/80 text-primary-foreground";
  if (pct >= 30) return "bg-orange-400 text-white";
  return "bg-red-400 text-white";
}

export default function ControleDieta({ dietaId, refeicoes = [] }: { dietaId: string; refeicoes?: RefeicaoPlano[] }) {
  const { alunoId, organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [adesaoPercentual, setAdesaoPercentual] = useState(50);
  const [marcacoes, setMarcacoes] = useState<Marcacoes>({});
  // Com refeições no plano, o percentual sai das marcações; sem elas (dieta só
  // em PDF), vale o informado na régua.
  const porRefeicao = refeicoes.length > 0;
  const percentualCalculado = porRefeicao ? percentualAdesao(refeicoes, marcacoes) ?? 0 : adesaoPercentual;
  const [consumiuDoce, setConsumiuDoce] = useState(false);
  const [consumiuAlcool, setConsumiuAlcool] = useState(false);
  const [aguaMl, setAguaMl] = useState(0);
  const [nivelSaciedade, setNivelSaciedade] = useState("");
  const [fomeManha, setFomeManha] = useState(false);
  const [fomeTarde, setFomeTarde] = useState(false);
  const [fomeNoite, setFomeNoite] = useState(false);
  const [observacoes, setObservacoes] = useState("");

  const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");

  const { data: metaAguaMl = 2000 } = useQuery({
    queryKey: ["aluno-meta-agua", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("alunos").select("meta_agua_ml").eq("id", alunoId!).single();
      if (error) throw error;
      return data.meta_agua_ml;
    },
    enabled: !!alunoId,
  });

  const { data: adesoes = [] } = useQuery({
    queryKey: ["dieta-adesao", alunoId, monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dieta_adesao")
        .select("id, data, adesao_percentual, consumiu_doce, consumiu_alcool, agua_ml, nivel_saciedade, fome_manha, fome_tarde, fome_noite, observacoes, refeicoes_marcadas")
        .eq("aluno_id", alunoId!)
        .gte("data", monthStart)
        .lte("data", monthEnd);
      if (error) throw error;
      return (data ?? []) as unknown as DietaAdesao[];
    },
    enabled: !!alunoId,
  });

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 0 });
  const weekAdesoes = adesoes.filter((a) => {
    const d = new Date(a.data);
    return d >= weekStart && d <= weekEnd;
  });

  const weekDoces = weekAdesoes.filter((a) => a.consumiu_doce).length;
  const weekAlcool = weekAdesoes.filter((a) => a.consumiu_alcool).length;
  const weekAguaMedia = weekAdesoes.length > 0 ? Math.round(weekAdesoes.reduce((s, a) => s + a.agua_ml, 0) / weekAdesoes.length) : 0;
  const weekSaciedadeOk = weekAdesoes.filter((a) => a.nivel_saciedade === "sem_fome").length;
  const weekSaciedadeLeve = weekAdesoes.filter((a) => a.nivel_saciedade === "fome_leve").length;
  const weekSaciedadeModerada = weekAdesoes.filter((a) => a.nivel_saciedade === "fome_moderada").length;
  const weekSaciedadeMuita = weekAdesoes.filter((a) => a.nivel_saciedade === "muita_fome").length;

  const monthMedia = adesoes.length > 0 ? Math.round(adesoes.reduce((s, a) => s + a.adesao_percentual, 0) / adesoes.length) : 0;
  const monthDiasRegistrados = adesoes.length;
  const monthDias100 = adesoes.filter((a) => a.adesao_percentual === 100).length;
  const monthDoces = adesoes.filter((a) => a.consumiu_doce).length;
  const monthAlcool = adesoes.filter((a) => a.consumiu_alcool).length;
  const monthAguaMedia = adesoes.length > 0 ? Math.round(adesoes.reduce((s, a) => s + a.agua_ml, 0) / adesoes.length) : 0;

  const calendarDays = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return { days: eachDayOfInterval({ start, end }), startPadding: getDay(start) };
  }, [currentMonth]);

  const getAdesaoForDate = (date: Date) => adesoes.find((a) => a.data === format(date, "yyyy-MM-dd"));

  const openAdesaoDialog = (date: Date) => {
    setSelectedDate(date);
    const existing = getAdesaoForDate(date);
    setAdesaoPercentual(existing?.adesao_percentual ?? 50);
    setMarcacoes(marcacoesDoPlano(refeicoes, existing?.refeicoes_marcadas));
    setConsumiuDoce(existing?.consumiu_doce ?? false);
    setConsumiuAlcool(existing?.consumiu_alcool ?? false);
    setAguaMl(existing?.agua_ml ?? 0);
    setNivelSaciedade(existing?.nivel_saciedade ?? "");
    setFomeManha(existing?.fome_manha ?? false);
    setFomeTarde(existing?.fome_tarde ?? false);
    setFomeNoite(existing?.fome_noite ?? false);
    setObservacoes(existing?.observacoes ?? "");
    setDialogOpen(true);
  };

  const saveAdesao = useMutation({
    mutationFn: async () => {
      if (!alunoId || !organization || !selectedDate) throw new Error("Cadastro de aluno não encontrado");
      const { error } = await supabase.from("dieta_adesao").upsert(
        {
          organization_id: organization.id,
          aluno_id: alunoId,
          dieta_id: dietaId,
          data: format(selectedDate, "yyyy-MM-dd"),
          adesao_percentual: percentualCalculado,
          refeicoes_marcadas: porRefeicao ? marcacoesDoPlano(refeicoes, marcacoes) : {},
          consumiu_doce: consumiuDoce,
          consumiu_alcool: consumiuAlcool,
          agua_ml: aguaMl,
          nivel_saciedade: nivelSaciedade || null,
          fome_manha: fomeManha,
          fome_tarde: fomeTarde,
          fome_noite: fomeNoite,
          observacoes: observacoes || null,
        },
        { onConflict: "aluno_id,data" }
      );
      if (error) throw error;

      // A água também vai para `registro_habito`, que é de onde a pontuação de
      // engajamento e o card "Próxima Ação" da home leem a hidratação.
      //
      // Antes existiam duas águas: a da home gravava aqui e a da dieta gravava
      // só em `dieta_adesao`, que não alimenta métrica nenhuma. Ao tirar o
      // card da home, manter só o registro da dieta zeraria a hidratação na
      // pontuação de todo mundo — em silêncio, que é o pior jeito de quebrar.
      // Agora a dieta é a única tela que registra água, e ela escreve nos dois
      // lugares: `dieta_adesao` para o histórico da própria tela e
      // `registro_habito` como fonte de verdade das métricas.
      const { error: erroHabito } = await supabase.from("registro_habito").upsert(
        {
          organization_id: organization.id,
          aluno_id: alunoId,
          data: format(selectedDate, "yyyy-MM-dd"),
          agua_ml: aguaMl,
        },
        { onConflict: "aluno_id,data" }
      );
      if (erroHabito) throw erroHabito;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dieta-adesao"] });
      // A home lê a água do dia por estas duas chaves; sem invalidar, o card
      // "Próxima Ação" continuaria pedindo água já registrada.
      void queryClient.invalidateQueries({ queryKey: ["aluno-habito-hoje"] });
      void queryClient.invalidateQueries({ queryKey: ["aluno-meta-agua"] });
      toast({ title: "Adesão registrada!" });
      setDialogOpen(false);
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });


  return (
    <div className="space-y-4">
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-5 w-5 text-primary" />
              Calendário de Adesão
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium min-w-[110px] text-center capitalize">{format(currentMonth, "MMMM yyyy", { locale: ptBR })}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
              <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">
                {d}
              </div>
            ))}
          </div>
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
                  onClick={() => !future && openAdesaoDialog(day)}
                  disabled={future}
                  className={cn(
                    "relative flex flex-col items-center justify-center rounded-lg p-1 min-h-[44px] text-xs transition-all",
                    today && !adesao && "ring-2 ring-primary/50",
                    future ? "opacity-30 cursor-default" : "hover:bg-muted/50 cursor-pointer",
                    adesao && getColorForAdesao(adesao.adesao_percentual)
                  )}
                >
                  <span className={cn("font-medium", adesao && "text-inherit")}>{format(day, "d")}</span>
                  {adesao && <span className="text-[10px] leading-none font-bold">{adesao.adesao_percentual}%</span>}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground justify-center flex-wrap">
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 rounded bg-emerald-500" /> <span>≥80%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 rounded bg-primary/80" /> <span>≥50%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 rounded bg-orange-400" /> <span>≥30%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 rounded bg-red-400" /> <span>&lt;30%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
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
              <span className="text-lg font-bold text-blue-500">{weekAguaMedia > 0 ? `${weekAguaMedia}ml` : "—"}</span>
            </div>
          </div>

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
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
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
              <span className="text-lg font-bold text-blue-500">{monthAguaMedia > 0 ? `${monthAguaMedia}ml` : "—"}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar Adesão{selectedDate && ` - ${format(selectedDate, "dd/MM/yyyy", { locale: ptBR })}`}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {porRefeicao ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Seguiu cada refeição?</Label>
                  <span
                    className={cn(
                      "text-lg font-bold",
                      percentualCalculado >= 80 ? "text-emerald-500" : percentualCalculado >= 50 ? "text-primary" : "text-orange-500"
                    )}
                  >
                    {percentualCalculado}%
                  </span>
                </div>
                <div className="space-y-1.5">
                  {refeicoes.map((r) => {
                    const chave = String(r.ordem);
                    const valor = marcacoes[chave];
                    return (
                      <div key={chave} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                        <span className="text-sm min-w-0 truncate">
                          {r.nome}
                          {r.horario && <span className="text-xs text-muted-foreground ml-1">{r.horario.slice(0, 5)}</span>}
                        </span>
                        <div className="flex gap-1.5 shrink-0" role="group" aria-label={`Seguiu ${r.nome}?`}>
                          <Button
                            type="button"
                            size="sm"
                            variant={valor === true ? "default" : "outline"}
                            className={cn("h-8 px-3", valor === true && "bg-emerald-600 hover:bg-emerald-600")}
                            aria-pressed={valor === true}
                            onClick={() => setMarcacoes((m) => ({ ...m, [chave]: true }))}
                          >
                            Sim
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={valor === false ? "default" : "outline"}
                            className={cn("h-8 px-3", valor === false && "bg-orange-500 hover:bg-orange-500")}
                            aria-pressed={valor === false}
                            onClick={() => setMarcacoes((m) => ({ ...m, [chave]: false }))}
                          >
                            Não
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {respondidas(refeicoes, marcacoes)} de {refeicoes.length} respondidas — refeição sem resposta conta como não seguida.
                </p>
              </div>
            ) : (
            <div className="space-y-3">
              <Label>Quanto você seguiu a dieta hoje?</Label>
              <div className="flex items-center gap-3">
                <Slider value={[adesaoPercentual]} onValueChange={(v) => setAdesaoPercentual(v[0])} min={0} max={100} step={10} className="flex-1" />
                <span
                  className={cn(
                    "text-lg font-bold min-w-[52px] text-right",
                    adesaoPercentual >= 80 ? "text-emerald-500" : adesaoPercentual >= 50 ? "text-primary" : "text-orange-500"
                  )}
                >
                  {adesaoPercentual}%
                </span>
              </div>
            </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                <Checkbox checked={consumiuDoce} onCheckedChange={(v) => setConsumiuDoce(v === true)} />
                <span className="text-sm">🍰 Consumiu doce?</span>
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                <Checkbox checked={consumiuAlcool} onCheckedChange={(v) => setConsumiuAlcool(v === true)} />
                <span className="text-sm">🍷 Consumiu álcool?</span>
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Consumo de Água</Label>
                <span className="text-sm font-semibold text-blue-500">
                  {aguaMl}ml <span className="text-muted-foreground font-normal">/ {metaAguaMl}ml</span>
                </span>
              </div>
              <Progress value={Math.min(100, (aguaMl / metaAguaMl) * 100)} className="h-2" />
              {aguaMl >= metaAguaMl ? (
                <p className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <PartyPopper className="h-3.5 w-3.5" /> Meta batida! Ainda dá pra registrar um pouco mais, se beber.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">💡 Meta de hoje: {metaAguaMl}ml — ajuste em Perfil.</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Droplets className="h-5 w-5 text-blue-500 shrink-0" />
                {INCREMENTOS_AGUA_ML.map((incremento) => {
                  // Limite de incremento: além de 150% da meta, os botões somem —
                  // evita um contador sem sentido (e qualquer futuro uso em
                  // pontuação/gamificação não vira alvo de "farm" de cliques).
                  const limite = metaAguaMl * 1.5;
                  const desabilitado = aguaMl >= limite;
                  return (
                    <Button
                      key={incremento}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={desabilitado}
                      onClick={() => setAguaMl((v) => Math.min(limite, v + incremento))}
                    >
                      +{incremento}ml
                    </Button>
                  );
                })}
                {aguaMl > 0 && (
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setAguaMl(0)}>
                    Zerar
                  </Button>
                )}
              </div>
            </div>

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

            <div className="space-y-2">
              <Label>Observações (opcional)</Label>
              <Textarea placeholder="Como foi seu dia? Alguma dificuldade?" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} />
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
    </div>
  );
}
