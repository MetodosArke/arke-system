import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Building2, Wallet, Receipt, Printer } from "lucide-react";
import type { Enums, Tables } from "@/integrations/supabase/types";
import { ReciboComprovanteDialog, type ReciboData } from "@/components/admin/ReciboComprovanteDialog";

const NIVEL_LABEL: Record<string, string> = { essencial: "Essencial", integrado: "Integrado", elite: "Elite" };
const ASSINATURA_LABEL: Record<string, string> = { ativa: "Ativa", atrasada: "Atrasada", cancelada: "Cancelada" };

type Nivel = Enums<"nivel_atacado">;

const NIVEIS: { value: Nivel; label: string }[] = [
  { value: "essencial", label: "Essencial" },
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
  const { organization, hasRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: planosAtacado = EMPTY_PLANOS_ATACADO } = useQuery({
    queryKey: ["planos-atacado"],
    queryFn: async () => {
      const { data, error } = await supabase.from("planos_atacado").select("*");
      if (error) throw error;
      return data;
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
        .select("asaas_wallet_id")
        .eq("id", organization!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

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

  const [walletId, setWalletId] = useState("");

  useEffect(() => {
    setWalletId(orgDetalhes?.asaas_wallet_id ?? "");
  }, [orgDetalhes]);

  const salvarWallet = useMutation({
    mutationFn: async () => {
      if (!organization) {
        throw new Error("Nenhuma organização selecionada. Entre com um usuário vinculado a uma organização (gestor) para editar esses dados.");
      }
      const { error } = await supabase
        .from("organizations")
        .update({ asaas_wallet_id: walletId || null })
        .eq("id", organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Wallet do Asaas salva" });
      void queryClient.invalidateQueries({ queryKey: ["organizacao-wallet", organization?.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    },
  });

  const salvar = useMutation({
    mutationFn: async (nivel: Nivel) => {
      if (!organization) {
        throw new Error("Nenhuma organização selecionada. Entre com um usuário vinculado a uma organização (gestor) para editar a precificação.");
      }
      const custo = planosAtacado.find((p) => p.id === nivel)?.custo_mensal ?? 0;
      const valorVarejo = parseMoeda(valores[nivel]);
      const markupPct = custo > 0 ? ((valorVarejo - custo) / custo) * 100 : 0;

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
    <div className="space-y-4 max-w-2xl mx-auto">
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
                        (custo atacado R$ {plano.custo_mensal} · sugestão ARKE R$ {plano.valor_sugerido_varejo})
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
        <CardContent className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="wallet-id">Wallet ID do Asaas</Label>
            <Input
              id="wallet-id"
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              placeholder="ex.: 22e49670-27e4-4579-a4f4-0dfd42b2e-000"
            />
          </div>
          <Button onClick={() => salvarWallet.mutate()} disabled={salvarWallet.isPending || !organization}>
            Salvar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Taxa de split aplicada por plano</CardTitle>
          <p className="text-xs text-muted-foreground">
            A cada cobrança confirmada no Asaas, o repasse de atacado é retido automaticamente para a
            ARKE e o restante cai direto na Wallet ID da academia configurada acima.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {NIVEIS.map(({ value, label }) => {
            const plano = planosAtacado.find((p) => p.id === value);
            const valorVarejo = parseMoeda(valores[value] || "0");
            const custoAtacado = Number(plano?.custo_mensal ?? 0);
            const liquidoAcademia = valorVarejo - custoAtacado;
            const pctAcademia = valorVarejo > 0 ? Math.round((liquidoAcademia / valorVarejo) * 100) : 0;
            return (
              <div key={value} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0 last:pb-0">
                <span className="font-medium">{label}</span>
                <span className="text-xs text-muted-foreground text-right">
                  Aluno paga R$ {valorVarejo.toFixed(2)} · ARKE retém R$ {custoAtacado.toFixed(2)} · Academia
                  recebe R$ {liquidoAcademia.toFixed(2)}
                  {valorVarejo > 0 && ` (${pctAcademia}%)`}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>

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

      <ReciboComprovanteDialog open={reciboAberto} onOpenChange={setReciboAberto} recibo={reciboSelecionado} />
    </div>
  );
}
