import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, Dumbbell, TrendingUp, Users, Utensils } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

const PRIORIDADE_LABEL: Record<string, string> = {
  rotina: "Rotina",
  atencao: "Atenção",
  prioritario: "Prioritário",
  encaminhamento_profissional: "Encaminhamento profissional",
};

function StatTile({ label, value, detail, icon: Icon, tone = "neutral" }: { label: string; value: string; detail?: string; icon: typeof Users; tone?: "neutral" | "warn" }) {
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="p-5">
    <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone === "warn" ? "bg-[#f8e6df] text-[#b65343]" : "bg-[#f5ead0] text-[#a47b13]"}`}><Icon size={17} /></div>
    <p className="mt-5 text-[12px] font-medium text-[#849289]">{label}</p>
    <p className="mt-1 text-2xl font-semibold tracking-[-.05em] text-[#2b271f]">{value}</p>
    {detail && <p className="mt-1 text-[11px] text-[#aaa193]">{detail}</p>}
  </CardContent></Card>;
}

function EntregaBar({ label, icon: Icon, resumo }: { label: string; icon: typeof Dumbbell; resumo: { semRegistro: number; rascunho: number; publicado: number } }) {
  const total = resumo.semRegistro + resumo.rascunho + resumo.publicado;
  const pct = (value: number) => (total ? (value / total) * 100 : 0);
  return <div>
    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#4b4438]"><Icon size={14} /> {label}</div>
    {total === 0 ? <p className="text-xs text-[#918a7d]">Nenhum aluno ativo para medir.</p> : <>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#eee9df]">
        <div className="bg-[#3e8254]" style={{ width: `${pct(resumo.publicado)}%` }} />
        <div className="bg-[#d4a017]" style={{ width: `${pct(resumo.rascunho)}%` }} />
        <div className="bg-[#e2dcca]" style={{ width: `${pct(resumo.semRegistro)}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[#766f62]">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#3e8254]" />Publicado: {resumo.publicado}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#d4a017]" />Rascunho: {resumo.rascunho}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#e2dcca]" />Sem registro: {resumo.semRegistro}</span>
      </div>
    </>}
  </div>;
}

export function Gestao() {
  const orgsQuery = trpc.gestao.myOrganizations.useQuery();
  const organizations = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data]);
  const [organizationId, setOrganizationId] = useState("");
  const activeOrgId = organizationId || organizations[0]?.membership.organization_id || "";

  const indicadoresQuery = trpc.gestao.indicadores.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const dados = indicadoresQuery.data;

  if (orgsQuery.isLoading) return <div className="p-8 text-sm text-[#918a7d]">Carregando organizações...</div>;
  if (!organizations.length) return <div className="mx-auto max-w-lg p-8 text-center text-sm text-[#918a7d]">Sua conta não tem acesso de gestão (proprietário/administrador/gerente) em nenhuma organização.</div>;

  return <div className="mx-auto max-w-[1200px] p-5 sm:p-8">
    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><h2 className="text-3xl font-semibold tracking-[-.05em] text-[#2b271f]">Gestão</h2><p className="mt-1 text-sm text-[#77877d]">Prazos, capacidade e indicadores de entrega da operação.</p></div>
      {organizations.length > 1 && <select value={activeOrgId} onChange={(e) => setOrganizationId(e.target.value)} className="h-10 rounded-xl border bg-white px-3 text-xs"><option value="">Selecione a organização</option>{organizations.map((org) => <option key={org.membership.organization_id} value={org.membership.organization_id}>{org.organization.name}</option>)}</select>}
    </div>

    {indicadoresQuery.isLoading && <p className="text-sm text-[#918a7d]">Carregando indicadores...</p>}

    {dados && <>
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]"><Users size={14} /> Capacidade</div>
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <StatTile label="Alunos ativos" value={String(dados.capacidade.totalAlunos)} icon={Users} />
        <StatTile label="Equipe ativa" value={String(dados.capacidade.totalStaff)} icon={ClipboardList} />
        <StatTile label="Média de alunos por membro da equipe" value={dados.capacidade.mediaAlunosPorStaff !== null ? dados.capacidade.mediaAlunosPorStaff.toFixed(1) : "—"} icon={TrendingUp} />
      </div>

      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]"><TrendingUp size={14} /> Entrega</div>
      <Card className="mb-8 rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="grid gap-6 p-5 sm:grid-cols-2">
        <EntregaBar label="Treinos" icon={Dumbbell} resumo={dados.entrega.treino} />
        <EntregaBar label="Planos alimentares" icon={Utensils} resumo={dados.entrega.dieta} />
      </CardContent></Card>

      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]"><Clock size={14} /> Prazos e atendimento</div>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Abertas" value={String(dados.atendimento.abertos)} icon={ClipboardList} />
        <StatTile label="Em andamento" value={String(dados.atendimento.emAndamento)} icon={Clock} />
        <StatTile label="Com prazo vencido" value={String(dados.atendimento.vencidos)} icon={AlertTriangle} tone={dados.atendimento.vencidos > 0 ? "warn" : "neutral"} />
        <StatTile label="Resolvidas (30 dias)" value={String(dados.atendimento.resolvidosUltimos30Dias)} detail={dados.atendimento.tempoMedioResolucaoHoras !== null ? `Tempo médio: ${dados.atendimento.tempoMedioResolucaoHoras.toFixed(1)}h` : "Sem resolução no período"} icon={CheckCircle2} />
      </div>
      <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Tarefas em aberto por prioridade</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-3">
        {Object.entries(dados.atendimento.porPrioridade).map(([key, value]) => <div key={key} className="rounded-xl bg-[#faf7ef] px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9488]">{PRIORIDADE_LABEL[key] ?? key}</p><p className="mt-1 text-xl font-semibold text-[#2b271f]">{value}</p></div>)}
      </CardContent></Card>
    </>}
  </div>;
}

export default Gestao;
