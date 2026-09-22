import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileSpreadsheet } from "lucide-react";
import { baixarPlanilha, dataBr, intervaloDoMes, type Aba } from "@/lib/exportarPlanilha";

const STATUS: Record<string, string> = {
  pendente: "Pendente",
  pago: "Pago",
  confirmado: "Pago",
  atrasado: "Atrasado",
  cancelado: "Cancelado",
  estornado: "Estornado",
};

/**
 * Fechamento do mês para o contador, em uma planilha: lançamentos, mensalidades
 * dos planos da academia, Método ARKE e folha. Cada aba traz o bruto, a taxa
 * do meio de pagamento e o líquido, que é o que o contador concilia com o
 * extrato do Asaas.
 */
export function ExportarContador() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [gerando, setGerando] = useState(false);

  const exportar = async () => {
    if (!organization) return;
    setGerando(true);
    try {
      const { inicio, fim } = intervaloDoMes(mes);
      const orgId = organization.id;
      const [lanc, mens, pags, folha] = await Promise.all([
        supabase
          .from("lancamentos_financeiros")
          .select("data, tipo, categoria, descricao, valor, status, vencimento, data_pagamento, forma_pagamento, contato")
          .eq("organization_id", orgId)
          .gte("data", inicio)
          .lte("data", fim)
          .order("data"),
        supabase
          .from("mensalidades")
          .select("competencia, vencimento, valor, taxa_gateway, valor_repasse_arke, valor_liquido_academia, status, data_pagamento, forma_pagamento, aluno_id")
          .eq("organization_id", orgId)
          .gte("competencia", inicio)
          .lte("competencia", fim)
          .order("vencimento"),
        supabase
          .from("pagamentos")
          .select("vencimento, valor, taxa_gateway, valor_repasse_arke, valor_liquido_academia, status, data_pagamento")
          .eq("organization_id", orgId)
          .gte("vencimento", inicio)
          .lte("vencimento", fim)
          .order("vencimento"),
        supabase
          .from("staff_folha_pagamentos")
          .select("competencia, user_id, valor_base, valor_comissoes, valor_total, status, data_pagamento")
          .eq("organization_id", orgId)
          .gte("competencia", inicio)
          .lte("competencia", fim),
      ]);
      const erro = [lanc, mens, pags, folha].find((r) => r.error)?.error;
      if (erro) throw erro;

      const alunoIds = [...new Set((mens.data ?? []).map((m) => m.aluno_id))];
      const { data: alunosMes } = alunoIds.length
        ? await supabase.from("alunos").select("id, user_id").in("id", alunoIds)
        : { data: [] as { id: string; user_id: string }[] };
      const userDoAluno = new Map((alunosMes ?? []).map((a) => [a.id, a.user_id]));
      const userIds = [...new Set([...(folha.data ?? []).map((f) => f.user_id), ...(alunosMes ?? []).map((a) => a.user_id)])];
      const { data: nomes } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };
      const nome = new Map((nomes ?? []).map((n) => [n.user_id, n.full_name]));

      const abas: Aba[] = [
        {
          nome: "Lançamentos",
          linhas: [
            ["Data", "Tipo", "Categoria", "Descrição", "Valor", "Status", "Vencimento", "Pagamento", "Forma", "Contato"],
            ...(lanc.data ?? []).map((l) => [
              dataBr(l.data),
              l.tipo === "receita" ? "Receita" : "Despesa",
              l.categoria,
              l.descricao,
              Number(l.valor),
              STATUS[l.status] ?? l.status,
              dataBr(l.vencimento),
              dataBr(l.data_pagamento),
              l.forma_pagamento,
              l.contato,
            ]),
          ],
        },
        {
          nome: "Mensalidades",
          linhas: [
            ["Aluno", "Competência", "Vencimento", "Valor", "Taxa do meio de pagamento", "Repasse ArkeFit", "Líquido academia", "Status", "Pagamento", "Forma"],
            ...(mens.data ?? []).map((m) => [
              nome.get(userDoAluno.get(m.aluno_id) ?? "") ?? "",
              dataBr(m.competencia).slice(3),
              dataBr(m.vencimento),
              Number(m.valor),
              m.taxa_gateway === null ? null : Number(m.taxa_gateway),
              m.valor_repasse_arke === null ? null : Number(m.valor_repasse_arke),
              m.valor_liquido_academia === null ? null : Number(m.valor_liquido_academia),
              STATUS[m.status] ?? m.status,
              dataBr(m.data_pagamento),
              m.forma_pagamento,
            ]),
          ],
        },
        {
          nome: "Método ARKE",
          linhas: [
            ["Vencimento", "Valor", "Taxa do meio de pagamento", "Repasse ArkeFit", "Líquido academia", "Status", "Pagamento"],
            ...(pags.data ?? []).map((p) => [
              dataBr(p.vencimento),
              Number(p.valor),
              p.taxa_gateway === null ? null : Number(p.taxa_gateway),
              Number(p.valor_repasse_arke),
              Number(p.valor_liquido_academia),
              STATUS[p.status] ?? p.status,
              dataBr(p.data_pagamento),
            ]),
          ],
        },
        {
          nome: "Folha",
          linhas: [
            ["Pessoa", "Competência", "Base", "Comissões", "Total", "Status", "Pagamento"],
            ...(folha.data ?? []).map((f) => [
              nome.get(f.user_id) ?? "",
              dataBr(f.competencia).slice(3),
              Number(f.valor_base),
              Number(f.valor_comissoes),
              Number(f.valor_total),
              STATUS[f.status] ?? f.status,
              dataBr(f.data_pagamento),
            ]),
          ],
        },
      ];
      await baixarPlanilha(`fechamento-${organization.slug}-${mes}`, abas);
      toast({ title: "Planilha exportada", description: `Fechamento de ${mes.split("-").reverse().join("/")}.` });
    } catch (e) {
      toast({ title: "Não foi possível exportar", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Input type="month" aria-label="Mês do fechamento" className="h-8 w-40" value={mes} onChange={(e) => setMes(e.target.value)} />
      <Button size="sm" variant="outline" disabled={gerando || !mes} onClick={() => void exportar()}>
        <FileSpreadsheet className="h-4 w-4 mr-1.5" /> {gerando ? "Gerando..." : "Exportar para o contador"}
      </Button>
    </div>
  );
}
