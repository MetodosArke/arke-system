import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Users,
  Scale,
  Dumbbell,
  UtensilsCrossed,
  Target,
  Heart,
  Trophy,
  Star,
  Save,
  Download,
  FileText,
  Droplets,
  Wine,
  Cookie,
  Smile,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Calendar,
  Timer,
  MapPin,
  Sparkles,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, getYear, getMonth } from "date-fns";
import jsPDF from "jspdf";
import { ptBR } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ReuniaoAcolhimentoForm from "@/components/admin/prontuario/ReuniaoAcolhimentoForm";

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export default function AdminProntuario() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const now = new Date();
  const [selectedAluno, setSelectedAluno] = useState("");
  const [currentMonth, setCurrentMonth] = useState(getMonth(now));
  const [currentYear, setCurrentYear] = useState(getYear(now));
  const [observacao, setObservacao] = useState("");

  const monthStart = useMemo(() => {
    const d = new Date(currentYear, currentMonth, 1);
    return format(d, "yyyy-MM-dd");
  }, [currentMonth, currentYear]);

  const monthEnd = useMemo(() => {
    const d = endOfMonth(new Date(currentYear, currentMonth, 1));
    return format(d, "yyyy-MM-dd");
  }, [currentMonth, currentYear]);

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  // Fetch alunos
  const { data: alunos = [] } = useQuery({
    queryKey: ["admin-alunos-prontuario"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name").order("full_name");
      return data || [];
    },
  });

  // Fetch checkins for dedication
  const { data: checkins = [] } = useQuery({
    queryKey: ["prontuario-checkins", selectedAluno, monthStart, monthEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from("checkin_diario")
        .select("*")
        .eq("user_id", selectedAluno)
        .gte("data", monthStart)
        .lte("data", monthEnd);
      return data || [];
    },
    enabled: !!selectedAluno,
  });

  // Fetch avaliacoes semanais
  const { data: avaliacoes = [] } = useQuery({
    queryKey: ["prontuario-avaliacoes", selectedAluno, currentMonth, currentYear],
    queryFn: async () => {
      const weekPrefix = `${currentYear}-`;
      const { data } = await supabase
        .from("avaliacao_semanal")
        .select("*")
        .eq("user_id", selectedAluno)
        .like("semana", `${weekPrefix}%`);
      // Filter by month based on created_at
      return (data || []).filter((a) => {
        const d = new Date(a.created_at);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      });
    },
    enabled: !!selectedAluno,
  });

  // Fetch progresso (body status)
  const { data: progressos = [] } = useQuery({
    queryKey: ["prontuario-progresso", selectedAluno, monthStart, monthEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from("progresso_semanal")
        .select("*")
        .eq("aluno_id", selectedAluno)
        .gte("data", monthStart)
        .lte("data", monthEnd)
        .order("data", { ascending: false });
      return data || [];
    },
    enabled: !!selectedAluno,
  });

  // Fetch dieta adesao
  const { data: dietaAdesao = [] } = useQuery({
    queryKey: ["prontuario-dieta", selectedAluno, monthStart, monthEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from("dieta_adesao")
        .select("*")
        .eq("aluno_id", selectedAluno)
        .gte("data", monthStart)
        .lte("data", monthEnd);
      return data || [];
    },
    enabled: !!selectedAluno,
  });

  // Fetch treinos registrados
  const { data: registrosTreino = [] } = useQuery({
    queryKey: ["prontuario-treinos", selectedAluno, monthStart, monthEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_treino")
        .select("*, treinos(titulo, tipo)")
        .eq("aluno_id", selectedAluno)
        .gte("data", monthStart)
        .lte("data", monthEnd);
      return data || [];
    },
    enabled: !!selectedAluno,
  });

  // Fetch calendario treinos (manual entries)
  const { data: calendarioTreinos = [] } = useQuery({
    queryKey: ["prontuario-calendario", selectedAluno, monthStart, monthEnd],
    queryFn: async () => {
      const { data } = await supabase
        .from("treino_calendario")
        .select("*")
        .eq("aluno_id", selectedAluno)
        .gte("data", monthStart)
        .lte("data", monthEnd);
      return data || [];
    },
    enabled: !!selectedAluno,
  });

  // Fetch objetivos
  const { data: objetivos } = useQuery({
    queryKey: ["prontuario-objetivos", selectedAluno],
    queryFn: async () => {
      const { data } = await supabase
        .from("aluno_objetivos")
        .select("*")
        .eq("user_id", selectedAluno)
        .maybeSingle();
      return data;
    },
    enabled: !!selectedAluno,
  });

  // Fetch valores
  const { data: valores } = useQuery({
    queryKey: ["prontuario-valores", selectedAluno],
    queryFn: async () => {
      const { data } = await supabase
        .from("aluno_valores")
        .select("*")
        .eq("user_id", selectedAluno)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!selectedAluno,
  });

  // Fetch desafios
  const { data: desafioProgresso = [] } = useQuery({
    queryKey: ["prontuario-desafios", selectedAluno],
    queryFn: async () => {
      const { data } = await supabase
        .from("desafio_progresso")
        .select("*, desafios(*)")
        .eq("aluno_id", selectedAluno);
      return data || [];
    },
    enabled: !!selectedAluno,
  });

  // Fetch aluno_perfil for meta semanal
  const { data: alunoPerfil } = useQuery({
    queryKey: ["prontuario-perfil", selectedAluno],
    queryFn: async () => {
      const { data } = await supabase
        .from("aluno_perfil")
        .select("*")
        .eq("user_id", selectedAluno)
        .maybeSingle();
      return data;
    },
    enabled: !!selectedAluno,
  });

  // Fetch observation
  const { data: savedObs } = useQuery({
    queryKey: ["prontuario-obs", selectedAluno, currentMonth, currentYear],
    queryFn: async () => {
      const { data } = await supabase
        .from("prontuario_observacoes" as any)
        .select("*")
        .eq("aluno_id", selectedAluno)
        .eq("mes", currentMonth + 1)
        .eq("ano", currentYear)
        .maybeSingle();
      return data as any;
    },
    enabled: !!selectedAluno,
  });

  // Sync obs text when data loads
  useState(() => {
    if (savedObs?.observacao) setObservacao(savedObs.observacao);
  });

  // Update obs when savedObs changes
  useMemo(() => {
    setObservacao(savedObs?.observacao || "");
  }, [savedObs]);

  const saveObsMutation = useMutation({
    mutationFn: async () => {
      if (savedObs?.id) {
        await supabase
          .from("prontuario_observacoes" as any)
          .update({ observacao, updated_at: new Date().toISOString() } as any)
          .eq("id", savedObs.id);
      } else {
        await supabase
          .from("prontuario_observacoes" as any)
          .insert({
            aluno_id: selectedAluno,
            mes: currentMonth + 1,
            ano: currentYear,
            observacao,
            criado_por: user?.id,
          } as any);
      }
    },
    onSuccess: () => {
      toast.success("Observação salva!");
      queryClient.invalidateQueries({ queryKey: ["prontuario-obs"] });
    },
    onError: () => toast.error("Erro ao salvar observação"),
  });

  // ===== Computed data =====
  const dedicacaoResume = useMemo(() => {
    const counts: Record<string, number> = {};
    checkins.forEach((c) => {
      counts[c.dedicacao] = (counts[c.dedicacao] || 0) + 1;
    });
    const total = checkins.length;
    if (total === 0) return null;
    // Most common
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return { most: sorted[0]?.[0], counts, total };
  }, [checkins]);

  const progressoGeral = useMemo(() => {
    if (avaliacoes.length === 0) return null;
    const avgSono = avaliacoes.reduce((s, a) => s + a.sono, 0) / avaliacoes.length;
    const avgProd = avaliacoes.reduce((s, a) => s + a.produtividade, 0) / avaliacoes.length;
    const avgHumor = avaliacoes.reduce((s, a) => s + a.humor, 0) / avaliacoes.length;
    const media = (avgSono + avgProd + avgHumor) / 3;
    return { sono: avgSono, produtividade: avgProd, humor: avgHumor, media };
  }, [avaliacoes]);

  const statusCorporal = useMemo(() => {
    if (progressos.length === 0) return null;
    const latest = progressos[0];
    return {
      peso: latest.peso_kg,
      gordura: latest.gordura_percentual,
      musculo: latest.musculo_percentual,
      metaPeso: latest.meta_peso_kg,
      metaGordura: latest.meta_gordura_valor,
      metaMusculo: latest.meta_musculo_valor,
      metaDir: latest.meta,
      metaGorduraDir: latest.meta_gordura,
      metaMusculoDir: latest.meta_musculo,
      proximaAvaliacao: latest.data_proxima_avaliacao,
    };
  }, [progressos]);

  const alimentacaoResume = useMemo(() => {
    if (dietaAdesao.length === 0) return null;
    const docesCount = dietaAdesao.filter((d) => d.consumiu_doce).length;
    const alcoolCount = dietaAdesao.filter((d) => d.consumiu_alcool).length;
    const totalAgua = dietaAdesao.reduce((s, d) => s + (d.agua_ml || 0), 0);
    const avgAgua = Math.round(totalAgua / dietaAdesao.length);
    const avgAdesao = Math.round(dietaAdesao.reduce((s, d) => s + d.adesao_percentual, 0) / dietaAdesao.length);
    const diasRegistrados = dietaAdesao.length;
    return { docesCount, alcoolCount, avgAgua, avgAdesao, diasRegistrados };
  }, [dietaAdesao]);

  const treinosResume = useMemo(() => {
    const totalTreinos = registrosTreino.length + calendarioTreinos.length;
    const totalMin = registrosTreino.reduce((s, r) => s + (r.duracao_min || 0), 0) +
      calendarioTreinos.reduce((s, c) => s + (c.duracao_min || 0), 0);
    const totalKm = calendarioTreinos.reduce((s, c) => s + (Number(c.distancia_km) || 0), 0);
    const tiposSet = new Set<string>();
    registrosTreino.forEach((r: any) => {
      if (r.treinos?.tipo) tiposSet.add(r.treinos.tipo);
    });
    calendarioTreinos.forEach((c) => {
      (c.tipos || []).forEach((t: string) => tiposSet.add(t));
    });
    const metaSemanal = alunoPerfil?.meta_semanal_dias || 3;
    // Count weeks with enough treinos
    const weekMap = new Map<string, number>();
    [...registrosTreino, ...calendarioTreinos].forEach((r: any) => {
      const d = new Date(r.data);
      const weekKey = `${d.getFullYear()}-W${Math.ceil((d.getDate()) / 7)}`;
      weekMap.set(weekKey, (weekMap.get(weekKey) || 0) + 1);
    });
    const semanasAtingidas = Array.from(weekMap.values()).filter((v) => v >= metaSemanal).length;
    const totalSemanas = weekMap.size || 1;

    return {
      totalTreinos,
      totalMin,
      totalKm,
      modalidades: tiposSet.size,
      metaSemanal,
      semanasAtingidas,
      totalSemanas,
    };
  }, [registrosTreino, calendarioTreinos, alunoPerfil]);

  const desafiosResume = useMemo(() => {
    const ativos = desafioProgresso.filter((dp: any) => {
      const d = dp.desafios;
      if (!d) return false;
      const now = new Date();
      return new Date(d.data_inicio) <= now && new Date(d.data_fim) >= now;
    });
    const concluidos = desafioProgresso.filter((dp: any) => dp.concluido);
    const pontos = concluidos.reduce((s: number, dp: any) => s + (dp.desafios?.pontos || 0), 0);
    return { ativos: ativos.length, concluidos: concluidos.length, pontos };
  }, [desafioProgresso]);

  const getProgressColor = (val: number) => {
    if (val >= 7) return "hsl(var(--chart-2))";
    if (val >= 5) return "hsl(var(--primary))";
    if (val >= 3) return "hsl(var(--chart-4))";
    return "hsl(var(--destructive))";
  };

  const alunoName = alunos.find((a) => a.user_id === selectedAluno)?.full_name || "";

  const generatePDF = async () => {
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginLeft = 18;
    const marginRight = 18;
    const maxW = pageW - marginLeft - marginRight;
    let y = 0;

    // Brand colors
    const gold: [number, number, number] = [180, 150, 80];
    const darkGold: [number, number, number] = [140, 110, 50];
    const black: [number, number, number] = [20, 20, 20];
    const darkGray: [number, number, number] = [60, 60, 60];
    const medGray: [number, number, number] = [120, 120, 120];
    const lightBg: [number, number, number] = [250, 248, 244];

    // Load logo
    let logoImg: string | null = null;
    try {
      const logoModule = await import("@/assets/logo.png");
      const resp = await fetch(logoModule.default);
      const blob = await resp.blob();
      logoImg = await new Promise<string>((res) => {
        const reader = new FileReader();
        reader.onloadend = () => res(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch { /* logo not available */ }

    const addPageFooter = () => {
      // Gold line at bottom
      doc.setDrawColor(...gold);
      doc.setLineWidth(0.5);
      doc.line(marginLeft, pageH - 15, pageW - marginRight, pageH - 15);
      doc.setFontSize(7);
      doc.setTextColor(...medGray);
      doc.setFont("helvetica", "normal");
      doc.text("Arke", marginLeft, pageH - 10);
      doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`, pageW - marginRight, pageH - 10, { align: "right" });
    };

    const checkPage = (needed = 30) => {
      if (y > pageH - needed) {
        addPageFooter();
        doc.addPage();
        y = 20;
      }
    };

    const addText = (text: string, size = 10, bold = false, color: [number, number, number] = darkGray) => {
      checkPage(size * 0.5 + 10);
      doc.setFontSize(size);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setTextColor(...color);
      const lines = doc.splitTextToSize(text, maxW);
      doc.text(lines, marginLeft, y);
      y += lines.length * (size * 0.45) + 2;
    };

    const addSpacer = (h = 6) => { y += h; };

    const addSection = (title: string) => {
      addSpacer(6);
      checkPage(35);
      // Gold accent bar
      doc.setFillColor(...gold);
      doc.roundedRect(marginLeft, y - 1, 3, 14, 1.5, 1.5, "F");
      // Section title
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...darkGold);
      doc.text(title, marginLeft + 7, y + 8);
      y += 18;
      // Subtle separator
      doc.setDrawColor(220, 215, 200);
      doc.setLineWidth(0.15);
      doc.line(marginLeft + 7, y - 3, pageW - marginRight, y - 3);
    };

    const addMetricCard = (label: string, value: string, x: number, w: number) => {
      doc.setFillColor(...lightBg);
      doc.roundedRect(x, y, w, 20, 2, 2, "F");
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...medGray);
      doc.text(label, x + w / 2, y + 7, { align: "center" });
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...black);
      doc.text(value, x + w / 2, y + 16, { align: "center" });
    };

    const addMetricRow = (metrics: { label: string; value: string }[]) => {
      checkPage(30);
      const gap = 4;
      const cardW = (maxW - gap * (metrics.length - 1)) / metrics.length;
      metrics.forEach((m, i) => {
        addMetricCard(m.label, m.value, marginLeft + i * (cardW + gap), cardW);
      });
      y += 26;
    };

    // ===== COVER HEADER =====
    // Dark header background
    doc.setFillColor(0, 0, 0);
    doc.rect(0, 0, pageW, 70, "F");
    // Gold accent line
    doc.setFillColor(...gold);
    doc.rect(0, 70, pageW, 2, "F");

    // Logo (draw black rect behind to ensure seamless background)
    if (logoImg) {
      try {
        doc.setFillColor(0, 0, 0);
        doc.rect(marginLeft - 1, 9, 30, 30, "F");
        doc.addImage(logoImg, "PNG", marginLeft, 10, 28, 28);
      } catch { /* skip logo */ }
    }

    // Title text
    const titleX = logoImg ? marginLeft + 34 : marginLeft;
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("PRONTUÁRIO MENSAL", titleX, 28);

    doc.setFontSize(13);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...gold);
    doc.text(alunoName, titleX, 40);

    doc.setFontSize(10);
    doc.setTextColor(200, 200, 200);
    doc.text(`${MONTH_NAMES[currentMonth]} ${currentYear}`, titleX, 52);

    // Decorative corner element
    doc.setFillColor(...gold);
    doc.triangle(pageW - 30, 0, pageW, 0, pageW, 30, "F");

    y = 82;

    // ===== DEDICAÇÃO =====
    if (dedicacaoResume) {
      addSection("DEDICAÇÃO");
      const items = Object.entries(dedicacaoResume.counts).map(([k, v]) => ({ label: k, value: `${v}x` }));
      if (items.length > 0) {
        addMetricRow(items.slice(0, 4));
        if (items.length > 4) addMetricRow(items.slice(4, 8));
      }
      addText(`Total de check-ins no mês: ${dedicacaoResume.total}`, 9, false, medGray);
    }

    // ===== PROGRESSO GERAL =====
    if (progressoGeral) {
      addSection("PROGRESSO GERAL");
      addMetricRow([
        { label: "Sono", value: `${progressoGeral.sono.toFixed(1)}/10` },
        { label: "Produtividade", value: `${progressoGeral.produtividade.toFixed(1)}/10` },
        { label: "Humor", value: `${progressoGeral.humor.toFixed(1)}/10` },
        { label: "Média Geral", value: `${progressoGeral.media.toFixed(1)}/10` },
      ]);
    }

    // ===== STATUS CORPORAL =====
    if (statusCorporal) {
      addSection("STATUS CORPORAL");
      addMetricRow([
        { label: "Peso", value: `${statusCorporal.peso ?? "—"} kg` },
        { label: "Gordura", value: `${statusCorporal.gordura ?? "—"}%` },
        { label: "Músculo", value: `${statusCorporal.musculo ?? "—"} kg` },
      ]);
      addText("Metas:", 9, true, darkGold);
      addMetricRow([
        { label: "Meta Peso", value: `${statusCorporal.metaPeso ?? "—"} kg` },
        { label: "Meta Gordura", value: `${statusCorporal.metaGordura ?? "—"}%` },
        { label: "Meta Músculo", value: `${statusCorporal.metaMusculo ?? "—"} kg` },
      ]);
    }

    // ===== ALIMENTAÇÃO =====
    if (alimentacaoResume) {
      addSection("ALIMENTAÇÃO");
      addMetricRow([
        { label: "Doces", value: `${alimentacaoResume.docesCount}x` },
        { label: "Álcool", value: `${alimentacaoResume.alcoolCount}x` },
        { label: "Água Média", value: `${alimentacaoResume.avgAgua} ml` },
      ]);
      addMetricRow([
        { label: "Adesão Média", value: `${alimentacaoResume.avgAdesao}%` },
        { label: "Dias Registrados", value: `${alimentacaoResume.diasRegistrados}` },
      ]);
    }

    // ===== TREINOS =====
    addSection("RESUMO DE TREINOS");
    addMetricRow([
      { label: "Treinos", value: `${treinosResume.totalTreinos}` },
      { label: "Minutos", value: `${treinosResume.totalMin}` },
      { label: "Distância", value: `${treinosResume.totalKm.toFixed(1)} km` },
    ]);
    addMetricRow([
      { label: "Modalidades", value: `${treinosResume.modalidades}` },
      { label: "Meta Semanal", value: `${treinosResume.semanasAtingidas}/${treinosResume.totalSemanas}` },
    ]);


    // ===== DESAFIOS & VALORES =====
    addSection("DESAFIOS & VALORES");
    addMetricRow([
      { label: "Ativos", value: `${desafiosResume.ativos}` },
      { label: "Concluídos", value: `${desafiosResume.concluidos}` },
      { label: "Pontos", value: `${desafiosResume.pontos}` },
    ]);
    if (valores?.valores && valores.valores.length > 0) {
      addSpacer(2);
      checkPage(20);
      // Render values as tags
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      let tagX = marginLeft;
      valores.valores.forEach((v) => {
        const tw = doc.getTextWidth(v) + 8;
        if (tagX + tw > pageW - marginRight) { tagX = marginLeft; y += 10; checkPage(15); }
        doc.setFillColor(250, 245, 230);
        doc.setDrawColor(...gold);
        doc.setLineWidth(0.3);
        doc.roundedRect(tagX, y, tw, 8, 2, 2, "FD");
        doc.setTextColor(...darkGold);
        doc.text(v, tagX + 4, y + 5.5);
        tagX += tw + 3;
      });
      y += 14;
    }

    // ===== OBJETIVOS (última seção) =====
    if (objetivos) {
      addSection("OBJETIVOS");
      (objetivos.objetivos || []).forEach((obj) => {
        checkPage(12);
        doc.setFillColor(...lightBg);
        const lines = doc.splitTextToSize(obj, maxW - 14);
        const h = lines.length * 5 + 6;
        doc.roundedRect(marginLeft, y - 1, maxW, h, 1.5, 1.5, "F");
        doc.setFillColor(...gold);
        doc.circle(marginLeft + 5, y + h / 2 - 1, 1.5, "F");
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...darkGray);
        doc.text(lines, marginLeft + 10, y + 4);
        y += h + 3;
      });
      if (objetivos.conquistas) { addSpacer(2); addText(`Conquistas: ${objetivos.conquistas}`, 9, false, medGray); }
      if (objetivos.dificuldades) addText(`Dificuldades: ${objetivos.dificuldades}`, 9, false, medGray);
      if (objetivos.visao_3_meses) addText(`Visao 3 meses: ${objetivos.visao_3_meses}`, 9, false, medGray);
      if (objetivos.visao_3_anos) addText(`Visao 3 anos: ${objetivos.visao_3_anos}`, 9, false, medGray);
    }

    // Final footer
    addPageFooter();

    doc.save(`prontuario_${alunoName.replace(/\s+/g, "_")}_${MONTH_NAMES[currentMonth]}_${currentYear}.pdf`);
    toast.success("PDF gerado com sucesso!");
  };

  return (
    <div className="space-y-4 sm:space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" />
          <h1 className="text-xl sm:text-2xl font-bold text-foreground" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
            Prontuário
          </h1>
        </div>
        <div className="w-full sm:w-72">
          <Select value={selectedAluno} onValueChange={setSelectedAluno}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o aluno" />
            </SelectTrigger>
            <SelectContent>
              {alunos.map((a) => (
                <SelectItem key={a.user_id} value={a.user_id}>
                  {a.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!selectedAluno && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p>Selecione um aluno para visualizar o prontuário mensal</p>
          </CardContent>
        </Card>
      )}

      {selectedAluno && (
        <Tabs defaultValue="resumo" className="w-full">
          <TabsList className="w-full grid grid-cols-2 h-auto p-1 mb-4">
            <TabsTrigger value="resumo" className="text-xs py-2.5 data-[state=active]:shadow-md">
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Resumo Mensal
            </TabsTrigger>
            <TabsTrigger value="acolhimento" className="text-xs py-2.5 data-[state=active]:shadow-md">
              <Heart className="h-3.5 w-3.5 mr-1.5" />
              Reunião de Acolhimento
            </TabsTrigger>
          </TabsList>

          <TabsContent value="acolhimento">
            <ReuniaoAcolhimentoForm alunoId={selectedAluno} />
          </TabsContent>

          <TabsContent value="resumo">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${currentMonth}-${currentYear}`}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {/* Month Navigation */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <Button variant="ghost" size="icon" onClick={prevMonth}>
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <div className="text-center">
                    <h2 className="text-lg sm:text-xl font-bold text-foreground" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
                      Resumo Mensal
                    </h2>
                    <p className="text-sm text-primary font-semibold">
                      {MONTH_NAMES[currentMonth]} {currentYear}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={nextMonth}>
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <Progress value={100} className="flex-1 h-1.5 [&>div]:bg-gradient-to-r [&>div]:from-destructive [&>div]:via-primary [&>div]:to-chart-2" />
                  <Button variant="outline" size="sm" className="ml-3 shrink-0" onClick={generatePDF}>
                    <Download className="h-4 w-4 mr-1.5" />
                    PDF
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Dedicação */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Heart className="h-4 w-4 text-primary" />
                  Como está a dedicação este mês?
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dedicacaoResume ? (
                  <div className="flex flex-wrap gap-2">
                    {["Baixa", "Média", "Boa", "Excelente"].map((level) => {
                      const map: Record<string, string> = { "baixa": "Baixa", "media": "Média", "boa": "Boa", "excelente": "Excelente" };
                      const key = Object.entries(map).find(([, v]) => v === level)?.[0] || level.toLowerCase();
                      const count = dedicacaoResume.counts[key] || 0;
                      const isMost = dedicacaoResume.most === key;
                      return (
                        <Badge
                          key={level}
                          variant={isMost ? "default" : "outline"}
                          className="text-xs px-3 py-1.5"
                        >
                          {isMost ? "✅" : "⭐"} {level} {count > 0 && `(${count}x)`}
                        </Badge>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Sem registros neste mês</p>
                )}
              </CardContent>
            </Card>

            {/* Progresso Geral */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Progresso Geral
                </CardTitle>
              </CardHeader>
              <CardContent>
                {progressoGeral ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Sono", val: progressoGeral.sono },
                      { label: "Produtividade", val: progressoGeral.produtividade },
                      { label: "Humor", val: progressoGeral.humor },
                      { label: "Média Geral", val: progressoGeral.media },
                    ].map((item) => (
                      <div key={item.label} className="text-center p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground font-medium">{item.label}</p>
                        <p className="text-xl font-bold" style={{ color: getProgressColor(item.val) }}>
                          {item.val.toFixed(1)}/10
                        </p>
                        <Progress
                          value={item.val * 10}
                          className="mt-1 h-1.5"
                          style={{ "--progress-color": getProgressColor(item.val) } as any}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Sem avaliações neste mês</p>
                )}
              </CardContent>
            </Card>

            {/* Status Corporal + Alimentação */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Status Corporal */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Scale className="h-4 w-4 text-primary" />
                    Status Corporal
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {statusCorporal ? (
                    <>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-xs text-muted-foreground">Peso</p>
                          <p className="text-lg font-bold text-foreground">{statusCorporal.peso ?? "—"} kg</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Gordura</p>
                          <p className="text-lg font-bold text-foreground">{statusCorporal.gordura ?? "—"}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Músculo</p>
                          <p className="text-lg font-bold text-foreground">{statusCorporal.musculo ?? "—"} kg</p>
                        </div>
                      </div>
                      <Separator />
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                            Meta Peso
                            {statusCorporal.metaDir === "diminuir" && <TrendingDown className="h-3 w-3 text-chart-2" />}
                            {statusCorporal.metaDir === "aumentar" && <TrendingUp className="h-3 w-3 text-primary" />}
                            {statusCorporal.metaDir === "manter" && <Minus className="h-3 w-3 text-muted-foreground" />}
                          </p>
                          <p className="text-sm font-semibold">{statusCorporal.metaPeso ?? "—"} kg</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Meta Gord.</p>
                          <p className="text-sm font-semibold">{statusCorporal.metaGordura ?? "—"}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Meta Musc.</p>
                          <p className="text-sm font-semibold">{statusCorporal.metaMusculo ?? "—"} kg</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Sem avaliações corporais neste mês</p>
                  )}
                </CardContent>
              </Card>

              {/* Alimentação */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <UtensilsCrossed className="h-4 w-4 text-primary" />
                    Alimentação
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {alimentacaoResume ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm flex items-center gap-1.5">
                          <Cookie className="h-3.5 w-3.5 text-chart-4" /> Doces
                        </span>
                        <Badge variant="outline" className="text-xs">{alimentacaoResume.docesCount}x</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm flex items-center gap-1.5">
                          <Wine className="h-3.5 w-3.5 text-chart-5" /> Álcool
                        </span>
                        <Badge variant="outline" className="text-xs">{alimentacaoResume.alcoolCount}x</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm flex items-center gap-1.5">
                          <Droplets className="h-3.5 w-3.5 text-chart-1" /> Água (média)
                        </span>
                        <Badge variant="outline" className="text-xs">{alimentacaoResume.avgAgua} ml</Badge>
                      </div>
                      <Separator />
                      <div className="text-center pt-1">
                        <p className="text-xs text-muted-foreground">Adesão Média</p>
                        <p className="text-2xl font-bold text-primary">{alimentacaoResume.avgAdesao}%</p>
                        <p className="text-xs text-muted-foreground">{alimentacaoResume.diasRegistrados} dias registrados</p>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Sem registros de dieta neste mês</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Resumo de Treinos */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Dumbbell className="h-4 w-4 text-primary" />
                  Resumo de Treinos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                    <Calendar className="h-4 w-4 text-primary shrink-0" />
                    <div>
                      <p className="text-lg font-bold text-foreground">{treinosResume.totalTreinos}</p>
                      <p className="text-xs text-muted-foreground">Treinos Totais</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                    <Timer className="h-4 w-4 text-primary shrink-0" />
                    <div>
                      <p className="text-lg font-bold text-foreground">{treinosResume.totalMin}</p>
                      <p className="text-xs text-muted-foreground">Minutos</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                    <MapPin className="h-4 w-4 text-primary shrink-0" />
                    <div>
                      <p className="text-lg font-bold text-foreground">{treinosResume.totalKm.toFixed(1)} km</p>
                      <p className="text-xs text-muted-foreground">Distância</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                    <Sparkles className="h-4 w-4 text-primary shrink-0" />
                    <div>
                      <p className="text-lg font-bold text-foreground">{treinosResume.modalidades}</p>
                      <p className="text-xs text-muted-foreground">Modalidades</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 col-span-2 sm:col-span-2">
                    <Star className="h-4 w-4 text-primary shrink-0" />
                    <div>
                      <p className="text-lg font-bold text-foreground">
                        Meta Semanal {treinosResume.semanasAtingidas}/{treinosResume.totalSemanas}
                        {treinosResume.semanasAtingidas >= treinosResume.totalSemanas && treinosResume.totalSemanas > 0 && " ⭐"}
                      </p>
                      <p className="text-xs text-muted-foreground">{treinosResume.metaSemanal} treinos/semana</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Objetivos + Desafios */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" />
                    Objetivos
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {objetivos ? (
                    <>
                      {(objetivos.objetivos || []).map((obj, i) => (
                        <p key={i} className="text-sm flex items-start gap-1.5">
                          <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                          {obj}
                        </p>
                      ))}
                      {objetivos.visao_3_meses && (
                        <p className="text-xs text-muted-foreground mt-2">
                          ✨ Visão 3 meses: "{objetivos.visao_3_meses}"
                        </p>
                      )}
                      {objetivos.visao_3_anos && (
                        <p className="text-xs text-muted-foreground">
                          ✨ Visão 3 anos: "{objetivos.visao_3_anos}"
                        </p>
                      )}
                      {objetivos.proxima_revisao && (
                        <p className="text-xs font-medium text-primary mt-1">
                          Próxima revisão: {format(new Date(objetivos.proxima_revisao), "dd/MM/yyyy")}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Sem objetivos definidos</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-primary" />
                    Desafios & Valores
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Ativos</span>
                    <Badge>{desafiosResume.ativos}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Concluídos</span>
                    <Badge variant="outline" className="bg-chart-2/10 text-chart-2">{desafiosResume.concluidos}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Pontos</span>
                    <Badge variant="outline" className="bg-primary/10 text-primary">{desafiosResume.pontos} pts</Badge>
                  </div>
                  {valores?.valores && valores.valores.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Valores do mês:</p>
                        <p className="text-sm font-medium text-foreground">{valores.valores.join(", ")}</p>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Observação salva (se existir) */}
            {savedObs?.observacao && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="py-3">
                  <p className="text-xs font-semibold text-primary mb-1">📝 Observação do profissional:</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{savedObs.observacao}</p>
                </CardContent>
              </Card>
            )}

            {/* Observação input */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  Observação do Mês
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder="Adicione uma observação para este mês..."
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  rows={3}
                />
                <Button
                  onClick={() => saveObsMutation.mutate()}
                  disabled={saveObsMutation.isPending || !observacao.trim()}
                  className="w-full sm:w-auto"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Salvar Observação
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </AnimatePresence>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
