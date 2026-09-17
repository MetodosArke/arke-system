import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs as InnerTabs,
  TabsContent as InnerTabsContent,
  TabsList as InnerTabsList,
  TabsTrigger as InnerTabsTrigger,
} from "@/components/ui/tabs";
import { CreditCard, Search, Filter, Pencil, DollarSign, AlertCircle, Loader2, Wallet, History } from "lucide-react";
import { format, addMonths, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

type MeioPagamento = "credito" | "debito" | "pix" | "dinheiro";

const MEIO_LABELS: Record<MeioPagamento, string> = {
  credito: "Cartão de Crédito",
  debito: "Cartão de Débito",
  pix: "Pix",
  dinheiro: "Dinheiro",
};

interface AlunoPagamentoRow {
  user_id: string;
  full_name: string;
  pagamento: {
    id: string;
    meio_pagamento: string;
    dia_vencimento: number;
    valor_mensal: number;
    status: string;
    proxima_data_vencimento: string;
    ultima_data_pagamento: string | null;
    observacoes: string | null;
  } | null;
}

type FaixaVencimento = "vencido" | "hoje" | "ate_3" | "ate_7" | "em_dia" | "inativo" | "sem_cadastro";

const FAIXA_LABELS: Record<FaixaVencimento, string> = {
  vencido: "Vencido",
  hoje: "Vence hoje",
  ate_3: "≤ 3 dias",
  ate_7: "≤ 7 dias",
  em_dia: "Em dia",
  inativo: "Inativo",
  sem_cadastro: "Sem cadastro",
};

function calcFaixa(row: AlunoPagamentoRow): FaixaVencimento {
  if (!row.pagamento) return "sem_cadastro";
  if (row.pagamento.status === "inativo") return "inativo";
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = parseISO(row.pagamento.proxima_data_vencimento + "T12:00:00");
  venc.setHours(0, 0, 0, 0);
  const diffMs = venc.getTime() - hoje.getTime();
  const dias = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (dias < 0) return "vencido";
  if (dias === 0) return "hoje";
  if (dias <= 3) return "ate_3";
  if (dias <= 7) return "ate_7";
  return "em_dia";
}

function faixaVariant(f: FaixaVencimento): "default" | "destructive" | "secondary" | "outline" {
  if (f === "vencido") return "destructive";
  if (f === "hoje" || f === "ate_3") return "destructive";
  if (f === "ate_7") return "secondary";
  if (f === "em_dia") return "default";
  return "outline";
}

function calcProximoVencimento(diaVenc: number, base?: Date): string {
  const ref = base ? new Date(base) : new Date();
  ref.setHours(12, 0, 0, 0);
  const ano = ref.getFullYear();
  const mes = ref.getMonth();
  // Tentativa neste mês
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  let dia = Math.min(diaVenc, ultimoDia);
  let candidato = new Date(ano, mes, dia, 12, 0, 0);
  if (candidato.getTime() <= ref.getTime()) {
    const proxMes = mes + 1;
    const ultimoProx = new Date(ano, proxMes + 1, 0).getDate();
    dia = Math.min(diaVenc, ultimoProx);
    candidato = new Date(ano, proxMes, dia, 12, 0, 0);
  }
  return format(candidato, "yyyy-MM-dd");
}

export default function ControleAlunos() {
  const [search, setSearch] = useState("");
  const [faixaFiltro, setFaixaFiltro] = useState<string>("todos");
  const [editOpen, setEditOpen] = useState(false);
  const [editAluno, setEditAluno] = useState<AlunoPagamentoRow | null>(null);
  const [meio, setMeio] = useState<MeioPagamento>("pix");
  const [diaVenc, setDiaVenc] = useState<number>(10);
  const [valor, setValor] = useState<string>("0");
  const [status, setStatus] = useState<string>("ativo");
  const [proxData, setProxData] = useState<string>("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  const [pagOpen, setPagOpen] = useState(false);
  const [pagAluno, setPagAluno] = useState<AlunoPagamentoRow | null>(null);
  const [pagData, setPagData] = useState(format(new Date(), "yyyy-MM-dd"));
  const [pagValor, setPagValor] = useState("0");
  const [pagMeio, setPagMeio] = useState<MeioPagamento>("pix");
  const [pagObs, setPagObs] = useState("");
  const [pagSaving, setPagSaving] = useState(false);

  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data: alunos = [], isLoading } = useQuery({
    queryKey: ["controle-alunos"],
    queryFn: async () => {
      // Buscar perfis
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .order("full_name");
      if (pErr) throw pErr;

      const { data: roles, error: rErr } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (rErr) throw rErr;

      const alunoIds = new Set(
        (roles || []).filter((r: any) => r.role === "aluno").map((r: any) => r.user_id)
      );

      const { data: pags, error: pagErr } = await supabase
        .from("aluno_pagamento" as any)
        .select("*");
      if (pagErr) throw pagErr;

      const pagMap: Record<string, any> = {};
      (pags || []).forEach((p: any) => {
        pagMap[p.aluno_id] = p;
      });

      return (profiles || [])
        .filter((p: any) => alunoIds.has(p.user_id))
        .map((p: any) => ({
          user_id: p.user_id,
          full_name: p.full_name,
          pagamento: pagMap[p.user_id] || null,
        })) as AlunoPagamentoRow[];
    },
  });

  const { data: historico = [] } = useQuery({
    queryKey: ["pagamento-historico", editAluno?.user_id],
    queryFn: async () => {
      if (!editAluno?.user_id) return [];
      const { data, error } = await supabase
        .from("pagamento_historico" as any)
        .select("*")
        .eq("aluno_id", editAluno.user_id)
        .order("data_pagamento", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!editAluno?.user_id && editOpen,
  });

  const filtered = useMemo(() => {
    return alunos.filter((a) => {
      const matchSearch = a.full_name.toLowerCase().includes(search.toLowerCase());
      const faixa = calcFaixa(a);
      const matchFaixa = faixaFiltro === "todos" || faixa === faixaFiltro;
      return matchSearch && matchFaixa;
    });
  }, [alunos, search, faixaFiltro]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { vencido: 0, hoje: 0, ate_3: 0, ate_7: 0, em_dia: 0, inativo: 0, sem_cadastro: 0 };
    alunos.forEach((a) => {
      const f = calcFaixa(a);
      c[f] = (c[f] || 0) + 1;
    });
    return c;
  }, [alunos]);

  const openEdit = (aluno: AlunoPagamentoRow) => {
    setEditAluno(aluno);
    if (aluno.pagamento) {
      setMeio((aluno.pagamento.meio_pagamento as MeioPagamento) || "pix");
      setDiaVenc(aluno.pagamento.dia_vencimento);
      setValor(String(aluno.pagamento.valor_mensal));
      setStatus(aluno.pagamento.status);
      setProxData(aluno.pagamento.proxima_data_vencimento);
      setObs(aluno.pagamento.observacoes || "");
    } else {
      setMeio("pix");
      setDiaVenc(10);
      setValor("0");
      setStatus("ativo");
      setProxData(calcProximoVencimento(10));
      setObs("");
    }
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!editAluno) return;
    setSaving(true);
    try {
      const payload = {
        aluno_id: editAluno.user_id,
        meio_pagamento: meio,
        dia_vencimento: diaVenc,
        valor_mensal: Number(valor) || 0,
        status,
        proxima_data_vencimento: proxData || calcProximoVencimento(diaVenc),
        observacoes: obs || null,
        criado_por: user?.id,
      };
      if (editAluno.pagamento) {
        const { error } = await supabase
          .from("aluno_pagamento" as any)
          .update(payload)
          .eq("aluno_id", editAluno.user_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("aluno_pagamento" as any).insert(payload);
        if (error) throw error;
      }
      toast({ title: "Dados de pagamento salvos!" });
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["controle-alunos"] });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const openRegistrarPag = (aluno: AlunoPagamentoRow) => {
    setPagAluno(aluno);
    setPagData(format(new Date(), "yyyy-MM-dd"));
    setPagValor(String(aluno.pagamento?.valor_mensal || 0));
    setPagMeio((aluno.pagamento?.meio_pagamento as MeioPagamento) || "pix");
    setPagObs("");
    setPagOpen(true);
  };

  const handleRegistrarPag = async () => {
    if (!pagAluno) return;
    setPagSaving(true);
    try {
      // Inserir histórico
      const { error: hErr } = await supabase.from("pagamento_historico" as any).insert({
        aluno_id: pagAluno.user_id,
        data_pagamento: pagData,
        valor_pago: Number(pagValor) || 0,
        meio_pagamento: pagMeio,
        observacoes: pagObs || null,
        registrado_por: user?.id,
      });
      if (hErr) throw hErr;

      // Atualizar próxima data e última
      const dia = pagAluno.pagamento?.dia_vencimento || 10;
      const baseDate = parseISO(pagData + "T12:00:00");
      const proxima = calcProximoVencimento(dia, baseDate);

      if (pagAluno.pagamento) {
        const { error } = await supabase
          .from("aluno_pagamento" as any)
          .update({
            ultima_data_pagamento: pagData,
            proxima_data_vencimento: proxima,
          })
          .eq("aluno_id", pagAluno.user_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("aluno_pagamento" as any).insert({
          aluno_id: pagAluno.user_id,
          meio_pagamento: pagMeio,
          dia_vencimento: dia,
          valor_mensal: Number(pagValor) || 0,
          status: "ativo",
          ultima_data_pagamento: pagData,
          proxima_data_vencimento: proxima,
          criado_por: user?.id,
        });
        if (error) throw error;
      }

      toast({ title: "Pagamento registrado!" });
      setPagOpen(false);
      qc.invalidateQueries({ queryKey: ["controle-alunos"] });
      qc.invalidateQueries({ queryKey: ["pagamento-historico"] });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setPagSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Card className="border-destructive/30">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Vencidos</p>
            <p className="text-2xl font-bold text-destructive">{counts.vencido}</p>
          </CardContent>
        </Card>
        <Card className="border-orange-500/30">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Vencem ≤ 3 dias</p>
            <p className="text-2xl font-bold text-orange-500">{counts.hoje + counts.ate_3}</p>
          </CardContent>
        </Card>
        <Card className="border-yellow-500/30">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Vencem ≤ 7 dias</p>
            <p className="text-2xl font-bold text-yellow-500">{counts.ate_7}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/30">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Em dia</p>
            <p className="text-2xl font-bold text-emerald-600">{counts.em_dia}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar aluno..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={faixaFiltro} onValueChange={setFaixaFiltro}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="vencido">Vencidos</SelectItem>
            <SelectItem value="hoje">Vencem hoje</SelectItem>
            <SelectItem value="ate_3">Vencem em ≤ 3 dias</SelectItem>
            <SelectItem value="ate_7">Vencem em ≤ 7 dias</SelectItem>
            <SelectItem value="em_dia">Em dia</SelectItem>
            <SelectItem value="inativo">Inativos</SelectItem>
            <SelectItem value="sem_cadastro">Sem cadastro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lista */}
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-5 w-5 text-primary" />
            Controle Financeiro ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/50" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <CreditCard className="h-10 w-10 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">Nenhum aluno encontrado</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((aluno) => {
                const faixa = calcFaixa(aluno);
                const pag = aluno.pagamento;
                return (
                  <div
                    key={aluno.user_id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg bg-muted/30 px-3 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{aluno.full_name}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <Badge variant={faixaVariant(faixa)} className="text-[10px]">
                          {FAIXA_LABELS[faixa]}
                        </Badge>
                        {pag && (
                          <>
                            <Badge variant="outline" className="text-[10px]">
                              {pag.status === "ativo" ? "Ativo" : "Inativo"}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              Venc: {format(parseISO(pag.proxima_data_vencimento + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR })}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              R$ {Number(pag.valor_mensal).toFixed(2)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {pag && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1"
                          onClick={() => openRegistrarPag(aluno)}
                        >
                          <DollarSign className="h-3.5 w-3.5" />
                          Registrar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1"
                        onClick={() => openEdit(aluno)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {pag ? "Editar" : "Cadastrar"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit/Cadastro Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              {editAluno?.pagamento ? "Editar" : "Cadastrar"} Pagamento — {editAluno?.full_name}
            </DialogTitle>
            <DialogDescription>Configure os dados financeiros do aluno.</DialogDescription>
          </DialogHeader>

          <InnerTabs defaultValue="dados">
            <InnerTabsList className="grid w-full grid-cols-2">
              <InnerTabsTrigger value="dados">Dados</InnerTabsTrigger>
              <InnerTabsTrigger value="historico" disabled={!editAluno?.pagamento}>
                Histórico
              </InnerTabsTrigger>
            </InnerTabsList>

            <InnerTabsContent value="dados" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Meio de pagamento</Label>
                  <Select value={meio} onValueChange={(v) => setMeio(v as MeioPagamento)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credito">Cartão de Crédito</SelectItem>
                      <SelectItem value="debito">Cartão de Débito</SelectItem>
                      <SelectItem value="pix">Pix</SelectItem>
                      <SelectItem value="dinheiro">Dinheiro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativo">Ativo</SelectItem>
                      <SelectItem value="inativo">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Dia do vencimento</Label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={diaVenc}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(31, Number(e.target.value) || 1));
                      setDiaVenc(v);
                      setProxData(calcProximoVencimento(v));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Valor mensal (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Próximo vencimento</Label>
                  <Input
                    type="date"
                    value={proxData}
                    onChange={(e) => setProxData(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Calculado automaticamente pelo dia, mas pode ser ajustado.
                  </p>
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Observações</Label>
                  <Textarea
                    rows={2}
                    value={obs}
                    onChange={(e) => setObs(e.target.value)}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</> : "Salvar"}
                </Button>
              </DialogFooter>
            </InnerTabsContent>

            <InnerTabsContent value="historico" className="pt-4">
              {historico.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <History className="h-10 w-10 text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">Nenhum pagamento registrado</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {historico.map((h: any) => (
                    <div key={h.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                      <div>
                        <p className="text-sm font-semibold">
                          {format(parseISO(h.data_pagamento + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {MEIO_LABELS[h.meio_pagamento as MeioPagamento] || h.meio_pagamento}
                          {h.observacoes ? ` • ${h.observacoes}` : ""}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-emerald-600">
                        R$ {Number(h.valor_pago).toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </InnerTabsContent>
          </InnerTabs>
        </DialogContent>
      </Dialog>

      {/* Registrar Pagamento Dialog */}
      <Dialog open={pagOpen} onOpenChange={setPagOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-600" />
              Registrar pagamento — {pagAluno?.full_name}
            </DialogTitle>
            <DialogDescription>
              O próximo vencimento será recalculado automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Data do pagamento</Label>
                <Input type="date" value={pagData} onChange={(e) => setPagData(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Valor pago (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={pagValor}
                  onChange={(e) => setPagValor(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Meio</Label>
              <Select value={pagMeio} onValueChange={(v) => setPagMeio(v as MeioPagamento)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="credito">Cartão de Crédito</SelectItem>
                  <SelectItem value="debito">Cartão de Débito</SelectItem>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea rows={2} value={pagObs} onChange={(e) => setPagObs(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagOpen(false)}>Cancelar</Button>
            <Button onClick={handleRegistrarPag} disabled={pagSaving}>
              {pagSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</> : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
