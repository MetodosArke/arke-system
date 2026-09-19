import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Building2,
  Users,
  TrendingUp,
  AlertTriangle,
  Receipt,
  Pencil,
  Mail,
  Phone,
  ClipboardList,
  Dumbbell,
  UtensilsCrossed,
  Ruler,
  CheckCircle2,
} from "lucide-react";
import { Bloco } from "@/components/admin/perfilSheetHelpers";
import type { Enums } from "@/integrations/supabase/types";

type AtividadeTipo = "treino" | "dieta" | "avaliacao" | "tarefa";

interface AtividadeItem {
  tipo: AtividadeTipo;
  data: string;
  descricao: string | null;
  aluno_id: string | null;
  aluno_nome: string | null;
  responsavel_nome: string | null;
}

const ATIVIDADE_ICON: Record<AtividadeTipo, typeof Dumbbell> = {
  treino: Dumbbell,
  dieta: UtensilsCrossed,
  avaliacao: Ruler,
  tarefa: CheckCircle2,
};

const ATIVIDADE_LABEL: Record<AtividadeTipo, string> = {
  treino: "Treino publicado",
  dieta: "Dieta publicada",
  avaliacao: "Avaliação física registrada",
  tarefa: "Pendência resolvida",
};

export interface OrganizacaoPerfil {
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
}

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

const TIPO_LABEL: Record<Enums<"organization_tipo">, string> = {
  academia: "Academia",
  studio: "Studio",
  profissional_autonomo: "Profissional Autônomo",
};

const formatarMoeda = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarData = (valor: string | null) =>
  valor ? new Date(valor).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "Sem atividade";

// Painel lateral com o perfil completo de uma organização — aberto
// clicando no nome do tenant na tabela do SuperAdmin. É um retrato
// consolidado do que já vem na listagem (a RPC get_superadmin_tenants já
// traz tudo que a tela precisa, então não há query adicional aqui); ações
// de edição e faturamento delegam para os dialogs que a tela já tinha, e
// ações destrutivas (suspender, excluir) continuam só no menu ⋮ da linha,
// para não ficarem a um clique de distância dentro de um painel de leitura.
export function OrganizacaoPerfilSheet({
  tenant,
  onOpenChange,
  onEditar,
  onFaturamento,
}: {
  tenant: OrganizacaoPerfil | null;
  onOpenChange: (open: boolean) => void;
  onEditar: (tenant: OrganizacaoPerfil) => void;
  onFaturamento: (tenant: OrganizacaoPerfil) => void;
}) {
  const { data: atividade = [] } = useQuery({
    queryKey: ["superadmin-organizacao-atividade", tenant?.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_organizacao_atividade", {
        _organization_id: tenant!.organization_id,
      });
      if (error) throw error;
      return (data ?? []) as AtividadeItem[];
    },
    enabled: !!tenant?.organization_id,
  });

  return (
    <Sheet open={!!tenant} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {tenant && (
          <>
            <SheetHeader className="text-left space-y-2">
              <SheetTitle>{tenant.nome}</SheetTitle>
              <p className="text-xs text-muted-foreground -mt-1">/{tenant.slug}</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{TIPO_LABEL[tenant.tipo]}</Badge>
                <Badge variant={tenant.status === "ativo" ? "default" : "secondary"}>
                  {STATUS_LABEL[tenant.status]}
                </Badge>
                <Badge variant="secondary">{PLANO_LABEL[tenant.plano_b2b]}</Badge>
              </div>
            </SheetHeader>

            <div className="flex gap-2 mt-4">
              <Button size="sm" className="flex-1" onClick={() => onEditar(tenant)}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Editar Informações
              </Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={() => onFaturamento(tenant)}>
                <Receipt className="h-3.5 w-3.5 mr-1.5" />
                Faturamento B2B
              </Button>
            </div>

            <Separator className="my-4" />

            <div className="space-y-4">
              <Bloco titulo="Métricas" icon={TrendingUp}>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" /> {tenant.alunos_total} alunos
                  </span>
                  <span>MRR: {formatarMoeda(Number(tenant.mrr_organizacao))}</span>
                </div>
                {tenant.assinaturas_atrasadas > 0 && (
                  <p className="text-xs text-destructive flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {tenant.assinaturas_atrasadas} assinatura(s) atrasada(s)
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Última atividade: {formatarData(tenant.ultima_atividade)}</p>
              </Bloco>

              <Bloco titulo="Contato" icon={Mail}>
                <p className="text-sm">{tenant.gestor_email ?? "E-mail do gestor não disponível"}</p>
                <p className="text-sm flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  {tenant.telefone ?? "Telefone não informado"}
                </p>
              </Bloco>

              <Bloco titulo="Dados Fiscais" icon={Building2}>
                <p className="text-sm">{tenant.cnpj_cpf ?? "CNPJ/CPF não informado"}</p>
                {tenant.status === "trial" && tenant.trial_vencimento && (
                  <p className="text-xs text-muted-foreground">Trial vence em {formatarData(tenant.trial_vencimento)}</p>
                )}
              </Bloco>

              <Bloco titulo="Atividade Recente" icon={ClipboardList}>
                {atividade.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem atividade recente registrada.</p>
                ) : (
                  <ul className="space-y-2">
                    {atividade.map((item, i) => {
                      const Icon = ATIVIDADE_ICON[item.tipo];
                      return (
                        <li key={i} className="text-sm">
                          <div className="flex items-start gap-2">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p>
                                <span className="font-medium">{ATIVIDADE_LABEL[item.tipo]}</span>
                                {item.descricao && <span className="text-muted-foreground"> — {item.descricao}</span>}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Para {item.aluno_nome ?? "aluno sem vínculo"}
                                {item.responsavel_nome && <> · por {item.responsavel_nome}</>} ·{" "}
                                {formatarData(item.data)}
                              </p>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Bloco>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
