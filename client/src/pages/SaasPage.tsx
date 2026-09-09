import { useMemo, useState } from "react";
import { ArrowRight, Check, ChevronRight, CircleDollarSign, CreditCard, Crown, ImagePlus, LockKeyhole, MailPlus, MapPin, Palette, Rocket, ShieldCheck, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

type Toast = { title: string; detail: string };
type Props = { tenantName: string; onTenantChange: (name: string) => void; onToast: (toast: Toast) => void };
type Plan = { id: "starter" | "growth" | "scale"; name: string; price: string; description: string; limits: string };

const tenants = [
  { name: "Rede Arke", type: "Conta principal", plan: "scale", users: 12, students: 698, usage: 68, initials: "RA" },
  { name: "Vértice Studio", type: "Academia licenciada", plan: "growth", users: 8, students: 286, usage: 42, initials: "VS" },
  { name: "Box Norte 360", type: "Box licenciado", plan: "scale", users: 14, students: 412, usage: 74, initials: "BN" },
];
const plans: Plan[] = [
  { id: "starter", name: "Starter", price: "R$ 399/mês", description: "Para começar a organizar a operação.", limits: "1 unidade · 150 alunos · 12 usuários" },
  { id: "growth", name: "Growth", price: "R$ 799/mês", description: "Para academias em fase de expansão.", limits: "3 unidades · 500 alunos · 32 usuários" },
  { id: "scale", name: "Scale", price: "R$ 1.490/mês", description: "Para redes e operações premium.", limits: "10 unidades · alunos ilimitados" },
];
const policyModules = ["Dashboard", "Academias", "Profissionais", "App do aluno", "Agenda", "Financeiro", "Integrações"] as const;

export default function SaasPage({ tenantName, onTenantChange, onToast }: Props) {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [selectedPlan, setSelectedPlan] = useState<Plan["id"]>("scale");
  const [billingStatus, setBillingStatus] = useState<"trialing" | "active" | "canceled">("trialing");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [auditUser, setAuditUser] = useState("");
  const [auditEntity, setAuditEntity] = useState("all");
  const [brandColor, setBrandColor] = useState("#c99518");
  const [brandName, setBrandName] = useState(tenantName);
  const [selectedUnit, setSelectedUnit] = useState("Sede principal");
  const [units, setUnits] = useState(["Sede principal", "Unidade Centro", "Unidade Norte"]);
  const [policyModule, setPolicyModule] = useState<(typeof policyModules)[number]>("Academias");
  const [policyView, setPolicyView] = useState(true);
  const [policyManage, setPolicyManage] = useState(true);
  const { data: sessionUser } = trpc.auth.me.useQuery();
  const { data: registeredClients } = trpc.admin.users.list.useQuery();
  const [selectedClientId, setSelectedClientId] = useState("");
  const { data: organizations } = trpc.saas.organizations.list.useQuery(undefined, { enabled: Boolean(sessionUser) });
  const realOrganizationId = organizations?.find((entry) => entry.organization.name === tenantName)?.organization.id ?? organizations?.[0]?.organization.id;
  const { data: access } = trpc.saas.organizations.access.useQuery({ organizationId: realOrganizationId ?? 0 }, { enabled: Boolean(realOrganizationId) });
  const saveOnboardingMutation = trpc.saas.organizations.saveOnboarding.useMutation();
  const updatePolicyMutation = trpc.saas.organizations.updatePolicy.useMutation();
  const inviteMutation = trpc.saas.organizations.invite.useMutation();
  const acceptInviteMutation = trpc.saas.organizations.acceptInvite.useMutation();
  const createUnitMutation = trpc.saas.organizations.createUnit.useMutation();
  const createOrganizationMutation = trpc.saas.organizations.create.useMutation();
  const archiveUnitMutation = trpc.saas.organizations.archiveUnit.useMutation();
  const auditInput = useMemo(() => ({ organizationId: realOrganizationId ?? 0, from: auditFrom || undefined, to: auditTo || undefined, userId: auditUser ? Number(auditUser) : undefined, entity: auditEntity }), [realOrganizationId, auditFrom, auditTo, auditUser, auditEntity]);
  const { data: auditEntries } = trpc.saas.organizations.audit.useQuery(auditInput, { enabled: Boolean(realOrganizationId) });
  const auditCsvQuery = trpc.saas.organizations.auditCsv.useQuery(auditInput, { enabled: false });
  const auditPdfQuery = trpc.saas.organizations.auditPdf.useQuery(auditInput, { enabled: false });

  const persistOnboarding = (input: { currentStep: number; status: "in_progress" | "completed"; inviteEmail?: string }) => {
    if (!realOrganizationId) return;
    saveOnboardingMutation.mutate({ organizationId: realOrganizationId, ...input, defaultUnitName: brandName, primaryColor: brandColor });
  };

  const choosePlan = (plan: Plan["id"]) => {
    setSelectedPlan(plan);
    setBillingStatus("active");
    onToast({ title: "Plano atualizado", detail: `A assinatura ${plan} foi atualizada no billing.` });
  };

  const invite = () => {
    if (!inviteEmail.trim()) {
      onToast({ title: "Informe um e-mail", detail: "Digite o e-mail de quem receberá acesso ao workspace." });
      return;
    }
    if (realOrganizationId) {
      inviteMutation.mutate({ organizationId: realOrganizationId, email: inviteEmail.trim(), role: "manager" }, { onSuccess: (result) => { setInviteToken(result.token); onToast({ title: "Convite persistido", detail: `Token de aceite gerado para ${inviteEmail.trim()}.` }); }, onError: () => onToast({ title: "Convite em operacional", detail: "A sessão atual não possui permissão real para enviar este convite." }) });
    } else onToast({ title: "Convite enviado em operacional", detail: `${inviteEmail.trim()} receberia um convite com a permissão de gestor.` });
    setInviteEmail("");
  };

  const acceptInvite = () => {
    if (!inviteToken.trim()) return onToast({ title: "Informe o token", detail: "Cole o token recebido no convite para concluir o aceite." });
    if (!sessionUser?.email) return onToast({ title: "Sessão necessária", detail: "O aceite exige um usuário autenticado com e-mail confirmado." });
    acceptInviteMutation.mutate({ token: inviteToken.trim() }, { onSuccess: (result) => { setInviteToken(""); onToast({ title: "Convite aceito", detail: `Você recebeu o perfil ${result.role} no workspace.` }); }, onError: (error) => onToast({ title: "Não foi possível aceitar", detail: error.message }) });
  };

  const downloadFile = (filename: string, content: BlobPart, mime: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportAuditCsv = async () => {
    if (!realOrganizationId) return onToast({ title: "Login real necessário", detail: "A exportação usa o histórico protegido do tenant autenticado." });
    const result = await auditCsvQuery.refetch();
    if (result.data) downloadFile(result.data.filename, result.data.content, "text/csv;charset=utf-8");
  };

  const exportAuditPdf = async () => {
    if (!realOrganizationId) return onToast({ title: "Login real necessário", detail: "A exportação usa o histórico protegido do tenant autenticado." });
    const result = await auditPdfQuery.refetch();
    if (result.data) {
      const binary = atob(result.data.contentBase64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      downloadFile(result.data.filename, bytes, "application/pdf");
    }
  };

  const saveBrand = () => {
    onToast({ title: "Identidade do tenant salva", detail: `${brandName} agora usa a cor de destaque ${brandColor}.` });
    onTenantChange(brandName || tenantName);
    persistOnboarding({ currentStep: 2, status: "in_progress" });
  };

  const savePolicy = () => {
    onToast({ title: "Política salva em operacional", detail: `${selectedUnit} · ${policyModule} · ${policyManage ? "gerenciar" : policyView ? "visualizar" : "sem acesso"}. A rota protegida está pronta para persistir essa regra.` });
    const unitId = access?.units[0]?.id;
    if (realOrganizationId && unitId) updatePolicyMutation.mutate({ organizationId: realOrganizationId, unitId, role: "manager", module: policyModule.toLowerCase().replace("app do aluno", "alunos") as "dashboard" | "academias" | "profissionais" | "alunos" | "agenda" | "financeiro" | "integracoes", canView: policyView ? 1 : 0, canManage: policyManage ? 1 : 0 });
  };

  const addUnit = () => {
    const nextUnit = `Unidade ${units.length + 1}`;
    if (realOrganizationId) createUnitMutation.mutate({ organizationId: realOrganizationId, name: nextUnit, slug: nextUnit.toLowerCase().replaceAll(" ", "-"), city: "" });
    setUnits((current) => [...current, nextUnit]);
    setSelectedUnit(nextUnit);
    onToast({ title: "Unidade criada em operacional", detail: `${nextUnit} está pronta para receber sua política de acesso.` });
  };

  const archiveUnit = () => {
    if (units.length <= 1 || selectedUnit === "Sede principal") {
      onToast({ title: "Unidade principal protegida", detail: "A sede principal não pode ser arquivada neste fluxo." });
      return;
    }
    const realUnitId = access?.units.find((unit) => unit.name === selectedUnit)?.id;
    if (realOrganizationId && realUnitId) archiveUnitMutation.mutate({ organizationId: realOrganizationId, unitId: realUnitId });
    setUnits((current) => current.filter((unit) => unit !== selectedUnit));
    setSelectedUnit("Sede principal");
    onToast({ title: "Unidade arquivada em operacional", detail: "O acesso da unidade foi removido da seleção ativa." });
  };

  const policyToggles: Array<{ label: string; value: boolean; onChange: (value: boolean) => void; detail: string }> = [
    { label: "Visualizar módulo", value: policyView, onChange: setPolicyView, detail: "Acessa dados e indicadores do módulo" },
    { label: "Gerenciar módulo", value: policyManage, onChange: setPolicyManage, detail: "Pode criar, editar e operar registros" },
  ];

  return <div className="mx-auto max-w-[1440px] p-5 sm:p-8" style={{ ["--tenant-accent" as string]: brandColor }}>
    <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#b88918]"><span className="h-1.5 w-1.5 rounded-full bg-[#d4a017]" /> SaaS • multi-tenant</div><h2 className="text-3xl font-semibold tracking-[-.055em] text-[#231f18] sm:text-4xl">Licenças & planos</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#766f62]">Crie e configure licenças Arke completas: cliente, workspace, plano, cobrança, unidades, equipe e permissões.</p></div><div className="flex flex-wrap gap-2"><Button onClick={() => { setOnboardingStep(1); setShowOnboarding(true); }} className="h-10 rounded-xl bg-[#15130f] px-4 text-xs font-semibold text-white hover:bg-[#2b271d]"><Rocket size={15} /> Criar novo workspace</Button><Button onClick={() => { setBrandName(""); setOnboardingStep(1); setShowOnboarding(true); }} variant="outline" className="h-10 rounded-xl border-[#ded8ca] bg-[#fffdf9] text-xs font-semibold text-[#6e5b2b]"><Users size={15} /> Criar tenant</Button></div></div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="Tenants ativos" value="03" detail="organizações licenciadas" icon={ShieldCheck} /><Kpi label="MRR da plataforma" value="R$ 3,7k" detail="receita recorrente SaaS" icon={CircleDollarSign} /><Kpi label="Usuários provisionados" value="34" detail="em todas as contas" icon={Users} /><Kpi label="Uso médio" value="61%" detail="da capacidade contratada" icon={Crown} /></div>

    <div className="mt-5 grid gap-5 xl:grid-cols-[1.18fr_.82fr]"><Card className="rounded-2xl border-[#e4dfd4] bg-[#fffdf9] shadow-[0_6px_24px_rgba(57,46,25,.05)]"><CardHeader className="flex flex-row items-center justify-between pb-3"><div><CardTitle className="text-base font-semibold text-[#2b271f]">Licenças em configuração</CardTitle><p className="mt-1 text-xs text-[#918a7d]">Cada licença reúne cliente, workspace, plano e acesso operacional.</p></div><Badge className="border-0 bg-[#f5ead0] text-[10px] font-bold text-[#98741a]">Isolamento ativo</Badge></CardHeader><CardContent className="space-y-2">{tenants.map((tenant) => <div key={tenant.name} className={cn("flex flex-col gap-3 rounded-2xl border p-4 transition sm:flex-row sm:items-center", tenantName === tenant.name ? "border-[#d3b664] bg-[#fffbf1]" : "border-[#eee9df]")}><div className="flex flex-1 items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f4e8c9] text-xs font-bold text-[#946f14]">{tenant.initials}</div><div><p className="text-sm font-semibold text-[#413a2f]">{tenant.name}</p><p className="mt-1 text-[11px] text-[#9b9488]">{tenant.type} · plano {tenant.plan}</p></div></div><div className="grid grid-cols-2 gap-4 sm:flex sm:items-center"><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#aaa193]">Ciclo</p><p className="mt-1 text-xs font-semibold text-[#6b624f]">Mensal</p></div><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#aaa193]">Faturamento</p><p className="mt-1 text-xs font-semibold text-[#6b624f]">Recorrente</p></div><Button onClick={() => { onTenantChange(tenant.name); onToast({ title: `${tenant.name} ativa`, detail: "Contexto de dados alternado sem novo login." }); }} className={cn("h-8 rounded-lg px-3 text-[11px] font-semibold", tenantName === tenant.name ? "bg-[#f3e6c5] text-[#937018] hover:bg-[#f3e6c5]" : "bg-[#15130f] text-white hover:bg-[#2b271d]")}>{tenantName === tenant.name ? "Ativo" : "Acessar"}</Button></div></div>)}</CardContent></Card><Card className="rounded-2xl border-[#231f18] bg-[#15130f] text-white shadow-[0_10px_30px_rgba(33,27,16,.15)]"><CardContent className="flex h-full flex-col p-6"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d4a017] text-[#15130f]"><Rocket size={19} /></div><p className="mt-6 text-xs font-bold uppercase tracking-[.14em] text-[#d4a017]">Configuração da licença</p><h3 className="mt-2 text-2xl font-semibold leading-tight tracking-[-.04em]">Venda a plataforma. Escale a operação.</h3><p className="mt-3 text-sm leading-6 text-[#c6c0b3]">Cada cliente possui dados, usuários, limites e marca próprios, enquanto a ARKE mantém a administração central.</p><div className="mt-auto pt-7"><div className="flex items-center justify-between text-xs text-[#c6c0b3]"><span>Trial médio convertido</span><strong className="text-[#d4a017]">38%</strong></div><div className="mt-2 h-2 rounded-full bg-white/10"><div className="h-full w-[38%] rounded-full bg-[#d4a017]" /></div><Button onClick={() => { setOnboardingStep(1); setShowOnboarding(true); }} variant="outline" className="mt-6 h-10 w-full rounded-xl border-white/20 bg-white/5 text-xs font-semibold text-white hover:bg-white/10">Continuar configuração <ArrowRight size={15} /></Button></div></CardContent></Card></div>

    <div className="mt-5 grid gap-5 lg:grid-cols-3"><Card className="rounded-2xl border-[#e4dfd4] bg-[#fffdf9] shadow-[0_6px_24px_rgba(57,46,25,.05)] lg:col-span-2"><CardHeader><CardTitle className="text-base font-semibold text-[#2b271f]">Billing recorrente</CardTitle><p className="mt-1 text-xs text-[#918a7d]">Billing recorrente conectado ao provedor de pagamentos.</p></CardHeader><CardContent><div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f8f1df] p-3"><div className="flex items-center gap-2"><CreditCard size={16} className="text-[#ae841b]" /><div><p className="text-xs font-semibold text-[#554725]">Assinatura {selectedPlan} · {billingStatus === "trialing" ? "Período inicial" : billingStatus === "active" ? "Ativa" : "Cancelada"}</p><p className="mt-1 text-[10px] text-[#94845d]">Provedor: operacional · próxima cobrança prevista</p></div></div>{billingStatus === "active" ? <Button onClick={() => { setBillingStatus("canceled"); onToast({ title: "Cancelamento agendado", detail: "A assinatura ficará ativa até o fim do ciclo atual." }); }} variant="outline" className="h-8 rounded-lg border-[#dfcfaa] text-[10px] font-semibold text-[#98741a]">Cancelar no fim do ciclo</Button> : <Button onClick={() => { setBillingStatus("active"); onToast({ title: "Assinatura reativada", detail: "A cobrança recorrente foi reativada em operacional." }); }} className="h-8 rounded-lg bg-[#15130f] text-[10px] font-semibold text-white hover:bg-[#2b271d]">Ativar assinatura</Button>}</div><div className="grid gap-3 md:grid-cols-3">{plans.map((plan) => <button key={plan.id} onClick={() => choosePlan(plan.id)} className={cn("rounded-xl border p-4 text-left transition", selectedPlan === plan.id ? "border-[#d3b664] bg-[#fffbf1]" : "border-[#eee9df] hover:border-[#d3c59f]")}><div className="flex items-center justify-between"><span className="text-xs font-semibold text-[#4e4636]">{plan.name}</span>{selectedPlan === plan.id && <Check size={14} className="text-[#b18317]" />}</div><p className="mt-3 text-lg font-semibold tracking-[-.04em] text-[#2f291d]">{plan.price}</p><p className="mt-1 text-[10px] leading-4 text-[#948b7d]">{plan.limits}</p></button>)}</div></CardContent></Card><Card className="rounded-2xl border-[#e4dfd4] bg-[#fffdf9] shadow-[0_6px_24px_rgba(57,46,25,.05)]"><CardHeader><CardTitle className="text-base font-semibold text-[#2b271f]">Convites e permissões</CardTitle><p className="mt-1 text-xs text-[#918a7d]">Adicione a equipe do tenant sem misturar acessos.</p></CardHeader><CardContent><div className="flex gap-2"><Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="e-mail@academia.com" className="h-9 rounded-lg border-[#e2dcca] bg-white text-xs" /><Button onClick={invite} className="h-9 rounded-lg bg-[#15130f] px-3 text-white hover:bg-[#2b271d]"><MailPlus size={14} /></Button></div><div className="mt-3 flex gap-2"><Input value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} placeholder="Token de aceite do convite" className="h-9 rounded-lg border-[#e2dcca] bg-white text-[10px]" /><Button onClick={acceptInvite} variant="outline" className="h-9 rounded-lg border-[#ddcfac] px-3 text-[10px] font-semibold text-[#98741a]">Aceitar</Button></div><div className="mt-4 space-y-2">{[["Você", "Owner"], ["gestor@vertice.com", "Manager"], ["camila@arke.com", "Professional"]].map(([email, role]) => <div key={email} className="flex items-center gap-2 rounded-lg bg-[#faf7f0] p-2.5"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f0e3c0] text-[9px] font-bold text-[#98751c]">{email.slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold text-[#5d5548]">{email}</p><p className="text-[10px] text-[#a29a8c]">{role}</p></div><Check size={13} className="text-[#b88a19]" /></div>)}</div></CardContent></Card></div>

    <div className="mt-5 grid gap-5 lg:grid-cols-[.9fr_1.1fr]"><Card className="rounded-2xl border-[#e4dfd4] bg-[#fffdf9] shadow-[0_6px_24px_rgba(57,46,25,.05)]"><CardHeader><CardTitle className="flex items-center gap-2 text-base font-semibold text-[#2b271f]"><LockKeyhole size={16} className="text-[#b08317]" /> Políticas de acesso</CardTitle><p className="mt-1 text-xs text-[#918a7d]">Controle o que cada perfil pode ver e gerenciar em cada unidade.</p></CardHeader><CardContent><div className="flex items-center gap-2 rounded-xl bg-[#faf5e8] p-3"><MapPin size={15} className="text-[#b08317]" /><select value={selectedUnit} onChange={(event) => setSelectedUnit(event.target.value)} className="flex-1 bg-transparent text-xs font-semibold text-[#5a4c30] outline-none">{units.map((unit) => <option key={unit}>{unit}</option>)}</select><span className="text-[10px] font-semibold text-[#a1843a]">{units.length} unidades</span><button onClick={addUnit} className="rounded-lg bg-[#15130f] px-2 py-1 text-[10px] font-semibold text-white">+ Unidade</button><button onClick={archiveUnit} className="rounded-lg border border-[#ddcfac] px-2 py-1 text-[10px] font-semibold text-[#98741a]">Arquivar</button></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{policyModules.map((module) => <button key={module} onClick={() => setPolicyModule(module)} className={cn("rounded-xl border p-3 text-left", policyModule === module ? "border-[#d3b664] bg-[#fffbf1]" : "border-[#eee9df]")}><p className="text-xs font-semibold text-[#5a5142]">{module}</p><p className="mt-1 text-[10px] text-[#a09789]">{module === "Financeiro" ? "Restrito a owner e admin" : "Política configurável"}</p></button>)}</div></CardContent></Card><Card className="rounded-2xl border-[#e4dfd4] bg-[#fffdf9] shadow-[0_6px_24px_rgba(57,46,25,.05)]"><CardHeader><CardTitle className="text-base font-semibold text-[#2b271f]">Permissões do perfil Manager</CardTitle><p className="mt-1 text-xs text-[#918a7d]">{selectedUnit} · {policyModule}</p></CardHeader><CardContent><div className="space-y-3">{policyToggles.map(({ label, value, onChange, detail }) => <div key={String(label)} className="flex items-center gap-3 rounded-xl border border-[#eee9df] p-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f4e8c9] text-[#a97f18]"><ShieldCheck size={15} /></div><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-[#5a5142]">{label}</p><p className="mt-1 text-[10px] text-[#9d9486]">{detail}</p></div><button onClick={() => onChange(!value)} className={cn("relative h-6 w-11 rounded-full transition", value ? "bg-[#d4a017]" : "bg-[#ded8ca]")}><span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white shadow transition", value ? "left-6" : "left-1")} /></button></div>)}</div><Button onClick={savePolicy} className="mt-4 h-9 w-full rounded-xl bg-[#15130f] text-xs font-semibold text-white hover:bg-[#2b271d]">Salvar política</Button></CardContent></Card></div>

    <div className="mt-5 rounded-2xl border border-[#e4dfd4] bg-[#fffdf9] p-5 shadow-[0_6px_24px_rgba(57,46,25,.05)]"><div className="flex items-center justify-between"><div><p className="flex items-center gap-2 text-sm font-semibold text-[#3c3529]"><ShieldCheck size={15} className="text-[#b08317]" /> Auditoria de alterações</p><p className="mt-1 text-xs text-[#948b7d]">Registro por usuário, tenant, unidade e entidade afetada.</p></div><div className="flex items-center gap-2"><Badge className="border-0 bg-[#f5ead0] text-[10px] font-bold text-[#98741a]">Rastreável</Badge><Button onClick={exportAuditCsv} variant="outline" className="h-8 rounded-lg border-[#ddcfac] px-2 text-[10px] font-semibold text-[#98741a]">CSV</Button><Button onClick={exportAuditPdf} variant="outline" className="h-8 rounded-lg border-[#ddcfac] px-2 text-[10px] font-semibold text-[#98741a]">PDF</Button></div></div><div className="mt-4 grid gap-2 rounded-xl bg-[#faf7ef] p-3 sm:grid-cols-4"><Input type="date" value={auditFrom} onChange={(event) => setAuditFrom(event.target.value)} className="h-8 rounded-lg border-[#e2dcca] bg-white text-[10px]" aria-label="Data inicial" /><Input type="date" value={auditTo} onChange={(event) => setAuditTo(event.target.value)} className="h-8 rounded-lg border-[#e2dcca] bg-white text-[10px]" aria-label="Data final" /><Input type="number" min="1" value={auditUser} onChange={(event) => setAuditUser(event.target.value)} placeholder="ID do usuário" className="h-8 rounded-lg border-[#e2dcca] bg-white text-[10px]" /><select value={auditEntity} onChange={(event) => setAuditEntity(event.target.value)} className="h-8 rounded-lg border border-[#e2dcca] bg-white px-2 text-[10px] text-[#6b624f]"><option value="all">Todas as entidades</option><option value="module_policy">Políticas</option><option value="onboarding_branding">Branding / onboarding</option><option value="organization_unit">Unidades</option><option value="invitation">Convites</option></select></div><div className="mt-4 grid gap-2 sm:grid-cols-3">{(auditEntries?.slice(0, 3) ?? [{ action: "updated", entity: "module_policy" }, { action: "updated", entity: "onboarding_branding" }, { action: "created", entity: "organization_unit" }]).map((entry, index) => <div key={String(entry.entity) + index} className="rounded-xl bg-[#faf7ef] p-3"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.1em] text-[#b08317]">{entry.action}</span><span className="text-[10px] text-[#aaa193]">agora</span></div><p className="mt-2 text-xs font-semibold text-[#5a5142]">{entry.entity === "module_policy" ? "Política de módulo" : entry.entity === "onboarding_branding" ? "Branding / onboarding" : "Unidade organizacional"}</p><p className="mt-1 text-[10px] text-[#9d9486]">Alteração registrada sem apagar o histórico.</p></div>)}</div></div>

    <div className="mt-5 rounded-2xl border border-[#e4dfd4] bg-[#fffdf9] p-5 shadow-[0_6px_24px_rgba(57,46,25,.05)]"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold text-[#3c3529]">Onboarding e personalização do tenant</p><p className="mt-1 text-xs text-[#948b7d]">Configure marca, unidade, plano e primeiro convite em quatro passos.</p></div><Button onClick={() => { setOnboardingStep(1); setShowOnboarding(true); }} variant="outline" className="h-9 rounded-xl border-[#ddcfac] text-xs font-semibold text-[#8c6a18]"><Palette size={14} /> Abrir onboarding</Button></div><div className="mt-4 grid gap-3 sm:grid-cols-4">{[[1, "Dados da operação", "nome, slug e cidade"], [2, "Identidade", "logo e cor da marca"], [3, "Plano", "limites e billing"], [4, "Equipe", "convites e permissões"]].map(([step, title, detail]) => <button onClick={() => { setOnboardingStep(Number(step)); setShowOnboarding(true); }} key={String(step)} className={cn("rounded-xl border p-3 text-left", onboardingStep === Number(step) ? "border-[#d3b664] bg-[#fffbf1]" : "border-[#eee9df]")}><div className="flex items-center justify-between"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f1e3be] text-[10px] font-bold text-[#96721a]">{step}</span><ChevronRight size={14} className="text-[#b5a98f]" /></div><p className="mt-3 text-xs font-semibold text-[#5a5142]">{title}</p><p className="mt-1 text-[10px] text-[#a09789]">{detail}</p></button>)}</div></div>

    {showOnboarding && <div className="fixed inset-0 z-50 overflow-y-auto bg-[#fffdf9] p-4 sm:p-8"><div className="min-h-[calc(100vh-2rem)] w-full max-w-5xl mx-auto overflow-y-auto rounded-2xl bg-[#fffdf9] p-6 sm:p-10"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-[#b08317]">Onboarding SaaS · etapa {onboardingStep}/4</p><h3 className="mt-2 text-2xl font-semibold tracking-[-.04em] text-[#2a2419]">Configure seu novo workspace</h3></div><button onClick={() => setShowOnboarding(false)} className="rounded-lg p-2 text-[#978e7e] hover:bg-[#f7f1e5]"><X size={18} /></button></div><div className="mt-7">{onboardingStep === 1 && <div className="space-y-4"><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Cliente cadastrado</label><select value={selectedClientId} onChange={(event) => { const client = registeredClients?.find((item) => item.id === event.target.value); setSelectedClientId(event.target.value); if (client) { setBrandName(client.name); setInviteEmail(client.email); } }} className="h-11 w-full rounded-xl border border-[#dfd6c5] bg-white px-3 text-sm text-[#544b3b]"><option value="">Selecione um cliente</option>{(registeredClients ?? []).filter((client) => client.module !== "administrador").map((client) => <option key={client.id} value={client.id}>{client.name} · {client.email} · {client.module}</option>)}</select></div><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Workspace</label><Input value={brandName} readOnly placeholder="Selecione o cliente acima" className="h-11 rounded-xl border-[#dfd6c5] bg-[#faf7ef]" /></div><div className="rounded-xl bg-[#f8f1df] p-3 text-xs leading-5 text-[#816f45]"><ShieldCheck size={15} className="mb-1 inline" /> Este tenant ficará isolado por organização no banco e terá membros próprios.</div></div>}{onboardingStep === 2 && <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl border border-dashed border-[#d8c79e] bg-[#fffbf1] p-8 text-center"><ImagePlus size={24} className="mx-auto text-[#b08317]" /><p className="mt-3 text-xs font-semibold text-[#5d513b]">Adicionar logo da operação</p><p className="mt-1 text-[10px] text-[#a2957e]">PNG ou SVG · até 2 MB</p></div><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Cor principal</label><div className="flex items-center gap-3"><input type="color" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} className="h-11 w-14 cursor-pointer rounded-lg border-0 bg-transparent" /><Input value={brandColor} onChange={(event) => setBrandColor(event.target.value)} className="h-11 rounded-xl border-[#dfd6c5]" /></div><p className="mt-3 text-xs leading-5 text-[#948b7d]">A marca do tenant pode ser diferente da marca central ARKE.</p></div></div>}{onboardingStep === 3 && <div className="space-y-3"><select value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value as Plan["id"])} className="h-12 w-full rounded-xl border border-[#dfd6c5] bg-white px-3 text-sm text-[#544b3b]">{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.price} · {plan.limits}</option>)}</select></div>}{onboardingStep === 4 && <div className="space-y-4"><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Cliente responsável</label><select value={selectedClientId} onChange={(event) => { const client = registeredClients?.find((item) => item.id === event.target.value); setSelectedClientId(event.target.value); if (client) setInviteEmail(client.email); }} className="h-11 w-full rounded-xl border border-[#dfd6c5] bg-white px-3 text-sm text-[#544b3b]"><option value="">Selecione o cliente responsável</option>{(registeredClients ?? []).filter((client) => client.module !== "administrador").map((client) => <option key={client.id} value={client.id}>{client.name} · {client.email}</option>)}</select></div><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Permissão inicial</label><select className="h-11 w-full rounded-xl border border-[#dfd6c5] bg-white px-3 text-sm text-[#544b3b]"><option>Manager — gestão da unidade</option><option>Professional — treinos e acompanhamento</option><option>Viewer — somente leitura</option></select></div><div className="rounded-xl bg-[#f8f1df] p-3 text-xs leading-5 text-[#816f45]"><Users size={15} className="mb-1 inline" /> O convite será salvo como pending e expira em 72 horas.</div></div>}</div><div className="mt-8 flex items-center justify-between border-t border-[#eee9df] pt-5"><Button onClick={() => onboardingStep === 1 ? setShowOnboarding(false) : setOnboardingStep((step) => step - 1)} variant="ghost" className="h-10 rounded-xl text-xs text-[#8d806a]">{onboardingStep === 1 ? "Cancelar" : "Voltar"}</Button><Button onClick={() => { if (onboardingStep < 4) setOnboardingStep((step) => step + 1); else { const name = brandName.trim(); const slug = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "nova-operacao"; if (!selectedClientId) return onToast({ title: "Selecione um cliente", detail: "O workspace precisa estar vinculado a um cliente cadastrado." }); createOrganizationMutation.mutate({ clientId: selectedClientId, name, slug, plan: selectedPlan }, { onSuccess: () => { setShowOnboarding(false); saveBrand(); onToast({ title: "Licença criada", detail: `${name} foi persistida e vinculada ao cliente selecionado.` }); }, onError: (error) => onToast({ title: "Não foi possível criar a licença", detail: error.message }) }); } }} className="h-10 rounded-xl bg-[#15130f] px-5 text-xs font-semibold text-white hover:bg-[#2b271d]">{onboardingStep < 4 ? "Continuar" : "Concluir onboarding"} <ArrowRight size={14} /></Button></div></div></div>}
  </div>;
}

function Kpi({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: any }) { return <Card className="rounded-2xl border-[#e4dfd4] bg-[#fffdf9] shadow-[0_6px_24px_rgba(57,46,25,.05)]"><CardContent className="p-5"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f4e8c9] text-[#a97f18]"><Icon size={17} /></div><p className="mt-5 text-[12px] font-medium text-[#938a7c]">{label}</p><p className="mt-1 text-2xl font-semibold tracking-[-.05em] text-[#332c20]">{value}</p><p className="mt-1 text-[11px] text-[#aaa193]">{detail}</p></CardContent></Card>; }
