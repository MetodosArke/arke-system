import { useMemo, useState } from "react";
import { AlertTriangle, Clock, Handshake, MessageSquarePlus, Plus, ThumbsDown, Trash2, TrendingUp, Users } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

type Toast = { title: string; detail: string };
type Estagio = "novo" | "contato_feito" | "visita_agendada" | "convite_enviado" | "matriculado" | "perdido";

const ESTAGIO_LABEL: Record<Estagio, string> = {
  novo: "Novo",
  contato_feito: "Contato feito",
  visita_agendada: "Visita agendada",
  convite_enviado: "Convite enviado",
  matriculado: "Matriculado",
  perdido: "Perdido",
};

// Estágios que ainda estão "em jogo" — o lead segue vivo no funil.
// convite_enviado é system-driven (converterLead) e só some daqui quando o
// convite é de fato aceito (marca matriculado) ou o lead é dado como
// perdido; por isso continua aparecendo aqui mesmo sem ação de "avançar".
const ESTAGIOS_ABERTOS: Estagio[] = ["novo", "contato_feito", "visita_agendada", "convite_enviado"];
const AVANCO: Record<Estagio, Estagio | null> = { novo: "contato_feito", contato_feito: "visita_agendada", visita_agendada: null, convite_enviado: null, matriculado: null, perdido: null };
const FUNIL_ORDEM: Estagio[] = ["novo", "contato_feito", "visita_agendada", "convite_enviado", "matriculado"];
const PIE_COLORS = ["#a47b13", "#3e8254", "#b65343", "#4c9a6a", "#d4a017", "#8b978e", "#766f62", "#b08317"];

const emptyLead = { nome: "", telefone: "", email: "", origem: "", interesse: "", notas: "", unitId: "" };

const formatPercent = (value: number | null | undefined) => (value == null ? "—" : `${Math.round(value * 100)}%`);
const formatHoras = (value: number | null | undefined) => (value == null ? "—" : value < 1 ? "< 1h" : `${value.toFixed(1)}h`);

function Kpi({ label, value, sublabel, icon: Icon, tone = "default" }: { label: string; value: string; sublabel?: string; icon: typeof Users; tone?: "default" | "warn" | "good" }) {
  const toneClass = tone === "warn" ? "text-[#b65343]" : tone === "good" ? "text-[#3e8254]" : "text-[#a97f18]";
  return <Card className="rounded-2xl border-[#e4dfd4] bg-[#fffdf9]"><CardContent className="p-5">
    <Icon size={18} className={toneClass} />
    <p className="mt-4 text-xs text-[#938a7c]">{label}</p>
    <p className="mt-1 text-2xl font-semibold text-[#332c20]">{value}</p>
    {sublabel && <p className="mt-1 text-[11px] text-[#9b9488]">{sublabel}</p>}
  </CardContent></Card>;
}

function FunilVisual({ porEstagio }: { porEstagio: Record<Estagio, number> }) {
  const max = Math.max(...FUNIL_ORDEM.map((estagio) => porEstagio[estagio]), 1);
  return <div className="space-y-3">
    {FUNIL_ORDEM.map((estagio) => {
      const total = porEstagio[estagio];
      const largura = total > 0 ? Math.max((total / max) * 100, 6) : 0;
      return <div key={estagio}>
        <div className="mb-1 flex items-center justify-between text-xs"><span className="font-semibold text-[#4b4438]">{ESTAGIO_LABEL[estagio]}</span><span className="text-[#9b9488]">{total}</span></div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-[#f1ede2]"><div className="h-full rounded-full bg-gradient-to-r from-[#d4a017] to-[#a47b13] transition-all" style={{ width: `${largura}%` }} /></div>
      </div>;
    })}
  </div>;
}

export function Crm({ onToast }: { onToast: (toast: Toast) => void }) {
  const orgsQuery = trpc.crm.myOrganizations.useQuery();
  const organizations = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data]);
  const [organizationId, setOrganizationId] = useState("");
  const activeOrgId = organizationId || organizations[0]?.membership.organization_id || "";

  const accessQuery = trpc.saas.organizations.access.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const units = accessQuery.data?.units ?? [];
  const [unitFilter, setUnitFilter] = useState("");

  const indicadoresQuery = trpc.crm.indicadores.useQuery({ organizationId: activeOrgId, unitId: unitFilter || undefined }, { enabled: Boolean(activeOrgId) });
  const indicadores = indicadoresQuery.data;
  const leadsEmAndamento = indicadores ? ESTAGIOS_ABERTOS.reduce((soma, estagio) => soma + indicadores.porEstagio[estagio], 0) : 0;

  const [estagioFilter, setEstagioFilter] = useState<Estagio>("novo");
  const leadsQuery = trpc.crm.leads.list.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const leads = leadsQuery.data ?? [];
  const leadsDoEstagio = useMemo(() => leads.filter((lead) => lead.estagio === estagioFilter), [leads, estagioFilter]);

  const utils = trpc.useUtils();
  const success = (title: string) => onToast({ title, detail: "Alteração persistida no Supabase." });
  const fail = (title: string, error: { message: string }) => onToast({ title, detail: error.message });
  const refreshLeads = () => { utils.crm.leads.list.invalidate({ organizationId: activeOrgId }); utils.crm.indicadores.invalidate(); };

  const [showNovo, setShowNovo] = useState(false);
  const [novoForm, setNovoForm] = useState(emptyLead);
  const createLead = trpc.crm.leads.create.useMutation({ onSuccess: () => { success("Lead cadastrado"); setNovoForm(emptyLead); setShowNovo(false); refreshLeads(); }, onError: (e) => fail("Erro ao cadastrar lead", e) });

  const [leadId, setLeadId] = useState<string | null>(null);
  const selectedLead = leads.find((lead) => lead.id === leadId);
  const atividadesQuery = trpc.crm.leads.atividades.useQuery({ leadId: leadId ?? "" }, { enabled: Boolean(leadId) });
  const atividades = atividadesQuery.data ?? [];
  const refreshAtividades = () => leadId && utils.crm.leads.atividades.invalidate({ leadId });

  const moverEstagio = trpc.crm.leads.moverEstagio.useMutation({ onSuccess: () => { success("Estágio atualizado"); refreshLeads(); refreshAtividades(); }, onError: (e) => fail("Erro ao mover estágio", e) });
  const [motivoPerda, setMotivoPerda] = useState("");
  const [showPerdido, setShowPerdido] = useState(false);
  const marcarPerdido = trpc.crm.leads.marcarPerdido.useMutation({ onSuccess: () => { success("Lead marcado como perdido"); setShowPerdido(false); setMotivoPerda(""); refreshLeads(); refreshAtividades(); }, onError: (e) => fail("Erro ao marcar lead como perdido", e) });
  const converter = trpc.crm.leads.converter.useMutation({ onSuccess: () => { success("Convite enviado — a matrícula é contabilizada quando o aluno aceitar"); refreshLeads(); refreshAtividades(); }, onError: (e) => fail("Erro ao converter lead", e) });
  const deleteLead = trpc.crm.leads.delete.useMutation({ onSuccess: () => { success("Lead removido"); setLeadId(null); refreshLeads(); }, onError: (e) => fail("Erro ao remover lead", e) });

  const [notaForm, setNotaForm] = useState("");
  const criarNota = trpc.crm.leads.criarNota.useMutation({ onSuccess: () => { success("Nota registrada"); setNotaForm(""); refreshAtividades(); }, onError: (e) => fail("Erro ao registrar nota", e) });

  const selectLead = (id: string) => { setLeadId(id); setShowPerdido(false); setMotivoPerda(""); setNotaForm(""); };

  if (orgsQuery.isLoading) return <div className="p-8 text-sm text-[#918a7d]">Carregando organizações...</div>;
  if (!organizations.length) return <div className="mx-auto max-w-lg p-8 text-center text-sm text-[#918a7d]">Sua conta não tem acesso ao CRM de nenhuma organização (papel de owner, admin ou manager).</div>;

  return <div className="mx-auto max-w-[1440px] p-5 sm:p-8">
    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><h2 className="text-3xl font-semibold tracking-[-.05em] text-[#2b271f]">CRM de vendas</h2><p className="mt-1 text-sm text-[#77877d]">Funil de leads, follow-up e fechamento de novos membros.</p></div>
      <div className="flex flex-wrap gap-2">
        {organizations.length > 1 && <select value={activeOrgId} onChange={(e) => { setOrganizationId(e.target.value); setLeadId(null); setUnitFilter(""); }} className="h-10 rounded-xl border bg-white px-3 text-xs"><option value="">Selecione a organização</option>{organizations.map((org) => <option key={org.membership.organization_id} value={org.membership.organization_id}>{org.organization.name}</option>)}</select>}
        {units.length > 1 && <select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="h-10 rounded-xl border bg-white px-3 text-xs"><option value="">Todas as unidades</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>}
      </div>
    </div>

    <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Leads em andamento" value={String(leadsEmAndamento)} icon={Users} sublabel={`${indicadores?.porEstagio.perdido ?? 0} perdidos no total`} />
      <Kpi label="Taxa de conversão" value={formatPercent(indicadores?.taxaConversao)} icon={TrendingUp} tone="good" sublabel="Matriculados sobre leads não perdidos" />
      <Kpi label="Follow-ups atrasados" value={String(indicadores?.followUps.atrasados ?? 0)} icon={AlertTriangle} tone={(indicadores?.followUps.atrasados ?? 0) > 0 ? "warn" : "default"} sublabel={`${indicadores?.followUps.abertos ?? 0} follow-ups abertos no total`} />
      <Kpi label="Tempo até 1ª resposta" value={formatHoras(indicadores?.tempoMedioPrimeiraRespostaHoras)} icon={Clock} sublabel="Média desde a criação do lead" />
    </div>

    <div className="mb-4 grid gap-4 lg:grid-cols-2">
      <Card className="rounded-2xl border-[#e4dfd4] bg-[#fffdf9]"><CardHeader><CardTitle className="text-base">Funil de vendas</CardTitle></CardHeader><CardContent>
        {indicadores ? <FunilVisual porEstagio={indicadores.porEstagio} /> : <p className="text-xs text-[#918a7d]">Carregando...</p>}
      </CardContent></Card>
      <Card className="rounded-2xl border-[#e4dfd4] bg-[#fffdf9]"><CardHeader><CardTitle className="text-base">Novos leads (últimos 30 dias)</CardTitle></CardHeader><CardContent>
        {indicadores?.novosPorDia.length ? <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={indicadores.novosPorDia}>
            <defs><linearGradient id="novosLeadsGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a47b13" stopOpacity={0.4} /><stop offset="100%" stopColor="#a47b13" stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee9df" vertical={false} />
            <XAxis dataKey="data" tick={{ fontSize: 10, fill: "#9b9488" }} tickFormatter={(value: string) => value.slice(5)} />
            <YAxis tick={{ fontSize: 10, fill: "#9b9488" }} allowDecimals={false} width={24} />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
            <Area type="monotone" dataKey="total" name="Novos leads" stroke="#a47b13" fill="url(#novosLeadsGradient)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer> : <p className="text-xs text-[#918a7d]">Nenhum lead criado nos últimos 30 dias.</p>}
      </CardContent></Card>
    </div>

    <div className="mb-5 grid gap-4 lg:grid-cols-2">
      <Card className="rounded-2xl border-[#e4dfd4] bg-[#fffdf9]"><CardHeader><CardTitle className="text-base">Leads por origem</CardTitle></CardHeader><CardContent>
        {indicadores?.porOrigem.length ? <div className="flex items-center gap-4">
          <ResponsiveContainer width="50%" height={160}>
            <PieChart><Pie data={indicadores.porOrigem} dataKey="total" nameKey="origem" innerRadius={38} outerRadius={64} paddingAngle={2} stroke="none">
              {indicadores.porOrigem.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
            </Pie><Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} /></PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-1.5">{indicadores.porOrigem.slice(0, 6).map((item, index) => <div key={item.origem} className="flex items-center justify-between text-[11px]"><span className="flex items-center gap-1.5 text-[#5c5445]"><span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />{item.origem}</span><span className="font-semibold text-[#332c20]">{item.total}</span></div>)}</div>
        </div> : <p className="text-xs text-[#918a7d]">Nenhum lead com origem registrada.</p>}
      </CardContent></Card>
      <Card className="rounded-2xl border-[#e4dfd4] bg-[#fffdf9]"><CardHeader><CardTitle className="text-base">Motivos de perda</CardTitle></CardHeader><CardContent>
        {indicadores?.motivosPerda.length ? <ResponsiveContainer width="100%" height={180}>
          <BarChart data={indicadores.motivosPerda} layout="vertical" margin={{ left: 8 }}>
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#9b9488" }} />
            <YAxis type="category" dataKey="motivo" width={110} tick={{ fontSize: 10, fill: "#5c5445" }} />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
            <Bar dataKey="total" name="Leads perdidos" fill="#b65343" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer> : <p className="text-xs text-[#918a7d]">Nenhum lead perdido registrado ainda.</p>}
      </CardContent></Card>
    </div>

    <div className="mb-4 flex flex-wrap items-center gap-2">
      {(Object.keys(ESTAGIO_LABEL) as Estagio[]).map((estagio) => <Button key={estagio} variant={estagioFilter === estagio ? "default" : "outline"} onClick={() => setEstagioFilter(estagio)} className="h-9 rounded-xl text-xs">{ESTAGIO_LABEL[estagio]} ({leads.filter((l) => l.estagio === estagio).length})</Button>)}
      <Button variant="outline" onClick={() => setShowNovo(!showNovo)} className="ml-auto h-9 rounded-xl text-xs">{showNovo ? "Cancelar" : "Novo lead"}</Button>
    </div>

    {showNovo && <Card className="mb-4 rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Novo lead</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">
      <Input value={novoForm.nome} onChange={(e) => setNovoForm({ ...novoForm, nome: e.target.value })} placeholder="Nome" className="h-9 rounded-lg text-xs" />
      <Input value={novoForm.telefone} onChange={(e) => setNovoForm({ ...novoForm, telefone: e.target.value })} placeholder="Telefone (opcional)" className="h-9 rounded-lg text-xs" />
      <Input value={novoForm.email} onChange={(e) => setNovoForm({ ...novoForm, email: e.target.value })} placeholder="E-mail (opcional, necessário para converter)" type="email" className="h-9 rounded-lg text-xs" />
      <Input value={novoForm.origem} onChange={(e) => setNovoForm({ ...novoForm, origem: e.target.value })} placeholder="Origem (ex.: instagram, indicação)" className="h-9 rounded-lg text-xs" />
      <Input value={novoForm.interesse} onChange={(e) => setNovoForm({ ...novoForm, interesse: e.target.value })} placeholder="Interesse (ex.: aula experimental, matrícula, personal)" className="h-9 rounded-lg text-xs" />
      {units.length > 1 && <select value={novoForm.unitId} onChange={(e) => setNovoForm({ ...novoForm, unitId: e.target.value })} className="h-9 rounded-lg border bg-white px-2 text-xs"><option value="">Unidade (opcional)</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>}
      <textarea value={novoForm.notas} onChange={(e) => setNovoForm({ ...novoForm, notas: e.target.value })} placeholder="Notas (opcional)" className="min-h-16 w-full rounded-lg border bg-white p-2 text-xs sm:col-span-2" />
      <Button onClick={() => createLead.mutate({ organizationId: activeOrgId, unitId: novoForm.unitId || undefined, nome: novoForm.nome, telefone: novoForm.telefone || undefined, email: novoForm.email || undefined, origem: novoForm.origem || undefined, interesse: novoForm.interesse || undefined, notas: novoForm.notas || undefined })} disabled={!novoForm.nome || createLead.isPending} className="h-9 rounded-lg bg-[#15130f] text-xs text-white sm:col-span-2"><Plus size={14} /> Cadastrar lead</Button>
    </CardContent></Card>}

    <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
      <div className="space-y-2">
        {leadsQuery.isLoading && <p className="text-sm text-[#918a7d]">Carregando...</p>}
        {!leadsQuery.isLoading && leadsDoEstagio.length === 0 && <div className="rounded-2xl border border-dashed border-[#dfd8c8] bg-[#fffdf9] p-8 text-center text-sm text-[#918a7d]">Nenhum lead em "{ESTAGIO_LABEL[estagioFilter]}".</div>}
        {leadsDoEstagio.map((lead) => <button key={lead.id} onClick={() => selectLead(lead.id)} className={`w-full rounded-xl border p-3 text-left ${leadId === lead.id ? "border-[#15130f] bg-[#faf7ef]" : "border-[#e5ece5] bg-white"}`}>
          <p className="text-sm font-semibold text-[#2b271f]">{lead.nome}</p>
          <p className="text-[11px] text-[#9b9488]">{[lead.telefone, lead.email].filter(Boolean).join(" · ") || "Sem contato registrado"}{lead.origem ? ` · ${lead.origem}` : ""}</p>
        </button>)}
      </div>

      <div>
        {!selectedLead && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="p-8 text-center text-sm text-[#918a7d]">Selecione um lead para ver o histórico e agir.</CardContent></Card>}
        {selectedLead && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm">
          <CardHeader><CardTitle className="text-base text-[#2b271f]">{selectedLead.nome}</CardTitle><p className="text-[11px] text-[#9b9488]">{[selectedLead.telefone, selectedLead.email].filter(Boolean).join(" · ") || "Sem contato registrado"}{selectedLead.origem ? ` · origem: ${selectedLead.origem}` : ""}{selectedLead.interesse ? ` · interesse: ${selectedLead.interesse}` : ""}</p></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#faf3df] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#a47b13]">{ESTAGIO_LABEL[selectedLead.estagio]}</span>
              {selectedLead.motivo_perda && <span className="text-[11px] text-[#b65343]">Motivo: {selectedLead.motivo_perda}</span>}
            </div>

            {selectedLead.estagio === "convite_enviado" && <div className="rounded-xl bg-[#faf3df] p-3 text-xs text-[#80641f]">Convite enviado — a matrícula só é contabilizada quando o aluno de fato criar a conta.</div>}

            {ESTAGIOS_ABERTOS.includes(selectedLead.estagio) && <div className="flex flex-wrap gap-2">
              {AVANCO[selectedLead.estagio] && <Button onClick={() => moverEstagio.mutate({ id: selectedLead.id, estagio: AVANCO[selectedLead.estagio] as "contato_feito" | "visita_agendada" })} disabled={moverEstagio.isPending} className="h-9 rounded-lg bg-[#15130f] px-3 text-[11px] text-white">Avançar para {ESTAGIO_LABEL[AVANCO[selectedLead.estagio] as Estagio]}</Button>}
              {selectedLead.estagio !== "convite_enviado" && <Button onClick={() => converter.mutate({ id: selectedLead.id })} disabled={converter.isPending} className="h-9 rounded-lg bg-[#3e8254] px-3 text-[11px] text-white"><Handshake size={13} /> Converter em membro</Button>}
              <Button variant="outline" onClick={() => setShowPerdido(!showPerdido)} className="h-9 rounded-lg px-3 text-[11px] text-[#b65343]"><ThumbsDown size={13} /> Marcar como perdido</Button>
              <Button variant="ghost" onClick={() => { if (window.confirm("Remover este lead?")) deleteLead.mutate({ id: selectedLead.id }); }} className="h-9 w-9 rounded-lg p-0 text-[#b65c4d]"><Trash2 size={14} /></Button>
            </div>}

            {showPerdido && <div className="space-y-2 rounded-xl bg-[#faf7ef] p-3"><Input value={motivoPerda} onChange={(e) => setMotivoPerda(e.target.value)} placeholder="Motivo da perda" className="h-9 rounded-lg text-xs" /><Button onClick={() => marcarPerdido.mutate({ id: selectedLead.id, motivo: motivoPerda })} disabled={motivoPerda.trim().length < 2 || marcarPerdido.isPending} className="h-9 rounded-lg bg-[#15130f] px-3 text-[11px] text-white">Confirmar</Button></div>}

            <div className="rounded-xl border border-[#eee9df] p-3">
              <p className="mb-2 text-xs font-semibold text-[#4b4438]">Histórico</p>
              <div className="mb-3 space-y-2">
                {atividadesQuery.isLoading && <p className="text-[11px] text-[#918a7d]">Carregando...</p>}
                {!atividadesQuery.isLoading && atividades.length === 0 && <p className="text-[11px] text-[#918a7d]">Nenhuma atividade registrada ainda.</p>}
                {atividades.map((atividade) => <div key={atividade.id} className={`rounded-lg border p-2 text-[11px] ${atividade.tipo === "follow_up_automatico" && atividade.status === "aberta" ? "border-[#d4a017] bg-[#faf3df]" : "border-[#eee9df]"}`}>
                  <p className="font-semibold text-[#4b4438]">{atividade.tipo === "follow_up_automatico" ? "Follow-up automático" : "Nota"}{atividade.status === "aberta" ? " · pendente" : ""}</p>
                  {atividade.descricao && <p className="mt-0.5 text-[#5c5445]">{atividade.descricao}</p>}
                  <p className="mt-0.5 text-[#9b9488]">{new Date(atividade.created_at).toLocaleString("pt-BR")}</p>
                </div>)}
              </div>
              {ESTAGIOS_ABERTOS.includes(selectedLead.estagio) && <div className="flex gap-2"><Input value={notaForm} onChange={(e) => setNotaForm(e.target.value)} placeholder="Registrar contato feito..." className="h-9 flex-1 rounded-lg text-xs" /><Button onClick={() => criarNota.mutate({ leadId: selectedLead.id, descricao: notaForm })} disabled={notaForm.trim().length < 2 || criarNota.isPending} className="h-9 rounded-lg bg-[#15130f] px-3 text-[11px] text-white"><MessageSquarePlus size={13} /> Registrar</Button></div>}
            </div>
          </CardContent>
        </Card>}
      </div>
    </div>
  </div>;
}

export default Crm;
