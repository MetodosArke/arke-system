import { useState } from "react";
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
} from "lucide-react";
import type { Tables, Enums } from "@/integrations/supabase/types";

type CategoriaSimulacao = "aluno" | "academia_studio" | "personal" | "nutricionista";

type PerfilSimulavel = {
  user_id: string;
  full_name: string | null;
  email: string;
  organizacao_nome: string;
  categoria: CategoriaSimulacao | null;
};

const CATEGORIAS_SIMULACAO: { categoria: CategoriaSimulacao; label: string; icon: typeof Users; destino: string }[] = [
  { categoria: "aluno", label: "Visão do Aluno", icon: UserCircle, destino: "/#/app" },
  { categoria: "academia_studio", label: "Visão da Academia", icon: Building2, destino: "/#/admin" },
  { categoria: "academia_studio", label: "Visão do Studio", icon: Store, destino: "/#/admin" },
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

type Tenant = {
  organization_id: string;
  nome: string;
  slug: string;
  status: Enums<"org_status">;
  plano_b2b: Enums<"plano_b2b">;
  created_at: string;
  alunos_total: number;
  mrr_organizacao: number;
  assinaturas_atrasadas: number;
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
    }) => {
      const update: Partial<Tables<"organizations">> = {};
      if (payload.status) update.status = payload.status;
      if (payload.plano_b2b) update.plano_b2b = payload.plano_b2b;
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

          {categoriaAtiva === "academia_studio" && (
            <p className="text-[11px] text-muted-foreground">
              Academia e Studio hoje compartilham exatamente a mesma tela no produto — não existe
              ainda uma experiência de frontend distinta para studios, então as duas opções mostram
              o mesmo painel de gestor.
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
          <CardTitle className="text-base">Gestão de Tenants</CardTitle>
          <p className="text-xs text-muted-foreground">
            Bloqueio manual e alteração de plano master das academias parceiras.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="p-3">Academia</th>
                  <th className="p-3">Alunos</th>
                  <th className="p-3">MRR</th>
                  <th className="p-3">Atrasadas</th>
                  <th className="p-3">Plano master</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {!isLoadingTenants && tenants.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-muted-foreground">
                      Nenhuma academia cadastrada ainda.
                    </td>
                  </tr>
                )}
                {tenants.map((tenant) => (
                  <tr key={tenant.organization_id} className="border-b border-border last:border-0">
                    <td className="p-3">
                      <p className="font-medium">{tenant.nome}</p>
                      <p className="text-xs text-muted-foreground">/{tenant.slug}</p>
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
                      <div className="flex items-center gap-2">
                        <Badge variant={tenant.status === "ativo" ? "default" : "secondary"}>
                          {STATUS_LABEL[tenant.status]}
                        </Badge>
                        {tenant.status === "suspenso" ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Desbloquear academia"
                            onClick={() =>
                              atualizarOrganizacao.mutate({
                                organizationId: tenant.organization_id,
                                status: "ativo",
                              })
                            }
                          >
                            <Unlock className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Bloquear academia"
                            onClick={() =>
                              atualizarOrganizacao.mutate({
                                organizationId: tenant.organization_id,
                                status: "suspenso",
                              })
                            }
                          >
                            <Lock className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {!isLoadingOverview && !overview && (
        <p className="text-xs text-muted-foreground text-center">
          Não foi possível carregar a visão global. Verifique se este usuário possui o papel
          "superadmin".
        </p>
      )}
    </div>
  );
}
