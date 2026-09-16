import { useState } from "react";
import { BarChart3, Building2, CalendarDays, CircleDollarSign, Trash2, TrendingDown, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { formatBRL } from "@shared/pricing";

// Painel de negócio ArkeFit (Sessão C do plano): operação interna da
// própria Metodos Arke, nunca uma tela de organização cliente — protegida
// server-side por adminProcedure (server/routers.ts, router `plataforma`).
// Primeira tela do projeto a agregar dado cross-organização.
const STATUS_LABEL: Record<string, string> = { trial: "Trial", active: "Ativa", past_due: "Inadimplente", canceled: "Cancelada" };
// Status bruto do Asaas (asaas_payments.status) — rótulo em pt-BR só na tela, o servidor nunca traduz.
const PAYMENT_STATUS_LABEL: Record<string, string> = { RECEIVED: "Recebido", CONFIRMED: "Confirmado", PENDING: "Pendente", OVERDUE: "Vencido", REFUNDED: "Reembolsado" };
const TABS = [{ key: "dashboard", label: "Dashboard" }, { key: "financeiro", label: "Financeiro" }, { key: "agenda", label: "Agenda" }] as const;
type TabKey = (typeof TABS)[number]["key"];
const APPOINTMENT_TIPO_LABEL: Record<string, string> = { onboarding: "Onboarding", implantacao: "Implantação", acompanhamento: "Acompanhamento", outro: "Outro" };
const APPOINTMENT_STATUS_LABEL: Record<string, string> = { agendado: "Agendado", concluido: "Concluído", cancelado: "Cancelado" };

// asaas_payments.value já vem em reais (não centavos) — formatBRL de
// @shared/pricing espera centavos, então usa-se um formatador próprio aqui.
const formatReais = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function StatTile({ label, value, detail, icon: Icon, tone = "neutral" }: { label: string; value: string; detail?: string; icon: typeof Users; tone?: "neutral" | "warn" | "good" }) {
  const toneClass = tone === "warn" ? "bg-[#f8e6df] text-[#b65343]" : tone === "good" ? "bg-[#e5f2df] text-[#4e8b5b]" : "bg-[#f5ead0] text-[#a47b13]";
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="p-5">
    <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", toneClass)}><Icon size={17} /></div>
    <p className="mt-5 text-[12px] font-medium text-[#849289]">{label}</p>
    <p className="mt-1 text-2xl font-semibold tracking-[-.05em] text-[#2b271f]">{value}</p>
    {detail && <p className="mt-1 text-[11px] text-[#aaa193]">{detail}</p>}
  </CardContent></Card>;
}

function DashboardTab() {
  const dashboardQuery = trpc.plataforma.dashboard.useQuery();
  const dados = dashboardQuery.data;

  if (dashboardQuery.isLoading) return <p className="text-sm text-[#918a7d]">Carregando indicadores...</p>;
  if (!dados) return <p className="text-sm text-[#918a7d]">Não foi possível carregar os indicadores.</p>;

  return <>
    <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label="MRR (assinaturas ativas)" value={formatBRL(dados.mrrCents)} icon={TrendingUp} tone="good" />
      <StatTile label="Organizações" value={String(dados.totalOrganizacoes)} icon={Building2} />
      <StatTile label="Alunos com Arke ativo" value={String(dados.alunosArkeAtivos)} icon={Users} />
      <StatTile label="Novas este mês" value={String(dados.novasEsteMes)} detail={dados.canceladasEsteMes > 0 ? `${dados.canceladasEsteMes} cancelada(s) este mês` : undefined} icon={dados.canceladasEsteMes > 0 ? TrendingDown : TrendingUp} tone={dados.canceladasEsteMes > 0 ? "warn" : "neutral"} />
    </div>
    <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="flex flex-wrap gap-3 p-5">
      {Object.entries(dados.porStatus).map(([key, value]) => <div key={key} className="rounded-xl bg-[#faf7ef] px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9488]">{STATUS_LABEL[key] ?? key}</p><p className="mt-1 text-xl font-semibold text-[#2b271f]">{value}</p></div>)}
    </CardContent></Card>
  </>;
}

function FinanceiroTab() {
  const [status, setStatus] = useState("");
  const financeiroQuery = trpc.plataforma.financeiro.useQuery({ status: status || undefined });
  const dados = financeiroQuery.data;

  return <>
    <div className="mb-4 grid gap-4 sm:grid-cols-2">
      <StatTile label="Recebido" value={dados ? formatReais(dados.totalRecebidoReais) : "—"} icon={TrendingUp} tone="good" />
      <StatTile label="Pendente / vencido" value={dados ? formatReais(dados.totalPendenteReais) : "—"} icon={TrendingDown} tone={dados && dados.totalPendenteReais > 0 ? "warn" : "neutral"} />
    </div>
    <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base text-[#2b271f]">Cobranças (mensalidade, módulo Arke, setup)</CardTitle>
      <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-lg border bg-white px-2 text-xs"><option value="">Todos os status</option>{Object.entries(PAYMENT_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </CardHeader><CardContent>
      {financeiroQuery.isLoading ? <p className="text-sm text-[#8b978e]">Carregando...</p> : dados?.pagamentos.length ? <div className="space-y-2">{dados.pagamentos.map((pagamento) => <div key={pagamento.id} className="flex items-center justify-between rounded-xl border border-[#eee9df] p-3">
        <div><p className="text-xs font-semibold text-[#4b4438]">{pagamento.organizationName ?? "Organização não identificada"}</p><p className="mt-1 text-[10px] text-[#9b9488]">{PAYMENT_STATUS_LABEL[pagamento.status ?? ""] ?? pagamento.status ?? "Sem status"}{pagamento.due_date ? ` · vence ${new Date(pagamento.due_date).toLocaleDateString("pt-BR")}` : ""}</p></div>
        <span className="text-xs font-semibold text-[#53665a]">{pagamento.value ? formatReais(Number(pagamento.value)) : "—"}</span>
      </div>)}</div> : <p className="text-sm text-[#918a7d]">Nenhuma cobrança encontrada.</p>}
    </CardContent></Card>
  </>;
}

const emptyAppointmentForm = { titulo: "", tipo: "outro", data: "", hora: "", duracaoMinutos: "30", descricao: "" };

function AgendaTab() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState(emptyAppointmentForm);
  const listQuery = trpc.plataforma.agenda.list.useQuery({});
  const compromissos = listQuery.data ?? [];
  const invalidate = () => utils.plataforma.agenda.list.invalidate();
  const createMutation = trpc.plataforma.agenda.create.useMutation({ onSuccess: () => { setForm(emptyAppointmentForm); invalidate(); } });
  const updateMutation = trpc.plataforma.agenda.update.useMutation({ onSuccess: invalidate });
  const deleteMutation = trpc.plataforma.agenda.delete.useMutation({ onSuccess: invalidate });

  const submit = () => {
    if (!form.titulo.trim() || !form.data || !form.hora) return;
    const scheduledAt = new Date(`${form.data}T${form.hora}:00`).toISOString();
    createMutation.mutate({ titulo: form.titulo.trim(), tipo: form.tipo as "onboarding" | "implantacao" | "acompanhamento" | "outro", scheduledAt, duracaoMinutos: Number(form.duracaoMinutos) || 30, descricao: form.descricao.trim() || undefined });
  };

  return <>
    <Card className="mb-5 rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">Novo compromisso</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">
      <Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Título (ex.: Onboarding Academia X)" className="h-9 rounded-lg text-xs sm:col-span-2" />
      <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className="h-9 rounded-lg border bg-white px-2 text-xs">{Object.entries(APPOINTMENT_TIPO_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <Input value={form.duracaoMinutos} onChange={(e) => setForm({ ...form, duracaoMinutos: e.target.value })} type="number" min={5} max={480} placeholder="Duração (min)" className="h-9 rounded-lg text-xs" />
      <Input value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} type="date" className="h-9 rounded-lg text-xs" />
      <Input value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} type="time" className="h-9 rounded-lg text-xs" />
      <Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Descrição (opcional)" className="h-9 rounded-lg text-xs sm:col-span-2" />
      <Button onClick={submit} disabled={createMutation.isPending || !form.titulo.trim() || !form.data || !form.hora} className="h-9 rounded-lg bg-[#15130f] text-xs text-white sm:col-span-2">Agendar</Button>
    </CardContent></Card>

    <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base text-[#2b271f]"><CalendarDays size={16} /> Compromissos</CardTitle></CardHeader><CardContent>
      {listQuery.isLoading ? <p className="text-sm text-[#8b978e]">Carregando...</p> : compromissos.length ? <div className="space-y-2">{compromissos.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#eee9df] p-3">
        <div className="min-w-0"><p className="truncate text-xs font-semibold text-[#4b4438]">{item.titulo}</p><p className="mt-1 text-[10px] text-[#9b9488]">{APPOINTMENT_TIPO_LABEL[item.tipo]} · {new Date(item.scheduled_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {item.duracao_minutos}min</p></div>
        <div className="flex shrink-0 items-center gap-2">
          <select value={item.status} onChange={(e) => updateMutation.mutate({ id: item.id, status: e.target.value as "agendado" | "concluido" | "cancelado" })} className="h-8 rounded-lg border bg-white px-2 text-[11px]">{Object.entries(APPOINTMENT_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <button onClick={() => deleteMutation.mutate({ id: item.id })} aria-label="Excluir compromisso" className="rounded-lg p-1.5 text-[#b65343] hover:bg-[#f8e6df]"><Trash2 size={14} /></button>
        </div>
      </div>)}</div> : <p className="text-sm text-[#918a7d]">Nenhum compromisso agendado.</p>}
    </CardContent></Card>
  </>;
}

export function ArkeFitOpsPage() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  return <div className="mx-auto max-w-[1200px] p-5 sm:p-8">
    <div className="mb-6"><h2 className="flex items-center gap-2 text-3xl font-semibold tracking-[-.05em] text-[#2b271f]"><BarChart3 size={26} className="text-[#a47b13]" /> Painel ArkeFit</h2><p className="mt-1 text-sm text-[#77877d]">Operação do próprio negócio ArkeFit — nunca dado de uma organização cliente.</p></div>
    <div className="mb-5 flex gap-2 border-b border-[#e4e0d7]">{TABS.map((item) => <button key={item.key} onClick={() => setTab(item.key)} className={cn("flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium", tab === item.key ? "border-[#a47b13] text-[#2b271f]" : "border-transparent text-[#918a7d]")}>{item.key === "financeiro" && <CircleDollarSign size={14} />}{item.key === "agenda" && <CalendarDays size={14} />}{item.label}</button>)}</div>
    {tab === "dashboard" && <DashboardTab />}
    {tab === "financeiro" && <FinanceiroTab />}
    {tab === "agenda" && <AgendaTab />}
  </div>;
}

export default ArkeFitOpsPage;
