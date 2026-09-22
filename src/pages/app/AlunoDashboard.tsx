import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  LifeBuoy,
  Dumbbell,
  UtensilsCrossed,
  TrendingUp,
  AlertTriangle,
  Droplet,
  CalendarClock,
  Minus,
  Plus,
  Sparkles,
  CheckCircle2,
  Flame,
  Target,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { RegistrarAlertaCard } from "@/components/aluno/RegistrarAlertaCard";
import PontuacaoEngajamento from "@/components/aluno/PontuacaoEngajamento";
import { MetodoArkeEmBreve } from "@/components/aluno/MetodoArkeEmBreve";
import { DocumentosMatricula } from "@/components/aluno/DocumentosMatricula";
import { definirProximaAcao } from "@/lib/proximaAcao";
import type { Enums } from "@/integrations/supabase/types";

type CheckinStatus = Enums<"checkin_status">;
type MotivoDificuldade = Enums<"motivo_dificuldade">;

const CHECKIN_OPTIONS: { value: CheckinStatus; label: string }[] = [
  { value: "funcionando_bem", label: "Funcionando bem" },
  { value: "preciso_ajuste", label: "Preciso de ajuste" },
  { value: "com_dificuldade", label: "Com dificuldade" },
  { value: "quero_falar_com_alguem", label: "Quero falar com alguém" },
];

const CHECKIN_LABEL: Record<CheckinStatus, string> = {
  funcionando_bem: "Funcionando bem",
  preciso_ajuste: "Preciso de ajuste",
  com_dificuldade: "Com dificuldade",
  quero_falar_com_alguem: "Quero falar com alguém",
};

const MOTIVO_OPTIONS: { value: MotivoDificuldade; label: string }[] = [
  { value: "tempo", label: "Tempo" },
  { value: "execucao", label: "Execução" },
  { value: "alimentacao", label: "Alimentação" },
  { value: "desconforto_dor", label: "Desconforto/Dor" },
  { value: "motivacao", label: "Motivação" },
];

const FASE_LABEL: Record<string, string> = {
  mapa: "M.A.P.A.® — Descobrir",
  base: "B.A.S.E.® — Estruturar",
  rota: "R.O.T.A.® — Sustentar",
  apex: "A.P.E.X.® — Expandir",
  legado: "L.E.G.A.D.O.® — Perpetuar",
};

const HOJE = new Date().toISOString().slice(0, 10);

export default function AlunoDashboard() {
  const { alunoId, organization, faseJornada, planoAluno } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [askOpen, setAskOpen] = useState(false);
  const [motivoPendente, setMotivoPendente] = useState<CheckinStatus | null>(null);

  const { data: metaAguaMl = 2000, isLoading: carregandoMeta } = useQuery({
    queryKey: ["aluno-meta-agua", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("alunos").select("meta_agua_ml").eq("id", alunoId!).single();
      if (error) throw error;
      return data.meta_agua_ml;
    },
    enabled: !!alunoId,
  });

  const { data: treinoAtivo, isLoading: carregandoTreino } = useQuery({
    queryKey: ["aluno-treino-ativo", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("treinos")
        .select("id, titulo, validade_fim")
        .eq("aluno_id", alunoId!)
        .eq("status", "ativo")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const { data: proximoEvento } = useQuery({
    queryKey: ["aluno-proximo-evento", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_proximo_evento_aluno");
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: !!alunoId,
  });

  // Mesma queryKey usada em AlunoTreinos.tsx — ao concluir o treino lá, a
  // invalidação dessa key já atualiza este card na volta pro dashboard,
  // sem precisar de nenhum mecanismo extra de sincronização.
  const { data: registroTreinoHoje, isLoading: carregandoRegistro } = useQuery({
    queryKey: ["aluno-registro-hoje", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_treino")
        .select("id, concluido")
        .eq("aluno_id", alunoId!)
        .eq("data", HOJE)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const { data: diasTreinoConcluido = [] } = useQuery({
    queryKey: ["aluno-treino-streak", alunoId],
    queryFn: async () => {
      const desde = new Date();
      desde.setDate(desde.getDate() - 90);
      const { data, error } = await supabase
        .from("registro_treino")
        .select("data")
        .eq("aluno_id", alunoId!)
        .eq("concluido", true)
        .gte("data", desde.toISOString().slice(0, 10))
        .order("data", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => r.data);
    },
    enabled: !!alunoId,
  });

  // Sequência de dias com treino concluído. Se hoje ainda não foi
  // concluído, conta a partir de ontem — não zera o streak no meio do dia.
  const treinoStreak = useMemo(() => {
    const dias = new Set(diasTreinoConcluido);
    const cursor = new Date();
    if (!dias.has(HOJE)) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (dias.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }, [diasTreinoConcluido]);

  const { data: dietaAtiva } = useQuery({
    queryKey: ["aluno-dieta-ativa", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("dietas")
        .select("id, titulo")
        .eq("aluno_id", alunoId!)
        .eq("status", "ativo")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const { data: checkins = [], isLoading: carregandoCheckins } = useQuery({
    queryKey: ["aluno-checkins-semana", alunoId],
    queryFn: async () => {
      const seteDiasAtras = new Date();
      seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
      const { data } = await supabase
        .from("checkins")
        .select("id, status, created_at, data")
        .eq("aluno_id", alunoId!)
        .gte("created_at", seteDiasAtras.toISOString())
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!alunoId,
  });

  const { data: habitoHoje, isLoading: carregandoHabito } = useQuery({
    queryKey: ["aluno-habito-hoje", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_habito")
        .select("*")
        .eq("aluno_id", alunoId!)
        .eq("data", HOJE)
        .maybeSingle();
      return data;
    },
    enabled: !!alunoId,
  });

  const registrarCheckin = useMutation({
    mutationFn: async (params: { status: CheckinStatus; motivo?: MotivoDificuldade }) => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const { error } = await supabase.from("checkins").insert({
        organization_id: organization.id,
        aluno_id: alunoId,
        status: params.status,
        motivo_dificuldade: params.motivo ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Registrado!", description: "Sua equipe foi avisada. Obrigado por compartilhar." });
      setAskOpen(false);
      setMotivoPendente(null);
      void queryClient.invalidateQueries({ queryKey: ["aluno-checkins-semana", alunoId] });
    },
    onError: (error: Error & { code?: string }) => {
      if (error.code === "23505") {
        toast({ title: "Você já registrou hoje", description: "Só é possível registrar uma vez por dia — volte amanhã." });
        setAskOpen(false);
        setMotivoPendente(null);
        void queryClient.invalidateQueries({ queryKey: ["aluno-checkins-semana", alunoId] });
        return;
      }
      toast({ title: "Não foi possível registrar", description: error.message, variant: "destructive" });
    },
  });

  const ajustarAgua = useMutation({
    mutationFn: async (deltaMl: number) => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const novoTotal = Math.max(0, Math.min(limiteAguaMl, (habitoHoje?.agua_ml ?? 0) + deltaMl));
      const { error } = await supabase.from("registro_habito").upsert(
        {
          organization_id: organization.id,
          aluno_id: alunoId,
          data: HOJE,
          agua_ml: novoTotal,
        },
        { onConflict: "aluno_id,data" }
      );
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["aluno-habito-hoje", alunoId] }),
    onError: (error: Error) => {
      toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" });
    },
  });

  const escolherStatus = (status: CheckinStatus) => {
    if (status === "com_dificuldade") {
      setMotivoPendente(status);
      return;
    }
    registrarCheckin.mutate({ status });
  };

  const checkinHoje = checkins.find((c) => c.data === HOJE);

  const aguaMl = habitoHoje?.agua_ml ?? 0;
  const aguaPct = Math.min(100, Math.round((aguaMl / metaAguaMl) * 100));
  // Além de 150% da meta o botão "+" some — evita um contador sem sentido
  // (e qualquer uso futuro em gamificação virar alvo de "farm" de cliques).
  const limiteAguaMl = metaAguaMl * 1.5;


  // A home abre respondendo "o que eu faço agora". Tudo o mais — atalhos,
  // pontuação, água — é segundo plano por diretriz do projeto.
  // Sem isto, `Boolean(undefined)` vira `false` e a home anuncia "sua ficha
  // está sendo preparada" para todo mundo em todo carregamento. O estado
  // desconhecido precisa chegar à função como desconhecido.
  const carregandoProximaAcao =
    !alunoId ||
    carregandoMeta ||
    carregandoTreino ||
    carregandoRegistro ||
    carregandoCheckins ||
    carregandoHabito;

  const proximaAcao = definirProximaAcao({
    temTreinoAtivo: carregandoProximaAcao ? undefined : Boolean(treinoAtivo),
    treinoDeHojeConcluido: Boolean(registroTreinoHoje?.concluido),
    respondeuCheckinHoje: Boolean(checkinHoje),
    aguaMl,
    metaAguaMl,
    tituloTreino: treinoAtivo?.titulo,
  });

  const irParaProximaAcao = () => {
    if (proximaAcao.destino) {
      navigate(proximaAcao.destino);
      return;
    }
    if (proximaAcao.ancora === "check-in-do-dia") setAskOpen(true);
    if (proximaAcao.ancora) {
      document.getElementById(proximaAcao.ancora)?.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Fases da jornada são do Método ARKE; no Free não há fase a mostrar. */}
      {faseJornada && planoAluno !== "free" && (
        <Badge variant="outline" className="text-xs">
          {FASE_LABEL[faseJornada] ?? faseJornada}
        </Badge>
      )}

      {/* Próxima Ação — primeiro bloco da home, por diretriz de UX do aluno. */}
      <Card className="border-primary/40 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-primary" /> Próxima Ação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {proximaAcao.chave === "carregando" ? (
            <div className="space-y-2" aria-busy="true" aria-label="Carregando sua próxima ação">
              <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-semibold">{proximaAcao.titulo}</p>
              <p className="text-sm text-muted-foreground">{proximaAcao.descricao}</p>
            </div>
          )}
          {proximaAcao.acao && (
            <Button className="w-full" size="lg" onClick={irParaProximaAcao}>
              {proximaAcao.acao}
            </Button>
          )}
        </CardContent>
      </Card>

      <div id="meu-progresso" className="space-y-4 scroll-mt-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" /> Progresso Semanal
            </CardTitle>
          </CardHeader>
          <CardContent>
            {checkins.length > 0 ? (
              <div className="space-y-2">
                {checkins.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0 last:pb-0">
                    <Badge variant="secondary">{CHECKIN_LABEL[c.status]}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Você ainda não registrou como está indo esta semana.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-primary" /> Próximo Evento de Acompanhamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            {proximoEvento?.data_agendada ? (
              <>
                <p className="text-sm font-medium">{proximoEvento.motivo}</p>
                <p className="text-sm text-primary">
                  {new Date(proximoEvento.data_agendada).toLocaleString("pt-BR", {
                    weekday: "long",
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Em breve — sua equipe vai agendar os próximos passos.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div id="check-in-do-dia" className="scroll-mt-4">
        {checkinHoje ? (
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="flex items-center gap-3 pt-4">
              <LifeBuoy className="h-5 w-5 text-emerald-600 shrink-0" />
              <p className="text-sm">
                Você já registrou hoje: <span className="font-semibold">{CHECKIN_LABEL[checkinHoje.status]}</span>.
                Volte amanhã para registrar de novo.
              </p>
            </CardContent>
          </Card>
        ) : !askOpen ? (
          <Button className="w-full" size="lg" variant="outline" onClick={() => setAskOpen(true)}>
            <LifeBuoy className="mr-2 h-4 w-4" /> Como está sendo seguir seu plano?
          </Button>
        ) : motivoPendente ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">O que está sendo mais difícil?</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MOTIVO_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant="outline"
                  disabled={registrarCheckin.isPending}
                  onClick={() => registrarCheckin.mutate({ status: motivoPendente, motivo: option.value })}
                >
                  {option.label}
                </Button>
              ))}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Como está sendo seguir seu plano?</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CHECKIN_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant="outline"
                  disabled={registrarCheckin.isPending}
                  onClick={() => escolherStatus(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div id="registrar-alerta" className="scroll-mt-4">
        <RegistrarAlertaCard />
      </div>

      {/* Pendências da matrícula (contrato, PAR-Q, atestado): some quando não há nada a fazer. */}
      <DocumentosMatricula />

      {/* Segundo plano: navegação, hábitos e gamificação. */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <button
          onClick={() => navigate("/app/treinos")}
          className="text-left rounded-xl border border-border bg-card p-3 sm:p-4 hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center justify-between mb-1.5">
            <Dumbbell className="h-5 w-5 text-primary" />
            {registroTreinoHoje?.concluido && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          </div>
          <p className="text-sm font-semibold">Treino de Hoje</p>
          <p className="text-xs text-muted-foreground truncate">{treinoAtivo?.titulo ?? "Nenhum treino ativo"}</p>
          {treinoStreak > 0 && (
            <p className="flex items-center gap-1 text-xs font-medium text-orange-500 mt-1">
              <Flame className="h-3.5 w-3.5" /> {treinoStreak} dia{treinoStreak > 1 ? "s" : ""} seguido{treinoStreak > 1 ? "s" : ""}
            </p>
          )}
        </button>

        <button
          onClick={() => navigate("/app/dieta")}
          className="text-left rounded-xl border border-border bg-card p-3 sm:p-4 hover:bg-accent/50 transition-colors"
        >
          <UtensilsCrossed className="h-5 w-5 text-primary mb-1.5" />
          <p className="text-sm font-semibold">Minha Dieta</p>
          <p className="text-xs text-muted-foreground truncate">{dietaAtiva?.titulo ?? "Nenhuma dieta ativa"}</p>
        </button>

        <button
          onClick={() => document.getElementById("meu-progresso")?.scrollIntoView({ behavior: "smooth" })}
          className="text-left rounded-xl border border-border bg-card p-3 sm:p-4 hover:bg-accent/50 transition-colors"
        >
          <TrendingUp className="h-5 w-5 text-primary mb-1.5" />
          <p className="text-sm font-semibold">Meu Progresso</p>
          <p className="text-xs text-muted-foreground">{checkins.length} check-in(s) essa semana</p>
        </button>

        <button
          onClick={() => document.getElementById("registrar-alerta")?.scrollIntoView({ behavior: "smooth" })}
          className="text-left rounded-xl border border-border bg-card p-3 sm:p-4 hover:bg-accent/50 transition-colors"
        >
          <AlertTriangle className="h-5 w-5 text-primary mb-1.5" />
          <p className="text-sm font-semibold">Registrar Alerta</p>
          <p className="text-xs text-muted-foreground">Dor ou problema de rotina</p>
        </button>
      </div>

      <Card id="diario-agua" className="scroll-mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Droplet className="h-4 w-4 text-primary" /> Diário de Hábitos — Água
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{aguaMl} ml / {metaAguaMl} ml</p>
            <div className="flex items-center gap-1.5">
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                disabled={ajustarAgua.isPending || aguaMl <= 0}
                onClick={() => ajustarAgua.mutate(-250)}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                disabled={ajustarAgua.isPending || aguaMl >= limiteAguaMl}
                onClick={() => ajustarAgua.mutate(250)}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <Progress value={aguaPct} />
          {aguaMl >= metaAguaMl && (
            <p className="text-xs font-medium text-emerald-600">🎉 Meta de água batida hoje!</p>
          )}
        </CardContent>
      </Card>

      <PontuacaoEngajamento />

      {planoAluno === "free" && <MetodoArkeEmBreve />}

      {treinoAtivo?.titulo === "Treino de Boas-vindas — Adaptação" && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex gap-3 items-start pt-4">
            <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold">Este é o seu treino de adaptação inicial</p>
              <p className="text-xs text-muted-foreground">
                Preparamos ele pra você já começar hoje. Seu professor vai montar sua ficha 100% personalizada em
                breve — assim que isso acontecer, ela substitui automaticamente este treino provisório.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
