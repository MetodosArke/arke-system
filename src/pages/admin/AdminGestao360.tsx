import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todasAsLinhas } from "@/lib/paginar";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, Download, FileText, FileSpreadsheet, TrendingUp, TrendingDown, Users, Activity, AlertTriangle, Filter, CalendarDays, DoorOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { hojeBrasilia, inicioDoMesBrasilia } from "@/lib/dataBrasilia";
import { decimal } from "@/lib/numeros";

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
    return inicioDoMesBrasilia();
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
      return todasAsLinhas((de, ate) =>
        supabase
          .from("aluno_assinaturas")
          .select("valor_cobrado, nivel_atacado, status, aluno_id, valor_repasse_arke")
          .eq("organization_id", organization!.id)
          .eq("status", "ativa")
          .order("id")
          .range(de, ate)
      );
    },
    enabled: !!organization?.id,
  });


  // Receita da academia (mensalidade própria, fora do Método ARKE) — até
  // aqui Gestão 360° só enxergava aluno_assinaturas (ARKE); pra academia
  // com baixa adesão ao Método, o "MRR" podia mostrar uma fração da
  // receita real. Normaliza planos não-mensais pro equivalente mensal.
  const { data: matriculasAcademiaAtivas = [] } = useQuery({
    queryKey: ["gestao360-matriculas-academia", organization?.id],
    queryFn: async () => {
      return todasAsLinhas((de, ate) =>
        supabase
          .from("aluno_matriculas_academia")
          .select("aluno_id, valor_cobrado, valor_repasse_arke, planos_academia(periodicidade)")
          .eq("organization_id", organization!.id)
          .eq("status", "ativa")
          .order("id")
          .range(de, ate)
      );
    },
    enabled: !!organization?.id,
  });

  const valorMensalEquivalente = (valorCobrado: number, periodicidade: string | undefined) => {
    switch (periodicidade) {
      case "trimestral":
        return valorCobrado / 3;
      case "semestral":
        return valorCobrado / 6;
      case "anual":
        return valorCobrado / 12;
      default:
        return valorCobrado;
    }
  };

  const { data: pagamentosMes = [] } = useQuery({
    queryKey: ["gestao360-pagamentos-mes", organization?.id, inicioMes],
    queryFn: async () => {
      return todasAsLinhas((de, ate) =>
        supabase
          .from("pagamentos")
          .select("valor, valor_repasse_arke, valor_liquido_academia, status, data_pagamento")
          .eq("organization_id", organization!.id)
          .eq("status", "confirmado")
          .gte("data_pagamento", inicioMes)
          .order("id")
          .range(de, ate)
      );
    },
    enabled: !!organization?.id,
  });

  // Receita de mensalidade da academia confirmada no mês (fora do
  // Método ARKE) — o DRE simplificado só olhava `pagamentos` (split
  // ARKE), mesmo furo do MRR: mensalidade paga direto pela academia
  // nunca entrava na receita bruta do mês.
  const { data: mensalidadesMes = [] } = useQuery({
    queryKey: ["gestao360-mensalidades-mes", organization?.id, inicioMes],
    queryFn: async () => {
      return todasAsLinhas((de, ate) =>
        supabase
          .from("mensalidades")
          .select("valor, valor_repasse_arke, status, data_pagamento")
          .eq("organization_id", organization!.id)
          .eq("status", "confirmado")
          .gte("data_pagamento", inicioMes)
          .order("id")
          .range(de, ate)
      );
    },
    enabled: !!organization?.id,
  });

  // Cobranças avulsas pagas no mês (taxa de matrícula, avaliação, personal):
  // receita da academia como a mensalidade, com a mesma taxa retida.
  const { data: avulsasMes = [] } = useQuery({
    queryKey: ["gestao360-avulsas-mes", organization?.id, inicioMes],
    queryFn: async () => {
      return todasAsLinhas((de, ate) =>
        supabase
          .from("cobrancas_avulsas")
          .select("valor, valor_repasse_arke")
          .eq("organization_id", organization!.id)
          .eq("status", "confirmado")
          .gte("data_pagamento", inicioMes)
          .order("id")
          .range(de, ate)
      );
    },
    enabled: !!organization?.id,
  });

  // Custo de equipe (folha, já com comissões somadas em valor_total) —
  // a "receita líquida" do DRE só descontava o repasse de atacado ARKE,
  // nunca o custo de equipe, então o número mostrado como "líquido" era
  // enganoso: ainda tinha o maior custo variável por descontar.
  const { data: folhaMes = [] } = useQuery({
    queryKey: ["gestao360-folha-mes", organization?.id, inicioMes],
    queryFn: async () => {
      return todasAsLinhas((de, ate) =>
        supabase
          .from("staff_folha_pagamentos")
          .select("valor_total, competencia")
          .eq("organization_id", organization!.id)
          .gte("competencia", inicioMes)
          .order("id")
          .range(de, ate)
      );
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
      return todasAsLinhas((de, ate) => supabase.rpc("obter_engajamento_alunos_organizacao").order("aluno_id").range(de, ate));
    },
    enabled: !!organization?.id,
  });

  // Funil de conversão — topo de funil do cross-sell do Método ARKE,
  // ainda sem nenhuma tela antes desta seção.
  const { data: funilConversao } = useQuery({
    queryKey: ["gestao360-funil", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_funil_conversao_organizacao");
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: !!organization?.id,
  });

  // Ocupação de turmas — só relevante pra Studio (capacidade fixa por sessão).
  const ehStudio = organization?.tipo === "studio";
  const { data: ocupacaoTurmas } = useQuery({
    queryKey: ["gestao360-ocupacao-turmas", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_ocupacao_turmas_organizacao");
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: !!organization?.id && ehStudio,
  });

  // Frequência real via catraca — mais confiável que auto-registro de
  // treino quando a academia tem controle de acesso; só aparece se
  // houver catraca ativa configurada.
  const { data: frequenciaCatraca } = useQuery({
    queryKey: ["gestao360-frequencia-catraca", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_frequencia_catraca_organizacao");
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: !!organization?.id,
  });

  const mrrArke = Number(metrics?.mrr_arke ?? 0);
  const mrrAcademia = Number(metrics?.mrr_academia ?? 0);
  const mrrBruto = Number(metrics?.mrr_total ?? mrrArke + mrrAcademia);
  // O que a ArkeFit retém de cada trilha: no Método, atacado + taxa de
  // processamento (travado na assinatura; as anteriores a esse registro caem
  // no custo do nível); no plano próprio, só a taxa de processamento,
  // travada na matrícula.
  const custoArkeMrr =
    assinaturasAtivas.reduce(
      // Toda assinatura trava o repasse na criacao desde 21/09/2026, entao o
      // nulo so existiria em linha anterior a isso — nao ha nenhuma. Cair no
      // custo por nivel seria pior agora: ele deixou de ser a fonte do
      // repasse, que passou a ser negociado por academia.
      (acc, a) => acc + Number(a.valor_repasse_arke ?? 0),
      0
    ) +
    matriculasAcademiaAtivas.reduce(
      (acc, m) => acc + valorMensalEquivalente(Number(m.valor_repasse_arke ?? 0), m.planos_academia?.periodicidade),
      0
    );
  const mrrLiquido = mrrBruto - custoArkeMrr;
  const alunosComAssinaturaArke = new Set(assinaturasAtivas.map((a) => a.aluno_id));
  const alunosComMatriculaAcademia = new Set(matriculasAcademiaAtivas.map((m) => m.aluno_id));
  const alunosAtivos = new Set([...alunosComAssinaturaArke, ...alunosComMatriculaAcademia]).size;
  const arpu = alunosAtivos > 0 ? mrrLiquido / alunosAtivos : 0;

  const totalAlunosOrg = metrics?.alunos_total ?? 0;
  const cancelamentosMes = metrics?.cancelamentos_mes_atual ?? 0;
  const churnPct = totalAlunosOrg > 0 ? (cancelamentosMes / totalAlunosOrg) * 100 : 0;
  const ltv = churnPct > 0 ? arpu / (churnPct / 100) : null;

  const receitaArkeMes = pagamentosMes.reduce((acc, p) => acc + Number(p.valor), 0);
  const receitaAcademiaMes =
    mensalidadesMes.reduce((acc, m) => acc + Number(m.valor), 0) + avulsasMes.reduce((acc, a) => acc + Number(a.valor), 0);
  const receitaBrutaMes = receitaArkeMes + receitaAcademiaMes;
  const repasseArkeMes =
    pagamentosMes.reduce((acc, p) => acc + Number(p.valor_repasse_arke), 0) +
    mensalidadesMes.reduce((acc, m) => acc + Number(m.valor_repasse_arke ?? 0), 0) +
    avulsasMes.reduce((acc, a) => acc + Number(a.valor_repasse_arke), 0);
  const custoEquipeMes = folhaMes.reduce((acc, f) => acc + Number(f.valor_total), 0);
  const receitaLiquidaMes = receitaBrutaMes - repasseArkeMes - custoEquipeMes;

  const constanciaPct = metrics?.constancia_pct_7d ?? 0;

  const LIMITE_ENGAJAMENTO_BAIXO = 40;
  const pontuacaoPorAluno = new Map(engajamentoAlunos.map((e) => [e.aluno_id, Number(e.pontuacao ?? 0)]));
  const baixoEngajamento = (alunoId: string) => (pontuacaoPorAluno.get(alunoId) ?? 100) < LIMITE_ENGAJAMENTO_BAIXO;
  const assinaturasArkeEmRisco = assinaturasAtivas.filter((a) => baixoEngajamento(a.aluno_id));
  const matriculasAcademiaEmRisco = matriculasAcademiaAtivas.filter((m) => baixoEngajamento(m.aluno_id));
  const mrrEmRisco =
    assinaturasArkeEmRisco.reduce((acc, a) => acc + Number(a.valor_cobrado), 0) +
    matriculasAcademiaEmRisco.reduce(
      (acc, m) => acc + valorMensalEquivalente(Number(m.valor_cobrado), m.planos_academia?.periodicidade),
      0
    );
  const alunosEmRisco = new Set([
    ...assinaturasArkeEmRisco.map((a) => a.aluno_id),
    ...matriculasAcademiaEmRisco.map((m) => m.aluno_id),
  ]).size;

  const nomeArquivoBase = `gestao-360-${organization?.slug ?? "academia"}-${hojeBrasilia()}`;

  const montarLinhasRelatorio = () => {
    const hoje = new Date().toLocaleDateString("pt-BR");
    return [
      ["Relatório de Gestão 360°", organization?.nome ?? "", `Gerado em ${hoje}`],
      [],
      ["DRE Simplificado (mês corrente)"],
      ["Receita bruta — Método ARKE", formatarMoeda(receitaArkeMes)],
      ["Receita bruta — Planos e cobranças avulsas da Academia", formatarMoeda(receitaAcademiaMes)],
      ["Receita bruta total", formatarMoeda(receitaBrutaMes)],
      ["(–) Repasse ARKE (atacado + taxa de processamento)", formatarMoeda(repasseArkeMes)],
      ["(–) Custo de equipe (folha + comissões)", formatarMoeda(custoEquipeMes)],
      ["(=) Receita líquida da academia", formatarMoeda(receitaLiquidaMes)],
      [],
      ["Indicadores"],
      ["MRR bruto — Método ARKE", formatarMoeda(mrrArke)],
      ["MRR bruto — Planos da Academia", formatarMoeda(mrrAcademia)],
      ["MRR bruto total", formatarMoeda(mrrBruto)],
      ["MRR líquido (academia)", formatarMoeda(mrrLiquido)],
      ["ARPU (líquido/aluno)", formatarMoeda(arpu)],
      ["LTV estimado", ltv != null ? formatarMoeda(ltv) : "N/D (sem churn no período)"],
      ["Churn do mês", `${decimal(churnPct, 1)}%`],
      ["Frequência (constância 7 dias)", `${constanciaPct}%`],
      ["MRR em risco (engajamento < 40)", formatarMoeda(mrrEmRisco)],
      ["Alunos em risco", alunosEmRisco],
      ["Alunos ativos", alunosAtivos],
      ["Alunos totais na organização", totalAlunosOrg],
      [],
      ["Funil de Conversão"],
      ["Alunos matriculados", funilConversao?.alunos_matriculados ?? 0],
      ["Aderiram ao Método ARKE", funilConversao?.alunos_aderiram_metodo ?? 0],
      ["Completaram a anamnese M.A.P.A.®", funilConversao?.alunos_anamnese_completa ?? 0],
      ["Avançaram além de M.A.P.A.®", funilConversao?.alunos_pos_mapa ?? 0],
      [],
      ["Frequência Real (Catraca)"],
      [
        "Frequência via catraca (7 dias)",
        frequenciaCatraca?.tem_catraca_ativa ? `${frequenciaCatraca.frequencia_catraca_pct_7d}%` : "Sem catraca ativa",
      ],
      ...(ehStudio
        ? ([
            [],
            ["Ocupação de Turmas (mês)"],
            ["Turmas ativas", ocupacaoTurmas?.turmas_ativas ?? 0],
            ["Vagas ofertadas", ocupacaoTurmas?.vagas_ofertadas_mes ?? 0],
            ["Agendamentos confirmados", ocupacaoTurmas?.agendamentos_mes ?? 0],
            ["Taxa de ocupação", `${ocupacaoTurmas?.taxa_ocupacao_pct ?? 0}%`],
            ["Em lista de espera", ocupacaoTurmas?.lista_espera_mes ?? 0],
          ] as (string | number)[][])
        : []),
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
        <StatTile
          icon={TrendingUp}
          label="MRR bruto total"
          value={formatarMoeda(mrrBruto)}
          sublabel={`ARKE ${formatarMoeda(mrrArke)} + Academia ${formatarMoeda(mrrAcademia)}`}
        />
        <StatTile icon={TrendingUp} label="MRR líquido" value={formatarMoeda(mrrLiquido)} sublabel="Após repasse ARKE (atacado + taxa de processamento)" />
        <StatTile icon={Users} label="ARPU líquido" value={formatarMoeda(arpu)} sublabel="Por aluno ativo/mês" />
        <StatTile icon={TrendingUp} label="LTV estimado" value={ltv != null ? formatarMoeda(ltv) : "N/D"} sublabel="Baseado no churn do mês" />
        <StatTile icon={TrendingDown} label="Churn do mês" value={`${decimal(churnPct, 1)}%`} sublabel={`${cancelamentosMes} cancelamento(s)`} />
        <StatTile icon={Activity} label="Frequência (7 dias)" value={`${constanciaPct}%`} sublabel="Constância de treino" />
        <StatTile
          icon={AlertTriangle}
          label="MRR em risco"
          value={formatarMoeda(mrrEmRisco)}
          sublabel={`${alunosEmRisco} aluno(s) com engajamento baixo`}
        />
        {frequenciaCatraca?.tem_catraca_ativa && (
          <StatTile
            icon={DoorOpen}
            label="Frequência (catraca, 7 dias)"
            value={`${frequenciaCatraca.frequencia_catraca_pct_7d}%`}
            sublabel="Mais confiável que auto-registro"
          />
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">DRE Simplificado — mês corrente</CardTitle>
          <p className="text-xs text-muted-foreground">
            Receita: pagamentos confirmados no Asaas (ARKE e mensalidade da academia). Custo de equipe: folhas de
            pagamento já fechadas no mês (Financeiro), com comissões já somadas.
          </p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Receita — Método ARKE</span>
            <span>{formatarMoeda(receitaArkeMes)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2 text-xs text-muted-foreground">
            <span>Receita — Planos e cobranças avulsas</span>
            <span>{formatarMoeda(receitaAcademiaMes)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span>Receita bruta total</span>
            <span className="font-semibold">{formatarMoeda(receitaBrutaMes)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2 text-red-600 dark:text-red-400">
            <span>(–) Repasse ARKE (atacado + taxa de processamento)</span>
            <span className="font-semibold">{formatarMoeda(repasseArkeMes)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2 text-red-600 dark:text-red-400">
            <span>(–) Custo de equipe (folha + comissões)</span>
            <span className="font-semibold">{formatarMoeda(custoEquipeMes)}</span>
          </div>
          <div className="flex items-center justify-between pt-1 text-base font-bold text-emerald-600 dark:text-emerald-400">
            <span>(=) Receita líquida da academia</span>
            <span>{formatarMoeda(receitaLiquidaMes)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" /> Funil de Conversão
          </CardTitle>
          <p className="text-xs text-muted-foreground">Do matriculado na academia até avançar na jornada do Método ARKE.</p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span>Alunos matriculados</span>
            <span className="font-semibold">{funilConversao?.alunos_matriculados ?? 0}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span>Aderiram ao Método ARKE</span>
            <span className="font-semibold">{funilConversao?.alunos_aderiram_metodo ?? 0}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span>Completaram a anamnese M.A.P.A.®</span>
            <span className="font-semibold">{funilConversao?.alunos_anamnese_completa ?? 0}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Avançaram além de M.A.P.A.®</span>
            <span className="font-semibold">{funilConversao?.alunos_pos_mapa ?? 0}</span>
          </div>
        </CardContent>
      </Card>

      {ehStudio && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" /> Ocupação de Turmas — mês corrente
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Taxa sobre as sessões (turma + data) que tiveram ao menos um agendamento no mês.
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Turmas ativas</p>
              <p className="text-lg font-bold">{ocupacaoTurmas?.turmas_ativas ?? 0}</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Taxa de ocupação</p>
              <p className="text-lg font-bold">{ocupacaoTurmas?.taxa_ocupacao_pct ?? 0}%</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Em lista de espera</p>
              <p className="text-lg font-bold">{ocupacaoTurmas?.lista_espera_mes ?? 0}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
