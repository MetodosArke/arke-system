import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, TrendingUp, TrendingDown, Plus } from "lucide-react";
import type { Enums } from "@/integrations/supabase/types";

type FolhaTipo = Enums<"folha_tipo">;
type LancamentoTipo = Enums<"lancamento_financeiro_tipo">;

const FOLHA_TIPO_LABEL: Record<FolhaTipo, string> = {
  salario_fixo: "Salário fixo",
  pro_labore: "Pró-labore",
  comissionado: "Só comissão",
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
  categoria: string;
  descricao: string;
  valor: string;
  data: string;
}

const LANCAMENTO_VAZIO: LancamentoForm = {
  tipo: "despesa",
  categoria: "",
  descricao: "",
  valor: "",
  data: new Date().toISOString().slice(0, 10),
};

export default function AdminFinanceiro() {
  const { organization, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [competencia, setCompetencia] = useState(MESES_RECENTES[0]);
  const [formFolha, setFormFolha] = useState<Record<string, { tipo: FolhaTipo; valor_base: string; ativo: boolean }>>({});
  const [novoLancamento, setNovoLancamento] = useState<LancamentoForm>(LANCAMENTO_VAZIO);

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

  const marcarPago = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("staff_folha_pagamentos")
        .update({ status: "pago", data_pagamento: new Date().toISOString().slice(0, 10) })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["staff-folha-pagamentos", organization?.id, competencia] }),
    onError: (error: Error) => toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" }),
  });

  const { data: lancamentos = [] } = useQuery({
    queryKey: ["lancamentos-financeiros", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lancamentos_financeiros")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("data", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const criarLancamento = useMutation({
    mutationFn: async () => {
      if (!organization) return;
      if (!novoLancamento.categoria.trim()) throw new Error("Informe a categoria.");
      const valor = Number(novoLancamento.valor.replace(",", "."));
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Valor inválido.");
      const { error } = await supabase.from("lancamentos_financeiros").insert({
        organization_id: organization.id,
        tipo: novoLancamento.tipo,
        categoria: novoLancamento.categoria.trim(),
        descricao: novoLancamento.descricao.trim() || null,
        valor,
        data: novoLancamento.data,
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

  const totalReceitas = lancamentos.filter((l) => l.tipo === "receita").reduce((s, l) => s + Number(l.valor), 0);
  const totalDespesas = lancamentos.filter((l) => l.tipo === "despesa").reduce((s, l) => s + Number(l.valor), 0);

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-2">
        <DollarSign className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Financeiro</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Controle interno — não substitui a contabilidade externa da academia. Aqui você registra o que já foi
        apurado lá fora (folha, receitas, despesas) pra ter visão e histórico dentro do ArkeFit.
      </p>

      <Tabs defaultValue="folha">
        <TabsList>
          <TabsTrigger value="folha">Folha</TabsTrigger>
          <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
        </TabsList>

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
                            <Button size="sm" variant="ghost" onClick={() => marcarPago.mutate(pagamento.id)} disabled={marcarPago.isPending}>
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

        <TabsContent value="lancamentos" className="space-y-4 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="pt-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                <div>
                  <p className="text-xs text-muted-foreground">Receitas (últimos 50 lançamentos)</p>
                  <p className="text-lg font-bold">R$ {totalReceitas.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-600" />
                <div>
                  <p className="text-xs text-muted-foreground">Despesas (últimos 50 lançamentos)</p>
                  <p className="text-lg font-bold">R$ {totalDespesas.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Novo lançamento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select value={novoLancamento.tipo} onValueChange={(v) => setNovoLancamento((f) => ({ ...f, tipo: v as LancamentoTipo }))}>
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
                  <Label>Data</Label>
                  <Input type="date" value={novoLancamento.data} onChange={(e) => setNovoLancamento((f) => ({ ...f, data: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Input
                    placeholder="Ex.: Aluguel, Fornecedor, Venda avulsa"
                    value={novoLancamento.categoria}
                    onChange={(e) => setNovoLancamento((f) => ({ ...f, categoria: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Valor (R$)</Label>
                  <Input inputMode="decimal" value={novoLancamento.valor} onChange={(e) => setNovoLancamento((f) => ({ ...f, valor: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Descrição (opcional)</Label>
                <Textarea rows={2} value={novoLancamento.descricao} onChange={(e) => setNovoLancamento((f) => ({ ...f, descricao: e.target.value }))} />
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
                      <TableHead>Categoria</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lancamentos.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs">{new Date(l.data).toLocaleDateString("pt-BR")}</TableCell>
                        <TableCell>
                          {l.categoria}
                          {l.descricao && <p className="text-xs text-muted-foreground">{l.descricao}</p>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={l.tipo === "receita" ? "default" : "secondary"}>{l.tipo === "receita" ? "Receita" : "Despesa"}</Badge>
                        </TableCell>
                        <TableCell className="text-right">R$ {Number(l.valor).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
