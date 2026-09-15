import { useState } from "react";
import { CalendarDays, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

const DIA_LABEL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const todayIso = () => new Date().toISOString().slice(0, 10);

function TurmaBookingCard({ turma, onToast }: { turma: { id: string; nome: string; descricao?: string | null; duracao_min: number }; onToast: (title: string, detail: string) => void }) {
  const [data, setData] = useState(todayIso());
  const horariosQuery = trpc.studio.horariosDaTurma.useQuery({ turmaId: turma.id });
  const horarios = horariosQuery.data ?? [];
  const diaSemana = new Date(`${data}T00:00:00Z`).getUTCDay();
  const horarioDoDia = horarios.find((h) => h.dia_semana === diaSemana);
  const vagasQuery = trpc.studio.vagasDisponiveis.useQuery({ turmaId: turma.id, data }, { enabled: Boolean(horarioDoDia) });
  const utils = trpc.useUtils();
  const reservar = trpc.studio.reservar.useMutation({
    onSuccess: () => { onToast("Vaga reservada", `Você garantiu sua vaga em ${turma.nome}.`); utils.studio.vagasDisponiveis.invalidate({ turmaId: turma.id, data }); utils.studio.minhasReservas.invalidate(); },
    onError: (e) => onToast("Não foi possível reservar", e.message),
  });

  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm">
    <CardHeader><CardTitle className="text-base text-[#2b271f]">{turma.nome}</CardTitle><p className="text-xs text-[#918a7d]">{turma.duracao_min} min{turma.descricao ? ` · ${turma.descricao}` : ""}</p></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-xs text-[#77877d]">Horários: {horarios.length === 0 ? "nenhum definido" : horarios.map((h) => `${DIA_LABEL[h.dia_semana]} ${h.hora_inicio.slice(0, 5)}`).join(", ")}</p>
      <Input value={data} onChange={(e) => setData(e.target.value)} type="date" className="h-9 rounded-lg text-xs" />
      {!horarioDoDia && <p className="text-xs text-[#918a7d]">Esta turma não tem sessão nesta data.</p>}
      {horarioDoDia && vagasQuery.data && <div className="flex items-center justify-between rounded-xl bg-[#faf7ef] px-3 py-2 text-xs text-[#5c5445]"><span><Users size={12} className="mr-1 inline" />{vagasQuery.data.disponiveis} de {vagasQuery.data.limite} vagas disponíveis</span><Button onClick={() => reservar.mutate({ turmaId: turma.id, data })} disabled={vagasQuery.data.disponiveis <= 0 || reservar.isPending} className="h-8 rounded-lg bg-[#15130f] px-3 text-[11px] text-white">Reservar vaga</Button></div>}
    </CardContent>
  </Card>;
}

export function MinhasTurmas() {
  const [toast, setToast] = useState<{ title: string; detail: string } | null>(null);
  const onToast = (title: string, detail: string) => { setToast({ title, detail }); window.setTimeout(() => setToast(null), 3800); };

  const turmasQuery = trpc.studio.turmasDisponiveis.useQuery();
  const turmas = turmasQuery.data ?? [];
  const reservasQuery = trpc.studio.minhasReservas.useQuery();
  const reservas = reservasQuery.data ?? [];
  const utils = trpc.useUtils();
  const cancelar = trpc.studio.cancelarMinhaReserva.useMutation({ onSuccess: () => { onToast("Reserva cancelada", "Sua vaga foi liberada."); utils.studio.minhasReservas.invalidate(); }, onError: (e) => onToast("Erro ao cancelar", e.message) });

  return <div className="mx-auto max-w-[1100px] p-5 sm:p-8">
    <div className="mb-6"><h2 className="text-3xl font-semibold tracking-[-.05em] text-[#2b271f]">Minhas turmas</h2><p className="mt-1 text-sm text-[#77877d]">Reserve sua vaga nas turmas com horário fixo da sua organização.</p></div>

    {toast && <div className="mb-6 rounded-xl bg-[#eef4ee] px-4 py-3 text-sm text-[#3e8254]"><strong>{toast.title}</strong> — {toast.detail}</div>}

    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]"><CalendarDays size={14} /> Minhas reservas</div>
    {reservasQuery.isLoading && <p className="text-sm text-[#918a7d]">Carregando...</p>}
    {!reservasQuery.isLoading && reservas.length === 0 && <div className="mb-8 rounded-2xl border border-dashed border-[#dfd8c8] bg-[#fffdf9] p-6 text-center text-sm text-[#918a7d]">Nenhuma reserva futura.</div>}
    {reservas.length > 0 && <div className="mb-8 space-y-2">{reservas.map((reserva) => <div key={reserva.id} className="flex items-center justify-between rounded-xl border border-[#e5ece5] bg-white p-3 text-sm"><span className="text-[#4b4438]">{new Date(`${reserva.data}T00:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</span><Button variant="ghost" onClick={() => cancelar.mutate({ id: reserva.id })} className="h-8 w-8 p-0 text-[#b65c4d]"><Trash2 size={14} /></Button></div>)}</div>}

    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]"><Users size={14} /> Turmas disponíveis</div>
    {turmasQuery.isLoading && <p className="text-sm text-[#918a7d]">Carregando...</p>}
    {!turmasQuery.isLoading && turmas.length === 0 && <div className="rounded-2xl border border-dashed border-[#dfd8c8] bg-[#fffdf9] p-8 text-center text-sm text-[#918a7d]">Nenhuma turma disponível na sua organização ainda.</div>}
    <div className="grid gap-4 sm:grid-cols-2">{turmas.map((turma) => <TurmaBookingCard key={turma.id} turma={turma} onToast={onToast} />)}</div>
  </div>;
}

export default MinhasTurmas;
