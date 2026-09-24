import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Building2, Wallet, Receipt, Printer, Upload } from "lucide-react";
import type { Enums, Tables } from "@/integrations/supabase/types";
import { ReciboComprovanteDialog, type ReciboData } from "@/components/admin/ReciboComprovanteDialog";
import { PlanosAcademiaPainel } from "@/components/admin/PlanosAcademiaPainel";
import { ContratoMatriculaPainel } from "@/components/admin/ContratoMatriculaPainel";
import { dividirCobranca, type RepasseConfig, type TaxaProcessamento } from "@/lib/repasse";
import { reais } from "@/lib/numeros";

type TipoNegocio = Extract<Enums<"organization_tipo">, "academia" | "studio">;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

const NIVEL_LABEL: Record<string, string> = { essencial: "Essencial (antigo)", integrado: "Integrado", elite: "Elite" };
const ASSINATURA_LABEL: Record<string, string> = { ativa: "Ativa", atrasada: "Atrasada", cancelada: "Cancelada" };

type Nivel = Enums<"nivel_atacado">;

// O Essencial virou o plano Free (sem custo de atacado): a academia paga só o plano B2B.
const NIVEIS: { value: Nivel; label: string }[] = [
  { value: "integrado", label: "Integrado" },
  { value: "elite", label: "Elite" },
];

const EMPTY_PRECIFICACAO: Tables<"organization_planos_precificacao">[] = [];
const EMPTY_PLANOS_ATACADO: Tables<"planos_atacado">[] = [];

// Aceita tanto "39.90" quanto "39,90" digitado pelo usuário.
function parseMoeda(valor: string): number {
  const normalizado = Number(valor.trim().replace(",", "."));
  return Number.isFinite(normalizado) ? normalizado : 0;
}

export default function AdminOrganizacao() {
  // Provisionamento automático da organização padrão para admin_arke sem
  // organização vinculada acontece em AdminLayout, compartilhado por todas
  // as telas de /admin — aqui só resta tratar o caso (fora de homologação)
  // de um usuário sem admin_arke e sem organização.
  const { organization, user, hasRole, refreshOrganization } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Consumo da cota de alunos do plano. Antes, o limite contratual só
  // existia como número parado numa coluna: ninguém via quanto já tinha
  // sido usado, e a primeira notícia de que ele existia era um cadastro
  // sendo recusado.
  const { data: cotaAlunos } = useQuery({
    queryKey: ["uso-limite-alunos", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_uso_limite_alunos");
      if (error) throw error;
      return data?.find((u) => u.organization_id === organization?.id) ?? null;
    },
    enabled: !!organization?.id,
  });

  const { data: planosAtacado = EMPTY_PLANOS_ATACADO } = useQuery({
    queryKey: ["planos-atacado"],
    queryFn: async () => {
      const { data, error } = await supabase.from("planos_atacado").select("*");
      if (error) throw error;
      return data;
    },
  });

  // Quanto a ArkeFit retém é negociado por academia (repasse_tipo/valor na
  // organização). A academia só lê: quem define é a ArkeFit, e o gatilho
  // trg_proteger_colunas_organizacao recusa alteração por aqui.
  const { data: repasseConfig = { tipo: "fixo", valor: null } as RepasseConfig } = useQuery({
    queryKey: ["repasse-organizacao", organization?.id],
    queryFn: async (): Promise<RepasseConfig> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("repasse_tipo, repasse_valor")
        .eq("id", organization!.id)
        .maybeSingle();
      if (error) throw error;
      return {
        tipo: (data?.repasse_tipo as RepasseConfig["tipo"]) ?? "fixo",
        valor: data?.repasse_valor === null || data?.repasse_valor === undefined ? null : Number(data.repasse_valor),
      };
    },
    enabled: !!organization?.id,
  });

  // A taxa do Asaas entra no repasse ARKE; a prévia do split precisa dela.
  const { data: taxaConfig } = useQuery({
    queryKey: ["taxa-processamento-config"],
    queryFn: async (): Promise<TaxaProcessamento> => {
      const { data, error } = await supabase.rpc("arke_taxa_processamento_config");
      if (error) throw error;
      const linha = data?.[0];
      return { percentual: Number(linha?.percentual ?? 0), fixa: Number(linha?.fixa ?? 0) };
    },
  });

  const { data: precificacao = EMPTY_PRECIFICACAO } = useQuery({
    queryKey: ["precificacao", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_planos_precificacao")
        .select("*")
        .eq("organization_id", organization!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const [valores, setValores] = useState<Record<Nivel, string>>({ essencial: "", integrado: "", elite: "" });

  useEffect(() => {
    const next: Record<Nivel, string> = { essencial: "", integrado: "", elite: "" };
    precificacao.forEach((p) => {
      next[p.nivel_atacado] = String(p.valor_varejo);
    });
    setValores((prev) => ({ ...prev, ...next }));
  }, [precificacao]);

  const { data: orgDetalhes } = useQuery({
    queryKey: ["organizacao-wallet", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("asaas_wallet_id, nome, tipo, slug, logo_url, telefone, endereco")
        .eq("id", organization!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const [perfil, setPerfil] = useState({
    nome: "",
    tipo: "academia" as TipoNegocio,
    slug: "",
    logoUrl: "",
    telefone: "",
    endereco: "",
  });

  useEffect(() => {
    if (!orgDetalhes) return;
    setPerfil({
      nome: orgDetalhes.nome ?? "",
      tipo: orgDetalhes.tipo === "studio" ? "studio" : "academia",
      slug: orgDetalhes.slug ?? "",
      logoUrl: orgDetalhes.logo_url ?? "",
      telefone: orgDetalhes.telefone ?? "",
      endereco: orgDetalhes.endereco ?? "",
    });
  }, [orgDetalhes]);

  const [enviandoLogo, setEnviandoLogo] = useState(false);

  const LOGO_TIPOS_ACEITOS = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
  const LOGO_TAMANHO_MAXIMO = 1.5 * 1024 * 1024; // mesmo limite configurado no bucket "avatars"

  // Reaproveita o bucket "avatars" (já público, já com RLS liberando
  // upload/troca/exclusão em uma pasta com o próprio user_id) para a logo
  // da organização — evita criar bucket e política novos só para isso.
  const enviarLogoDoComputador = async (file: File) => {
    if (!user) return;
    if (!LOGO_TIPOS_ACEITOS.includes(file.type)) {
      toast({ title: "Formato não suportado", description: "Envie um PNG, JPEG, WEBP ou SVG.", variant: "destructive" });
      return;
    }
    if (file.size > LOGO_TAMANHO_MAXIMO) {
      toast({ title: "Arquivo muito grande", description: "O limite é 1,5 MB por imagem.", variant: "destructive" });
      return;
    }

    setEnviandoLogo(true);
    try {
      const extensao = file.name.split(".").pop() || "png";
      const caminho = `${user.id}/org-logo-${Date.now()}.${extensao}`;
      const { error } = await supabase.storage
        .from("avatars")
        .upload(caminho, file, { upsert: true, contentType: file.type });
      if (error) throw error;

      const { data } = supabase.storage.from("avatars").getPublicUrl(caminho);
      setPerfil((p) => ({ ...p, logoUrl: data.publicUrl }));
      toast({ title: "Logo enviada", description: 'Clique em "Salvar Perfil" para aplicar às telas da organização.' });
    } catch (error) {
      toast({
        title: "Não foi possível enviar a logo",
        description: error instanceof Error ? error.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setEnviandoLogo(false);
    }
  };

  const podeEscolherTipo = orgDetalhes?.tipo === "academia" || orgDetalhes?.tipo === "studio";

  const salvarPerfilEstabelecimento = useMutation({
    mutationFn: async () => {
      if (!organization) {
        throw new Error("Nenhuma organização vinculada a este usuário. Entre com um usuário gestor/staff de uma academia.");
      }
      const slugNormalizado = slugify(perfil.slug);
      if (!SLUG_RE.test(slugNormalizado)) {
        throw new Error("Slug inválido. Use apenas letras minúsculas, números e hífens.");
      }
      const { error } = await supabase
        .from("organizations")
        .update({
          nome: perfil.nome,
          slug: slugNormalizado,
          ...(podeEscolherTipo ? { tipo: perfil.tipo } : {}),
          logo_url: perfil.logoUrl.trim() || null,
          telefone: perfil.telefone.trim() || null,
          endereco: perfil.endereco.trim() || null,
        })
        .eq("id", organization.id);
      if (error) {
        if (error.message.includes("duplicate") || error.code === "23505") {
          throw new Error("Esse slug já está em uso por outra organização. Escolha outro.");
        }
        throw error;
      }
      setPerfil((prev) => ({ ...prev, slug: slugNormalizado }));
    },
    onSuccess: () => {
      toast({ title: "Perfil do estabelecimento atualizado" });
      void queryClient.invalidateQueries({ queryKey: ["organizacao-wallet", organization?.id] });
      // organization.tipo no AuthContext decide o que a Sidebar e a Home
      // mostram (ex.: item "Agenda", visão de Studio) — sem isto o usuário
      // só veria a mudança depois de deslogar e logar de novo.
      void refreshOrganization();
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    },
  });

  const tipoMudou = podeEscolherTipo && orgDetalhes != null && perfil.tipo !== orgDetalhes.tipo;
  const [confirmarMudancaTipoAberto, setConfirmarMudancaTipoAberto] = useState(false);

  const salvarPerfil = () => {
    if (tipoMudou) {
      setConfirmarMudancaTipoAberto(true);
      return;
    }
    salvarPerfilEstabelecimento.mutate();
  };

  const iniciais = perfil.nome
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const { data: assinaturas = [] } = useQuery({
    queryKey: ["organizacao-assinaturas", organization?.id],
    queryFn: async () => {
      const { data: assinaturasData, error } = await supabase
        .from("aluno_assinaturas")
        .select("id, aluno_id, nivel_atacado, valor_cobrado, status, fatura_pendente_url, updated_at")
        .eq("organization_id", organization!.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;

      const alunoIds = assinaturasData.map((a) => a.aluno_id);
      const { data: alunosData } = alunoIds.length
        ? await supabase.from("alunos").select("id, user_id").in("id", alunoIds)
        : { data: [] as { id: string; user_id: string }[] };
      const userIds = (alunosData ?? []).map((a) => a.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };

      const userIdByAlunoId = new Map((alunosData ?? []).map((a) => [a.id, a.user_id]));
      const nomeByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

      return assinaturasData.map((a) => ({
        ...a,
        aluno_nome: nomeByUserId.get(userIdByAlunoId.get(a.aluno_id) ?? "") ?? "—",
      }));
    },
    enabled: !!organization?.id,
  });

  const [reciboAberto, setReciboAberto] = useState(false);
  const [reciboSelecionado, setReciboSelecionado] = useState<ReciboData | null>(null);

  const abrirRecibo = (assinatura: (typeof assinaturas)[number]) => {
    setReciboSelecionado({
      organizacaoNome: organization?.nome ?? "Academia",
      alunoNome: assinatura.aluno_nome,
      planoNome: NIVEL_LABEL[assinatura.nivel_atacado] ?? assinatura.nivel_atacado,
      valor: Number(assinatura.valor_cobrado),
      formaPagamento: "Asaas",
      data: assinatura.updated_at,
      statusPagamento: ASSINATURA_LABEL[assinatura.status] ?? assinatura.status,
      invoiceUrl: assinatura.fatura_pendente_url,
    });
    setReciboAberto(true);
  };

  const salvar = useMutation({
    mutationFn: async (nivel: Nivel) => {
      if (!organization) {
        throw new Error("Nenhuma organização selecionada. Entre com um usuário vinculado a uma organização (gestor) para editar a precificação.");
      }
      const valorVarejo = parseMoeda(valores[nivel]);
      // O repasse vem do contrato desta academia, não mais de um custo por
      // nível igual para todas. Sem isto o erro só apareceria ao gerar a
      // cobrança do aluno, que a função recusa pelo mesmo motivo.
      const divisao = dividirCobranca(valorVarejo, repasseConfig, taxaConfig ?? { percentual: 0, fixa: 0 });
      if (divisao.semRepasseNegociado) {
        throw new Error("O repasse do Método ainda não foi definido no contrato desta academia. Fale com o suporte da ArkeFit.");
      }
      if (!divisao.cobreORepasse) {
        throw new Error(
          `O valor precisa cobrir o repasse ARKE de ${reais(divisao.repasseArke!)} (repasse do contrato + taxa de processamento).`
        );
      }
      // Markup sobre o que a academia de fato entrega à ArkeFit.
      const markupPct = divisao.repasseArke! > 0 ? ((valorVarejo - divisao.repasseArke!) / divisao.repasseArke!) * 100 : 0;

      const { error } = await supabase
        .from("organization_planos_precificacao")
        .upsert(
          {
            organization_id: organization.id,
            nivel_atacado: nivel,
            valor_varejo: valorVarejo,
            markup_pct: markupPct,
          },
          { onConflict: "organization_id,nivel_atacado" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Preço atualizado" });
      void queryClient.invalidateQueries({ queryKey: ["precificacao", organization?.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">{organization?.nome ?? "Organização"}</h1>
      </div>

      {!organization && !hasRole("admin_arke") && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          Nenhuma organização vinculada a este usuário. Esta tela edita a precificação e o split de
          pagamento de uma organização específica — entre com um usuário gestor/staff vinculado a
          uma academia para editar esses dados.
        </div>
      )}

      <Tabs defaultValue="perfil">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="perfil">Perfil</TabsTrigger>
          <TabsTrigger value="precificacao">Precificação</TabsTrigger>
          <TabsTrigger value="pagamentos">Pagamentos</TabsTrigger>
          <TabsTrigger value="assinaturas">Assinaturas</TabsTrigger>
          <TabsTrigger value="planos">Planos da Academia</TabsTrigger>
          <TabsTrigger value="contrato">Contrato de matrícula</TabsTrigger>
        </TabsList>

      <TabsContent value="perfil" className="space-y-4 pt-3">
      {cotaAlunos?.limite != null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Alunos do plano</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <p className="text-sm">
                <span className="text-xl font-bold">{Number(cotaAlunos.alunos_ativos)}</span>
                <span className="text-muted-foreground"> de {cotaAlunos.limite} alunos</span>
              </p>
              <Badge variant="outline" className="uppercase text-xs">{cotaAlunos.plano}</Badge>
            </div>
            <Progress
              value={Math.min(100, (Number(cotaAlunos.alunos_ativos) / cotaAlunos.limite) * 100)}
            />
            {Number(cotaAlunos.alunos_ativos) >= cotaAlunos.limite ? (
              <p className="text-xs text-destructive">
                Cota cheia — novos cadastros serão recusados. Fale com a ArkeFit sobre migrar de plano.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Aluno anonimizado por LGPD não ocupa vaga.
              </p>
            )}
            {cotaAlunos.limite_padrao_do_plano != null &&
              cotaAlunos.limite !== cotaAlunos.limite_padrao_do_plano && (
                // Divergência já aconteceu de verdade: a Tietê estava no
                // Growth com o limite do Starter. Mostrar em vez de
                // corrigir sozinho — pode ser acordo comercial legítimo.
                <p className="text-xs text-amber-600">
                  O plano {cotaAlunos.plano} prevê {cotaAlunos.limite_padrao_do_plano} alunos, mas o
                  limite configurado é {cotaAlunos.limite}. Confirme com a ArkeFit se é intencional.
                </p>
              )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Perfil do Estabelecimento
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Avatar className="h-14 w-14 shrink-0">
              <AvatarImage src={perfil.logoUrl || undefined} />
              <AvatarFallback className="text-base">{iniciais || "AR"}</AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="org-logo">Logo da organização</Label>
              <div className="flex flex-col sm:flex-row gap-1.5">
                <Input
                  id="org-logo"
                  placeholder="Cole o link de uma imagem (https://...)"
                  value={perfil.logoUrl}
                  onChange={(e) => setPerfil((p) => ({ ...p, logoUrl: e.target.value }))}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={enviandoLogo}
                  onClick={() => document.getElementById("org-logo-arquivo")?.click()}
                  className="shrink-0"
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  {enviandoLogo ? "Enviando..." : "Enviar do computador"}
                </Button>
                <input
                  id="org-logo-arquivo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void enviarLogoDoComputador(file);
                    e.target.value = "";
                  }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">PNG, JPEG, WEBP ou SVG, até 1,5 MB.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="org-nome">Nome da Unidade</Label>
              <Input
                id="org-nome"
                value={perfil.nome}
                onChange={(e) => setPerfil((p) => ({ ...p, nome: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-tipo">Tipo de Negócio</Label>
              <Select
                value={perfil.tipo}
                onValueChange={(v) => setPerfil((p) => ({ ...p, tipo: v as TipoNegocio }))}
                disabled={!podeEscolherTipo}
              >
                <SelectTrigger id="org-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="academia">Academia</SelectItem>
                  <SelectItem value="studio">Studio</SelectItem>
                </SelectContent>
              </Select>
              {!podeEscolherTipo && (
                <p className="text-[11px] text-muted-foreground">
                  Profissional autônomo não altera o tipo de negócio por aqui.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-slug">Slug público</Label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">arkefit.com.br/#/p/</span>
              <Input
                id="org-slug"
                value={perfil.slug}
                onChange={(e) => setPerfil((p) => ({ ...p, slug: slugify(e.target.value) }))}
                placeholder="minha-academia"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="org-telefone">Telefone de contato</Label>
              <Input
                id="org-telefone"
                value={perfil.telefone}
                onChange={(e) => setPerfil((p) => ({ ...p, telefone: e.target.value }))}
                placeholder="(11) 99999-9999"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-endereco">Endereço</Label>
              <Input
                id="org-endereco"
                value={perfil.endereco}
                onChange={(e) => setPerfil((p) => ({ ...p, endereco: e.target.value }))}
                placeholder="Rua, número, bairro, cidade"
              />
            </div>
          </div>

          <Button
            disabled={salvarPerfilEstabelecimento.isPending || !perfil.nome.trim() || !perfil.slug.trim() || !organization}
            onClick={salvarPerfil}
          >
            {salvarPerfilEstabelecimento.isPending ? "Salvando..." : "Salvar perfil do estabelecimento"}
          </Button>
        </CardContent>
      </Card>
      </TabsContent>

      <Dialog open={confirmarMudancaTipoAberto} onOpenChange={setConfirmarMudancaTipoAberto}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mudar o tipo de negócio para {perfil.tipo === "studio" ? "Studio" : "Academia"}?</DialogTitle>
            <DialogDescription>
              Isso muda o que a equipe vê no painel — Studio ganha a Agenda de turmas e passa a exigir
              agendamento ativo na catraca; Academia perde o acesso a essa tela. Dados já existentes
              (turmas, agendamentos) não são migrados nem apagados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarMudancaTipoAberto(false)}>
              Cancelar
            </Button>
            <Button
              disabled={salvarPerfilEstabelecimento.isPending}
              onClick={() =>
                salvarPerfilEstabelecimento.mutate(undefined, {
                  onSuccess: () => setConfirmarMudancaTipoAberto(false),
                })
              }
            >
              {salvarPerfilEstabelecimento.isPending ? "Salvando..." : "Confirmar mudança"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TabsContent value="precificacao" className="pt-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Precificação de varejo (markup sobre o atacado ARKE)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {NIVEIS.map(({ value, label }) => {
            const plano = planosAtacado.find((p) => p.id === value);
            return (
              <div key={value} className="flex items-end gap-3">
                <div className="flex-1">
                  <Label htmlFor={`valor-${value}`}>
                    {label}{" "}
                    {plano != null && (
                      <span className="text-muted-foreground">
                        (custo atacado R$ {plano.custo_mensal} + taxa de processamento · sugestão ARKE R${" "}
                        {plano.valor_sugerido_varejo})
                      </span>
                    )}
                  </Label>
                  <Input
                    id={`valor-${value}`}
                    type="text"
                    inputMode="decimal"
                    value={valores[value]}
                    onChange={(e) => setValores((prev) => ({ ...prev, [value]: e.target.value }))}
                    placeholder="Valor de varejo (R$) — ex.: 39,90"
                  />
                </div>
                <Button onClick={() => salvar.mutate(value)} disabled={salvar.isPending || !organization}>
                  Salvar
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="pagamentos" className="space-y-4 pt-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Split de Pagamento (Asaas)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Wallet ID da academia no Asaas — usada para receber automaticamente a parte líquida de cada
            cobrança (o repasse de atacado à ARKE é retido na origem).
          </p>
        </CardHeader>
        {/* A carteira é configurada no onboarding (Recebimentos), que confere no Asaas
            antes de gravar — a carteira da ArkeFit, por exemplo, é recusada. A
            gravação direta daqui passou a ser recusada pelo banco. */}
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm">
            {orgDetalhes?.asaas_wallet_id ? (
              <span className="font-mono text-xs">{orgDetalhes.asaas_wallet_id}</span>
            ) : (
              <span className="text-muted-foreground">Conta de recebimentos ainda não configurada.</span>
            )}
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate("/admin/onboarding")}>
            {orgDetalhes?.asaas_wallet_id ? "Ver conta" : "Configurar"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Taxa de split aplicada por plano</CardTitle>
          <p className="text-xs text-muted-foreground">
            A cada cobrança confirmada no Asaas, o repasse ARKE — custo de atacado mais a taxa de
            processamento do pagamento — é retido automaticamente, e o restante cai direto na Wallet ID
            da academia configurada acima. A taxa acompanha o valor cobrado.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {NIVEIS.map(({ value, label }) => {
            const valorVarejo = parseMoeda(valores[value] || "0");
            const { taxaEstimada, repasseArke, liquidoAcademia, semRepasseNegociado } = dividirCobranca(
              valorVarejo,
              repasseConfig,
              taxaConfig ?? { percentual: 0, fixa: 0 }
            );
            const pctAcademia =
              valorVarejo > 0 && liquidoAcademia !== null ? Math.round((liquidoAcademia / valorVarejo) * 100) : 0;
            return (
              <div key={value} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0 last:pb-0">
                <span className="font-medium">{label}</span>
                <span className="text-xs text-muted-foreground text-right">
                  {semRepasseNegociado
                    ? "Repasse do Método ainda não definido no contrato desta academia."
                    : `Aluno paga ${reais(valorVarejo)} · ARKE retém ${reais(repasseArke!)} (repasse ${reais((
                        repasseArke! - taxaEstimada
                      ))} + taxa ${reais(taxaEstimada)}) · Academia recebe ${reais(liquidoAcademia!)}${valorVarejo > 0 ? ` (${pctAcademia}%)` : ""}`}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="assinaturas" className="pt-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4" /> Assinaturas da Academia
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Emita o comprovante/recibo de qualquer assinatura para entregar ao aluno no balcão.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {assinaturas.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nenhuma assinatura registrada ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aluno</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {assinaturas.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.aluno_nome}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{NIVEL_LABEL[a.nivel_atacado] ?? a.nivel_atacado}</Badge>
                    </TableCell>
                    <TableCell>{Number(a.valor_cobrado).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                    <TableCell>
                      <Badge variant={a.status === "ativa" ? "default" : "outline"}>
                        {ASSINATURA_LABEL[a.status] ?? a.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Imprimir Recibo / Comprovante" onClick={() => abrirRecibo(a)}>
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="planos" className="pt-3">
        <PlanosAcademiaPainel />
      </TabsContent>

      <TabsContent value="contrato" className="pt-3">
        <ContratoMatriculaPainel />
      </TabsContent>
      </Tabs>

      <ReciboComprovanteDialog open={reciboAberto} onOpenChange={setReciboAberto} recibo={reciboSelecionado} />
    </div>
  );
}
