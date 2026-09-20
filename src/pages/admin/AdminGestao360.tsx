import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, Download, FileText, FileSpreadsheet, TrendingUp, TrendingDown, Users, Activity, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

function baixarCsv(nomeArquivo: string, linhas: (string | number)[][]) {
  const csv = linhas
    .map((linha) => linha.map((valor) => `"${String(valor).replace(/"/g, '""')}"`).join(";"))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AdminGestao360() {
  const { organization } = useAuth();
  const { toast } = useToast();

  const inicioMes = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }, []);

  const { data: metrics } = useQuery({
    queryKey: ["gestao360-churn-metrics", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_churn_metrics")
        .select("*")
        .eq("organization_id", organization!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: assinaturasAtivas = [], isLoading: isLoadingAssinaturas } = useQuery({
    queryKey: ["gestao360-assinaturas", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aluno_assinaturas")
        .select("valor_cobrado, nivel_atacado, status, aluno_id")
        .eq("organization_id", organization!.id)
        .eq("status", "ativa");
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: planosAtacado = [] } = useQuery({
    queryKey: ["planos-atacado-gestao360"],
    queryFn: async () => {
      const { data, error } = await supabase.from("planos_atacado").select("id, custo_mensal");
      if (error) throw error;
      return data;
    },
  });

  const { data: pagamentosMes = [] } = useQuery({
    queryKey: ["gestao360-pagamentos-mes", organization?.id, inicioMes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pagamentos")
        .select("valor, valor_repasse_arke, valor_liquido_academia, status, data_pagamento")
        .eq("organization_id", organization!.id)
        .eq("status", "confirmado")
        .gte("data_pagamento", inicioMes);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  // MRR em risco — conecta a pontuação de engajamento (Etapa K/M) com a
  // receita: quanto de MRR está em assinaturas de alunos com engajamento
  // baixo, que sem intervenção tendem a virar cancelamento. Antes desta
  // seção, Gestão 360° só olhava dinheiro, nunca engajamento.
  const { data: engajamentoAlunos = [] } = useQuery({
    queryKey: ["gestao360-engajamento", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_engajamento_alunos_organizacao");
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const custoPorNivel = new Map(planosAtacado.map((p) => [p.id, Number(p.custo_mensal)]));

  const mrrBruto = assinaturasAtivas.reduce((acc, a) => acc + Number(a.valor_cobrado), 0);
  const custoArkeMrr = assinaturasAtivas.reduce((acc, a) => acc + (custoPorNivel.get(a.nivel_atacado) ?? 0), 0);
  const mrrLiquido = mrrBruto - custoArkeMrr;
  const alunosAtivos = assinaturasAtivas.length;
  const arpu = alunosAtivos > 0 ? mrrLiquido / alunosAtivos : 0;

  const totalAlunosOrg = metrics?.alunos_total ?? 0;
  const cancelamentosMes = metrics?.cancelamentos_mes_atual ?? 0;
  const churnPct = totalAlunosOrg > 0 ? (cancelamentosMes / totalAlunosOrg) * 100 : 0;
  const ltv = churnPct > 0 ? arpu / (churnPct / 100) : null;

  const receitaBrutaMes = pagamentosMes.reduce((acc, p) => acc + Number(p.valor), 0);
  const repasseArkeMes = pagamentosMes.reduce((acc, p) => acc + Number(p.valor_repasse_arke), 0);
  const receitaLiquidaMes = pagamentosMes.reduce((acc, p) => acc + Number(p.valor_liquido_academia), 0);

  const constanciaPct = metrics?.constancia_pct_7d ?? 0;

  const LIMITE_ENGAJAMENTO_BAIXO = 40;
  const pontuacaoPorAluno = new Map(engajamentoAlunos.map((e) => [e.aluno_id, Number(e.pontuacao ?? 0)]));
  const assinaturasEmRisco = assinaturasAtivas.filter(
    (a) => (pontuacaoPorAluno.get(a.aluno_id) ?? 100) < LIMITE_ENGAJAMENTO_BAIXO
  );
  const mrrEmRisco = assinaturasEmRisco.reduce((acc, a) => acc + Number(a.valor_cobrado), 0);

  const nomeArquivoBase = `gestao-360-${organization?.slug ?? "academia"}-${new Date().toISOString().slice(0, 10)}`;

  const montarLinhasRelatorio = () => {
    const hoje = new Date().toLocaleDateString("pt-BR");
    return [
      ["Relatório de Gestão 360°", organization?.nome ?? "", `Gerado em ${hoje}`],
      [],
      ["DRE Simplificado (mês corrente)"],
      ["Receita bruta", formatarMoeda(receitaBrutaMes)],
      ["Repasse de atacado ARKE", formatarMoeda(repasseArkeMes)],
      ["Receita líquida da academia", formatarMoeda(receitaLiquidaMes)],
      [],
      ["Indicadores"],
      ["MRR bruto", formatarMoeda(mrrBruto)],
      ["MRR líquido (academia)", formatarMoeda(mrrLiquido)],
      ["ARPU (líquido/aluno)", formatarMoeda(arpu)],
      ["LTV estimado", ltv != null ? formatarMoeda(ltv) : "N/D (sem churn no período)"],
      ["Churn do mês", `${churnPct.toFixed(1)}%`],
      ["Frequência (constância 7 dias)", `${constanciaPct}%`],
      ["MRR em risco (engajamento < 40)", formatarMoeda(mrrEmRisco)],
      ["Assinaturas em risco", assinaturasEmRisco.length],
      ["Alunos ativos", alunosAtivos],
      ["Alunos totais na organização", totalAlunosOrg],
    ] as (string | number)[][];
  };

  const exportarRelatorio = () => {
    baixarCsv(`${nomeArquivoBase}.csv`, montarLinhasRelatorio());
    toast({ title: "Relatório exportado", description: "O arquivo CSV foi baixado." });
  };

  const exportarPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    const linhas = montarLinhasRelatorio();
    let y = 18;
    doc.setFontSize(14);
    doc.text(`Gestão 360° — ${organization?.nome ?? "Academia"}`, 14, y);
    doc.setFontSize(10);
    y += 8;
    for (const linha of linhas) {
      if (linha.length === 0) {
        y += 3;
        continue;
      }
      if (linha.length === 1) {
        y += 4;
        doc.setFont("helvetica", "bold");
        doc.text(String(linha[0]), 14, y);
        doc.setFont("helvetica", "normal");
        y += 2;
        continue;
      }
      doc.text(String(linha[0]), 14, y);
      doc.text(String(linha[1]), 120, y);
      if (linha[2]) doc.text(String(linha[2]), 160, y);
      y += 7;
    }
    doc.save(`${nomeArquivoBase}.pdf`);
    toast({ title: "Relatório exportado", description: "O arquivo PDF foi baixado." });
  };

  const exportarExcel = async () => {
    const { utils, write } = await import("xlsx");
    const linhas = montarLinhasRelatorio();
    const worksheet = utils.aoa_to_sheet(linhas);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Gestão 360°");
    const buffer = write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nomeArquivoBase}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Relatório exportado", description: "O arquivo Excel foi baixado." });
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Gestão 360°</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportarRelatorio} disabled={isLoadingAssinaturas}>
            <Download className="h-4 w-4 mr-1.5" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => void exportarPdf()} disabled={isLoadingAssinaturas}>
            <FileText className="h-4 w-4 mr-1.5" /> PDF
          </Button>
          <Button size="sm" variant="outline" onClick={() => void exportarExcel()} disabled={isLoadingAssinaturas}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatTile icon={TrendingUp} label="MRR bruto" value={formatarMoeda(mrrBruto)} />
        <StatTile icon={TrendingUp} label="MRR líquido" value={formatarMoeda(mrrLiquido)} sublabel="Sua parte, após repasse ARKE" />
        <StatTile icon={Users} label="ARPU líquido" value={formatarMoeda(arpu)} sublabel="Por aluno ativo/mês" />
        <StatTile icon={TrendingUp} label="LTV estimado" value={ltv != null ? formatarMoeda(ltv) : "N/D"} sublabel="Baseado no churn do mês" />
        <StatTile icon={TrendingDown} label="Churn do mês" value={`${churnPct.toFixed(1)}%`} sublabel={`${cancelamentosMes} cancelamento(s)`} />
        <StatTile icon={Activity} label="Frequência (7 dias)" value={`${constanciaPct}%`} sublabel="Constância de treino" />
        <StatTile
          icon={AlertTriangle}
          label="MRR em risco"
          value={formatarMoeda(mrrEmRisco)}
          sublabel={`${assinaturasEmRisco.length} assinatura(s) com engajamento baixo`}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">DRE Simplificado — mês corrente</CardTitle>
          <p className="text-xs text-muted-foreground">Considera apenas pagamentos já confirmados no Asaas.</p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span>Receita bruta</span>
            <span className="font-semibold">{formatarMoeda(receitaBrutaMes)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2 text-red-600 dark:text-red-400">
            <span>(–) Repasse de atacado ARKE</span>
            <span className="font-semibold">{formatarMoeda(repasseArkeMes)}</span>
          </div>
          <div className="flex items-center justify-between pt-1 text-base font-bold text-emerald-600 dark:text-emerald-400">
            <span>(=) Receita líquida da academia</span>
            <span>{formatarMoeda(receitaLiquidaMes)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
