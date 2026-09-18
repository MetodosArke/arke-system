import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
} from "lucide-react";
import type { Tables, Enums } from "@/integrations/supabase/types";

type CategoriaSimulacao = "aluno" | "academia" | "studio" | "personal" | "nutricionista";

type PerfilSimulavel = {
  user_id: string;
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

  const { data: tenants = [], isLoading: isLoadingTenants } = useQuery({
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
    }) => {
      const update: Partial<Tables<"organizations">> = {};
      if (payload.status) update.status = payload.status;
      if (payload.plano_b2b) update.plano_b2b = payload.plano_b2b;
      if (payload.nome) update.nome = payload.nome;
      if (payload.tipo) update.tipo = payload.tipo;
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

  const tenantsFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return tenants.filter((t) => {
      const bateBusca =
        !termo || t.nome.toLowerCase().includes(termo) || t.slug.toLowerCase().includes(termo);
      const bateTipo = filtroTipo === "todos" || t.tipo === filtroTipo;
      const bateStatus = filtroStatus === "todos" || t.status === filtroStatus;
      return bateBusca && bateTipo && bateStatus;
    });
  }, [tenants, busca, filtroTipo, filtroStatus]);

  // ---- Onboarding Assistido: "+ Nova Organização" ----
  const [modalNovaOrgAberto, setModalNovaOrgAberto] = useState(false);
  const [novaOrg, setNovaOrg] = useState({
    tipo: "academia" as TipoOnboarding,
    nome: "",
    slug: "",
    gestor_email: "",
    gestor_nome: "",
    plano_b2b: "starter" as Enums<"plano_b2b">,
    status: "trial" as "trial" | "ativo",
  });

  const resetarNovaOrg = () =>
    setNovaOrg({
      tipo: "academia",
      nome: "",
      slug: "",
      gestor_email: "",
      gestor_nome: "",
      plano_b2b: "starter",
      status: "trial",
    });

  const criarOrganizacao = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("criar-organizacao-superadmin", {
        body: novaOrg,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Organização cadastrada!",
        description: "Convite de ativação enviado ao e-mail do gestor.",
      });
      setModalNovaOrgAberto(false);
      resetarNovaOrg();
      void queryClient.invalidateQueries({ queryKey: ["superadmin-tenants"] });
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao cadastrar organização", description: error.message, variant: "destructive" }),
  });

  // ---- Editar Informações do Tenant ----
  const [tenantEditando, setTenantEditando] = useState<Tenant | null>(null);
  const [edicao, setEdicao] = useState({ nome: "", tipo: "academia" as Enums<"organization_tipo">, plano_b2b: "starter" as Enums<"plano_b2b"> });

  const abrirEdicao = (tenant: Tenant) => {
    setTenantEditando(tenant);
    setEdicao({ nome: tenant.nome, tipo: tenant.tipo, plano_b2b: tenant.plano_b2b });
  };

  const salvarEdicao = () => {
    if (!tenantEditando) return;
    atualizarOrganizacao.mutate(
      {
        organizationId: tenantEditando.organization_id,
        nome: edicao.nome,
        tipo: edicao.tipo,
        plano_b2b: edicao.plano_b2b,
      },
      { onSuccess: () => setTenantEditando(null) }
    );
  };

  // ---- Ações de Suporte: resetar token do gateway / alterar e-mail do gestor ----
  const acaoSuporte = useMutation({
    mutationFn: async (payload: { organization_id: string; acao: "resetar_token_gateway" | "alterar_email_gestor"; novo_email?: string }) => {
      const { data, error } = await supabase.functions.invoke("superadmin-suporte-tenant", { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data, variables) => {
      if (variables.acao === "resetar_token_gateway") {
        toast({
          title: "Token do Gateway Local resetado.",
          description: `${data?.catracas_resetadas ?? 0} dispositivo(s) atualizado(s).`,
        });
      } else {
        toast({ title: "E-mail do gestor alterado." });
        setModalEmailGestorAberto(null);
        setNovoEmailGestor("");
      }
    },
    onError: (error: Error) =>
      toast({ title: "Erro na ação de suporte", description: error.message, variant: "destructive" }),
  });

  const [modalEmailGestorAberto, setModalEmailGestorAberto] = useState<Tenant | null>(null);
  const [novoEmailGestor, setNovoEmailGestor] = useState("");

  // Ações sensíveis (afetam login de toda a academia/studio ou os leitores
  // físicos de catraca da unidade) exigem confirmação explícita — evita que
  // um clique errado no menu de 3 pontinhos suspenda um tenant ou invalide
  // o token do Gateway Local por engano.
  const [tenantSuspendendo, setTenantSuspendendo] = useState<Tenant | null>(null);
  const [tenantResetandoToken, setTenantResetandoToken] = useState<Tenant | null>(null);

  const [categoriaAtiva, setCategoriaAtiva] = useState<CategoriaSimulacao | null>(null);
  const [destinoAtivo, setDestinoAtivo] = useState<string | null>(null);
  const [userIdSelecionado, setUserIdSelecionado] = useState<string | null>(null);
  const [simulando, setSimulando] = useState(false);

  const { data: perfisSimulaveis = [] } = useQuery({
    queryKey: ["superadmin-perfis-simulaveis"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_perfis_simulaveis");
      if (error) throw error;
      return (data ?? []) as PerfilSimulavel[];
    },
  });

  const opcoesCategoria = perfisSimulaveis.filter((p) => p.categoria === categoriaAtiva);

  const escolherCategoria = (categoria: CategoriaSimulacao, destino: string) => {
    setCategoriaAtiva(categoria);
    setDestinoAtivo(destino);
    setUserIdSelecionado(null);
  };

  const simular = async () => {
    if (!userIdSelecionado || !destinoAtivo) return;
    setSimulando(true);
    const { error } = await startImpersonation(userIdSelecionado);
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
              <Select value={userIdSelecionado ?? undefined} onValueChange={setUserIdSelecionado}>
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
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.full_name || p.email} — {p.organizacao_nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button disabled={!userIdSelecionado || simulando} onClick={() => void simular()}>
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
          value={overview ? `${Number(overview.take_rate_pct).toFixed(1)}%` : "—"}
          sublabel="Repasse ARKE / receita bruta"
        />
        <StatTile
          icon={AlertTriangle}
          label="Inadimplência Geral"
          value={overview ? `${Number(overview.inadimplencia_pct).toFixed(1)}%` : "—"}
          sublabel="Assinaturas atrasadas"
        />
        <StatTile
          icon={HeartPulse}
          label="Retenção de tenants"
          value={overview ? `${Number(overview.retencao_tenants_pct).toFixed(1)}%` : "—"}
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
                {!isLoadingTenants && tenantsFiltrados.length === 0 && (
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
                      <p className="font-medium">{tenant.nome}</p>
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
                          <DropdownMenuItem
                            onClick={() => {
                              setModalEmailGestorAberto(tenant);
                              setNovoEmailGestor("");
                            }}
                          >
                            <Mail className="h-3.5 w-3.5 mr-2" /> Alterar E-mail do Gestor Master
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
                    <SelectItem value="trial">Trial</SelectItem>
                    <SelectItem value="ativo">Ativo</SelectItem>
                  </SelectContent>
                </Select>
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

      {/* Editar Informações do Tenant */}
      <Dialog open={!!tenantEditando} onOpenChange={(open) => !open && setTenantEditando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Informações do Tenant</DialogTitle>
            <DialogDescription>{tenantEditando?.nome}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="edicao-nome">Nome</Label>
              <Input
                id="edicao-nome"
                value={edicao.nome}
                onChange={(e) => setEdicao((s) => ({ ...s, nome: e.target.value }))}
              />
            </div>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setTenantEditando(null)}>
              Cancelar
            </Button>
            <Button disabled={atualizarOrganizacao.isPending || !edicao.nome.trim()} onClick={salvarEdicao}>
              {atualizarOrganizacao.isPending ? "Salvando..." : "Salvar alterações"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ação de Suporte: alterar e-mail do gestor master */}
      <Dialog open={!!modalEmailGestorAberto} onOpenChange={(open) => !open && setModalEmailGestorAberto(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Alterar E-mail do Gestor Master</DialogTitle>
            <DialogDescription>{modalEmailGestorAberto?.nome}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="novo-email-gestor">Novo e-mail de login</Label>
            <Input
              id="novo-email-gestor"
              type="email"
              value={novoEmailGestor}
              onChange={(e) => setNovoEmailGestor(e.target.value)}
              placeholder="novo-email@academia.com"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalEmailGestorAberto(null)}>
              Cancelar
            </Button>
            <Button
              disabled={acaoSuporte.isPending || !novoEmailGestor.trim()}
              onClick={() =>
                modalEmailGestorAberto &&
                acaoSuporte.mutate({
                  organization_id: modalEmailGestorAberto.organization_id,
                  acao: "alterar_email_gestor",
                  novo_email: novoEmailGestor.trim(),
                })
              }
            >
              {acaoSuporte.isPending ? "Salvando..." : "Alterar e-mail"}
            </Button>
          </DialogFooter>
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

      {!isLoadingOverview && !overview && (
        <p className="text-xs text-muted-foreground text-center">
          Não foi possível carregar a visão global. Verifique se este usuário possui o papel
          "superadmin".
        </p>
      )}
    </div>
  );
}
