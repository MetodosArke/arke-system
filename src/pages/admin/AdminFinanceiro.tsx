import { hojeBrasilia } from "@/lib/dataBrasilia";
import { useState } from "react";
import { ExportarContador } from "@/components/admin/ExportarContador";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, TrendingUp, TrendingDown, Plus, Wallet, Repeat, Sparkles, BookOpen, Percent } from "lucide-react";
import type { Enums, Tables } from "@/integrations/supabase/types";

type FolhaTipo = Enums<"folha_tipo">;
type LancamentoTipo = Enums<"lancamento_financeiro_tipo">;
type LancamentoStatus = Enums<"lancamento_status">;
type PlanoContas = Tables<"plano_contas">;
type Papel = Extract<Enums<"app_role">, "gestor" | "professor" | "nutricionista" | "recepcao">;
type TipoEventoComissao = Enums<"comissao_tipo_evento">;

const PAPEL_LABEL: Record<Papel, string> = {
  gestor: "Gestor",
  professor: "Personal",
  nutricionista: "Nutricionista",
  recepcao: "Recepção",
};

const PAPEIS: Papel[] = ["gestor", "professor", "nutricionista", "recepcao"];

const TIPO_EVENTO_COMISSAO_LABEL: Record<TipoEventoComissao, string> = {
  matricula_academia: "Matrícula em plano da academia",
  adesao_metodo_arke: "Adesão ao Método ARKE",
};

const TIPOS_EVENTO_COMISSAO: TipoEventoComissao[] = ["matricula_academia", "adesao_metodo_arke"];

interface ComissaoConfigForm {
  percentual: string;
  valor_fixo: string;
  ativo: boolean;
  id: string | null;
}

const COMISSAO_FORM_VAZIO: ComissaoConfigForm = { percentual: "", valor_fixo: "", ativo: true, id: null };

const FOLHA_TIPO_LABEL: Record<FolhaTipo, string> = {
  salario_fixo: "Salário fixo",
  pro_labore: "Pró-labore",
  comissionado: "Só comissão",
};

const STATUS_LABEL: Record<LancamentoStatus, string> = {
  pendente: "Pendente",
  pago: "Pago",
  atrasado: "Atrasado",
  cancelado: "Cancelado",
};

const MESES_RECENTES = Array.from({ length: 6 }, (_, i) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - i);
  return d.toISOString().slice(0, 7); // YYYY-MM
});

function mesLabel(ym: string) {
  const [ano, mes] = ym.split("-").map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

interface LancamentoForm {
  tipo: LancamentoTipo;
  categoriaId: string;
  contato: string;
  formaPagamento: string;
  descricao: string;
  valor: string;
  data: string;
  vencimento: string; // vazio = já pago na criação
  recorrente: boolean;
}

const LANCAMENTO_VAZIO: LancamentoForm = {
  tipo: "despesa",
  categoriaId: "",
  contato: "",
  formaPagamento: "",
  descricao: "",
  valor: "",
  data: hojeBrasilia(),
  vencimento: "",
  recorrente: false,
};

export default function AdminFinanceiro() {
  const { organization, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [competencia, setCompetencia] = useState(MESES_RECENTES[0]);
  const [formFolha, setFormFolha] = useState<Record<string, { tipo: FolhaTipo; valor_base: string; ativo: boolean }>>({});
  const [novoLancamento, setNovoLancamento] = useState<LancamentoForm>(LANCAMENTO_VAZIO);
  const [novaCategoria, setNovaCategoria] = useState<{ tipo: LancamentoTipo; nome: string }>({ tipo: "despesa", nome: "" });

  const { data: equipe = [] } = useQuery({
    queryKey: ["financeiro-equipe", organization?.id],
    queryFn: async () => {
      const { data: membros, error } = await supabase
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", organization!.id)
        .eq("status", "active")
        .in("role", ["gestor", "professor", "nutricionista", "recepcao"]);
      if (error) throw error;
      const userIds = membros.map((m) => m.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };
      const nomeByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
      return membros.map((m) => ({ ...m, full_name: nomeByUserId.get(m.user_id) ?? "—" }));
    },
    enabled: !!organization?.id,
  });

  const { data: folhaConfig = [] } = useQuery({
    queryKey: ["staff-folha-config", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_folha").select("*").eq("organization_id", organization!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: pagamentosDoMes = [] } = useQuery({
    queryKey: ["staff-folha-pagamentos", organization?.id, competencia],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_folha_pagamentos")
        .select("*")
        .eq("organization_id", organization!.id)
        .eq("competencia", `${competencia}-01`);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const configByUserId = new Map(folhaConfig.map((f) => [f.user_id, f]));
  const pagamentoByUserId = new Map(pagamentosDoMes.map((p) => [p.user_id, p]));

  const getFormFolha = (userId: string) => {
    if (formFolha[userId]) return formFolha[userId];
    const existente = configByUserId.get(userId);
    return existente
      ? { tipo: existente.tipo, valor_base: existente.valor_base != null ? String(existente.valor_base) : "", ativo: existente.ativo }
      : { tipo: "salario_fixo" as FolhaTipo, valor_base: "", ativo: true };
  };

  const setFormFolhaUser = (userId: string, patch: Partial<{ tipo: FolhaTipo; valor_base: string; ativo: boolean }>) => {
    setFormFolha((f) => ({ ...f, [userId]: { ...getFormFolha(userId), ...patch } }));
  };

  const salvarFolha = useMutation({
    mutationFn: async (userId: string) => {
      if (!organization) return;
      const form = getFormFolha(userId);
      const valorBase = form.tipo === "comissionado" ? null : form.valor_base.trim() ? Number(form.valor_base.replace(",", ".")) : null;
      const { error } = await supabase
        .from("staff_folha")
        .upsert(
          { organization_id: organization.id, user_id: userId, tipo: form.tipo, valor_base: valorBase, ativo: form.ativo },
          { onConflict: "organization_id,user_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Remuneração salva" });
      void queryClient.invalidateQueries({ queryKey: ["staff-folha-config", organization?.id] });
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  const gerarFechamento = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("gerar_fechamento_folha", { _user_id: userId, _competencia: `${competencia}-01` });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Fechamento gerado" });
      void queryClient.invalidateQueries({ queryKey: ["staff-folha-pagamentos", organization?.id, competencia] });
    },
    onError: (error: Error) => toast({ title: "Erro ao gerar fechamento", description: error.message, variant: "destructive" }),
  });

  const marcarFolhaPaga = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("staff_folha_pagamentos")
        .update({ status: "pago", data_pagamento: hojeBrasilia() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["staff-folha-pagamentos", organization?.id, competencia] }),
    onError: (error: Error) => toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" }),
  });

  const { data: planoContas = [] } = useQuery({
    queryKey: ["plano-contas", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plano_contas")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("tipo")
        .order("nome");
      if (error) throw error;
      return data as PlanoContas[];
    },
    enabled: !!organization?.id,
  });

  const contasPorTipo = (tipo: LancamentoTipo) => planoContas.filter((c) => c.tipo === tipo && c.ativo);

  const criarCategoria = useMutation({
    mutationFn: async () => {
      if (!organization) return;
      if (!novaCategoria.nome.trim()) throw new Error("Informe o nome da conta.");
      const { error } = await supabase
        .from("plano_contas")
        .insert({ organization_id: organization.id, tipo: novaCategoria.tipo, nome: novaCategoria.nome.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Conta criada" });
      setNovaCategoria({ tipo: "despesa", nome: "" });
      void queryClient.invalidateQueries({ queryKey: ["plano-contas", organization?.id] });
    },
    onError: (error: Error) => toast({ title: "Erro ao criar conta", description: error.message, variant: "destructive" }),
  });

  const alternarCategoria = useMutation({
    mutationFn: async (categoria: PlanoContas) => {
      const { error } = await supabase.from("plano_contas").update({ ativo: !categoria.ativo }).eq("id", categoria.id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["plano-contas", organization?.id] }),
    onError: (error: Error) => toast({ title: "Erro ao atualizar conta", description: error.message, variant: "destructive" }),
  });

  const { data: lancamentos = [] } = useQuery({
    queryKey: ["lancamentos-financeiros", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lancamentos_financeiros")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("data", { ascending: false })
        .limit(80);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const criarLancamento = useMutation({
    mutationFn: async () => {
      if (!organization) return;
      const valor = Number(novoLancamento.valor.replace(",", "."));
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Valor inválido.");
      const categoria = planoContas.find((c) => c.id === novoLancamento.categoriaId);
      const temVencimentoFuturo = !!novoLancamento.vencimento;
      const { error } = await supabase.from("lancamentos_financeiros").insert({
        organization_id: organization.id,
        tipo: novoLancamento.tipo,
        categoria_id: novoLancamento.categoriaId || null,
        categoria: categoria?.nome ?? null,
        contato: novoLancamento.contato.trim() || null,
        forma_pagamento: novoLancamento.formaPagamento.trim() || null,
        descricao: novoLancamento.descricao.trim() || null,
        valor,
        data: novoLancamento.data,
        vencimento: novoLancamento.vencimento || null,
        status: temVencimentoFuturo ? "pendente" : "pago",
        data_pagamento: temVencimentoFuturo ? null : novoLancamento.data,
        recorrencia: novoLancamento.recorrente ? "mensal" : "nenhuma",
        registrado_por: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Lançamento registrado" });
      setNovoLancamento(LANCAMENTO_VAZIO);
      void queryClient.invalidateQueries({ queryKey: ["lancamentos-financeiros", organization?.id] });
    },
    onError: (error: Error) => toast({ title: "Erro ao registrar", description: error.message, variant: "destructive" }),
  });

  const marcarLancamentoPago = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("lancamentos_financeiros")
        .update({ status: "pago", data_pagamento: hojeBrasilia() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["lancamentos-financeiros", organization?.id] }),
    onError: (error: Error) => toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" }),
  });

  const comissaoChave = (papel: Papel, tipo: TipoEventoComissao) => `${papel}:${tipo}`;

  const { data: comissoesConfigs = [], isLoading: comissoesCarregando } = useQuery({
    queryKey: ["staff-comissoes-config", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_comissoes_config").select("*").eq("organization_id", organization!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: comissoesLancamentos = [] } = useQuery({
    queryKey: ["staff-comissoes-lancamentos", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_comissoes_lancamentos")
        .select("id, user_id, tipo_evento, valor_base, valor_comissao, status, competencia, created_at")
        .eq("organization_id", organization!.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;

      const userIds = Array.from(new Set(data?.map((l) => l.user_id) ?? []));
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };
      const nomeByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

      return (data ?? []).map((l) => ({ ...l, nome: nomeByUserId.get(l.user_id) ?? "—" }));
    },
    enabled: !!organization?.id,
  });

  const [comissaoFormularios, setComissaoFormularios] = useState<Record<string, ComissaoConfigForm>>({});
  const comissaoConfigByChave = new Map(comissoesConfigs.map((c) => [comissaoChave(c.papel as Papel, c.tipo_evento), c]));

  const getComissaoForm = (papel: Papel, tipo: TipoEventoComissao): ComissaoConfigForm => {
    const k = comissaoChave(papel, tipo);
    if (comissaoFormularios[k]) return comissaoFormularios[k];
    const existente = comissaoConfigByChave.get(k);
    return existente
      ? {
          id: existente.id,
          percentual: existente.percentual != null ? String(existente.percentual) : "",
          valor_fixo: existente.valor_fixo != null ? String(existente.valor_fixo) : "",
          ativo: existente.ativo,
        }
      : { ...COMISSAO_FORM_VAZIO };
  };

  const setComissaoForm = (papel: Papel, tipo: TipoEventoComissao, patch: Partial<ComissaoConfigForm>) => {
    const k = comissaoChave(papel, tipo);
    setComissaoFormularios((f) => ({ ...f, [k]: { ...getComissaoForm(papel, tipo), ...patch } }));
  };

  const salvarComissao = useMutation({
    mutationFn: async ({ papel, tipo }: { papel: Papel; tipo: TipoEventoComissao }) => {
      if (!organization) return;
      const form = getComissaoForm(papel, tipo);
      const percentual = form.percentual.trim() ? Number(form.percentual.replace(",", ".")) : null;
      const valorFixo = form.valor_fixo.trim() ? Number(form.valor_fixo.replace(",", ".")) : null;
      const { error } = await supabase.from("staff_comissoes_config").upsert(
        {
          organization_id: organization.id,
          papel,
          tipo_evento: tipo,
          percentual,
          valor_fixo: valorFixo,
          ativo: form.ativo,
        },
        { onConflict: "organization_id,papel,tipo_evento" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Regra de comissão salva" });
      void queryClient.invalidateQueries({ queryKey: ["staff-comissoes-config", organization?.id] });
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  const marcarComissaoPaga = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_comissoes_lancamentos").update({ status: "pago" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["staff-comissoes-lancamentos", organization?.id] }),
    onError: (error: Error) => toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" }),
  });

  const pagos = lancamentos.filter((l) => l.status === "pago");
  const totalReceitasPagas = pagos.filter((l) => l.tipo === "receita").reduce((s, l) => s + Number(l.valor), 0);
  const totalDespesasPagas = pagos.filter((l) => l.tipo === "despesa").reduce((s, l) => s + Number(l.valor), 0);
  const saldo = totalReceitasPagas - totalDespesasPagas;
  const aReceber = lancamentos
    .filter((l) => l.tipo === "receita" && (l.status === "pendente" || l.status === "atrasado"))
    .reduce((s, l) => s + Number(l.valor), 0);
  const aPagar = lancamentos
    .filter((l) => l.tipo === "despesa" && (l.status === "pendente" || l.status === "atrasado"))
    .reduce((s, l) => s + Number(l.valor), 0);

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Financeiro</h1>
        </div>
        <ExportarContador />
      </div>
      <p className="text-sm text-muted-foreground">
        Controle interno — não substitui a contabilidade externa da academia, mas fica o mais completo possível
        dentro disso: plano de contas, contas a pagar/receber com vencimento e recorrência, e lançamento automático
        do que o próprio ArkeFit já sabe (mensalidade paga, folha fechada).
      </p>

      <Tabs defaultValue="lancamentos">
        <TabsList>
          <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
          <TabsTrigger value="folha">Folha</TabsTrigger>
          <TabsTrigger value="comissoes">Comissões</TabsTrigger>
          <TabsTrigger value="plano-contas">Plano de Contas</TabsTrigger>
        </TabsList>

        <TabsContent value="lancamentos" className="space-y-4 pt-3">
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" />
                  <p className="text-xs text-muted-foreground">Saldo (pagos)</p>
                </div>
                <p className={`text-lg font-bold ${saldo < 0 ? "text-red-600" : ""}`}>R$ {saldo.toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  <p className="text-xs text-muted-foreground">A receber</p>
                </div>
                <p className="text-lg font-bold">R$ {aReceber.toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-red-600" />
                  <p className="text-xs text-muted-foreground">A pagar</p>
                </div>
                <p className="text-lg font-bold">R$ {aPagar.toFixed(2)}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Novo lançamento</CardTitle>
              <CardDescription>Sem vencimento = já pago hoje. Com vencimento = entra como pendente (conta a pagar/receber).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select
                    value={novoLancamento.tipo}
                    onValueChange={(v) => setNovoLancamento((f) => ({ ...f, tipo: v as LancamentoTipo, categoriaId: "" }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="receita">Receita</SelectItem>
                      <SelectItem value="despesa">Despesa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Conta (plano de contas)</Label>
                  <Select value={novoLancamento.categoriaId} onValueChange={(v) => setNovoLancamento((f) => ({ ...f, categoriaId: v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {contasPorTipo(novoLancamento.tipo).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Data</Label>
                  <Input type="date" value={novoLancamento.data} onChange={(e) => setNovoLancamento((f) => ({ ...f, data: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Vencimento (opcional)</Label>
                  <Input type="date" value={novoLancamento.vencimento} onChange={(e) => setNovoLancamento((f) => ({ ...f, vencimento: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Valor (R$)</Label>
                  <Input inputMode="decimal" value={novoLancamento.valor} onChange={(e) => setNovoLancamento((f) => ({ ...f, valor: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Fornecedor / cliente (opcional)</Label>
                  <Input value={novoLancamento.contato} onChange={(e) => setNovoLancamento((f) => ({ ...f, contato: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Forma de pagamento (opcional)</Label>
                  <Input
                    placeholder="Pix, boleto, cartão..."
                    value={novoLancamento.formaPagamento}
                    onChange={(e) => setNovoLancamento((f) => ({ ...f, formaPagamento: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Descrição (opcional)</Label>
                <Textarea rows={2} value={novoLancamento.descricao} onChange={(e) => setNovoLancamento((f) => ({ ...f, descricao: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="recorrente"
                  checked={novoLancamento.recorrente}
                  onCheckedChange={(v) => setNovoLancamento((f) => ({ ...f, recorrente: v === true }))}
                />
                <Label htmlFor="recorrente" className="text-sm font-normal cursor-pointer">
                  Repete todo mês (ex.: aluguel) — a próxima ocorrência é criada automaticamente como pendente
                </Label>
              </div>
              <Button size="sm" onClick={() => criarLancamento.mutate()} disabled={criarLancamento.isPending}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Registrar
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              {lancamentos.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Nenhum lançamento ainda.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Conta</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lancamentos.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs">
                          {new Date(`${l.vencimento ?? l.data}T12:00:00`).toLocaleDateString("pt-BR")}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1">
                            {l.categoria ?? "—"}
                            {l.recorrencia === "mensal" && <Repeat className="h-3 w-3 text-muted-foreground" />}
                            {l.origem_automatica && <Sparkles className="h-3 w-3 text-muted-foreground" />}
                          </span>
                          {l.contato && <p className="text-xs text-muted-foreground">{l.contato}</p>}
                          {l.descricao && <p className="text-xs text-muted-foreground">{l.descricao}</p>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={l.tipo === "receita" ? "default" : "secondary"}>{l.tipo === "receita" ? "Receita" : "Despesa"}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={l.status === "pago" ? "default" : l.status === "atrasado" ? "destructive" : "outline"}
                          >
                            {STATUS_LABEL[l.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">R$ {Number(l.valor).toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          {(l.status === "pendente" || l.status === "atrasado") && (
                            <Button size="sm" variant="ghost" onClick={() => marcarLancamentoPago.mutate(l.id)} disabled={marcarLancamentoPago.isPending}>
                              Marcar pago
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="folha" className="space-y-4 pt-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Remuneração por profissional</CardTitle>
              <CardDescription>Salário fixo, pró-labore ou só comissão (sem valor base).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {equipe.map((m) => {
                const form = getFormFolha(m.user_id);
                return (
                  <div key={m.user_id} className="flex items-center gap-2 flex-wrap border-b border-border pb-3 last:border-0 last:pb-0">
                    <span className="text-sm font-medium w-36 shrink-0">{m.full_name}</span>
                    <Select value={form.tipo} onValueChange={(v) => setFormFolhaUser(m.user_id, { tipo: v as FolhaTipo })}>
                      <SelectTrigger className="w-40 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(FOLHA_TIPO_LABEL) as FolhaTipo[]).map((t) => (
                          <SelectItem key={t} value={t}>
                            {FOLHA_TIPO_LABEL[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.tipo !== "comissionado" && (
                      <Input
                        className="w-28 h-8"
                        placeholder="R$ 0,00"
                        inputMode="decimal"
                        value={form.valor_base}
                        onChange={(e) => setFormFolhaUser(m.user_id, { valor_base: e.target.value })}
                      />
                    )}
                    <Button size="sm" variant="outline" onClick={() => salvarFolha.mutate(m.user_id)} disabled={salvarFolha.isPending}>
                      Salvar
                    </Button>
                  </div>
                );
              })}
              {equipe.length === 0 && <p className="text-sm text-muted-foreground">Nenhum profissional na equipe.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Fechamento mensal</CardTitle>
                <CardDescription>Soma remuneração + comissões do mês selecionado.</CardDescription>
              </div>
              <Select value={competencia} onValueChange={setCompetencia}>
                <SelectTrigger className="w-40 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MESES_RECENTES.map((ym) => (
                    <SelectItem key={ym} value={ym} className="capitalize">
                      {mesLabel(ym)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Profissional</TableHead>
                    <TableHead>Base</TableHead>
                    <TableHead>Comissões</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipe.map((m) => {
                    const pagamento = pagamentoByUserId.get(m.user_id);
                    return (
                      <TableRow key={m.user_id}>
                        <TableCell>{m.full_name}</TableCell>
                        <TableCell>{pagamento ? `R$ ${Number(pagamento.valor_base).toFixed(2)}` : "—"}</TableCell>
                        <TableCell>{pagamento ? `R$ ${Number(pagamento.valor_comissoes).toFixed(2)}` : "—"}</TableCell>
                        <TableCell className="font-medium">{pagamento ? `R$ ${Number(pagamento.valor_total).toFixed(2)}` : "—"}</TableCell>
                        <TableCell>
                          {pagamento ? (
                            <Badge variant={pagamento.status === "pago" ? "default" : "outline"}>
                              {pagamento.status === "pago" ? "Pago" : "Pendente"}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Não gerado</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="outline" onClick={() => gerarFechamento.mutate(m.user_id)} disabled={gerarFechamento.isPending}>
                            {pagamento ? "Atualizar" : "Gerar"}
                          </Button>
                          {pagamento && pagamento.status === "pendente" && (
                            <Button size="sm" variant="ghost" onClick={() => marcarFolhaPaga.mutate(pagamento.id)} disabled={marcarFolhaPaga.isPending}>
                              Marcar pago
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="comissoes" className="space-y-4 pt-3">
          <p className="text-sm text-muted-foreground">
            Regra por papel — quando alguém desse papel registra uma matrícula ou uma adesão, o lançamento é
            gerado automaticamente. Sem regra configurada (ou com percentual/valor em branco), nenhuma comissão
            é gerada.
          </p>

          {TIPOS_EVENTO_COMISSAO.map((tipo) => (
            <Card key={tipo}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Percent className="h-4 w-4" /> {TIPO_EVENTO_COMISSAO_LABEL[tipo]}
                </CardTitle>
                <CardDescription>Comissão = (valor do evento × percentual) + valor fixo.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {comissoesCarregando && <p className="text-sm text-muted-foreground">Carregando...</p>}
                {!comissoesCarregando &&
                  PAPEIS.map((papel) => {
                    const form = getComissaoForm(papel, tipo);
                    return (
                      <div key={papel} className="flex items-center gap-3 flex-wrap border-b border-border pb-3 last:border-0 last:pb-0">
                        <span className="text-sm font-medium w-28 shrink-0">{PAPEL_LABEL[papel]}</span>
                        <div className="flex items-center gap-1.5">
                          <Input
                            className="w-20 h-8"
                            placeholder="%"
                            inputMode="decimal"
                            value={form.percentual}
                            onChange={(e) => setComissaoForm(papel, tipo, { percentual: e.target.value })}
                          />
                          <span className="text-xs text-muted-foreground">%</span>
                        </div>
                        <span className="text-xs text-muted-foreground">+</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">R$</span>
                          <Input
                            className="w-24 h-8"
                            placeholder="0,00"
                            inputMode="decimal"
                            value={form.valor_fixo}
                            onChange={(e) => setComissaoForm(papel, tipo, { valor_fixo: e.target.value })}
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Switch checked={form.ativo} onCheckedChange={(v) => setComissaoForm(papel, tipo, { ativo: v })} />
                          <span className="text-xs text-muted-foreground">Ativa</span>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => salvarComissao.mutate({ papel, tipo })} disabled={salvarComissao.isPending}>
                          Salvar
                        </Button>
                      </div>
                    );
                  })}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Lançamentos recentes</CardTitle>
            </CardHeader>
            <CardContent>
              {comissoesLancamentos.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma comissão gerada ainda.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Profissional</TableHead>
                      <TableHead>Evento</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comissoesLancamentos.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>{l.nome}</TableCell>
                        <TableCell className="text-xs">{TIPO_EVENTO_COMISSAO_LABEL[l.tipo_evento as TipoEventoComissao]}</TableCell>
                        <TableCell>R$ {Number(l.valor_comissao).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant={l.status === "pago" ? "default" : "outline"}>
                            {l.status === "pago" ? "Pago" : "Pendente"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {l.status === "pendente" && (
                            <Button size="sm" variant="ghost" onClick={() => marcarComissaoPaga.mutate(l.id)} disabled={marcarComissaoPaga.isPending}>
                              Marcar pago
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plano-contas" className="space-y-4 pt-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="h-4 w-4" /> Plano de contas
              </CardTitle>
              <CardDescription>Categorias usadas nos lançamentos. As marcadas "(automático)" são criadas sozinhas pelo sistema.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-2 flex-wrap">
                <div className="space-y-1.5">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={novaCategoria.tipo} onValueChange={(v) => setNovaCategoria((c) => ({ ...c, tipo: v as LancamentoTipo }))}>
                    <SelectTrigger className="w-32 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="receita">Receita</SelectItem>
                      <SelectItem value="despesa">Despesa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 flex-1 min-w-[160px]">
                  <Label className="text-xs">Nome da conta</Label>
                  <Input className="h-8" value={novaCategoria.nome} onChange={(e) => setNovaCategoria((c) => ({ ...c, nome: e.target.value }))} />
                </div>
                <Button size="sm" onClick={() => criarCategoria.mutate()} disabled={criarCategoria.isPending}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Adicionar
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {(["receita", "despesa"] as LancamentoTipo[]).map((tipo) => (
                  <div key={tipo}>
                    <p className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">{tipo === "receita" ? "Receitas" : "Despesas"}</p>
                    <ul className="space-y-1">
                      {planoContas
                        .filter((c) => c.tipo === tipo)
                        .map((c) => (
                          <li key={c.id} className="flex items-center justify-between text-sm border-b border-border pb-1 last:border-0">
                            <span className={c.ativo ? "" : "text-muted-foreground line-through"}>{c.nome}</span>
                            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => alternarCategoria.mutate(c)}>
                              {c.ativo ? "Desativar" : "Ativar"}
                            </Button>
                          </li>
                        ))}
                      {planoContas.filter((c) => c.tipo === tipo).length === 0 && (
                        <p className="text-xs text-muted-foreground">Nenhuma conta cadastrada.</p>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
