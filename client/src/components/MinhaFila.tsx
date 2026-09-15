import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

type Toast = { title: string; detail: string };
type StatusFilter = "aberta" | "em_andamento" | "resolvida";

const PRIORIDADE_LABEL: Record<string, string> = {
  rotina: "Rotina",
  atencao: "Atenção",
  prioritario: "Prioritário",
  encaminhamento_profissional: "Encaminhamento profissional",
};

const PRIORIDADE_ORDER: Record<string, number> = { encaminhamento_profissional: 0, prioritario: 1, atencao: 2, rotina: 3 };

const PRIORIDADE_COLOR: Record<string, string> = {
  rotina: "bg-[#eef4ee] text-[#3e8254]",
  atencao: "bg-[#faf3df] text-[#a47b13]",
  prioritario: "bg-[#f8e6df] text-[#b65343]",
  encaminhamento_profissional: "bg-[#f3e2e2] text-[#9b2c2c]",
};

const ORIGEM_LABEL: Record<string, string> = { check_in: "Check-in", pedido_direto: "Pedido do aluno", manual: "Criada pela equipe" };

const emptyManual = { alunoId: "", prioridade: "rotina" as const, descricao: "" };

export function MinhaFila({ onToast }: { onToast: (toast: Toast) => void }) {
  const orgsQuery = trpc.prescricao.myOrganizations.useQuery();
  const organizations = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data]);
  const [organizationId, setOrganizationId] = useState("");
  const activeOrgId = organizationId || organizations[0]?.membership.organization_id || "";

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("aberta");
  const filaQuery = trpc.atendimento.fila.list.useQuery({ organizationId: activeOrgId, status: statusFilter }, { enabled: Boolean(activeOrgId) });
  const items = useMemo(() => [...(filaQuery.data ?? [])].sort((a, b) => (PRIORIDADE_ORDER[a.prioridade] ?? 9) - (PRIORIDADE_ORDER[b.prioridade] ?? 9)), [filaQuery.data]);

  const studentsQuery = trpc.prescricao.students.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const students = studentsQuery.data ?? [];
  const studentName = (alunoId: string) => students.find((s) => s.user_id === alunoId)?.full_name || "Aluno";

  const utils = trpc.useUtils();
  const refresh = () => utils.atendimento.fila.list.invalidate({ organizationId: activeOrgId, status: statusFilter });
  const assign = trpc.atendimento.fila.assign.useMutation({ onSuccess: () => { onToast({ title: "Atendimento assumido", detail: "Você agora é o responsável por essa tarefa." }); refresh(); }, onError: (e) => onToast({ title: "Erro ao assumir atendimento", detail: e.message }) });
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resultadoForm, setResultadoForm] = useState("");
  const resolve = trpc.atendimento.fila.resolve.useMutation({ onSuccess: () => { onToast({ title: "Atendimento resolvido", detail: "O resultado foi registrado." }); setResolvingId(null); setResultadoForm(""); refresh(); }, onError: (e) => onToast({ title: "Erro ao resolver atendimento", detail: e.message }) });

  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState(emptyManual);
  const createManual = trpc.atendimento.fila.create.useMutation({ onSuccess: () => { onToast({ title: "Tarefa criada", detail: "Adicionada à fila de atendimento." }); setManualForm(emptyManual); setShowManual(false); refresh(); }, onError: (e) => onToast({ title: "Erro ao criar tarefa", detail: e.message }) });

  if (orgsQuery.isLoading) return <div className="p-8 text-sm text-[#918a7d]">Carregando organizações...</div>;
  if (!organizations.length) return <div className="mx-auto max-w-lg p-8 text-center text-sm text-[#918a7d]">Sua conta não está vinculada a nenhuma organização como profissional.</div>;

  return <div className="mx-auto max-w-[1100px] p-5 sm:p-8">
    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><h2 className="text-3xl font-semibold tracking-[-.05em] text-[#2b271f]">Minha fila</h2><p className="mt-1 text-sm text-[#77877d]">Solicitações e sinais de acompanhamento da sua organização.</p></div>
      {organizations.length > 1 && <select value={activeOrgId} onChange={(e) => setOrganizationId(e.target.value)} className="h-10 rounded-xl border bg-white px-3 text-xs"><option value="">Selecione a organização</option>{organizations.map((org) => <option key={org.membership.organization_id} value={org.membership.organization_id}>{org.organization.name}</option>)}</select>}
    </div>

    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Button variant={statusFilter === "aberta" ? "default" : "outline"} onClick={() => setStatusFilter("aberta")} className="h-9 rounded-xl text-xs">Abertas</Button>
      <Button variant={statusFilter === "em_andamento" ? "default" : "outline"} onClick={() => setStatusFilter("em_andamento")} className="h-9 rounded-xl text-xs">Em andamento</Button>
      <Button variant={statusFilter === "resolvida" ? "default" : "outline"} onClick={() => setStatusFilter("resolvida")} className="h-9 rounded-xl text-xs">Histórico</Button>
      <Button variant="outline" onClick={() => setShowManual(!showManual)} className="ml-auto h-9 rounded-xl text-xs">{showManual ? "Cancelar" : "Nova tarefa"}</Button>
    </div>

    {showManual && <Card className="mb-4 rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Nova tarefa</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">
      <select value={manualForm.alunoId} onChange={(e) => setManualForm({ ...manualForm, alunoId: e.target.value })} className="h-9 rounded-lg border bg-white px-2 text-xs"><option value="">Selecione o aluno</option>{students.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name || "Aluno sem nome"}</option>)}</select>
      <select value={manualForm.prioridade} onChange={(e) => setManualForm({ ...manualForm, prioridade: e.target.value as typeof manualForm.prioridade })} className="h-9 rounded-lg border bg-white px-2 text-xs">{Object.entries(PRIORIDADE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <Input value={manualForm.descricao} onChange={(e) => setManualForm({ ...manualForm, descricao: e.target.value })} placeholder="Descrição" className="h-9 rounded-lg text-xs sm:col-span-2" />
      <Button onClick={() => createManual.mutate({ organizationId: activeOrgId, alunoId: manualForm.alunoId, prioridade: manualForm.prioridade, descricao: manualForm.descricao || undefined })} disabled={!manualForm.alunoId || createManual.isPending} className="h-9 rounded-lg bg-[#15130f] text-xs text-white sm:col-span-2">Criar tarefa</Button>
    </CardContent></Card>}

    {filaQuery.isLoading && <p className="text-sm text-[#918a7d]">Carregando...</p>}
    {!filaQuery.isLoading && items.length === 0 && <div className="rounded-2xl border border-dashed border-[#dfd8c8] bg-[#fffdf9] p-8 text-center text-sm text-[#918a7d]"><ClipboardList className="mx-auto mb-2 text-[#c9c2b3]" size={22} />Nenhum atendimento {statusFilter === "aberta" ? "aberto" : statusFilter === "em_andamento" ? "em andamento" : "resolvido"} no momento.</div>}

    <div className="space-y-3">
      {items.map((item) => {
        const overdue = item.prazo && item.status !== "resolvida" && new Date(item.prazo).getTime() < Date.now();
        return <Card key={item.id} className={`rounded-2xl border bg-white shadow-sm ${overdue ? "border-[#b65343]" : "border-[#e5ece5]"}`}>
          <CardContent className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${PRIORIDADE_COLOR[item.prioridade] ?? ""}`}>{PRIORIDADE_LABEL[item.prioridade] ?? item.prioridade}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9488]">{ORIGEM_LABEL[item.origem] ?? item.origem}</span>
              {overdue && <span className="rounded-full bg-[#f8e6df] px-2 py-0.5 text-[10px] font-bold text-[#b65343]">Prazo vencido</span>}
            </div>
            <p className="text-sm font-semibold text-[#2b271f]">{studentName(item.aluno_id)}</p>
            {item.descricao && <p className="text-xs text-[#5c5445]">{item.descricao}</p>}
            <p className="text-[10px] text-[#9b9488]">Aberta em {new Date(item.created_at).toLocaleString("pt-BR")}{item.prazo ? ` · prazo ${new Date(item.prazo).toLocaleString("pt-BR")}` : ""}</p>

            {item.status === "resolvida" && item.resultado && <div className="rounded-xl bg-[#eef4ee] p-3 text-xs text-[#3e8254]"><strong>Resultado:</strong> {item.resultado}</div>}

            {item.status === "aberta" && <Button onClick={() => assign.mutate({ id: item.id })} disabled={assign.isPending} className="h-8 rounded-lg bg-[#15130f] px-3 text-[11px] text-white"><UserCheck size={13} /> Assumir</Button>}

            {item.status === "em_andamento" && resolvingId !== item.id && <Button onClick={() => setResolvingId(item.id)} className="h-8 rounded-lg bg-[#15130f] px-3 text-[11px] text-white"><CheckCircle2 size={13} /> Resolver</Button>}
            {item.status === "em_andamento" && resolvingId === item.id && <div className="space-y-2"><textarea value={resultadoForm} onChange={(e) => setResultadoForm(e.target.value)} placeholder="O que foi feito para resolver?" className="min-h-16 w-full rounded-lg border bg-white p-2 text-xs" /><div className="flex gap-2"><Button onClick={() => resolve.mutate({ id: item.id, resultado: resultadoForm })} disabled={resultadoForm.trim().length < 2 || resolve.isPending} className="h-8 rounded-lg bg-[#15130f] px-3 text-[11px] text-white">Confirmar</Button><Button variant="outline" onClick={() => setResolvingId(null)} className="h-8 rounded-lg px-3 text-[11px]">Cancelar</Button></div></div>}
          </CardContent>
        </Card>;
      })}
    </div>
  </div>;
}

export default MinhaFila;
