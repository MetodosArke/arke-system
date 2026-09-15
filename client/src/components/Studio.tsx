import { useMemo, useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

type Toast = { title: string; detail: string };

const DIA_LABEL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const emptyTurma = { nome: "", descricao: "", limiteVagas: "10", duracaoMin: "60" };
const emptyHorario = { diaSemana: "1", horaInicio: "07:00" };

const todayIso = () => new Date().toISOString().slice(0, 10);

export function Studio({ onToast }: { onToast: (toast: Toast) => void }) {
  const orgsQuery = trpc.studio.myOrganizations.useQuery();
  const organizations = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data]);
  const [organizationId, setOrganizationId] = useState("");
  const activeOrgId = organizationId || organizations[0]?.membership.organization_id || "";

  const utils = trpc.useUtils();
  const success = (title: string) => onToast({ title, detail: "Alteração persistida no Supabase." });
  const fail = (title: string, error: { message: string }) => onToast({ title, detail: error.message });

  const studentsQuery = trpc.prescricao.students.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const studentName = (alunoId: string) => studentsQuery.data?.find((student) => student.user_id === alunoId)?.full_name || "Aluno";

  const turmasQuery = trpc.studio.turmas.list.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const turmas = turmasQuery.data ?? [];
  const [turmaId, setTurmaId] = useState<string | null>(null);
  const selectedTurma = turmas.find((turma) => turma.id === turmaId);
  const [turmaForm, setTurmaForm] = useState(emptyTurma);
  const refreshTurmas = () => utils.studio.turmas.list.invalidate({ organizationId: activeOrgId });

  const createTurma = trpc.studio.turmas.create.useMutation({ onSuccess: (created) => { success("Turma criada"); setTurmaId(created.id); setTurmaForm(emptyTurma); refreshTurmas(); }, onError: (e) => fail("Erro ao criar turma", e) });
  const updateTurma = trpc.studio.turmas.update.useMutation({ onSuccess: () => { success("Turma atualizada"); refreshTurmas(); }, onError: (e) => fail("Erro ao atualizar turma", e) });
  const deleteTurma = trpc.studio.turmas.delete.useMutation({ onSuccess: () => { success("Turma removida"); setTurmaId(null); refreshTurmas(); }, onError: (e) => fail("Erro ao remover turma", e) });

  const horariosQuery = trpc.studio.turmas.horarios.useQuery({ turmaId: turmaId ?? "" }, { enabled: Boolean(turmaId) });
  const horarios = horariosQuery.data ?? [];
  const [horarioForm, setHorarioForm] = useState(emptyHorario);
  const saveHorarios = trpc.studio.turmas.saveHorarios.useMutation({ onSuccess: () => { success("Horários salvos"); setHorarioForm(emptyHorario); utils.studio.turmas.horarios.invalidate({ turmaId: turmaId ?? "" }); }, onError: (e) => fail("Erro ao salvar horários", e) });
  const addHorario = () => {
    if (!turmaId) return;
    const items = [...horarios.map((h) => ({ diaSemana: h.dia_semana, horaInicio: h.hora_inicio.slice(0, 5) })), { diaSemana: Number(horarioForm.diaSemana), horaInicio: horarioForm.horaInicio }];
    saveHorarios.mutate({ turmaId, items });
  };
  const removeHorario = (idToRemove: string) => {
    if (!turmaId) return;
    const items = horarios.filter((h) => h.id !== idToRemove).map((h) => ({ diaSemana: h.dia_semana, horaInicio: h.hora_inicio.slice(0, 5) }));
    saveHorarios.mutate({ turmaId, items });
  };

  const [dataConsulta, setDataConsulta] = useState(todayIso());
  const reservasQuery = trpc.studio.turmas.reservas.useQuery({ turmaId: turmaId ?? "", data: dataConsulta }, { enabled: Boolean(turmaId) });
  const reservas = reservasQuery.data ?? [];
  const cancelarReserva = trpc.studio.turmas.cancelarReserva.useMutation({ onSuccess: () => { success("Reserva cancelada"); utils.studio.turmas.reservas.invalidate({ turmaId: turmaId ?? "", data: dataConsulta }); }, onError: (e) => fail("Erro ao cancelar reserva", e) });

  const selectTurma = (id: string) => { setTurmaId(id); setHorarioForm(emptyHorario); };

  if (orgsQuery.isLoading) return <div className="p-8 text-sm text-[#918a7d]">Carregando organizações...</div>;
  if (!organizations.length) return <div className="mx-auto max-w-lg p-8 text-center text-sm text-[#918a7d]">Sua conta não está vinculada a nenhuma organização como profissional/gestão.</div>;

  return <div className="mx-auto max-w-[1440px] p-5 sm:p-8">
    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><h2 className="text-3xl font-semibold tracking-[-.05em] text-[#2b271f]">Turmas</h2><p className="mt-1 text-sm text-[#77877d]">Horários fixos, limite de vagas e reservas por sessão.</p></div>
      {organizations.length > 1 && <select value={activeOrgId} onChange={(e) => { setOrganizationId(e.target.value); setTurmaId(null); }} className="h-10 rounded-xl border bg-white px-3 text-xs"><option value="">Selecione a organização</option>{organizations.map((org) => <option key={org.membership.organization_id} value={org.membership.organization_id}>{org.organization.name}</option>)}</select>}
    </div>

    <div className="grid gap-5 lg:grid-cols-[.7fr_1.3fr]">
      <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">Turmas</CardTitle></CardHeader><CardContent className="space-y-1">
        {turmasQuery.isLoading && <p className="text-xs text-[#918a7d]">Carregando...</p>}
        {!turmasQuery.isLoading && turmas.length === 0 && <p className="text-xs text-[#918a7d]">Nenhuma turma cadastrada ainda.</p>}
        {turmas.map((turma) => <button key={turma.id} onClick={() => selectTurma(turma.id)} className={`w-full rounded-xl px-3 py-2.5 text-left text-sm ${turmaId === turma.id ? "bg-[#15130f] font-semibold text-white" : "text-[#4b4438] hover:bg-[#faf7ef]"}`}><span className="block truncate">{turma.nome}</span><span className={`block text-[10px] ${turmaId === turma.id ? "text-white/70" : "text-[#9b9488]"}`}>{turma.status} · {turma.limite_vagas} vagas</span></button>)}
        <div className="mt-3 space-y-2 rounded-xl bg-[#faf7ef] p-3">
          <p className="text-xs font-semibold text-[#4b4438]">Nova turma</p>
          <Input value={turmaForm.nome} onChange={(e) => setTurmaForm({ ...turmaForm, nome: e.target.value })} placeholder="Nome da turma" className="h-9 rounded-lg text-xs" />
          <div className="grid grid-cols-2 gap-2"><Input value={turmaForm.limiteVagas} onChange={(e) => setTurmaForm({ ...turmaForm, limiteVagas: e.target.value })} placeholder="Limite de vagas" type="number" className="h-9 rounded-lg text-xs" /><Input value={turmaForm.duracaoMin} onChange={(e) => setTurmaForm({ ...turmaForm, duracaoMin: e.target.value })} placeholder="Duração (min)" type="number" className="h-9 rounded-lg text-xs" /></div>
          <textarea value={turmaForm.descricao} onChange={(e) => setTurmaForm({ ...turmaForm, descricao: e.target.value })} placeholder="Descrição (opcional)" className="min-h-14 w-full rounded-lg border bg-white p-2 text-xs" />
          <Button onClick={() => createTurma.mutate({ organizationId: activeOrgId, nome: turmaForm.nome, descricao: turmaForm.descricao || undefined, limiteVagas: Number(turmaForm.limiteVagas || 1), duracaoMin: Number(turmaForm.duracaoMin || 60) })} disabled={!turmaForm.nome || createTurma.isPending} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Criar turma</Button>
        </div>
      </CardContent></Card>

      <div>
        {!selectedTurma && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="p-8 text-center text-sm text-[#918a7d]">Selecione uma turma para gerenciar horários e reservas.</CardContent></Card>}
        {selectedTurma && <div className="grid gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">{selectedTurma.nome}</CardTitle></CardHeader><CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Input defaultValue={selectedTurma.nome} onChange={(e) => setTurmaForm({ ...turmaForm, nome: e.target.value })} placeholder="Nome" className="h-9 rounded-lg text-xs" />
              <select defaultValue={selectedTurma.status} onChange={(e) => updateTurma.mutate({ id: selectedTurma.id, data: { nome: turmaForm.nome || selectedTurma.nome, descricao: selectedTurma.descricao, professorId: selectedTurma.professor_id, limiteVagas: selectedTurma.limite_vagas, duracaoMin: selectedTurma.duracao_min, status: e.target.value as "ativa" | "inativa" } })} className="h-9 rounded-lg border bg-white px-2 text-xs"><option value="ativa">Ativa</option><option value="inativa">Inativa</option></select>
            </div>
            <Button variant="outline" onClick={() => { if (window.confirm("Remover esta turma?")) deleteTurma.mutate({ id: selectedTurma.id }); }} className="h-9 w-full rounded-lg text-xs text-[#b65c4d]"><Trash2 size={14} /> Remover turma</Button>

            <div className="rounded-xl border border-[#eee9df] p-3">
              <p className="mb-2 text-xs font-semibold text-[#4b4438]">Horários fixos</p>
              <div className="mb-2 space-y-1.5">
                {horarios.length === 0 && <p className="text-[10px] text-[#918a7d]">Nenhum horário definido.</p>}
                {horarios.map((h) => <div key={h.id} className="flex items-center justify-between rounded-lg border border-[#eee9df] p-2 text-xs"><span>{DIA_LABEL[h.dia_semana]} às {h.hora_inicio.slice(0, 5)}</span><Button variant="ghost" onClick={() => removeHorario(h.id)} className="h-7 w-7 p-0 text-[#b65c4d]"><Trash2 size={13} /></Button></div>)}
              </div>
              <div className="grid grid-cols-[1fr_100px] gap-2"><select value={horarioForm.diaSemana} onChange={(e) => setHorarioForm({ ...horarioForm, diaSemana: e.target.value })} className="h-9 rounded-lg border bg-white px-2 text-xs">{DIA_LABEL.map((label, index) => <option key={label} value={index}>{label}</option>)}</select><Input value={horarioForm.horaInicio} onChange={(e) => setHorarioForm({ ...horarioForm, horaInicio: e.target.value })} type="time" className="h-9 rounded-lg text-xs" /></div>
              <Button onClick={addHorario} disabled={saveHorarios.isPending} className="mt-2 h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Adicionar horário</Button>
            </div>
          </CardContent></Card>

          <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Reservas</CardTitle></CardHeader><CardContent className="space-y-3">
            <Input value={dataConsulta} onChange={(e) => setDataConsulta(e.target.value)} type="date" className="h-9 rounded-lg text-xs" />
            <p className="text-[11px] text-[#9b9488]"><Users size={12} className="mr-1 inline" />{reservas.length} / {selectedTurma.limite_vagas} vagas ocupadas</p>
            <div className="space-y-1.5">
              {reservasQuery.isLoading && <p className="text-xs text-[#918a7d]">Carregando...</p>}
              {!reservasQuery.isLoading && reservas.length === 0 && <p className="text-xs text-[#918a7d]">Nenhuma reserva para esta data.</p>}
              {reservas.map((reserva) => <div key={reserva.id} className="flex items-center justify-between rounded-lg bg-[#faf7ef] px-3 py-2 text-xs text-[#5c5445]"><span>{studentName(reserva.aluno_id)}</span><Button variant="ghost" onClick={() => cancelarReserva.mutate({ id: reserva.id })} className="h-7 w-7 p-0 text-[#b65c4d]"><Trash2 size={13} /></Button></div>)}
            </div>
          </CardContent></Card>
        </div>}
      </div>
    </div>
  </div>;
}

export default Studio;
