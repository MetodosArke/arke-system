import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, BarChart3, Building2, CalendarDays, Check, ChevronRight, CircleDollarSign, FileCheck2, Link2, Plus, RefreshCw, ShieldCheck, Users, WalletCards, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import type { ViewKey } from "@/App";
import { MODULE_LABELS, type ModuleKey } from "@/lib/appCatalog";
import SaasPage from "@/pages/SaasPage";
import { StudentManagementPage, UserManagementPage } from "@/components/CrudManagement";
import { GlobalLibraryAdmin } from "@/components/GlobalLibraryAdmin";
import { ProfessionalDashboard } from "@/components/ProfessionalDashboard";
import { StudentDashboard } from "@/components/StudentDashboard";
import { MinhaFila } from "@/components/MinhaFila";
import { Gestao } from "@/components/Gestao";
import { Studio } from "@/components/Studio";
import { MinhasTurmas } from "@/components/MinhasTurmas";
import { Crm } from "@/components/Crm";

type Toast = { title: string; detail: string } | null;
type User = { name: string; username?: string; role?: string };
type HomeProps = { view: ViewKey; setView: (view: ViewKey) => void; user: User; module: ModuleKey; logoUrl?: string; tenantName: string; onTenantChange: (name: string) => void };

function ToastMessage({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  if (!toast) return null;
  return <div className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-2xl border border-[#ebe1c8] bg-white p-4 shadow-xl"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f2e5c4] text-[#4b955e]"><Check size={16} /></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[#2c4634]">{toast.title}</p><p className="mt-0.5 text-xs leading-5 text-[#7e8f84]">{toast.detail}</p></div><button onClick={onClose} className="text-[#9ca9a0]"><X size={15} /></button></div>;
}

function PageIntro({ eyebrow, title, detail, action, onAction }: { eyebrow: string; title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#b08317]"><span className="h-1.5 w-1.5 rounded-full bg-[#91ce68]" /> {eyebrow}</div><h2 className="text-3xl font-semibold tracking-[-.055em] text-[#2b271f] sm:text-4xl">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#77877d]">{detail}</p></div>{action && onAction && <Button onClick={onAction} className="h-10 shrink-0 rounded-xl bg-[#15130f] px-4 text-xs font-semibold text-white hover:bg-[#2b271d]"><Plus size={15} /> {action}</Button>}</div>;
}

function StatCard({ label, value, detail, icon: Icon, tone = "green" }: { label: string; value: string; detail: string; icon: typeof Users; tone?: "green" | "purple" | "orange" | "blue" }) {
  const tones = { green: "bg-[#f5ead0] text-[#a47b13]", purple: "bg-[#eee9da] text-[#9a7a2a]", orange: "bg-[#f8eedb] text-[#a47b13]", blue: "bg-[#eceae2] text-[#4b8da2]" };
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="p-5"><div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", tones[tone])}><Icon size={17} /></div><p className="mt-5 text-[12px] font-medium text-[#849289]">{label}</p><p className="mt-1 text-2xl font-semibold tracking-[-.05em] text-[#2b271f]">{value}</p><p className="mt-1 text-[11px] text-[#aaa193]">{detail}</p></CardContent></Card>;
}

function EmptyState({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="rounded-2xl border border-dashed border-[#dfd8c8] bg-[#fffdf9] p-8 text-center"><p className="text-sm font-semibold text-[#51483a]">{title}</p><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[#918a7d]">{detail}</p>{action && onAction && <Button onClick={onAction} className="mt-4 h-9 rounded-xl bg-[#15130f] text-xs text-white"><Plus size={14} /> {action}</Button>}</div>;
}

function Dashboard({ setView, module, tenantName, user }: { setView: (view: ViewKey) => void; module: ModuleKey; tenantName: string; user: User }) {
  const studentsQuery = trpc.admin.students.list.useQuery();
  const usersQuery = trpc.admin.users.list.useQuery();
  const activeStudents = studentsQuery.data?.filter((student) => student.status === "Ativo").length ?? 0;
  const activeUsers = usersQuery.data?.filter((item) => item.status === "Ativo").length ?? 0;
  const label = MODULE_LABELS[module];
  return <div className="mx-auto max-w-[1440px] p-5 sm:p-8"><PageIntro eyebrow={`${label} • operação`} title={`Olá, ${user.name}.`} detail={tenantName ? `Dados persistidos da operação ${tenantName}.` : "Selecione uma operação vinculada ao seu acesso."} action={module === "administrador" ? "Novo cliente" : "Novo registro"} onAction={() => setView(module === "administrador" ? "admin" : module === "profissional" ? "profissionais" : "alunos")} /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><StatCard label="Alunos ativos" value={String(activeStudents)} detail="registros no banco" icon={Users} /><StatCard label="Usuários ativos" value={String(activeUsers)} detail="app_users ativos" icon={ShieldCheck} tone="purple" /><StatCard label="Clientes em escopo" value={module === "administrador" ? String(usersQuery.data?.length ?? 0) : String(usersQuery.data?.filter((item) => item.module === module).length ?? 0)} detail="sem dados artificiais" icon={Building2} tone="orange" /></div><div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_.8fr]"><Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">Base operacional</CardTitle><p className="mt-1 text-xs text-[#918a7d]">Os indicadores abaixo são derivados exclusivamente das consultas persistidas.</p></CardHeader><CardContent>{studentsQuery.isLoading || usersQuery.isLoading ? <p className="text-sm text-[#8b978e]">Carregando dados...</p> : <div className="space-y-3"><div className="flex items-center justify-between rounded-xl bg-[#faf7ef] p-4"><span className="text-xs text-[#6d7d72]">Cadastros de alunos</span><strong className="text-sm text-[#4b4438]">{studentsQuery.data?.length ?? 0}</strong></div><div className="flex items-center justify-between rounded-xl bg-[#faf7ef] p-4"><span className="text-xs text-[#6d7d72]">Cadastros de usuários/clientes</span><strong className="text-sm text-[#4b4438]">{usersQuery.data?.length ?? 0}</strong></div></div>}</CardContent></Card><Card className="rounded-2xl border-[#231f18] bg-[#15130f] text-white shadow-sm"><CardContent className="flex h-full flex-col p-6"><ShieldCheck className="text-[#d4a017]" size={24} /><h3 className="mt-5 text-2xl font-semibold leading-tight">Nenhum dado é inventado.</h3><p className="mt-3 text-sm leading-6 text-[#c1d3c7]">Quando não houver registros persistidos, o Arke mostra estado vazio e orienta o próximo cadastro.</p><Button onClick={() => setView(module === "administrador" ? "admin" : "alunos")} variant="outline" className="mt-auto h-10 rounded-xl border-white/20 bg-white/5 text-xs font-semibold text-white hover:bg-white/10">Abrir operação <ArrowUpRight size={15} /></Button></CardContent></Card></div></div>;
}

function AgendaPage({ setView }: { setView: (view: ViewKey) => void }) {
  return <div className="mx-auto max-w-[1100px] p-5 sm:p-8"><PageIntro eyebrow="operação" title="Agenda" detail="A agenda será exibida aqui quando houver compromissos persistidos para a organização selecionada." action="Cadastrar registro" onAction={() => setView("admin")} /><EmptyState title="Nenhum compromisso cadastrado" detail="Cadastre o primeiro registro operacional para que ele apareça no calendário." action="Abrir cadastros" onAction={() => setView("admin")} /></div>;
}

const BILLING_MANAGER_ROLES = ["owner", "admin", "manager"];

function FinancePage({ onToast }: { onToast: (toast: NonNullable<Toast>) => void }) {
  const status = trpc.billing.asaasStatus.useQuery();
  const orgsQuery = trpc.saas.organizations.list.useQuery();
  const organizations = useMemo(() => (orgsQuery.data ?? []).filter((item) => BILLING_MANAGER_ROLES.includes(item.membership.role)), [orgsQuery.data]);
  const [organizationId, setOrganizationId] = useState("");
  const activeOrgId = organizationId || organizations[0]?.membership.organization_id || "";

  const payments = trpc.billing.organization.payments.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const rows = (payments.data ?? []) as Array<{ id?: string; invoice_url?: string; status?: string; value?: number | string }>;
  const utils = trpc.useUtils();
  const [billingType, setBillingType] = useState<"PIX" | "BOLETO" | "CREDIT_CARD">("PIX");
  const gerarCobranca = trpc.billing.organization.gerarCobranca.useMutation({
    onSuccess: (payment) => { onToast({ title: "Cobrança gerada", detail: payment.invoiceUrl ? `Fatura: ${payment.invoiceUrl}` : "Cobrança criada no Asaas." }); utils.billing.organization.payments.invalidate({ organizationId: activeOrgId }); },
    onError: (error) => onToast({ title: "Erro ao gerar cobrança", detail: error.message }),
  });

  if (orgsQuery.isLoading) return <div className="p-8 text-sm text-[#918a7d]">Carregando organizações...</div>;
  if (!organizations.length) return <div className="mx-auto max-w-lg p-8 text-center text-sm text-[#918a7d]">Sua conta não é owner/admin/manager de nenhuma organização com assinatura.</div>;

  return <div className="mx-auto max-w-[1440px] p-5 sm:p-8">
    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <PageIntro eyebrow="financeiro" title="Financeiro" detail="Cobranças reais da assinatura, geradas e sincronizadas via Asaas." />
      {organizations.length > 1 && <select value={activeOrgId} onChange={(e) => setOrganizationId(e.target.value)} className="h-10 rounded-xl border bg-white px-3 text-xs"><option value="">Selecione a organização</option>{organizations.map((org) => <option key={org.membership.organization_id} value={org.membership.organization_id}>{org.organization.name}</option>)}</select>}
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><StatCard label="Cobranças desta organização" value={String(rows.length)} detail="persistidas via webhook" icon={CircleDollarSign} /><StatCard label="Integração Asaas" value={status.data?.configured ? "Ativa" : "Não configurada"} detail={status.data ? `Ambiente: ${status.data.environment === "production" ? "produção" : "sandbox"}` : "status do servidor"} icon={Link2} tone="purple" /><StatCard label="Última sincronização" value={rows.length ? "Disponível" : "—"} detail="sem fallback local" icon={RefreshCw} tone="blue" /></div>

    <Card className="mt-5 rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">Gerar cobrança da mensalidade</CardTitle></CardHeader><CardContent className="flex flex-wrap items-center gap-2">
      <select value={billingType} onChange={(e) => setBillingType(e.target.value as typeof billingType)} className="h-9 rounded-lg border bg-white px-2 text-xs"><option value="PIX">PIX</option><option value="BOLETO">Boleto</option><option value="CREDIT_CARD">Cartão de crédito (link)</option></select>
      <Button onClick={() => gerarCobranca.mutate({ organizationId: activeOrgId, billingType })} disabled={!activeOrgId || gerarCobranca.isPending} className="h-9 rounded-lg bg-[#15130f] text-xs text-white">Gerar cobrança real</Button>
      <p className="text-[11px] text-[#9b9488]">Cartão via checkout transparente (tokenização) depende de habilitação pelo gerente de conta Asaas — o link acima funciona sem ela.</p>
    </CardContent></Card>

    <Card className="mt-5 rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">Cobranças persistidas</CardTitle></CardHeader><CardContent>{payments.isLoading ? <p className="text-sm text-[#8b978e]">Carregando...</p> : rows.length ? <div className="space-y-2">{rows.map((payment, index) => <div key={payment.id ?? index} className="flex items-center justify-between rounded-xl border border-[#eee9df] p-3"><div><p className="text-xs font-semibold text-[#4b4438]">{payment.invoice_url ? <a href={payment.invoice_url} target="_blank" rel="noreferrer" className="text-[#a47b13] underline">Ver fatura</a> : "Cobrança Asaas"}</p><p className="mt-1 text-[10px] text-[#9b9488]">{payment.status ?? "Sem status"}</p></div><span className="text-xs font-semibold text-[#53665a]">{payment.value ? `R$ ${Number(payment.value).toFixed(2)}` : "—"}</span></div>)}</div> : <EmptyState title="Nenhuma cobrança persistida" detail="Gere a primeira cobrança real acima para esta organização." />}</CardContent></Card>
  </div>;
}

const BENEFIT_LABEL: Record<"wellhub" | "totalpass", string> = { wellhub: "Wellhub", totalpass: "TotalPass" };
const BENEFIT_FIELDS: Record<"wellhub" | "totalpass", Array<{ key: string; label: string; secret?: boolean }>> = {
  wellhub: [{ key: "client_id", label: "Client ID" }, { key: "client_secret", label: "Client Secret", secret: true }, { key: "partner_id", label: "Partner ID" }],
  totalpass: [{ key: "app_key", label: "App Key" }, { key: "app_secret", label: "App Secret", secret: true }, { key: "gym_id", label: "Gym ID" }],
};

function BenefitProviderCard({ organizationId, provider, data, onToast }: { organizationId: string; provider: "wellhub" | "totalpass"; data: { enabled: boolean; configured: boolean; publicFields: Record<string, string> }; onToast: (toast: NonNullable<Toast>) => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<Record<string, string>>({});
  const save = trpc.integracoes.beneficios.save.useMutation({ onSuccess: () => { onToast({ title: `${BENEFIT_LABEL[provider]} salvo`, detail: "Credenciais persistidas para esta organização." }); setForm({}); utils.integracoes.beneficios.list.invalidate({ organizationId }); }, onError: (error) => onToast({ title: `Erro ao salvar ${BENEFIT_LABEL[provider]}`, detail: error.message }) });
  const fieldValue = (key: string) => form[key] ?? data.publicFields[key] ?? "";
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="flex items-center justify-between text-sm text-[#2b271f]"><span>{BENEFIT_LABEL[provider]}</span><Badge className={cn("border-0 text-[10px]", data.configured ? "bg-[#e5f2df] text-[#4e8b5b]" : "bg-[#f8e6df] text-[#b65c4d]")}>{data.configured ? "Vinculado" : "Não vinculado"}</Badge></CardTitle></CardHeader><CardContent className="space-y-2">
    {BENEFIT_FIELDS[provider].map((field) => <Input key={field.key} value={fieldValue(field.key)} onChange={(e) => setForm({ ...form, [field.key]: e.target.value })} placeholder={field.secret && data.configured ? `${field.label} (deixe em branco para manter)` : field.label} type={field.secret ? "password" : "text"} className="h-9 rounded-lg text-xs" />)}
    <Button onClick={() => save.mutate({ organizationId, provider, enabled: true, fields: form })} disabled={save.isPending} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white">Salvar vínculo</Button>
  </CardContent></Card>;
}

const TURNSTILE_BRAND_LABEL: Record<string, string> = { control_id: "Control iD", topdata: "Topdata", henry: "Henry", dimep: "Dimep", outra: "Outra" };
const TURNSTILE_CONFIG_FIELDS = [{ key: "host", label: "IP/host do equipamento" }, { key: "usuario", label: "Usuário" }, { key: "senha", label: "Senha", secret: true }, { key: "api_key", label: "API key (se houver)", secret: true }];

function TurnstileUnitCard({ organizationId, unit, onToast }: { organizationId: string; unit: { unitId: string; unitName: string; brand: string; model: string | null; enabled: boolean; configured: boolean }; onToast: (toast: NonNullable<Toast>) => void }) {
  const utils = trpc.useUtils();
  const [brand, setBrand] = useState(unit.brand);
  const [model, setModel] = useState(unit.model ?? "");
  const [config, setConfig] = useState<Record<string, string>>({});
  const save = trpc.integracoes.catraca.save.useMutation({ onSuccess: () => { onToast({ title: "Catraca configurada", detail: `${unit.unitName} vinculada ao adaptador certo.` }); setConfig({}); utils.integracoes.catraca.list.invalidate({ organizationId }); }, onError: (error) => onToast({ title: "Erro ao configurar catraca", detail: error.message }) });
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="flex items-center justify-between text-sm text-[#2b271f]"><span>{unit.unitName}</span><Badge className={cn("border-0 text-[10px]", unit.configured ? "bg-[#e5f2df] text-[#4e8b5b]" : "bg-[#f8e6df] text-[#b65c4d]")}>{unit.configured ? "Configurada" : "Não configurada"}</Badge></CardTitle></CardHeader><CardContent className="space-y-2">
    <select value={brand} onChange={(e) => setBrand(e.target.value)} className="h-9 w-full rounded-lg border bg-white px-2 text-xs">{Object.entries(TURNSTILE_BRAND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Modelo (opcional)" className="h-9 rounded-lg text-xs" />
    {TURNSTILE_CONFIG_FIELDS.map((field) => <Input key={field.key} value={config[field.key] ?? ""} onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })} placeholder={unit.configured && field.secret ? `${field.label} (deixe em branco para manter)` : field.label} type={field.secret ? "password" : "text"} className="h-9 rounded-lg text-xs" />)}
    <Button onClick={() => save.mutate({ organizationId, unitId: unit.unitId, brand: brand as "control_id" | "topdata" | "henry" | "dimep" | "outra", model: model || undefined, config, enabled: true })} disabled={save.isPending} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white">Salvar catraca</Button>
  </CardContent></Card>;
}

function IntegrationsPage({ module, onToast }: { module: ModuleKey; onToast: (toast: NonNullable<Toast>) => void }) {
  const status = trpc.billing.asaasStatus.useQuery();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEmail, setWebhookEmail] = useState("");
  const createWebhook = trpc.billing.admin.createWebhook.useMutation({ onSuccess: () => onToast({ title: "Webhook registrado no Asaas", detail: "Os eventos de pagamento passam a chegar em /api/webhooks/asaas." }), onError: (error) => onToast({ title: "Erro ao registrar webhook", detail: error.message }) });

  const orgsQuery = trpc.saas.organizations.list.useQuery();
  const organizations = useMemo(() => (orgsQuery.data ?? []).filter((item) => BILLING_MANAGER_ROLES.includes(item.membership.role)), [orgsQuery.data]);
  const [organizationId, setOrganizationId] = useState("");
  const activeOrgId = organizationId || organizations[0]?.membership.organization_id || "";

  const benefitsQuery = trpc.integracoes.beneficios.list.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const benefits = benefitsQuery.data ?? [];
  const accessQuery = trpc.saas.organizations.access.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const units = accessQuery.data?.units ?? [];
  const turnstilesQuery = trpc.integracoes.catraca.list.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const turnstiles = turnstilesQuery.data ?? [];
  const turnstileForUnit = (unitId: string) => turnstiles.find((t) => t.unitId === unitId) ?? { unitId, unitName: units.find((u) => u.id === unitId)?.name ?? "Unidade", brand: "outra", model: null, enabled: false, configured: false };

  return <div className="mx-auto max-w-[1100px] p-5 sm:p-8">
    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <PageIntro eyebrow="integrações" title="Integrações" detail="Status exibido a partir da configuração real do servidor. Cada organização vincula suas próprias credenciais — o parceiro é a academia, não a Arke." />
      {organizations.length > 1 && <select value={activeOrgId} onChange={(e) => setOrganizationId(e.target.value)} className="h-10 rounded-xl border bg-white px-3 text-xs"><option value="">Selecione a organização</option>{organizations.map((org) => <option key={org.membership.organization_id} value={org.membership.organization_id}>{org.organization.name}</option>)}</select>}
    </div>

    <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">Conectores configurados</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex items-center justify-between rounded-xl bg-[#faf7ef] p-4"><div className="flex items-center gap-3"><Link2 size={17} className="text-[#a47b13]" /><span className="text-xs font-semibold text-[#4b4438]">Asaas</span></div><Badge className={cn("border-0 text-[10px]", status.data?.configured ? "bg-[#e5f2df] text-[#4e8b5b]" : "bg-[#f8e6df] text-[#b65c4d]")}>{status.data?.configured ? `Configurado · ${status.data.environment === "production" ? "produção" : "sandbox"}` : "Não configurado"}</Badge></div><p className="text-xs leading-5 text-[#918a7d]">Nenhuma integração externa é simulada nesta tela. Sem configuração, o estado permanece vazio.</p></CardContent></Card>

    {module === "administrador" && <Card className="mt-5 rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">Registrar webhook de produção</CardTitle></CardHeader><CardContent className="space-y-2"><p className="text-xs leading-5 text-[#918a7d]">Chama a API do Asaas para criar o webhook apontando para <code>/api/webhooks/asaas</code> deste deploy. Cole a URL completa do domínio de produção.</p><Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://arkefit.com.br/api/webhooks/asaas" className="h-9 rounded-lg text-xs" /><Input value={webhookEmail} onChange={(e) => setWebhookEmail(e.target.value)} placeholder="E-mail para notificação de falhas" type="email" className="h-9 rounded-lg text-xs" /><Button onClick={() => createWebhook.mutate({ url: webhookUrl, email: webhookEmail })} disabled={!webhookUrl || !webhookEmail || createWebhook.isPending} className="h-9 rounded-lg bg-[#15130f] text-xs text-white">Registrar webhook</Button></CardContent></Card>}

    {!organizations.length && <p className="mt-5 text-xs text-[#918a7d]">Sua conta não é owner/admin/manager de nenhuma organização — benefícios e catraca são vinculados por organização.</p>}

    {Boolean(activeOrgId) && <>
      <div className="mb-3 mt-6 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]">Benefícios (Wellhub / TotalPass)</div>
      <div className="grid gap-4 sm:grid-cols-2">{benefits.map((benefit) => <BenefitProviderCard key={benefit.provider} organizationId={activeOrgId} provider={benefit.provider} data={benefit} onToast={onToast} />)}</div>

      <div className="mb-3 mt-6 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]">Catraca por unidade</div>
      {!units.length && <p className="text-xs text-[#918a7d]">Nenhuma unidade cadastrada para esta organização ainda.</p>}
      <div className="grid gap-4 sm:grid-cols-2">{units.map((unit) => <TurnstileUnitCard key={unit.id} organizationId={activeOrgId} unit={turnstileForUnit(unit.id)} onToast={onToast} />)}</div>
    </>}
  </div>;
}

function SettingsPage({ tenantName }: { tenantName: string }) {
  return <div className="mx-auto max-w-[900px] p-5 sm:p-8"><PageIntro eyebrow="configuração" title="Configurações" detail="Branding e preferências persistidos no workspace selecionado." /><Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="p-6"><p className="text-xs font-bold uppercase tracking-[.14em] text-[#a47b13]">Workspace ativo</p><p className="mt-2 text-2xl font-semibold text-[#2b271f]">{tenantName || "Nenhum workspace selecionado"}</p><p className="mt-3 text-sm leading-6 text-[#77877d]">A edição de branding, unidades e permissões deve ser feita em Licenças & planos, sempre vinculada a uma organização persistida.</p></CardContent></Card></div>;
}

export function Home({ view, setView, user, module, tenantName, onTenantChange }: HomeProps) {
  const [toast, setToast] = useState<Toast>(null);
  const onToast = (next: NonNullable<Toast>) => { setToast(next); window.setTimeout(() => setToast(null), 3800); };
  const page = useMemo(() => { switch (view) { case "academias": return <UserManagementPage onToast={onToast} moduleFilter="academia" />; case "studios": return <UserManagementPage onToast={onToast} moduleFilter="studio" />; case "profissionais": return <UserManagementPage onToast={onToast} moduleFilter="profissional" />; case "alunos": return <StudentManagementPage onToast={onToast} />; case "agenda": return <AgendaPage setView={setView} />; case "financeiro": return <FinancePage onToast={onToast} />; case "integracoes": return <IntegrationsPage module={module} onToast={onToast} />; case "saas": return <SaasPage tenantName={tenantName} onTenantChange={onTenantChange} onToast={onToast} />; case "admin": return <UserManagementPage onToast={onToast} />; case "acervo": return <GlobalLibraryAdmin onToast={onToast} />; case "meus-alunos": return <ProfessionalDashboard onToast={onToast} />; case "minha-fila": return <MinhaFila onToast={onToast} />; case "meu-treino": return <StudentDashboard />; case "gestao": return <Gestao />; case "turmas": return <Studio onToast={onToast} />; case "minhas-turmas": return <MinhasTurmas />; case "crm": return <Crm onToast={onToast} />; case "configuracoes": return <SettingsPage tenantName={tenantName} />; default: return <Dashboard module={module} user={user} tenantName={tenantName} setView={setView} />; } }, [view, setView, user, module, tenantName, onTenantChange]);
  return <><div className="min-h-full">{page}</div><ToastMessage toast={toast} onClose={() => setToast(null)} /></>;
}

export default Home;
