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
const allBillingPlans = [
  ...plans,
  { id: "unlimited", name: "Unlimited", price: "R$ 3.490/mês", limits: "Unidades, alunos e usuários ilimitados" },
  { id: "essencial", name: "Essencial", price: "R$ 149/mês", limits: "Profissionais · operação essencial" },
  { id: "performance", name: "Performance", price: "R$ 249/mês", limits: "Profissionais · acompanhamento avançado" },
  { id: "premium", name: "Premium", price: "R$ 199/mês", limits: "Profissionais · recursos premium" },
] as const;
const policyModules = ["Dashboard", "Academias", "Profissionais", "App do aluno", "Agenda", "Financeiro", "Integrações"] as const;

export default function SaasPage({ tenantName, onTenantChange, onToast }: Props) {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [editingLicenseId, setEditingLicenseId] = useState<number | null>(null);
  const [editingClientId, setEditingClientId] = useState("");
  const [editingStatus, setEditingStatus] = useState<"trialing" | "active" | "past_due" | "canceled">("trialing");
  const [logoDataUrl, setLogoDataUrl] = useState("");
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
  const [selectedPolicyClientId, setSelectedPolicyClientId] = useState("");
  const { data: organizations } = trpc.saas.organizations.list.useQuery(undefined, { enabled: Boolean(sessionUser) });
  const licenseRows = organizations?.map((entry) => { const client = registeredClients?.find((item) => item.id === entry.organization.clientId); return { name: entry.organization.name, type: client?.module ?? (entry.organization.clientId ? "Cliente licenciado" : "Organização"), profile: client?.role ?? "Administrador da licença", plan: entry.organization.plan, status: entry.organization.status, initials: entry.organization.name.slice(0, 2).toUpperCase(), organizationId: entry.organization.id, clientId: entry.organization.clientId }; }) ?? [];
  const realOrganizationId = organizations?.find((entry) => entry.organization.name === tenantName)?.organization.id;
  const policyOrganizationId = organizations?.find((entry) => entry.organization.clientId === selectedPolicyClientId)?.organization.id ?? realOrganizationId;
  const { data: access } = trpc.saas.organizations.access.useQuery({ organizationId: policyOrganizationId ?? 0 }, { enabled: Boolean(policyOrganizationId) });
  const saveOnboardingMutation = trpc.saas.organizations.saveOnboarding.useMutation();
  const updatePolicyMutation = trpc.saas.organizations.updatePolicy.useMutation();
  const inviteMutation = trpc.saas.organizations.invite.useMutation();
  const acceptInviteMutation = trpc.saas.organizations.acceptInvite.useMutation();
  const createUnitMutation = trpc.saas.organizations.createUnit.useMutation();
  const createOrganizationMutation = trpc.saas.organizations.create.useMutation();
  const subscription = trpc.saas.organizations.subscription.useQuery({ organizationId: realOrganizationId ?? 0 }, { enabled: Boolean(realOrganizationId) });
  const updateSubscriptionMutation = trpc.saas.organizations.updateSubscription.useMutation();
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
    if (!realOrganizationId) return onToast({ title: "Selecione uma licença", detail: "Escolha uma licença cadastrada antes de alterar o plano." });
    updateSubscriptionMutation.mutate({ organizationId: realOrganizationId, plan, status: "active" }, { onSuccess: () => { setBillingStatus("active"); onToast({ title: "Plano persistido", detail: `A assinatura ${plan} foi atualizada no banco de dados.` }); }, onError: (error) => onToast({ title: "Não foi possível atualizar o plano", detail: error.message }) });
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
    if (policyOrganizationId && unitId) updatePolicyMutation.mutate({ organizationId: policyOrganizationId, unitId, role: "manager", module: policyModule.toLowerCase().replace("app do aluno", "alunos") as "dashboard" | "academias" | "profissionais" | "alunos" | "agenda" | "financeiro" | "integracoes", canView: policyView ? 1 : 0, canManage: policyManage ? 1 : 0 });
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

  const activeOrganizations = (organizations ?? []).filter((entry) => ["active", "trial", "trialing"].includes(String(entry.organization.status)));
  const planPrices: Record<string, number> = { starter: 399, growth: 799, scale: 1490, unlimited: 3490, essencial: 149, performance: 249, premium: 199 };
  const mrr = activeOrganizations.reduce((total, entry) => total + (planPrices[String(entry.organization.plan).toLowerCase()] ?? 0), 0);
  const provisionedUsers = registeredClients?.filter((client) => client.module !== "administrador").length ?? 0;
  const formatCurrency = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  const policyToggles: Array<{ label: string; value: boolean; onChange: (value: boolean) => void; detail: string }> = [
    { label: "Visualizar módulo", value: policyView, onChange: setPolicyView, detail: "Acessa dados e indicadores do módulo" },
    { label: "Gerenciar módulo", value: policyManage, onChange: setPolicyManage, detail: "Pode criar, editar e operar registros" },
  ];

  if (editingLicenseId) {
    const license = licenseRows.find((item) => item.organizationId === editingLicenseId);
    if (!license) return null;
    return <div className="min-h-screen bg-[#fffdf9] p-5 sm:p-10"><div className="mx-auto max-w-5xl"><button onClick={() => setEditingLicenseId(null)} className="mb-8 text-sm font-semibold text-[#98741a]">← Voltar para licenças</button><div className="mb-8"><p className="text-xs font-bold uppercase tracking-[.16em] text-[#b88918]">Edição de licença</p><h1 className="mt-2 text-3xl font-semibold text-[#231f18]">{license.name}</h1><p className="mt-2 text-sm text-[#766f62]">Cadastro completo do cliente, perfil, plano, status e identidade da licença.</p></div><div className="grid gap-5 md:grid-cols-2"><Card className="rounded-2xl border-[#e4dfd4] bg-white"><CardHeader><CardTitle>Dados da licença</CardTitle></CardHeader><CardContent className="space-y-4"><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Cliente cadastrado</label><select value={editingClientId} onChange={(event) => setEditingClientId(event.target.value)} className="h-11 w-full rounded-xl border border-[#dfd6c5] bg-white px-3 text-sm text-[#544b3b]"><option value="">Selecione o cliente</option>{(registeredClients ?? []).filter((client) => client.module !== "administrador").map((client) => <option key={client.id} value={client.id}>{client.name} · {client.email} · {client.module}</option>)}</select><p className="mt-2 text-[10px] text-[#9b9282]">A edição deve continuar vinculada ao cadastro correto do cliente.</p></div><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Perfil</label><Input value={license.profile} readOnly className="h-11 rounded-xl bg-[#faf7ef]" /></div><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Status</label><select value={editingStatus} onChange={(event) => setEditingStatus(event.target.value as "trialing" | "active" | "past_due" | "canceled")} className="h-11 w-full rounded-xl border border-[#dfd6c5] bg-white px-3 text-sm"><option value="trialing">trial</option><option value="active">active</option><option value="past_due">past_due</option><option value="canceled">canceled</option></select></div></CardContent></Card><Card className="rounded-2xl border-[#e4dfd4] bg-white"><CardHeader><CardTitle>Plano e operação</CardTitle></CardHeader><CardContent className="space-y-4"><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Plano</label><select value={license.plan} onChange={(event) => choosePlan(event.target.value as Plan["id"])} className="h-11 w-full rounded-xl border border-[#dfd6c5] bg-white px-3 text-sm">{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.price}</option>)}</select></div><div className="rounded-xl bg-[#f8f1df] p-4 text-xs leading-5 text-[#816f45]">A licença está vinculada ao cliente no banco e suas unidades, memberships, políticas e auditoria permanecem isoladas.</div><Button onClick={() => { if (!editingClientId) return onToast({ title: "Selecione um cliente", detail: "Escolha o cadastro correto antes de salvar a licença." }); updateSubscriptionMutation.mutate({ organizationId: license.organizationId, plan: license.plan as Plan["id"], status: editingStatus }, { onSuccess: () => { setEditingLicenseId(null); onToast({ title: "Licença atualizada", detail: "Cliente, plano e status foram persistidos no banco." }); }, onError: (error) => onToast({ title: "Não foi possível salvar", detail: error.message }) }); }} className="h-11 w-full rounded-xl bg-[#15130f] text-white">Salvar e voltar</Button></CardContent></Card></div></div></div>;
  }

  return <div className="mx-auto max-w-[1440px] p-5 sm:p-8" style={{ ["--tenant-accent" as string]: brandColor }}>
    <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#b88918]"><span className="h-1.5 w-1.5 rounded-full bg-[#d4a017]" /> SaaS • multi-tenant</div><h2 className="text-3xl font-semibold tracking-[-.055em] text-[#231f18] sm:text-4xl">Licenças & planos</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#766f62]">Crie e configure licenças Arke completas: cliente, workspace, plano, cobrança, unidades, equipe e permissões.</p></div><div className="flex flex-wrap gap-2"><Button onClick={() => { setOnboardingStep(1); setShowOnboarding(true); }} className="h-10 rounded-xl bg-[#15130f] px-4 text-xs font-semibold text-white hover:bg-[#2b271d]"><Rocket size={15} /> Criar novo workspace</Button><Button onClick={() => { setBrandName(""); setOnboardingStep(1); setShowOnboarding(true); }} variant="outline" className="h-10 rounded-xl border-[#ded8ca] bg-[#fffdf9] text-xs font-semibold text-[#6e5b2b]"><Users size={15} /> Criar tenant</Button></div></div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="Licenças ativas" value={String(activeOrganizations.length)} detail="organizações persistidas" icon={ShieldCheck} /><Kpi label="MRR da plataforma" value={formatCurrency(mrr)} detail="receita recorrente persistida" icon={CircleDollarSign} /><Kpi label="Clientes cadastrados" value={String(provisionedUsers)} detail="clientes operacionais" icon={Users} /><Kpi label="Uso contratado" value="—" detail="calculado por licença" icon={Crown} /></div>

    <div className="mt-5 grid gap-5 xl:grid-cols-[1.18fr_.82fr]"><Card className="rounded-2xl border-[#e4dfd4] bg-[#fffdf9] shadow-[0_6px_24px_rgba(57,46,25,.05)]"><CardHeader className="flex flex-row items-center justify-between pb-3"><div><CardTitle className="text-base font-semibold text-[#2b271f]">Carteira de licenças</CardTitle><p className="mt-1 text-xs text-[#918a7d]">Todas as licenças criadas ficam listadas aqui com cliente, perfil, status e edição completa.</p></div><Badge className="border-0 bg-[#f5ead0] text-[10px] font-bold text-[#98741a]">Isolamento ativo</Badge></CardHeader><CardContent className="space-y-2">{licenseRows.length === 0 ? <div className="rounded-2xl border border-dashed border-[#ded8ca] bg-[#faf7ef] p-8 text-center text-sm text-[#8d806a]">Nenhuma licença cadastrada para os clientes selecionados.</div> : licenseRows.map((tenant) => <div key={tenant.organizationId} className={cn("flex flex-col gap-3 rounded-2xl border p-4 transition sm:flex-row sm:items-center", tenantName === tenant.name ? "border-[#d3b664] bg-[#fffbf1]" : "border-[#eee9df]")}><div className="flex flex-1 items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f4e8c9] text-xs font-bold text-[#946f14]">{tenant.initials}</div><div><p className="text-sm font-semibold text-[#413a2f]">{tenant.name}</p><p className="mt-1 text-[11px] text-[#9b9488]">{tenant.type} · {tenant.profile}</p><p className="mt-1 text-[10px] text-[#a79c8b]">Plano {tenant.plan} · {tenant.status}</p></div></div><div className="grid grid-cols-2 gap-4 sm:flex sm:items-center"><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#aaa193]">Ciclo</p><p className="mt-1 text-xs font-semibold text-[#6b624f]">Mensal</p></div><div><p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#aaa193]">Faturamento</p><p className="mt-1 text-xs font-semibold text-[#6b624f]">Recorrente</p></div><Button onClick={() => { setEditingLicenseId(tenant.organizationId); setEditingClientId(tenant.clientId ?? ""); setEditingStatus(tenant.status === "trial" ? "trialing" : tenant.status as "active" | "past_due" | "canceled"); }} className={cn("h-8 rounded-lg px-3 text-[11px] font-semibold", tenantName === tenant.name ? "bg-[#f3e6c5] text-[#937018] hover:bg-[#f3e6c5]" : "bg-[#15130f] text-white hover:bg-[#2b271d]")}>Editar licença</Button></div></div>)}</CardContent></Card><Card className="rounded-2xl border-[#231f18] bg-[#15130f] text-white shadow-[0_10px_30px_rgba(33,27,16,.15)]"><CardContent className="flex h-full flex-col p-6"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d4a017] text-[#15130f]"><Rocket size={19} /></div><p className="mt-6 text-xs font-bold uppercase tracking-[.14em] text-[#d4a017]">Configuração da licença</p><h3 className="mt-2 text-2xl font-semibold leading-tight tracking-[-.04em]">Venda a plataforma. Escale a operação.</h3><p className="mt-3 text-sm leading-6 text-[#c6c0b3]">Cada cliente possui dados, usuários, limites e marca próprios, enquanto a ARKE mantém a administração central.</p><div className="mt-auto pt-7"><div className="flex items-center justify-between text-xs text-[#c6c0b3]"><span>Trial médio convertido</span><strong className="text-[#d4a017]">38%</strong></div><div className="mt-2 h-2 rounded-full bg-white/10"><div className="h-full w-[38%] rounded-full bg-[#d4a017]" /></div><Button onClick={() => { setOnboardingStep(1); setShowOnboarding(true); }} variant="outline" className="mt-6 h-10 w-full rounded-xl border-white/20 bg-white/5 text-xs font-semibold text-white hover:bg-white/10">Continuar configuração <ArrowRight size={15} /></Button></div></CardContent></Card></div>

    <div className="mt-5 rounded-2xl border border-[#e4dfd4] bg-[#fffdf9] p-5 shadow-[0_6px_24px_rgba(57,46,25,.05)]"><div className="flex items-center justify-between"><div><p className="flex items-center gap-2 text-sm font-semibold text-[#3c3529]"><ShieldCheck size={15} className="text-[#b08317]" /> Auditoria de alterações</p><p className="mt-1 text-xs text-[#948b7d]">Registro por usuário, tenant, unidade e entidade afetada.</p></div><div className="flex items-center gap-2"><Badge className="border-0 bg-[#f5ead0] text-[10px] font-bold text-[#98741a]">Rastreável</Badge><Button onClick={exportAuditCsv} variant="outline" className="h-8 rounded-lg border-[#ddcfac] px-2 text-[10px] font-semibold text-[#98741a]">CSV</Button><Button onClick={exportAuditPdf} variant="outline" className="h-8 rounded-lg border-[#ddcfac] px-2 text-[10px] font-semibold text-[#98741a]">PDF</Button></div></div><div className="mt-4 grid gap-2 rounded-xl bg-[#faf7ef] p-3 sm:grid-cols-4"><Input type="date" value={auditFrom} onChange={(event) => setAuditFrom(event.target.value)} className="h-8 rounded-lg border-[#e2dcca] bg-white text-[10px]" aria-label="Data inicial" /><Input type="date" value={auditTo} onChange={(event) => setAuditTo(event.target.value)} className="h-8 rounded-lg border-[#e2dcca] bg-white text-[10px]" aria-label="Data final" /><Input type="number" min="1" value={auditUser} onChange={(event) => setAuditUser(event.target.value)} placeholder="ID do usuário" className="h-8 rounded-lg border-[#e2dcca] bg-white text-[10px]" /><select value={auditEntity} onChange={(event) => setAuditEntity(event.target.value)} className="h-8 rounded-lg border border-[#e2dcca] bg-white px-2 text-[10px] text-[#6b624f]"><option value="all">Todas as entidades</option><option value="module_policy">Políticas</option><option value="onboarding_branding">Branding / onboarding</option><option value="organization_unit">Unidades</option><option value="invitation">Convites</option></select></div><div className="mt-4 grid gap-2 sm:grid-cols-3">{(auditEntries?.slice(0, 3) ?? []).map((entry, index) => <div key={String(entry.entity) + index} className="rounded-xl bg-[#faf7ef] p-3"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.1em] text-[#b08317]">{entry.action}</span><span className="text-[10px] text-[#aaa193]">agora</span></div><p className="mt-2 text-xs font-semibold text-[#5a5142]">{entry.entity === "module_policy" ? "Política de módulo" : entry.entity === "onboarding_branding" ? "Branding / onboarding" : "Unidade organizacional"}</p><p className="mt-1 text-[10px] text-[#9d9486]">Alteração registrada sem apagar o histórico.</p></div>)}</div></div>

    {showOnboarding && <div className="fixed inset-0 z-50 overflow-y-auto bg-[#fffdf9] p-4 sm:p-8"><div className="min-h-[calc(100vh-2rem)] w-full max-w-5xl mx-auto overflow-y-auto rounded-2xl bg-[#fffdf9] p-6 sm:p-10"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-[#b08317]">Onboarding SaaS · etapa {onboardingStep}/4</p><h3 className="mt-2 text-2xl font-semibold tracking-[-.04em] text-[#2a2419]">Configure seu novo workspace</h3></div><button onClick={() => setShowOnboarding(false)} className="rounded-lg p-2 text-[#978e7e] hover:bg-[#f7f1e5]"><X size={18} /></button></div><div className="mt-7">{onboardingStep === 1 && <div className="space-y-4"><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Cliente cadastrado</label><select value={selectedClientId} onChange={(event) => { const client = registeredClients?.find((item) => item.id === event.target.value); setSelectedClientId(event.target.value); if (client) { setBrandName(client.name); setInviteEmail(client.email); } }} className="h-11 w-full rounded-xl border border-[#dfd6c5] bg-white px-3 text-sm text-[#544b3b]"><option value="">Selecione um cliente</option>{(registeredClients ?? []).filter((client) => client.module !== "administrador").map((client) => <option key={client.id} value={client.id}>{client.name} · {client.email} · {client.module}</option>)}</select></div><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Workspace</label><Input value={brandName} readOnly placeholder="Selecione o cliente acima" className="h-11 rounded-xl border-[#dfd6c5] bg-[#faf7ef]" /></div><div className="rounded-xl bg-[#f8f1df] p-3 text-xs leading-5 text-[#816f45]"><ShieldCheck size={15} className="mb-1 inline" /> Este tenant ficará isolado por organização no banco e terá membros próprios.</div></div>}{onboardingStep === 2 && <div className="grid gap-4 sm:grid-cols-2"><label className="block cursor-pointer rounded-2xl border border-dashed border-[#d8c79e] bg-[#fffbf1] p-8 text-center"><input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) return onToast({ title: "Logo muito grande", detail: "Selecione uma imagem de até 2 MB." }); const reader = new FileReader(); reader.onload = () => setLogoDataUrl(String(reader.result ?? "")); reader.readAsDataURL(file); }} /><ImagePlus size={24} className="mx-auto text-[#b08317]" />{logoDataUrl ? <img src={logoDataUrl} alt="Prévia da logo" className="mx-auto mt-3 h-16 max-w-[180px] object-contain" /> : <p className="mt-3 text-xs font-semibold text-[#5d513b]">Importar logo da operação</p>}<p className="mt-1 text-[10px] text-[#a2957e]">PNG, JPG, WEBP ou SVG · até 2 MB</p></label><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Cor principal</label><div className="flex items-center gap-3"><input type="color" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} className="h-11 w-14 cursor-pointer rounded-lg border-0 bg-transparent" /><Input value={brandColor} onChange={(event) => setBrandColor(event.target.value)} className="h-11 rounded-xl border-[#dfd6c5]" /></div><p className="mt-3 text-xs leading-5 text-[#948b7d]">A marca do tenant pode ser diferente da marca central ARKE.</p></div></div>}{onboardingStep === 3 && <div className="space-y-3"><select value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value as Plan["id"])} className="h-12 w-full rounded-xl border border-[#dfd6c5] bg-white px-3 text-sm text-[#544b3b]">{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.price} · {plan.limits}</option>)}</select></div>}{onboardingStep === 4 && <div className="space-y-4"><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Cliente responsável</label><select value={selectedClientId} onChange={(event) => { const client = registeredClients?.find((item) => item.id === event.target.value); setSelectedClientId(event.target.value); if (client) setInviteEmail(client.email); }} className="h-11 w-full rounded-xl border border-[#dfd6c5] bg-white px-3 text-sm text-[#544b3b]"><option value="">Selecione o cliente responsável</option>{(registeredClients ?? []).filter((client) => client.module !== "administrador").map((client) => <option key={client.id} value={client.id}>{client.name} · {client.email}</option>)}</select></div><div><label className="mb-2 block text-xs font-semibold text-[#665b49]">Permissão inicial</label><select className="h-11 w-full rounded-xl border border-[#dfd6c5] bg-white px-3 text-sm text-[#544b3b]"><option>Manager — gestão da unidade</option><option>Professional — treinos e acompanhamento</option><option>Viewer — somente leitura</option></select></div><div className="rounded-xl bg-[#f8f1df] p-3 text-xs leading-5 text-[#816f45]"><Users size={15} className="mb-1 inline" /> O convite será salvo como pending e expira em 72 horas.</div></div>}</div><div className="mt-8 flex items-center justify-between border-t border-[#eee9df] pt-5"><Button onClick={() => onboardingStep === 1 ? setShowOnboarding(false) : setOnboardingStep((step) => step - 1)} variant="ghost" className="h-10 rounded-xl text-xs text-[#8d806a]">{onboardingStep === 1 ? "Cancelar" : "Voltar"}</Button><Button onClick={() => { if (onboardingStep < 4) setOnboardingStep((step) => step + 1); else { const name = brandName.trim(); const slug = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "nova-operacao"; if (!selectedClientId) return onToast({ title: "Selecione um cliente", detail: "O workspace precisa estar vinculado a um cliente cadastrado." }); createOrganizationMutation.mutate({ clientId: selectedClientId, logoUrl: logoDataUrl || undefined, primaryColor: brandColor, name, slug, plan: selectedPlan }, { onSuccess: () => { setShowOnboarding(false); saveBrand(); onToast({ title: "Licença criada", detail: `${name} foi persistida e vinculada ao cliente selecionado.` }); }, onError: (error) => onToast({ title: "Não foi possível criar a licença", detail: error.message }) }); } }} className="h-10 rounded-xl bg-[#15130f] px-5 text-xs font-semibold text-white hover:bg-[#2b271d]">{onboardingStep < 4 ? "Continuar" : "Concluir onboarding"} <ArrowRight size={14} /></Button></div></div></div>}
  </div>;
}

function Kpi({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: any }) { return <Card className="rounded-2xl border-[#e4dfd4] bg-[#fffdf9] shadow-[0_6px_24px_rgba(57,46,25,.05)]"><CardContent className="p-5"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f4e8c9] text-[#a97f18]"><Icon size={17} /></div><p className="mt-5 text-[12px] font-medium text-[#938a7c]">{label}</p><p className="mt-1 text-2xl font-semibold tracking-[-.05em] text-[#332c20]">{value}</p><p className="mt-1 text-[11px] text-[#aaa193]">{detail}</p></CardContent></Card>; }
