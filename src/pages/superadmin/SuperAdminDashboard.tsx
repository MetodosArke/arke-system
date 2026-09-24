import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { useTrialDias } from "@/lib/trial";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { startImpersonation } from "@/lib/impersonation";
import { cn } from "@/lib/utils";
import {
  Shield,
  TrendingUp,
  Percent,
  AlertTriangle,
  Building2,
  HeartPulse,
  Users,
  Dumbbell,
  Activity,
  Lock,
  Unlock,
  UserCircle,
  Store,
  Apple,
  UserCog,
  Plus,
  Search,
  MoreVertical,
  Pencil,
  KeyRound,
  Mail,
  Receipt,
  QrCode,
  CreditCard,
  Copy,
  ExternalLink,
  Trash2,
} from "lucide-react";
import type { Tables, Enums } from "@/integrations/supabase/types";
import { OrganizacaoPerfilSheet } from "@/components/superadmin/OrganizacaoPerfilSheet";
import { ReceitaHistoricoCard } from "@/components/superadmin/ReceitaHistoricoCard";
import { FunilConversaoCard } from "@/components/superadmin/FunilConversaoCard";
import { AdocaoMetodologiaCard } from "@/components/superadmin/AdocaoMetodologiaCard";
import { OperacaoGlobalCard } from "@/components/superadmin/OperacaoGlobalCard";
import { decimal } from "@/lib/numeros";

type CategoriaSimulacao = "aluno" | "academia" | "studio" | "personal" | "nutricionista";

type PerfilSimulavel = {
  user_id: string;
  organization_id: string;
  full_name: string | null;
  email: string;
  organizacao_nome: string;
  categoria: CategoriaSimulacao | null;
};

const CATEGORIAS_SIMULACAO: { categoria: CategoriaSimulacao; label: string; icon: typeof Users; destino: string }[] = [
  { categoria: "aluno", label: "Visão do Aluno", icon: UserCircle, destino: "/#/app" },
  { categoria: "academia", label: "Visão da Academia", icon: Building2, destino: "/#/admin" },
  { categoria: "studio", label: "Visão do Studio", icon: Store, destino: "/#/admin/agenda" },
  { categoria: "personal", label: "Visão do Personal Trainer", icon: Dumbbell, destino: "/#/admin" },
  { categoria: "nutricionista", label: "Visão do Nutricionista", icon: Apple, destino: "/#/admin" },
];

function StatTile({
  icon: Icon,
  label,
  value,
  sublabel,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="h-4.5 w-4.5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className="text-lg font-bold truncate">{value}</p>
          {sublabel && <p className="text-[11px] text-muted-foreground truncate">{sublabel}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarData = (valor: string | null) =>
  valor
    ? new Date(valor).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "Sem atividade";

const STATUS_LABEL: Record<Enums<"org_status">, string> = {
  trial: "Trial",
  ativo: "Ativo",
  inadimplente: "Inadimplente",
  suspenso: "Suspenso",
  cancelado: "Cancelado",
};

const STATUS_ATIVOS = new Set<Enums<"org_status">>(["ativo", "trial"]);
const STATUS_INATIVOS = new Set<Enums<"org_status">>(["suspenso", "inadimplente", "cancelado"]);

const PLANO_LABEL: Record<Enums<"plano_b2b">, string> = {
  starter: "Starter",
  growth: "Growth",
  enterprise: "Enterprise",
  custom: "Custom",
  autonomo: "Profissional Autônomo",
};

// Onboarding Assistido só cria academia/studio (profissional_autonomo tem
// fluxo próprio via convidar-profissional-autonomo), por isso o tipo aqui é
// mais restrito que o enum completo organization_tipo.
type TipoOnboarding = "academia" | "studio";
const TIPO_LABEL: Record<Enums<"organization_tipo">, string> = {
  academia: "Academia",
  studio: "Studio",
  profissional_autonomo: "Profissional Autônomo",
};

type Tenant = {
  organization_id: string;
  nome: string;
  slug: string;
  status: Enums<"org_status">;
  plano_b2b: Enums<"plano_b2b">;
  tipo: Enums<"organization_tipo">;
  created_at: string;
  alunos_total: number;
  mrr_organizacao: number;
  assinaturas_atrasadas: number;
  ultima_atividade: string | null;
  cnpj_cpf: string | null;
  telefone: string | null;
  trial_vencimento: string | null;
  gestor_email: string | null;
};

type CobrancaB2b = Tables<"cobrancas_b2b">;

const FORMA_PAGAMENTO_LABEL: Record<"PIX" | "CREDIT_CARD", string> = {
  PIX: "PIX",
  CREDIT_CARD: "Cartão de Crédito",
};

export default function SuperAdminDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: overview, isLoading: isLoadingOverview } = useQuery({
    queryKey: ["superadmin-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_overview");
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const {
    data: tenants = [],
    isLoading: isLoadingTenants,
    error: erroTenants,
  } = useQuery({
    queryKey: ["superadmin-tenants"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_tenants");
      if (error) throw error;
      return (data ?? []) as Tenant[];
    },
  });

  const atualizarOrganizacao = useMutation({
    mutationFn: async (payload: {
      organizationId: string;
      status?: Enums<"org_status">;
      plano_b2b?: Enums<"plano_b2b">;
      nome?: string;
      tipo?: Enums<"organization_tipo">;
      cnpj_cpf?: string | null;
      telefone?: string | null;
      trial_vencimento?: string | null;
    }) => {
      const update: Partial<Tables<"organizations">> = {};
      if (payload.status) update.status = payload.status;
      if (payload.plano_b2b) update.plano_b2b = payload.plano_b2b;
      if (payload.nome) update.nome = payload.nome;
      if (payload.tipo) update.tipo = payload.tipo;
      if (payload.cnpj_cpf !== undefined) update.cnpj_cpf = payload.cnpj_cpf;
      if (payload.telefone !== undefined) update.telefone = payload.telefone;
      if (payload.trial_vencimento !== undefined) update.trial_vencimento = payload.trial_vencimento;
      const { error } = await supabase
        .from("organizations")
        .update(update)
        .eq("id", payload.organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Academia atualizada." });
      void queryClient.invalidateQueries({ queryKey: ["superadmin-tenants"] });
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" }),
  });

  // ---- Busca e filtros da tabela de tenants ----
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<Enums<"organization_tipo"> | "todos">("todos");
  const [filtroStatus, setFiltroStatus] = useState<Enums<"org_status"> | "todos">("todos");

  // Carteira: separa de cara a visão do dia a dia (quem está pagando/em
  // trial) da faxina de contas mortas (suspenso/inadimplente/cancelado) —
  // numa base grande, misturar as duas na mesma tabela sem esse corte
  // rápido torna a tela inútil para gestão de carteira em escala.
  const [filtroCarteira, setFiltroCarteira] = useState<"ativos" | "inativos" | "todos">("ativos");

  const contadoresCarteira = useMemo(
    () => ({
      ativos: tenants.filter((t) => STATUS_ATIVOS.has(t.status)).length,
      inativos: tenants.filter((t) => STATUS_INATIVOS.has(t.status)).length,
      todos: tenants.length,
    }),
    [tenants]
  );

  const tenantsFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return tenants.filter((t) => {
      const bateBusca =
        !termo || t.nome.toLowerCase().includes(termo) || t.slug.toLowerCase().includes(termo);
      const bateTipo = filtroTipo === "todos" || t.tipo === filtroTipo;
      const bateStatus = filtroStatus === "todos" || t.status === filtroStatus;
      const bateCarteira =
        filtroCarteira === "todos" ||
        (filtroCarteira === "ativos" && STATUS_ATIVOS.has(t.status)) ||
        (filtroCarteira === "inativos" && STATUS_INATIVOS.has(t.status));
      return bateBusca && bateTipo && bateStatus && bateCarteira;
    });
  }, [tenants, busca, filtroTipo, filtroStatus, filtroCarteira]);

  // ---- Onboarding Assistido: "+ Nova Organização" ----
  const [modalNovaOrgAberto, setModalNovaOrgAberto] = useState(false);
  const trialDias = useTrialDias();
  const [novaOrg, setNovaOrg] = useState({
    tipo: "academia" as TipoOnboarding,
    nome: "",
    slug: "",
    gestor_email: "",
    gestor_nome: "",
    plano_b2b: "starter" as Enums<"plano_b2b">,
    // Plano B2B vale desde o primeiro dia; trial é só para testes.
    status: "ativo" as "trial" | "ativo",
  });

  const resetarNovaOrg = () =>
    setNovaOrg({
      tipo: "academia",
      nome: "",
      slug: "",
      gestor_email: "",
      gestor_nome: "",
      plano_b2b: "starter",
      status: "ativo",
    });

  const criarOrganizacao = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{
        organization_id?: string;
        gestor_user_id?: string;
        gestor_ja_existia?: boolean;
        aviso?: string | null;
        error?: string;
      }>("criar-organizacao-superadmin", { body: novaOrg });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível criar a organização."));
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      const descricao = data?.aviso
        ? `(Aviso: ${data.aviso})`
        : data?.gestor_ja_existia
          ? "O gestor já tinha conta — ela foi vinculada à nova organização e avisada por e-mail."
          : "Convite de ativação enviado ao e-mail do gestor.";
      toast({ title: "Organização criada com sucesso!", description: descricao });
      setModalNovaOrgAberto(false);
      resetarNovaOrg();
      void queryClient.invalidateQueries({ queryKey: ["superadmin-tenants"] });
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao cadastrar organização", description: error.message, variant: "destructive" }),
  });

  // ---- Editar Informações do Tenant (+ Faturamento B2B e Fiscal) ----
  const [tenantEditando, setTenantEditando] = useState<Tenant | null>(null);
  const [tenantPerfil, setTenantPerfil] = useState<Tenant | null>(null);
  const [edicao, setEdicao] = useState({
    nome: "",
    tipo: "academia" as Enums<"organization_tipo">,
    plano_b2b: "starter" as Enums<"plano_b2b">,
    status: "trial" as Enums<"org_status">,
    cnpjCpf: "",
    telefone: "",
    trialVencimento: "",
    gestorEmail: "",
  });

  const [abaEdicaoAtiva, setAbaEdicaoAtiva] = useState<"informacoes" | "faturamento">("informacoes");

  const fecharEdicao = (open: boolean) => {
    if (!open) {
      setTenantEditando(null);
      resetarCobranca();
    }
  };

  const abrirEdicao = (tenant: Tenant, aba: "informacoes" | "faturamento" = "informacoes") => {
    setTenantEditando(tenant);
    setEdicao({
      nome: tenant.nome,
      tipo: tenant.tipo,
      plano_b2b: tenant.plano_b2b,
      status: tenant.status,
      cnpjCpf: tenant.cnpj_cpf ?? "",
      telefone: tenant.telefone ?? "",
      trialVencimento: tenant.trial_vencimento ?? "",
      gestorEmail: tenant.gestor_email ?? "",
    });
    setAbaEdicaoAtiva(aba);
    resetarCobranca();
  };

  const salvarEdicao = () => {
    if (!tenantEditando) return;
    atualizarOrganizacao.mutate({
      organizationId: tenantEditando.organization_id,
      nome: edicao.nome,
      tipo: edicao.tipo,
      plano_b2b: edicao.plano_b2b,
      status: edicao.status,
      cnpj_cpf: edicao.cnpjCpf.trim() || null,
      telefone: edicao.telefone.trim() || null,
      trial_vencimento: edicao.trialVencimento || null,
    });
  };

  // ---- Ações de Suporte: resetar token do gateway / alterar e-mail do gestor / excluir organização ----
  const acaoSuporte = useMutation({
    mutationFn: async (payload: {
      organization_id: string;
      acao: "resetar_token_gateway" | "alterar_email_gestor" | "excluir_organizacao";
      novo_email?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("superadmin-suporte-tenant", { body: payload });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível concluir a ação de suporte."));
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data, variables) => {
      if (variables.acao === "resetar_token_gateway") {
        toast({
          title: "Token do Gateway Local resetado.",
          description: `${data?.catracas_resetadas ?? 0} dispositivo(s) atualizado(s).`,
        });
      } else if (variables.acao === "excluir_organizacao") {
        toast({ title: "Organização excluída." });
        void queryClient.invalidateQueries({ queryKey: ["superadmin-tenants"] });
      } else {
        toast({ title: "E-mail do gestor alterado." });
        void queryClient.invalidateQueries({ queryKey: ["superadmin-tenants"] });
      }
    },
    onError: (error: Error) =>
      toast({ title: "Erro na ação de suporte", description: error.message, variant: "destructive" }),
  });

  // ---- Faturamento B2B (Asaas): emissão de cobrança avulsa contra o tenant ----
  const [cobranca, setCobranca] = useState({
    valor: "",
    descricao: "",
    formaPagamento: "PIX" as "PIX" | "CREDIT_CARD",
  });
  const [cobrancaGerada, setCobrancaGerada] = useState<CobrancaB2b | null>(null);

  const resetarCobranca = () => {
    setCobranca({ valor: "", descricao: "", formaPagamento: "PIX" });
    setCobrancaGerada(null);
  };

  const emitirCobranca = useMutation({
    mutationFn: async () => {
      if (!tenantEditando) throw new Error("Nenhum tenant selecionado.");
      const valorNumerico = Number(cobranca.valor.replace(",", "."));
      if (!Number.isFinite(valorNumerico) || valorNumerico <= 0) {
        throw new Error("Informe um valor válido, maior que zero.");
      }
      const { data, error } = await supabase.functions.invoke("asaas-emitir-cobranca-b2b", {
        body: {
          organization_id: tenantEditando.organization_id,
          valor: valorNumerico,
          descricao: cobranca.descricao.trim(),
          forma_pagamento: cobranca.formaPagamento,
        },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível emitir a cobrança."));
      if (data?.error) throw new Error(data.error);
      return data.cobranca as CobrancaB2b;
    },
    onSuccess: (data) => {
      toast({ title: "Cobrança gerada no Asaas!" });
      setCobrancaGerada(data);
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível gerar a cobrança", description: error.message, variant: "destructive" }),
  });

  const copiarPixCopiaCola = async () => {
    if (!cobrancaGerada?.pix_copia_cola) return;
    try {
      await navigator.clipboard.writeText(cobrancaGerada.pix_copia_cola);
      toast({ title: "Código PIX copiado!" });
    } catch {
      toast({ title: "Não foi possível copiar", description: "Copie manualmente o código abaixo.", variant: "destructive" });
    }
  };

  // Ações sensíveis (afetam login de toda a academia/studio ou os leitores
  // físicos de catraca da unidade) exigem confirmação explícita — evita que
  // um clique errado no menu de 3 pontinhos suspenda um tenant ou invalide
  // o token do Gateway Local por engano.
  const [tenantSuspendendo, setTenantSuspendendo] = useState<Tenant | null>(null);
  const [tenantResetandoToken, setTenantResetandoToken] = useState<Tenant | null>(null);

  // Exclusão é irreversível (apaga alunos, treinos, dietas, cobranças, etc.
  // via cascade) — exige digitar o nome exato do tenant, não só um clique
  // de confirmação, para reduzir a chance de apagar a organização errada.
  const [tenantExcluindo, setTenantExcluindo] = useState<Tenant | null>(null);
  const [confirmacaoExclusao, setConfirmacaoExclusao] = useState("");

  const [categoriaAtiva, setCategoriaAtiva] = useState<CategoriaSimulacao | null>(null);
  const [destinoAtivo, setDestinoAtivo] = useState<string | null>(null);
  // A mesma pessoa pode ter mais de um vínculo ativo simulável (ex.: gestor
  // de mais de uma academia) — a chave precisa combinar user_id +
  // organization_id, senão duas opções colidiriam no mesmo <Select>.
  const [vinculoSelecionado, setVinculoSelecionado] = useState<string | null>(null);
  const [simulando, setSimulando] = useState(false);

  const { data: perfisSimulaveis = [] } = useQuery({
    queryKey: ["superadmin-perfis-simulaveis"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_perfis_simulaveis");
      if (error) throw error;
      return (data ?? []) as PerfilSimulavel[];
    },
  });

  const chaveVinculo = (p: PerfilSimulavel) => `${p.user_id}:${p.organization_id}`;
  const opcoesCategoria = perfisSimulaveis.filter((p) => p.categoria === categoriaAtiva);
  const perfilSelecionado = opcoesCategoria.find((p) => chaveVinculo(p) === vinculoSelecionado) ?? null;

  const escolherCategoria = (categoria: CategoriaSimulacao, destino: string) => {
    setCategoriaAtiva(categoria);
    setDestinoAtivo(destino);
    setVinculoSelecionado(null);
  };

  const simular = async () => {
    if (!perfilSelecionado || !destinoAtivo) return;
    setSimulando(true);
    const { error } = await startImpersonation(perfilSelecionado.user_id, perfilSelecionado.organization_id);
    setSimulando(false);
    if (error) {
      toast({ title: "Não foi possível simular este perfil", description: error.message, variant: "destructive" });
      return;
    }
    window.location.assign(destinoAtivo);
    window.location.reload();
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Super Admin — Visão Master ArkeFit</h1>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCog className="h-4 w-4" /> Simulação de Visão de Perfil
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Entre com a sessão de um usuário real já cadastrado para testar e validar o frontend
            exatamente como cada perfil enxerga.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {CATEGORIAS_SIMULACAO.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => escolherCategoria(c.categoria, c.destino)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border-2 border-border p-3 text-center text-xs font-medium transition-colors hover:border-primary hover:bg-primary/5",
                  categoriaAtiva === c.categoria && destinoAtivo === c.destino && "border-primary bg-primary/5"
                )}
              >
                <c.icon className="h-5 w-5 text-primary" />
                {c.label}
              </button>
            ))}
          </div>

          {categoriaAtiva === "studio" && (
            <p className="text-[11px] text-muted-foreground">
              Studios têm turmas de horário fixo e capacidade limitada — a simulação entra direto na
              Agenda (Grade Semanal), a tela própria desse tipo de negócio.
            </p>
          )}

          {categoriaAtiva && (
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={vinculoSelecionado ?? undefined} onValueChange={setVinculoSelecionado}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Selecione um usuário real para simular" />
                </SelectTrigger>
                <SelectContent>
                  {opcoesCategoria.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      Nenhum usuário cadastrado nessa categoria ainda.
                    </div>
                  )}
                  {opcoesCategoria.map((p) => (
                    <SelectItem key={chaveVinculo(p)} value={chaveVinculo(p)}>
                      {p.full_name || p.email} — {p.organizacao_nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button disabled={!perfilSelecionado || simulando} onClick={() => void simular()}>
                {simulando ? "Entrando..." : "Simular"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile
          icon={TrendingUp}
          label="MRR Global"
          value={overview ? formatarMoeda(Number(overview.mrr_global)) : "—"}
        />
        <StatTile
          icon={TrendingUp}
          label="ARR Global"
          value={overview ? formatarMoeda(Number(overview.arr_global)) : "—"}
        />
        <StatTile
          icon={Percent}
          label="Take Rate"
          value={overview ? `${decimal(Number(overview.take_rate_pct), 1)}%` : "—"}
          sublabel="Repasse ARKE líquido de taxa / receita bruta"
        />
        <StatTile
          icon={AlertTriangle}
          label="Inadimplência Geral"
          value={overview ? `${decimal(Number(overview.inadimplencia_pct), 1)}%` : "—"}
          sublabel="Assinaturas atrasadas"
        />
        <StatTile
          icon={HeartPulse}
          label="Retenção de tenants"
          value={overview ? `${decimal(Number(overview.retencao_tenants_pct), 1)}%` : "—"}
          sublabel="Health Score B2B"
        />
        <StatTile
          icon={Building2}
          label="Academias ativas"
          value={overview ? `${overview.academias_ativas}` : "—"}
          sublabel={overview ? `${overview.academias_total} academias no total` : undefined}
        />
        <StatTile
          icon={Users}
          label="Alunos ativos (global)"
          value={overview ? `${overview.alunos_ativos_global}` : "—"}
        />
        <StatTile
          icon={Dumbbell}
          label="Prescrições B.A.S.E.®"
          value={overview ? `${overview.prescricoes_base_total}` : "—"}
          sublabel="Treinos + dietas ativos"
        />
        <StatTile
          icon={Activity}
          label="Check-ins M.A.P.A.®"
          value={overview ? `${overview.checkins_mapa_total}` : "—"}
          sublabel="Total processado"
        />
      </div>

      <ReceitaHistoricoCard />

      <FunilConversaoCard />

      <AdocaoMetodologiaCard />

      <OperacaoGlobalCard />

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Gestão de Tenants</CardTitle>
              <p className="text-xs text-muted-foreground">
                Onboarding, busca, suporte e bloqueio manual das academias e studios parceiros.
              </p>
            </div>
            <Button size="sm" onClick={() => setModalNovaOrgAberto(true)} className="shrink-0 gap-1.5">
              <Plus className="h-4 w-4" /> Nova Organização
            </Button>
          </div>

          <Tabs
            value={filtroCarteira}
            onValueChange={(v) => setFiltroCarteira(v as typeof filtroCarteira)}
            className="pt-2"
          >
            <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-grid">
              <TabsTrigger value="ativos" className="gap-1.5">
                Ativos / Trial
                <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1 text-[10px]">
                  {contadoresCarteira.ativos}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="inativos" className="gap-1.5">
                Inativos / Cancelados
                <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1 text-[10px]">
                  {contadoresCarteira.inativos}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="todos" className="gap-1.5">
                Todos
                <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1 text-[10px]">
                  {contadoresCarteira.todos}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou slug..."
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Select value={filtroTipo} onValueChange={(v) => setFiltroTipo(v as typeof filtroTipo)}>
              <SelectTrigger className="h-8 w-full sm:w-36 text-xs">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os tipos</SelectItem>
                <SelectItem value="academia">Academia</SelectItem>
                <SelectItem value="studio">Studio</SelectItem>
                <SelectItem value="profissional_autonomo">Profissional Autônomo</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={(v) => setFiltroStatus(v as typeof filtroStatus)}>
              <SelectTrigger className="h-8 w-full sm:w-36 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="p-3">Academia</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Alunos</th>
                  <th className="p-3">MRR</th>
                  <th className="p-3">Atrasadas</th>
                  <th className="p-3">Plano master</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Última Atividade</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {erroTenants && (
                  <tr>
                    <td colSpan={9} className="p-4 text-center text-destructive">
                      Não foi possível carregar a lista de tenants: {(erroTenants as Error).message}
                    </td>
                  </tr>
                )}
                {!isLoadingTenants && !erroTenants && tenantsFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-4 text-center text-muted-foreground">
                      {tenants.length === 0
                        ? "Nenhuma academia cadastrada ainda."
                        : "Nenhum tenant encontrado com os filtros atuais."}
                    </td>
                  </tr>
                )}
                {tenantsFiltrados.map((tenant) => (
                  <tr key={tenant.organization_id} className="border-b border-border last:border-0">
                    <td className="p-3">
                      <button
                        type="button"
                        className="text-left hover:underline underline-offset-2"
                        onClick={() => setTenantPerfil(tenant)}
                      >
                        <p className="font-medium">{tenant.nome}</p>
                      </button>
                      <p className="text-xs text-muted-foreground">/{tenant.slug}</p>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline">{TIPO_LABEL[tenant.tipo]}</Badge>
                    </td>
                    <td className="p-3">{tenant.alunos_total}</td>
                    <td className="p-3">{formatarMoeda(Number(tenant.mrr_organizacao))}</td>
                    <td className="p-3">
                      {tenant.assinaturas_atrasadas > 0 ? (
                        <Badge variant="destructive">{tenant.assinaturas_atrasadas}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="p-3">
                      <Select
                        value={tenant.plano_b2b}
                        disabled={
                          atualizarOrganizacao.isPending &&
                          atualizarOrganizacao.variables?.organizationId === tenant.organization_id
                        }
                        onValueChange={(value) =>
                          atualizarOrganizacao.mutate({
                            organizationId: tenant.organization_id,
                            plano_b2b: value as Enums<"plano_b2b">,
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-32 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(PLANO_LABEL).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-3">
                      <Badge variant={tenant.status === "ativo" ? "default" : "secondary"}>
                        {STATUS_LABEL[tenant.status]}
                      </Badge>
                    </td>
                    <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">
                      {formatarData(tenant.ultima_atividade)}
                    </td>
                    <td className="p-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Ações do tenant" aria-label="Ações do tenant">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Ações do Tenant</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => abrirEdicao(tenant)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Editar Informações
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => abrirEdicao(tenant, "faturamento")}>
                            <Receipt className="h-3.5 w-3.5 mr-2" /> Faturamento / Cobranças B2B
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={
                              acaoSuporte.isPending &&
                              acaoSuporte.variables?.organization_id === tenant.organization_id
                            }
                            onClick={() => setTenantResetandoToken(tenant)}
                          >
                            <KeyRound className="h-3.5 w-3.5 mr-2" /> Resetar Token do Gateway Local
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {tenant.status === "suspenso" ? (
                            <DropdownMenuItem
                              disabled={
                                atualizarOrganizacao.isPending &&
                                atualizarOrganizacao.variables?.organizationId === tenant.organization_id
                              }
                              onClick={() =>
                                atualizarOrganizacao.mutate({
                                  organizationId: tenant.organization_id,
                                  status: "ativo",
                                })
                              }
                            >
                              <Unlock className="h-3.5 w-3.5 mr-2" /> Ativar acesso do tenant
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              disabled={
                                atualizarOrganizacao.isPending &&
                                atualizarOrganizacao.variables?.organizationId === tenant.organization_id
                              }
                              onClick={() => setTenantSuspendendo(tenant)}
                            >
                              <Lock className="h-3.5 w-3.5 mr-2" /> Suspender acesso do tenant
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            disabled={
                              acaoSuporte.isPending &&
                              acaoSuporte.variables?.organization_id === tenant.organization_id
                            }
                            onClick={() => {
                              setConfirmacaoExclusao("");
                              setTenantExcluindo(tenant);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir Organização
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Onboarding Assistido: cadastro de nova academia/studio */}
      <Dialog
        open={modalNovaOrgAberto}
        onOpenChange={(open) => {
          setModalNovaOrgAberto(open);
          if (!open) resetarNovaOrg();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cadastrar Academia / Studio</DialogTitle>
            <DialogDescription>
              Um convite de ativação será enviado por e-mail ao gestor principal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(["academia", "studio"] as TipoOnboarding[]).map((tipo) => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => setNovaOrg((s) => ({ ...s, tipo }))}
                  className={cn(
                    "rounded-lg border-2 border-border p-3 text-center text-sm font-medium transition-colors hover:border-primary hover:bg-primary/5",
                    novaOrg.tipo === tipo && "border-primary bg-primary/5"
                  )}
                >
                  {TIPO_LABEL[tipo]}
                </button>
              ))}
            </div>
            <div className="space-y-1">
              <Label htmlFor="nova-org-nome">Nome da Unidade</Label>
              <Input
                id="nova-org-nome"
                value={novaOrg.nome}
                onChange={(e) => setNovaOrg((s) => ({ ...s, nome: e.target.value }))}
                placeholder="Ex: Academia Vida Ativa"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nova-org-slug">Slug (opcional — gerado a partir do nome)</Label>
              <Input
                id="nova-org-slug"
                value={novaOrg.slug}
                onChange={(e) => setNovaOrg((s) => ({ ...s, slug: e.target.value }))}
                placeholder="academia-vida-ativa"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nova-org-gestor-nome">Nome do Gestor</Label>
              <Input
                id="nova-org-gestor-nome"
                value={novaOrg.gestor_nome}
                onChange={(e) => setNovaOrg((s) => ({ ...s, gestor_nome: e.target.value }))}
                placeholder="Nome completo"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nova-org-gestor-email">E-mail do Gestor Principal</Label>
              <Input
                id="nova-org-gestor-email"
                type="email"
                value={novaOrg.gestor_email}
                onChange={(e) => setNovaOrg((s) => ({ ...s, gestor_email: e.target.value }))}
                placeholder="gestor@academia.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Plano</Label>
                <Select
                  value={novaOrg.plano_b2b}
                  onValueChange={(value) => setNovaOrg((s) => ({ ...s, plano_b2b: value as Enums<"plano_b2b"> }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="growth">Growth</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select
                  value={novaOrg.status}
                  onValueChange={(value) => setNovaOrg((s) => ({ ...s, status: value as "trial" | "ativo" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="trial">Trial (só para testes)</SelectItem>
                  </SelectContent>
                </Select>
                {novaOrg.status === "trial" && (
                  <p className="text-[11px] text-muted-foreground">
                    O prazo é preenchido automaticamente com {trialDias} dias a partir de hoje; dá para alterar
                    depois no perfil da organização.
                  </p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalNovaOrgAberto(false)}>
              Cancelar
            </Button>
            <Button
              disabled={
                criarOrganizacao.isPending ||
                !novaOrg.nome.trim() ||
                !novaOrg.gestor_email.trim() ||
                !novaOrg.gestor_nome.trim()
              }
              onClick={() => criarOrganizacao.mutate()}
            >
              {criarOrganizacao.isPending ? "Cadastrando..." : "Cadastrar e convidar gestor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar Informações do Tenant — Informações + Faturamento/Cobranças B2B */}
      <Dialog open={!!tenantEditando} onOpenChange={fecharEdicao}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Informações do Tenant</DialogTitle>
            <DialogDescription>{tenantEditando?.nome}</DialogDescription>
          </DialogHeader>

          <Tabs value={abaEdicaoAtiva} onValueChange={(v) => setAbaEdicaoAtiva(v as typeof abaEdicaoAtiva)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="informacoes">Informações</TabsTrigger>
              <TabsTrigger value="faturamento">Faturamento / Cobranças</TabsTrigger>
            </TabsList>

            <TabsContent value="informacoes" className="space-y-3 mt-3">
              <div className="space-y-1">
                <Label htmlFor="edicao-nome">Nome</Label>
                <Input
                  id="edicao-nome"
                  value={edicao.nome}
                  onChange={(e) => setEdicao((s) => ({ ...s, nome: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Tipo de negócio</Label>
                  <Select
                    value={edicao.tipo}
                    onValueChange={(value) => setEdicao((s) => ({ ...s, tipo: value as Enums<"organization_tipo"> }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TIPO_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Plano master</Label>
                  <Select
                    value={edicao.plano_b2b}
                    onValueChange={(value) => setEdicao((s) => ({ ...s, plano_b2b: value as Enums<"plano_b2b"> }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PLANO_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label>Status do Tenant</Label>
                <Select
                  value={edicao.status}
                  onValueChange={(value) => setEdicao((s) => ({ ...s, status: value as Enums<"org_status"> }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABEL).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="edicao-cnpj">CNPJ / CPF da Organização</Label>
                  <Input
                    id="edicao-cnpj"
                    value={edicao.cnpjCpf}
                    onChange={(e) => setEdicao((s) => ({ ...s, cnpjCpf: e.target.value }))}
                    placeholder="00.000.000/0001-00"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edicao-telefone">Telefone da Organização</Label>
                  <Input
                    id="edicao-telefone"
                    value={edicao.telefone}
                    onChange={(e) => setEdicao((s) => ({ ...s, telefone: e.target.value }))}
                    placeholder="(11) 91234-5678"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="edicao-trial">Data Limite do Trial / Vencimento</Label>
                  {/* Padrão de arke_trial_dias() vem do banco;
                      aqui é a exceção negociada caso a caso. */}
                  <Input
                    id="edicao-trial"
                    type="date"
                    value={edicao.trialVencimento}
                    onChange={(e) => setEdicao((s) => ({ ...s, trialVencimento: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="edicao-email-gestor">E-mail do Gestor Master</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="edicao-email-gestor"
                    type="email"
                    value={edicao.gestorEmail}
                    onChange={(e) => setEdicao((s) => ({ ...s, gestorEmail: e.target.value }))}
                    placeholder="gestor@academia.com"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={
                      acaoSuporte.isPending ||
                      !edicao.gestorEmail.trim() ||
                      edicao.gestorEmail.trim() === (tenantEditando?.gestor_email ?? "")
                    }
                    onClick={() =>
                      tenantEditando &&
                      acaoSuporte.mutate({
                        organization_id: tenantEditando.organization_id,
                        acao: "alterar_email_gestor",
                        novo_email: edicao.gestorEmail.trim(),
                      })
                    }
                  >
                    <Mail className="h-3.5 w-3.5 mr-1.5" /> Atualizar
                  </Button>
                </div>
                {!tenantEditando?.gestor_email && (
                  <p className="text-[11px] text-muted-foreground">Nenhum gestor ativo encontrado nesta organização.</p>
                )}
              </div>

              <DialogFooter className="!mt-4">
                <Button variant="outline" onClick={() => fecharEdicao(false)}>
                  Fechar
                </Button>
                <Button disabled={atualizarOrganizacao.isPending || !edicao.nome.trim()} onClick={salvarEdicao}>
                  {atualizarOrganizacao.isPending ? "Salvando..." : "Salvar Informações"}
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="faturamento" className="space-y-3 mt-3">
              {(!edicao.cnpjCpf.trim() || !edicao.telefone.trim()) && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  Cadastre o CNPJ/CPF e o telefone na aba "Informações" e salve antes de emitir uma cobrança — o
                  Asaas exige o documento fiscal e um telefone de contato do cliente.
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="cobranca-valor">Valor (R$)</Label>
                <Input
                  id="cobranca-valor"
                  type="text"
                  inputMode="decimal"
                  value={cobranca.valor}
                  onChange={(e) => setCobranca((s) => ({ ...s, valor: e.target.value }))}
                  placeholder="290.00"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cobranca-descricao">Descrição / Motivo da Cobrança</Label>
                <Input
                  id="cobranca-descricao"
                  value={cobranca.descricao}
                  onChange={(e) => setCobranca((s) => ({ ...s, descricao: e.target.value }))}
                  placeholder="Ex.: Mensalidade SaaS, Taxa de Implantação"
                />
              </div>
              <div className="space-y-1">
                <Label>Forma de Pagamento</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCobranca((s) => ({ ...s, formaPagamento: "PIX" }))}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-lg border-2 border-border py-2 text-sm font-medium transition-colors hover:border-primary hover:bg-primary/5",
                      cobranca.formaPagamento === "PIX" && "border-primary bg-primary/5"
                    )}
                  >
                    <QrCode className="h-4 w-4 text-primary" /> PIX
                  </button>
                  <button
                    type="button"
                    onClick={() => setCobranca((s) => ({ ...s, formaPagamento: "CREDIT_CARD" }))}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-lg border-2 border-border py-2 text-sm font-medium transition-colors hover:border-primary hover:bg-primary/5",
                      cobranca.formaPagamento === "CREDIT_CARD" && "border-primary bg-primary/5"
                    )}
                  >
                    <CreditCard className="h-4 w-4 text-primary" /> Cartão de Crédito
                  </button>
                </div>
              </div>

              <Button
                className="w-full"
                disabled={
                  emitirCobranca.isPending ||
                  !edicao.cnpjCpf.trim() ||
                  !edicao.telefone.trim() ||
                  !cobranca.valor.trim() ||
                  !cobranca.descricao.trim()
                }
                onClick={() => emitirCobranca.mutate()}
              >
                <Receipt className="h-4 w-4 mr-1.5" />
                {emitirCobranca.isPending ? "Gerando..." : "Gerar Cobrança no Asaas"}
              </Button>

              {cobrancaGerada && (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">
                    Cobrança de {formatarMoeda(Number(cobrancaGerada.valor))} gerada —{" "}
                    {FORMA_PAGAMENTO_LABEL[cobrancaGerada.forma_pagamento as "PIX" | "CREDIT_CARD"]}
                  </p>

                  {cobrancaGerada.pix_qr_code_base64 && (
                    <div className="flex justify-center">
                      <img
                        src={`data:image/png;base64,${cobrancaGerada.pix_qr_code_base64}`}
                        alt="QR Code PIX"
                        className="h-40 w-40 rounded-md border border-border"
                      />
                    </div>
                  )}

                  {cobrancaGerada.pix_copia_cola && (
                    <div className="space-y-1">
                      <Label>PIX Copia e Cola</Label>
                      <div className="flex items-start gap-2">
                        <Textarea readOnly rows={3} value={cobrancaGerada.pix_copia_cola} className="text-xs font-mono" />
                        <Button type="button" size="icon" variant="outline" className="shrink-0" onClick={() => void copiarPixCopiaCola()}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {cobrancaGerada.invoice_url && (
                    <Button variant="outline" className="w-full" asChild>
                      <a href={cobrancaGerada.invoice_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Abrir link de pagamento do Asaas
                      </a>
                    </Button>
                  )}
                </div>
              )}

              <DialogFooter className="!mt-4">
                <Button variant="outline" onClick={() => fecharEdicao(false)}>
                  Fechar
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Confirmação: suspender acesso do tenant (bloqueia login de gestor, staff e alunos) */}
      <Dialog open={!!tenantSuspendendo} onOpenChange={(open) => !open && setTenantSuspendendo(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Suspender acesso de {tenantSuspendendo?.nome}?</DialogTitle>
            <DialogDescription>
              Isso bloqueia imediatamente o login do gestor, de toda a equipe e dos alunos dessa
              organização. Pode ser revertido depois pelo mesmo menu.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTenantSuspendendo(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={atualizarOrganizacao.isPending}
              onClick={() =>
                tenantSuspendendo &&
                atualizarOrganizacao.mutate(
                  { organizationId: tenantSuspendendo.organization_id, status: "suspenso" },
                  { onSuccess: () => setTenantSuspendendo(null) }
                )
              }
            >
              {atualizarOrganizacao.isPending ? "Suspendendo..." : "Suspender acesso"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação: resetar token do Gateway Local (invalida os leitores de catraca físicos da unidade) */}
      <Dialog open={!!tenantResetandoToken} onOpenChange={(open) => !open && setTenantResetandoToken(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Resetar token do Gateway Local de {tenantResetandoToken?.nome}?</DialogTitle>
            <DialogDescription>
              Isso invalida imediatamente o token de todas as catracas dessa organização — os leitores
              físicos param de autenticar até alguém reconfigurar o Gateway Local no local com o novo
              token.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTenantResetandoToken(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={acaoSuporte.isPending}
              onClick={() =>
                tenantResetandoToken &&
                acaoSuporte.mutate(
                  { organization_id: tenantResetandoToken.organization_id, acao: "resetar_token_gateway" },
                  { onSuccess: () => setTenantResetandoToken(null) }
                )
              }
            >
              {acaoSuporte.isPending ? "Resetando..." : "Resetar token"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação: exclusão permanente da organização (apaga alunos, equipe, treinos,
          dietas, cobranças e todos os demais dados vinculados) */}
      <Dialog
        open={!!tenantExcluindo}
        onOpenChange={(open) => {
          if (!open) {
            setTenantExcluindo(null);
            setConfirmacaoExclusao("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir {tenantExcluindo?.nome}?</DialogTitle>
            <DialogDescription>
              Isso apaga <strong>permanentemente</strong> a organização e todos os dados vinculados —
              alunos, equipe, treinos, dietas, check-ins, agendamentos e cobranças. Não pode ser
              desfeito.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="confirmacao-exclusao">
              Digite <strong>{tenantExcluindo?.nome}</strong> para confirmar
            </Label>
            <Input
              id="confirmacao-exclusao"
              value={confirmacaoExclusao}
              onChange={(e) => setConfirmacaoExclusao(e.target.value)}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTenantExcluindo(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={acaoSuporte.isPending || confirmacaoExclusao.trim() !== tenantExcluindo?.nome}
              onClick={() =>
                tenantExcluindo &&
                acaoSuporte.mutate(
                  { organization_id: tenantExcluindo.organization_id, acao: "excluir_organizacao" },
                  { onSuccess: () => setTenantExcluindo(null) }
                )
              }
            >
              {acaoSuporte.isPending ? "Excluindo..." : "Excluir Organização"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!isLoadingOverview && !overview && (
        <p className="text-xs text-muted-foreground text-center">
          Não foi possível carregar a visão global. Verifique se este usuário possui o papel
          "superadmin".
        </p>
      )}

      <OrganizacaoPerfilSheet
        tenant={tenantPerfil}
        onOpenChange={(open) => !open && setTenantPerfil(null)}
        onEditar={(tenant) => {
          setTenantPerfil(null);
          abrirEdicao(tenant);
        }}
        onFaturamento={(tenant) => {
          setTenantPerfil(null);
          abrirEdicao(tenant, "faturamento");
        }}
      />
    </div>
  );
}
