import { hojeBrasilia } from "@/lib/dataBrasilia";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, Plus, UserPlus, CheckCircle2, XCircle, Clock, Users, ChevronLeft, ChevronRight } from "lucide-react";
import type { Enums } from "@/integrations/supabase/types";

type AgendamentoStatus = Enums<"agendamento_status">;

const DIAS_SEMANA = [
  { valor: 1, label: "Seg" },
  { valor: 2, label: "Ter" },
  { valor: 3, label: "Qua" },
  { valor: 4, label: "Qui" },
  { valor: 5, label: "Sex" },
  { valor: 6, label: "Sáb" },
  { valor: 7, label: "Dom" },
];

const STATUS_LABEL: Record<AgendamentoStatus, string> = {
  agendado: "Agendado",
  presente: "Presente",
  cancelado: "Cancelado",
  lista_espera: "Lista de espera",
};

interface Turma {
  id: string;
  nome: string;
  capacidade_maxima: number;
  profissional_id: string | null;
  horario_inicio: string;
  horario_fim: string;
  dias_semana: number[];
  ativa: boolean;
}

interface Agendamento {
  id: string;
  turma_id: string;
  aluno_id: string;
  status: AgendamentoStatus;
}

interface AlunoOpcao {
  id: string;
  full_name: string;
}

const TURMA_INICIAL = { nome: "", capacidade_maxima: "10", profissional_id: "", horario_inicio: "07:00", horario_fim: "08:00" };

// A data da academia, nao a do aparelho: aluno viajando veria uma semana
// diferente da que a academia ve, e o banco decide com Sao Paulo.
const hojeISO = hojeBrasilia;

function somarDias(dataISO: string, delta: number) {
  // Meio-dia deixa o passo de 24h imune a virada de horario de verao.
  const d = new Date(`${dataISO}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return dataBrasilia(d);
}

function weekdayISO(dataISO: string) {
  // getDay(): 0=Dom..6=Sáb → convertido para a convenção 1=Seg..7=Dom já usada em dias_descanso.
  const d = new Date(`${dataISO}T12:00:00`);
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

export default function AdminAgenda() {
  const { organization, hasRole, organizationRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const podeGerenciar = hasRole("admin_arke") || organizationRole === "gestor";

  const [dataSelecionada, setDataSelecionada] = useState(hojeISO());
  const [novaTurmaAberta, setNovaTurmaAberta] = useState(false);
  const [formTurma, setFormTurma] = useState(TURMA_INICIAL);
  const [diasSelecionados, setDiasSelecionados] = useState<number[]>([]);
  const [turmaAdicionarAluno, setTurmaAdicionarAluno] = useState<Turma | null>(null);
  const [alunoParaAdicionar, setAlunoParaAdicionar] = useState<string>("");

  const weekday = useMemo(() => weekdayISO(dataSelecionada), [dataSelecionada]);

  const { data: staff = [] } = useQuery({
    queryKey: ["admin-agenda-staff", organization?.id],
    queryFn: async () => {
      const { data: membros, error } = await supabase
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", organization!.id)
        .eq("status", "active")
        .in("role", ["gestor", "professor", "nutricionista"]);
      if (error) throw error;
      const userIds = membros.map((m) => m.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };
      const nomeByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
      return membros.map((m) => ({ user_id: m.user_id, full_name: nomeByUserId.get(m.user_id) ?? "—" }));
    },
    enabled: !!organization?.id,
  });

  const { data: alunos = [] } = useQuery({
    queryKey: ["admin-agenda-alunos", organization?.id],
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
      return alunosData.map((a) => ({ id: a.id, full_name: nomeByUserId.get(a.user_id) ?? "—" })) as AlunoOpcao[];
    },
    enabled: !!organization?.id,
  });
  const nomeAlunoPorId = new Map(alunos.map((a) => [a.id, a.full_name]));

  const { data: turmas = [] } = useQuery({
    queryKey: ["admin-agenda-turmas", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("turmas")
        .select("id, nome, capacidade_maxima, profissional_id, horario_inicio, horario_fim, dias_semana, ativa")
        .eq("organization_id", organization!.id)
        .order("horario_inicio");
      if (error) throw error;
      return data as Turma[];
    },
    enabled: !!organization?.id,
  });

  const turmasDoDia = turmas.filter((t) => t.ativa && t.dias_semana.includes(weekday));

  const { data: agendamentos = [] } = useQuery({
    queryKey: ["admin-agenda-agendamentos", organization?.id, dataSelecionada],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agendamentos")
        .select("id, turma_id, aluno_id, status")
        .eq("organization_id", organization!.id)
        .eq("data", dataSelecionada);
      if (error) throw error;
      return data as Agendamento[];
    },
    enabled: !!organization?.id,
  });

  const invalidarAgendamentos = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-agenda-agendamentos", organization?.id, dataSelecionada] });

  const criarTurma = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("Organização inválida.");
      const capacidade = Number(formTurma.capacidade_maxima);
      if (!formTurma.nome.trim() || !capacidade || capacidade <= 0 || diasSelecionados.length === 0) {
        throw new Error("Preencha nome, capacidade e ao menos um dia da semana.");
      }
      if (formTurma.horario_fim <= formTurma.horario_inicio) {
        throw new Error("O horário de fim precisa ser depois do horário de início.");
      }
      const { error } = await supabase.from("turmas").insert({
        organization_id: organization.id,
        nome: formTurma.nome.trim(),
        capacidade_maxima: capacidade,
        profissional_id: formTurma.profissional_id || null,
        horario_inicio: formTurma.horario_inicio,
        horario_fim: formTurma.horario_fim,
        dias_semana: diasSelecionados,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Turma criada!" });
      void queryClient.invalidateQueries({ queryKey: ["admin-agenda-turmas", organization?.id] });
      setNovaTurmaAberta(false);
      setFormTurma(TURMA_INICIAL);
      setDiasSelecionados([]);
    },
    onError: (error: Error) => toast({ title: "Erro ao criar turma", description: error.message, variant: "destructive" }),
  });

  const agendar = useMutation({
    mutationFn: async (payload: { turmaId: string; alunoId: string; status: AgendamentoStatus }) => {
      if (!organization) throw new Error("Organização inválida.");
      const { error } = await supabase.from("agendamentos").insert({
        organization_id: organization.id,
        turma_id: payload.turmaId,
        aluno_id: payload.alunoId,
        data: dataSelecionada,
        status: payload.status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Agendamento registrado!" });
      invalidarAgendamentos();
      setTurmaAdicionarAluno(null);
      setAlunoParaAdicionar("");
    },
    onError: (error: Error, variables) => {
      const lotada = error.message.includes("lotada");
      if (lotada && variables.status !== "lista_espera") {
        toast({ title: "Turma lotada", description: "O aluno foi colocado na lista de espera." });
        agendar.mutate({ ...variables, status: "lista_espera" });
        return;
      }
      toast({ title: "Erro ao agendar", description: error.message, variant: "destructive" });
    },
  });

  const atualizarStatus = useMutation({
    mutationFn: async (payload: { id: string; status: AgendamentoStatus }) => {
      const { error } = await supabase.from("agendamentos").update({ status: payload.status }).eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidarAgendamentos();
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" }),
  });

  const toggleDia = (valor: number) =>
    setDiasSelecionados((prev) => (prev.includes(valor) ? prev.filter((d) => d !== valor) : [...prev, valor]));

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Agenda — Grade Semanal</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            title="Dia anterior"
            onClick={() => setDataSelecionada((d) => somarDias(d, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={dataSelecionada}
            onChange={(e) => setDataSelecionada(e.target.value)}
            className="w-40"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            title="Próximo dia"
            onClick={() => setDataSelecionada((d) => somarDias(d, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {podeGerenciar && (
            <Button size="sm" onClick={() => setNovaTurmaAberta(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nova turma
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {DIAS_SEMANA.find((d) => d.valor === weekday)?.label} — {turmasDoDia.length} turma(s) neste dia.
      </p>

      {turmasDoDia.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma turma cadastrada para este dia da semana.
          </CardContent>
        </Card>
      )}

      {turmasDoDia.map((turma) => {
        const agendamentosDaTurma = agendamentos.filter((a) => a.turma_id === turma.id);
        const ativos = agendamentosDaTurma.filter((a) => a.status === "agendado" || a.status === "presente");
        const listaEspera = agendamentosDaTurma.filter((a) => a.status === "lista_espera");
        const staffNome = staff.find((s) => s.user_id === turma.profissional_id)?.full_name;

        return (
          <Card key={turma.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {turma.nome}
                  <Badge variant="outline" className="font-normal gap-1">
                    <Clock className="h-3 w-3" /> {turma.horario_inicio.slice(0, 5)}–{turma.horario_fim.slice(0, 5)}
                  </Badge>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={ativos.length >= turma.capacidade_maxima ? "destructive" : "secondary"} className="gap-1">
                    <Users className="h-3 w-3" /> {ativos.length}/{turma.capacidade_maxima}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTurmaAdicionarAluno(turma)}
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1" /> Adicionar aluno
                  </Button>
                </div>
              </div>
              {staffNome && <p className="text-xs text-muted-foreground">Responsável: {staffNome}</p>}
            </CardHeader>
            <CardContent className="space-y-2">
              {ativos.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum aluno agendado ainda.</p>
              )}
              {ativos.map((ag) => (
                <div key={ag.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                  <span>{nomeAlunoPorId.get(ag.aluno_id) ?? "—"}</span>
                  <div className="flex items-center gap-1">
                    <Badge variant={ag.status === "presente" ? "default" : "outline"}>{STATUS_LABEL[ag.status]}</Badge>
                    {ag.status === "agendado" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Check-in"
                        disabled={atualizarStatus.isPending && atualizarStatus.variables?.id === ag.id}
                        onClick={() => atualizarStatus.mutate({ id: ag.id, status: "presente" })}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      title="Cancelar"
                      disabled={atualizarStatus.isPending && atualizarStatus.variables?.id === ag.id}
                      onClick={() => atualizarStatus.mutate({ id: ag.id, status: "cancelado" })}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}

              {listaEspera.length > 0 && (
                <div className="pt-2 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Lista de espera</p>
                  {listaEspera.map((ag) => (
                    <div key={ag.id} className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border p-2 text-sm">
                      <span>{nomeAlunoPorId.get(ag.aluno_id) ?? "—"}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          ativos.length >= turma.capacidade_maxima ||
                          (atualizarStatus.isPending && atualizarStatus.variables?.id === ag.id)
                        }
                        onClick={() => atualizarStatus.mutate({ id: ag.id, status: "agendado" })}
                      >
                        Promover
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={!!turmaAdicionarAluno} onOpenChange={(open) => !open && setTurmaAdicionarAluno(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar aluno — {turmaAdicionarAluno?.nome}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={alunoParaAdicionar} onValueChange={setAlunoParaAdicionar}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um aluno" />
              </SelectTrigger>
              <SelectContent>
                {alunos.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTurmaAdicionarAluno(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!alunoParaAdicionar || agendar.isPending}
              onClick={() =>
                turmaAdicionarAluno &&
                agendar.mutate({ turmaId: turmaAdicionarAluno.id, alunoId: alunoParaAdicionar, status: "agendado" })
              }
            >
              {agendar.isPending ? "Agendando..." : "Agendar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={novaTurmaAberta} onOpenChange={(open) => !open && setNovaTurmaAberta(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova turma</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="turma-nome">Nome</Label>
              <Input
                id="turma-nome"
                value={formTurma.nome}
                onChange={(e) => setFormTurma((f) => ({ ...f, nome: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="turma-capacidade">Capacidade máxima</Label>
                <Input
                  id="turma-capacidade"
                  type="number"
                  min={1}
                  value={formTurma.capacidade_maxima}
                  onChange={(e) => setFormTurma((f) => ({ ...f, capacidade_maxima: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Profissional responsável</Label>
                <Select
                  value={formTurma.profissional_id}
                  onValueChange={(v) => setFormTurma((f) => ({ ...f, profissional_id: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (
                      <SelectItem key={s.user_id} value={s.user_id}>
                        {s.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="turma-inicio">Horário de início</Label>
                <Input
                  id="turma-inicio"
                  type="time"
                  value={formTurma.horario_inicio}
                  onChange={(e) => setFormTurma((f) => ({ ...f, horario_inicio: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="turma-fim">Horário de fim</Label>
                <Input
                  id="turma-fim"
                  type="time"
                  value={formTurma.horario_fim}
                  onChange={(e) => setFormTurma((f) => ({ ...f, horario_fim: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Dias da semana</Label>
              <div className="flex flex-wrap gap-3">
                {DIAS_SEMANA.map((d) => (
                  <label key={d.valor} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={diasSelecionados.includes(d.valor)}
                      onCheckedChange={() => toggleDia(d.valor)}
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovaTurmaAberta(false)}>
              Cancelar
            </Button>
            <Button disabled={criarTurma.isPending} onClick={() => criarTurma.mutate()}>
              {criarTurma.isPending ? "Criando..." : "Criar turma"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
