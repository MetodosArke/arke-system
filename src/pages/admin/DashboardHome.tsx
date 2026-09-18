import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Home,
  Users,
  AlertTriangle,
  DoorOpen,
  UserPlus,
  KeyRound,
  UsersRound,
  CalendarDays,
  Percent,
  Clock3,
  Plus,
  CalendarCheck,
  ClipboardList,
  Dumbbell,
  Ruler,
  UtensilsCrossed,
  CalendarClock,
  Rocket,
} from "lucide-react";

function hojeISO() {
  const hoje = new Date();
  const offset = hoje.getTimezoneOffset();
  return new Date(hoje.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function weekdayISO(dataISO: string) {
  const d = new Date(`${dataISO}T12:00:00`);
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sublabel,
}: {
  icon: typeof Home;
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className="text-xl font-bold truncate">{value}</p>
          {sublabel && <p className="text-[11px] text-muted-foreground truncate">{sublabel}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function AtalhoButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" className="justify-start gap-2 h-auto py-2.5" onClick={onClick}>
      <Icon className="h-4 w-4 text-primary shrink-0" />
      <span className="text-sm">{label}</span>
    </Button>
  );
}

// Onboarding não tem mais item fixo no menu lateral — enquanto a
// organização não concluir a configuração inicial (perfil + split Asaas),
// esse banner aparece em qualquer uma das Homes como o caminho de volta.
function OnboardingBanner() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate("/admin/onboarding")}
      className="flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10"
    >
      <Rocket className="h-4 w-4 text-primary shrink-0" />
      <span className="flex-1 text-sm">
        <span className="font-medium">Termine a configuração inicial da sua organização.</span>{" "}
        <span className="text-muted-foreground">Perfil, slug e split de pagamento levam menos de 2 minutos.</span>
      </span>
    </button>
  );
}

export default function DashboardHome() {
  const { organization, organizationRole, user } = useAuth();

  const ehStudio = organization?.tipo === "studio";
  const ehProfissionalAutonomo = organization?.tipo === "profissional_autonomo";
  const especialidade = organization?.especialidadeProfissional;

  const visao = useMemo(() => {
    if (ehProfissionalAutonomo) return especialidade === "nutricionista" ? "nutricionista" : "personal";
    if (organizationRole === "professor") return "personal";
    if (organizationRole === "nutricionista") return "nutricionista";
    return ehStudio ? "gestor_studio" : "gestor_academia";
  }, [ehProfissionalAutonomo, especialidade, organizationRole, ehStudio]);

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <Home className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Início</h1>
      </div>

      {organization && !organization.onboardingCompleted && <OnboardingBanner />}

      {visao === "gestor_academia" && <VisaoGestorAcademia />}
      {visao === "gestor_studio" && <VisaoGestorStudio />}
      {visao === "personal" && <VisaoPersonal userId={user?.id ?? null} />}
      {visao === "nutricionista" && <VisaoNutricionista userId={user?.id ?? null} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Gestor de Academia
// ---------------------------------------------------------------------
function VisaoGestorAcademia() {
  const { organization } = useAuth();
  const navigate = useNavigate();
  const hoje = hojeISO();

  const { data: presentesHoje } = useQuery({
    queryKey: ["home-presentes-hoje", organization?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("acessos_catraca_logs")
        .select("aluno_id", { count: "exact", head: true })
        .eq("organization_id", organization!.id)
        .eq("resultado", "liberado")
        .gte("created_at", `${hoje}T00:00:00`);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organization?.id,
  });

  const { data: alertasRetencao } = useQuery({
    queryKey: ["home-alertas-retencao", organization?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("tarefas")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization!.id)
        .in("tipo", ["barreira", "ativacao"])
        .in("status", ["aberta", "em_andamento"]);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organization?.id,
  });

  const { data: catracas } = useQuery({
    queryKey: ["home-status-catracas", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizacao_catracas")
        .select("status")
        .eq("organization_id", organization!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const catracasAtivas = catracas?.filter((c) => c.status === "ativo").length ?? 0;
  const catracasTotal = catracas?.length ?? 0;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard icon={Users} label="Alunos Presentes Hoje" value={presentesHoje ?? "—"} sublabel="Acessos liberados na catraca" />
        <StatCard
          icon={AlertTriangle}
          label="Alertas de Retenção"
          value={alertasRetencao ?? "—"}
          sublabel="Alunos inativos / sem barreira resolvida"
        />
        <StatCard
          icon={DoorOpen}
          label="Status da Catraca"
          value={catracasTotal === 0 ? "—" : `${catracasAtivas}/${catracasTotal}`}
          sublabel={catracasTotal === 0 ? "Nenhuma catraca cadastrada" : "Dispositivos ativos"}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Atalhos Rápidos</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <AtalhoButton icon={UserPlus} label="Novo Aluno" onClick={() => navigate("/admin/alunos")} />
          <AtalhoButton icon={KeyRound} label="Liberar Catraca" onClick={() => navigate("/admin/catracas")} />
          <AtalhoButton icon={UsersRound} label="Convidar Equipe" onClick={() => navigate("/admin/equipe")} />
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------
// Gestor de Studio
// ---------------------------------------------------------------------
function VisaoGestorStudio() {
  const { organization } = useAuth();
  const navigate = useNavigate();
  const hoje = hojeISO();
  const diaSemanaHoje = weekdayISO(hoje);

  const { data: turmas = [] } = useQuery({
    queryKey: ["home-turmas-hoje", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("turmas")
        .select("id, nome, capacidade_maxima, dias_semana, horario_inicio, ativa")
        .eq("organization_id", organization!.id)
        .eq("ativa", true);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const turmasHoje = useMemo(
    () => turmas.filter((t) => t.dias_semana.includes(diaSemanaHoje)).sort((a, b) => a.horario_inicio.localeCompare(b.horario_inicio)),
    [turmas, diaSemanaHoje]
  );

  const { data: agendamentosHoje = [] } = useQuery({
    queryKey: ["home-agendamentos-hoje", organization?.id, hoje],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agendamentos")
        .select("turma_id, status")
        .eq("organization_id", organization!.id)
        .eq("data", hoje);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const capacidadeTotalHoje = turmasHoje.reduce((soma, t) => soma + t.capacidade_maxima, 0);
  const ocupadosHoje = agendamentosHoje.filter((a) => a.status === "agendado" || a.status === "presente").length;
  const taxaOcupacao = capacidadeTotalHoje > 0 ? Math.round((ocupadosHoje / capacidadeTotalHoje) * 100) : 0;
  const filaEspera = agendamentosHoje.filter((a) => a.status === "lista_espera").length;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard icon={CalendarDays} label="Próximas Aulas do Dia" value={turmasHoje.length} sublabel={turmasHoje[0] ? `Próxima: ${turmasHoje[0].nome} às ${turmasHoje[0].horario_inicio}` : "Nenhuma turma hoje"} />
        <StatCard icon={Percent} label="Taxa de Ocupação das Turmas" value={`${taxaOcupacao}%`} sublabel={`${ocupadosHoje} de ${capacidadeTotalHoje} vagas hoje`} />
        <StatCard icon={Clock3} label="Fila de Espera" value={filaEspera} sublabel="Alunos aguardando vaga hoje" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Atalhos Rápidos</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <AtalhoButton icon={Plus} label="Nova Turma/Aula" onClick={() => navigate("/admin/agenda")} />
          <AtalhoButton icon={UserPlus} label="Novo Aluno" onClick={() => navigate("/admin/alunos")} />
          <AtalhoButton icon={CalendarCheck} label="Marcar Presença" onClick={() => navigate("/admin/agenda")} />
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------
// Personal Trainer
// ---------------------------------------------------------------------
function VisaoPersonal({ userId }: { userId: string | null }) {
  const { organization } = useAuth();
  const navigate = useNavigate();
  const hoje = hojeISO();
  const [avaliacaoAberta, setAvaliacaoAberta] = useState(false);

  const { data: minhaFila } = useQuery({
    queryKey: ["home-fila-prescricao", organization?.id, userId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("tarefas")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization!.id)
        .in("tipo", ["anamnese", "dor", "ajuste"])
        .in("status", ["aberta", "em_andamento"])
        .or(`responsavel_id.eq.${userId},responsavel_id.is.null`);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organization?.id && !!userId,
  });

  const { data: treinosAVencer } = useQuery({
    queryKey: ["home-treinos-vencer", organization?.id],
    queryFn: async () => {
      const em7dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count, error } = await supabase
        .from("treinos")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization!.id)
        .eq("status", "ativo")
        .not("validade_fim", "is", null)
        .lte("validade_fim", em7dias)
        .gte("validade_fim", new Date().toISOString());
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organization?.id,
  });

  const { data: avaliacoesHoje } = useQuery({
    queryKey: ["home-avaliacoes-hoje", organization?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("avaliacoes_fisicas")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization!.id)
        .gte("data_avaliacao", hoje);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organization?.id,
  });

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard icon={ClipboardList} label="Minha Fila de Prescrição" value={minhaFila ?? "—"} sublabel="Anamneses, dores e ajustes pendentes" />
        <StatCard icon={Dumbbell} label="Treinos a Vencer" value={treinosAVencer ?? "—"} sublabel="Nos próximos 7 dias" />
        <StatCard icon={Ruler} label="Avaliações do Dia" value={avaliacoesHoje ?? "—"} sublabel="Avaliações físicas registradas hoje" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Atalhos Rápidos</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <AtalhoButton icon={Dumbbell} label="Prescrever Treino" onClick={() => navigate("/admin/treinos")} />
          <AtalhoButton icon={Ruler} label="Nova Avaliação" onClick={() => setAvaliacaoAberta(true)} />
        </CardContent>
      </Card>

      <NovaAvaliacaoDialog open={avaliacaoAberta} onOpenChange={setAvaliacaoAberta} />
    </>
  );
}

// ---------------------------------------------------------------------
// Nutricionista
// ---------------------------------------------------------------------
function VisaoNutricionista({ userId }: { userId: string | null }) {
  const { organization } = useAuth();
  const navigate = useNavigate();
  const hoje = hojeISO();
  const [retornoAberto, setRetornoAberto] = useState(false);

  const { data: dietasPendentes } = useQuery({
    queryKey: ["home-dietas-pendentes", organization?.id, userId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("tarefas")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization!.id)
        .in("tipo", ["anamnese", "ajuste"])
        .in("status", ["aberta", "em_andamento"])
        .or(`responsavel_id.eq.${userId},responsavel_id.is.null`);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organization?.id && !!userId,
  });

  const { data: consultasHoje } = useQuery({
    queryKey: ["home-consultas-hoje", organization?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("avaliacoes_fisicas")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization!.id)
        .gte("data_avaliacao", hoje);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organization?.id,
  });

  // Só conta quem realmente tem nutrição no plano (provedor_nutricao !=
  // "nenhum") — não faz sentido cobrar dieta de quem não contratou o nível.
  const { data: semPlanoAlimentar } = useQuery({
    queryKey: ["home-sem-plano-alimentar", organization?.id],
    queryFn: async () => {
      const { data: alunosComNutricao, error: alunosError } = await supabase
        .from("alunos")
        .select("id")
        .eq("organization_id", organization!.id)
        .neq("provedor_nutricao", "nenhum")
        .is("anonimizado_em", null);
      if (alunosError) throw alunosError;
      const ids = alunosComNutricao.map((a) => a.id);
      if (ids.length === 0) return 0;

      const { data: dietasAtivas, error: dietasError } = await supabase
        .from("dietas")
        .select("aluno_id")
        .eq("organization_id", organization!.id)
        .eq("status", "ativo")
        .in("aluno_id", ids);
      if (dietasError) throw dietasError;

      const comDieta = new Set(dietasAtivas.map((d) => d.aluno_id));
      return ids.filter((id) => !comDieta.has(id)).length;
    },
    enabled: !!organization?.id,
  });

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard icon={UtensilsCrossed} label="Dietas Pendentes" value={dietasPendentes ?? "—"} sublabel="Anamneses e ajustes na sua fila" />
        <StatCard icon={CalendarClock} label="Consultas do Dia" value={consultasHoje ?? "—"} sublabel="Avaliações registradas hoje" />
        <StatCard icon={AlertTriangle} label="Alunos sem Plano Alimentar" value={semPlanoAlimentar ?? "—"} sublabel="Com nutrição incluída no plano" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Atalhos Rápidos</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <AtalhoButton icon={UtensilsCrossed} label="Criar Dieta" onClick={() => navigate("/admin/dietas")} />
          <AtalhoButton icon={CalendarClock} label="Agendar Retorno" onClick={() => setRetornoAberto(true)} />
        </CardContent>
      </Card>

      <AgendarRetornoDialog open={retornoAberto} onOpenChange={setRetornoAberto} />
    </>
  );
}

// ---------------------------------------------------------------------
// Diálogos leves para os atalhos que não têm uma tela própria dedicada
// ---------------------------------------------------------------------
function NovaAvaliacaoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { organization, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [alunoId, setAlunoId] = useState("");
  const [pesoKg, setPesoKg] = useState("");
  const [alturaCm, setAlturaCm] = useState("");
  const [observacoes, setObservacoes] = useState("");

  const { data: alunos = [] } = useQuery({
    queryKey: ["home-alunos-opcoes", organization?.id],
    queryFn: async () => {
      const { data: alunosData, error } = await supabase
        .from("alunos")
        .select("id, user_id")
        .eq("organization_id", organization!.id)
        .is("anonimizado_em", null);
      if (error) throw error;
      const userIds = alunosData.map((a) => a.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };
      const nomeByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
      return alunosData.map((a) => ({ id: a.id, nome: nomeByUserId.get(a.user_id) ?? "Aluno" }));
    },
    enabled: open && !!organization?.id,
  });

  const criar = useMutation({
    mutationFn: async () => {
      if (!organization || !alunoId) throw new Error("Selecione um aluno.");
      const { error } = await supabase.from("avaliacoes_fisicas").insert({
        organization_id: organization.id,
        aluno_id: alunoId,
        avaliado_por: user?.id ?? null,
        data_avaliacao: hojeISO(),
        peso_kg: pesoKg ? Number(pesoKg) : null,
        altura_cm: alturaCm ? Number(alturaCm) : null,
        observacoes: observacoes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Avaliação registrada" });
      void queryClient.invalidateQueries({ queryKey: ["home-avaliacoes-hoje"] });
      onOpenChange(false);
      setAlunoId("");
      setPesoKg("");
      setAlturaCm("");
      setObservacoes("");
    },
    onError: (error: Error) => toast({ title: "Erro ao registrar", description: error.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova Avaliação Física</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Aluno</Label>
            <Select value={alunoId} onValueChange={setAlunoId}>
              <SelectTrigger><SelectValue placeholder="Selecione o aluno" /></SelectTrigger>
              <SelectContent>
                {alunos.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum aluno cadastrado ainda.</div>
                )}
                {alunos.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="avaliacao-peso">Peso (kg)</Label>
              <Input id="avaliacao-peso" type="number" inputMode="decimal" value={pesoKg} onChange={(e) => setPesoKg(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="avaliacao-altura">Altura (cm)</Label>
              <Input id="avaliacao-altura" type="number" inputMode="decimal" value={alturaCm} onChange={(e) => setAlturaCm(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="avaliacao-obs">Observações</Label>
            <Textarea id="avaliacao-obs" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!alunoId || criar.isPending} onClick={() => criar.mutate()}>
            {criar.isPending ? "Salvando..." : "Registrar avaliação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgendarRetornoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { organization, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [alunoId, setAlunoId] = useState("");
  const [data, setData] = useState(hojeISO());

  const { data: alunos = [] } = useQuery({
    queryKey: ["home-alunos-opcoes", organization?.id],
    queryFn: async () => {
      const { data: alunosData, error } = await supabase
        .from("alunos")
        .select("id, user_id")
        .eq("organization_id", organization!.id)
        .is("anonimizado_em", null);
      if (error) throw error;
      const userIds = alunosData.map((a) => a.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };
      const nomeByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
      return alunosData.map((a) => ({ id: a.id, nome: nomeByUserId.get(a.user_id) ?? "Aluno" }));
    },
    enabled: open && !!organization?.id,
  });

  // Não existe uma agenda de consultas de nutrição dedicada — reaproveita
  // o motor de tarefas (o mesmo que já orienta toda a jornada do aluno)
  // para lembrar do retorno, com SLA no dia marcado.
  const agendar = useMutation({
    mutationFn: async () => {
      if (!organization || !alunoId) throw new Error("Selecione um aluno.");
      const { error } = await supabase.from("tarefas").insert({
        organization_id: organization.id,
        aluno_id: alunoId,
        responsavel_id: user?.id ?? null,
        tipo: "outro",
        prioridade: "media",
        motivo: "Retorno de nutrição agendado",
        sla_prazo: `${data}T12:00:00`,
        // Chave de idempotência exigida por `tarefas`, mas aqui cada retorno
        // agendado manualmente é um evento novo por natureza — timestamp
        // garante unicidade sem impedir múltiplos retornos do mesmo aluno.
        origem_evento: `retorno_nutricao:${alunoId}:${Date.now()}`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Retorno agendado", description: "A lembrança aparece na sua fila na data marcada." });
      void queryClient.invalidateQueries({ queryKey: ["home-dietas-pendentes"] });
      void queryClient.invalidateQueries({ queryKey: ["tarefas-fila"] });
      onOpenChange(false);
      setAlunoId("");
    },
    onError: (error: Error) => toast({ title: "Erro ao agendar", description: error.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agendar Retorno</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Aluno</Label>
            <Select value={alunoId} onValueChange={setAlunoId}>
              <SelectTrigger><SelectValue placeholder="Selecione o aluno" /></SelectTrigger>
              <SelectContent>
                {alunos.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum aluno cadastrado ainda.</div>
                )}
                {alunos.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="retorno-data">Data do retorno</Label>
            <Input id="retorno-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!alunoId || agendar.isPending} onClick={() => agendar.mutate()}>
            {agendar.isPending ? "Agendando..." : "Agendar retorno"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
