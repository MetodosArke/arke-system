import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  startOfMonth,
  endOfMonth,
  format,
  getDay,
  addDays,
  differenceInCalendarDays,
  startOfWeek,
  endOfWeek,
  eachWeekOfInterval,
  isWithinInterval,
  getISOWeek,
  getYear,
} from "date-fns";

// Helper: get Monday-Sunday weeks that overlap with the month
function getWeeksInMonth(year: number, month: number) {
  const monthStart = startOfMonth(new Date(year, month, 1));
  const monthEnd = endOfMonth(new Date(year, month, 1));
  const weeks = eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 1 });
  return weeks.map((weekStart) => ({
    start: weekStart,
    end: endOfWeek(weekStart, { weekStartsOn: 1 }),
    key: `${getYear(weekStart)}-W${getISOWeek(weekStart)}`,
  }));
}

function isInWeek(dateStr: string, weekStart: Date, weekEnd: Date) {
  const d = new Date(dateStr + "T12:00:00");
  return isWithinInterval(d, { start: weekStart, end: weekEnd });
}

// Calculate consecutive streak bonus
function calcStreakBonus(weeklyHits: boolean[], bonusTable: number[]): number {
  let streak = 0;
  let maxStreak = 0;
  for (const hit of weeklyHits) {
    if (hit) {
      streak++;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 0;
    }
  }
  // Find applicable bonus
  let bonus = 0;
  for (let i = bonusTable.length - 1; i >= 0; i--) {
    if (maxStreak >= i + 2) {
      bonus = bonusTable[i];
      break;
    }
  }
  return bonus;
}

export interface PontuacaoDetalhada {
  // Engagement
  dedicacaoDiaria: { base: number; bonus: number; total: number; max: number };
  progressoSemanal: { base: number; bonus: number; total: number; max: number };
  objetivos: { total: number; max: number };
  valores: { total: number; max: number };
  compromissosCriados: { base: number; bonus: number; total: number; max: number };
  feed: { total: number; max: number };
  calendarioDieta: { total: number; max: number };
  engajamentoTotal: number;

  // Performance
  metaTreino: { base: number; bonus: number; total: number; max: number };
  dietaSemanal: { base: number; bonus: number; total: number; max: number };
  metasMes: { total: number; metasBatidas: number; max: number };
  conquistaSemanal: { base: number; bonus: number; total: number; max: number };
  compromissoCumprido: { base: number; bonus: number; total: number; max: number };
  agua: { base: number; bonus: number; total: number; max: number };
  desafios: { total: number; max: number };
  penalidade: { total: number; diasAlcool: number };
  modalidades: { total: number; count: number; max: number };
  performanceTotal: number;

  totalGeral: number;
  isLoading: boolean;
}

export function usePontuacaoMensal(year: number, month: number): PontuacaoDetalhada {
  const { user } = useAuth();
  const userId = user?.id || "";

  const monthStart = format(new Date(year, month, 1), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(new Date(year, month, 1)), "yyyy-MM-dd");
  const weeks = useMemo(() => getWeeksInMonth(year, month), [year, month]);

  // Fetch all data in parallel
  const { data: checkins = [], isLoading: l1 } = useQuery({
    queryKey: ["pontuacao-checkins", userId, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from("checkin_diario")
        .select("*")
        .eq("user_id", userId)
        .gte("data", monthStart)
        .lte("data", monthEnd)
        .order("data");
      return data || [];
    },
    enabled: !!userId,
  });

  const { data: avaliacoes = [], isLoading: l2 } = useQuery({
    queryKey: ["pontuacao-avaliacoes", userId, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from("avaliacao_semanal")
        .select("*")
        .eq("user_id", userId);
      return (data || []).filter((a) => {
        const d = new Date(a.created_at);
        return d.getMonth() === month && d.getFullYear() === year;
      });
    },
    enabled: !!userId,
  });

  // Also fetch avaliacoes from surrounding months for streak calculation
  const { data: allAvaliacoes = [] } = useQuery({
    queryKey: ["pontuacao-all-avaliacoes", userId, year],
    queryFn: async () => {
      const { data } = await supabase
        .from("avaliacao_semanal")
        .select("semana, conquista, created_at")
        .eq("user_id", userId);
      return data || [];
    },
    enabled: !!userId,
  });

  const { data: objetivos, isLoading: l3 } = useQuery({
    queryKey: ["pontuacao-objetivos", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("aluno_objetivos")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!userId,
  });

  const { data: valoresData, isLoading: l4 } = useQuery({
    queryKey: ["pontuacao-valores", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("aluno_valores")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!userId,
  });

  const { data: compromissos = [], isLoading: l5 } = useQuery({
    queryKey: ["pontuacao-compromissos", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("compromisso_semanal")
        .select("*, compromisso_metas(*)")
        .eq("user_id", userId);
      return data || [];
    },
    enabled: !!userId,
  });

  const { data: feedPosts = [], isLoading: l6 } = useQuery({
    queryKey: ["pontuacao-feed-posts", userId, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from("feed_posts")
        .select("created_at")
        .eq("user_id", userId)
        .gte("created_at", monthStart + "T00:00:00")
        .lte("created_at", monthEnd + "T23:59:59");
      return data || [];
    },
    enabled: !!userId,
  });

  const { data: feedLikes = [] } = useQuery({
    queryKey: ["pontuacao-feed-likes", userId, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from("feed_likes")
        .select("created_at")
        .eq("user_id", userId)
        .gte("created_at", monthStart + "T00:00:00")
        .lte("created_at", monthEnd + "T23:59:59");
      return data || [];
    },
    enabled: !!userId,
  });

  const { data: feedComments = [] } = useQuery({
    queryKey: ["pontuacao-feed-comments", userId, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from("feed_comments")
        .select("created_at")
        .eq("user_id", userId)
        .gte("created_at", monthStart + "T00:00:00")
        .lte("created_at", monthEnd + "T23:59:59");
      return data || [];
    },
    enabled: !!userId,
  });

  const { data: dietaAdesao = [], isLoading: l7 } = useQuery({
    queryKey: ["pontuacao-dieta", userId, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from("dieta_adesao")
        .select("*")
        .eq("aluno_id", userId)
        .gte("data", monthStart)
        .lte("data", monthEnd);
      return data || [];
    },
    enabled: !!userId,
  });

  const { data: registrosTreino = [], isLoading: l8 } = useQuery({
    queryKey: ["pontuacao-treinos", userId, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_treino")
        .select("data")
        .eq("aluno_id", userId)
        .gte("data", monthStart)
        .lte("data", monthEnd);
      return data || [];
    },
    enabled: !!userId,
  });

  const { data: calendarioTreinos = [] } = useQuery({
    queryKey: ["pontuacao-calendario", userId, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from("treino_calendario")
        .select("data, tipos")
        .eq("aluno_id", userId)
        .gte("data", monthStart)
        .lte("data", monthEnd);
      return data || [];
    },
    enabled: !!userId,
  });

  const { data: alunoPerfil } = useQuery({
    queryKey: ["pontuacao-perfil", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("aluno_perfil")
        .select("meta_semanal_dias")
        .eq("user_id", userId)
        .maybeSingle();
      return data;
    },
    enabled: !!userId,
  });

  const { data: progressos = [] } = useQuery({
    queryKey: ["pontuacao-progresso", userId, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from("progresso_semanal")
        .select("*")
        .eq("aluno_id", userId)
        .gte("data", monthStart)
        .lte("data", monthEnd)
        .order("data", { ascending: false });
      return data || [];
    },
    enabled: !!userId,
  });

  const { data: desafioProgresso = [] } = useQuery({
    queryKey: ["pontuacao-desafios", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("desafio_progresso")
        .select("*, desafios(*)")
        .eq("aluno_id", userId);
      return data || [];
    },
    enabled: !!userId,
  });

  // Desafios aplicáveis ao aluno (para_todos ou participante)
  const { data: desafiosAluno = [] } = useQuery({
    queryKey: ["pontuacao-desafios-lista", userId],
    queryFn: async () => {
      const { data: all } = await supabase.from("desafios").select("*");
      if (!all) return [];
      const { data: parts } = await supabase
        .from("desafio_participantes")
        .select("desafio_id")
        .eq("aluno_id", userId);
      const ids = new Set((parts || []).map((p: any) => p.desafio_id));
      return (all as any[]).filter((d) => d.para_todos || ids.has(d.id));
    },
    enabled: !!userId,
  });

  // Dados completos (sem filtro de mês) para avaliar desafios automáticos
  const { data: dietaAdesaoAll = [] } = useQuery({
    queryKey: ["pontuacao-dieta-all", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("dieta_adesao")
        .select("data, consumiu_doce, consumiu_alcool, agua_ml, adesao_percentual")
        .eq("aluno_id", userId);
      return (data || []) as any[];
    },
    enabled: !!userId,
  });

  const { data: registrosTreinoAll = [] } = useQuery({
    queryKey: ["pontuacao-treinos-all", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("registro_treino")
        .select("data")
        .eq("aluno_id", userId);
      return (data || []) as any[];
    },
    enabled: !!userId,
  });

  const { data: calendarioTreinosAll = [] } = useQuery({
    queryKey: ["pontuacao-calendario-all", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("treino_calendario")
        .select("data, tipos")
        .eq("aluno_id", userId);
      return (data || []) as any[];
    },
    enabled: !!userId,
  });

  const isLoading = l1 || l2 || l3 || l4 || l5 || l6 || l7 || l8;

  return useMemo(() => {
    // ========== ENGAGEMENT ==========

    // 1. Dedicação diária (max 25)
    const diasPreenchidos = Math.min(checkins.length, 15);
    let maxConsecDias = 0;
    let currentStreak = 0;
    const sortedDates = checkins.map((c) => c.data).sort();
    for (let i = 0; i < sortedDates.length; i++) {
      if (i === 0) {
        currentStreak = 1;
      } else {
        const prev = new Date(sortedDates[i - 1] + "T12:00:00");
        const curr = new Date(sortedDates[i] + "T12:00:00");
        const diff = differenceInCalendarDays(curr, prev);
        if (diff === 1) {
          currentStreak++;
        } else {
          currentStreak = 1;
        }
      }
      maxConsecDias = Math.max(maxConsecDias, currentStreak);
    }
    const dedicacaoBonus = Math.min(Math.floor(maxConsecDias / 2), 10);
    const dedicacaoTotal = Math.min(diasPreenchidos + dedicacaoBonus, 25);

    // 2. Progresso semanal (max 15)
    const weeklyAvaliacao = weeks.map((w) =>
      avaliacoes.some((a) => {
        const d = new Date(a.created_at);
        return isWithinInterval(d, { start: w.start, end: w.end });
      })
    );
    const progressoBase = Math.min(weeklyAvaliacao.filter(Boolean).length * 3, 12);
    const progressoBonus = calcStreakBonus(weeklyAvaliacao, [1, 2, 3]);
    const progressoTotal = Math.min(progressoBase + progressoBonus, 15);

    // 3. Objetivos (max 10) — valid for 3 months
    let objetivosTotal = 0;
    if (objetivos) {
      const revisao = objetivos.proxima_revisao
        ? new Date(objetivos.proxima_revisao + "T12:00:00")
        : null;
      const isValid = !revisao || revisao >= new Date(year, month, 1);
      if (isValid) {
        const count = (objetivos.objetivos || []).filter((o: string) => o && o.trim()).length;
        if (count >= 3) objetivosTotal = 10;
        else if (count === 2) objetivosTotal = 7;
        else if (count === 1) objetivosTotal = 4;
      }
    }

    // 4. Valores (max 10) — valid for 6 months
    let valoresTotalPts = 0;
    if (valoresData?.valores && valoresData.valores.length >= 3) {
      const validade = valoresData.validade
        ? new Date(valoresData.validade + "T12:00:00")
        : null;
      const isValid = !validade || validade >= new Date(year, month, 1);
      if (isValid) valoresTotalPts = 10;
    }

    // 5. Compromissos criados (max 15)
    const weeklyCompromissos = weeks.map((w) => {
      const comps = compromissos.filter((c) => {
        // Match by semana key or created_at
        if (c.semana === w.key) return true;
        const d = new Date(c.created_at);
        return isWithinInterval(d, { start: w.start, end: w.end });
      });
      const metaCount = comps.reduce(
        (sum: number, c: any) => sum + ((c.compromisso_metas as any[]) || []).length,
        0
      );
      return Math.min(metaCount, 3);
    });
    const compromissosBase = Math.min(weeklyCompromissos.reduce((s, v) => s + v, 0), 12);
    const weeklyCompHit = weeklyCompromissos.map((v) => v > 0);
    // Streak bonus: 2 weeks → +1, 4 → +2, 6 → +3
    let compStreak = 0;
    let compMaxStreak = 0;
    for (const hit of weeklyCompHit) {
      if (hit) { compStreak++; compMaxStreak = Math.max(compMaxStreak, compStreak); }
      else compStreak = 0;
    }
    let compBonus = 0;
    if (compMaxStreak >= 6) compBonus = 3;
    else if (compMaxStreak >= 4) compBonus = 2;
    else if (compMaxStreak >= 2) compBonus = 1;
    const compromissosTotal = Math.min(compromissosBase + compBonus, 15);

    // 6. Feed (max 5)
    const feedWeekly = weeks.map((w) => {
      const hasPost = feedPosts.some((p) => {
        const d = new Date(p.created_at);
        return isWithinInterval(d, { start: w.start, end: w.end });
      });
      const hasLike = feedLikes.some((l) => {
        const d = new Date(l.created_at);
        return isWithinInterval(d, { start: w.start, end: w.end });
      });
      const hasComment = feedComments.some((c) => {
        const d = new Date(c.created_at);
        return isWithinInterval(d, { start: w.start, end: w.end });
      });
      return hasPost || hasLike || hasComment;
    });
    const feedTotal = Math.min(feedWeekly.filter(Boolean).length, 5);

    // 7. Calendário da dieta (max 20)
    let calendarioDietaTotal = 0;
    dietaAdesao.forEach((d) => {
      const dataRegistro = new Date(d.data + "T12:00:00");
      const dataCriacao = new Date(d.created_at);
      const mesmodia = differenceInCalendarDays(dataCriacao, dataRegistro) === 0;
      calendarioDietaTotal += mesmodia ? 1 : 0.5;
    });
    calendarioDietaTotal = Math.min(Math.floor(calendarioDietaTotal), 20);

    const engajamentoTotal = Math.min(
      dedicacaoTotal + progressoTotal + objetivosTotal + valoresTotalPts +
      compromissosTotal + feedTotal + calendarioDietaTotal,
      100
    );

    // ========== PERFORMANCE ==========

    const metaSemanal = alunoPerfil?.meta_semanal_dias || 3;

    // 1. Meta treino semanal (max 15)
    const allTreinoDates = [
      ...registrosTreino.map((r) => r.data),
      ...calendarioTreinos.map((c) => c.data),
    ];
    const weeklyTreinoHit = weeks.map((w) => {
      const count = allTreinoDates.filter((d) => isInWeek(d, w.start, w.end)).length;
      return count >= metaSemanal;
    });
    const treinoBase = Math.min(weeklyTreinoHit.filter(Boolean).length * 3, 12);
    const treinoBonus = calcStreakBonus(weeklyTreinoHit, [1, 2, 3]);
    const treinoTotal = Math.min(treinoBase + treinoBonus, 15);

    // Modalidades: conta tipos distintos (natação, ciclismo, corrida) — max 5
    const modalidadesSet = new Set<string>();
    calendarioTreinos.forEach((c: any) => {
      if (c.tipos && Array.isArray(c.tipos)) {
        c.tipos.forEach((t: string) => {
          const lower = t.toLowerCase();
          if (["natação", "ciclismo", "corrida"].includes(lower)) {
            modalidadesSet.add(lower);
          }
        });
      }
    });
    const modalidadesCount = modalidadesSet.size;
    // 1 modalidade = 2pts, 2 = 3pts, 3 = 5pts
    const modalidadesTotal = modalidadesCount >= 3 ? 5 : modalidadesCount === 2 ? 3 : modalidadesCount === 1 ? 2 : 0;

    // 2. Dieta semanal ≥80% (max 15)
    const weeklyDietaHit = weeks.map((w) => {
      const weekDieta = dietaAdesao.filter((d) => isInWeek(d.data, w.start, w.end));
      if (weekDieta.length === 0) return false;
      const avg = weekDieta.reduce((s, d) => s + d.adesao_percentual, 0) / weekDieta.length;
      return avg >= 80;
    });
    const dietaBase = Math.min(weeklyDietaHit.filter(Boolean).length * 3, 12);
    const dietaBonus = calcStreakBonus(weeklyDietaHit, [1, 2, 3]);
    const dietaTotal = Math.min(dietaBase + dietaBonus, 15);

    // 3. Metas do mês: peso + gordura + músculo (max 25)
    // Inicia em 25 pontos e diminui a cada meta com aferição registrada que não foi atingida.
    // Metas sem aferição/valor não penalizam. Decrementos: 1 não atingida = -9, 2 = -18, 3 = -25.
    let metasNaoAtingidas = 0;
    let metasBatidas = 0;
    if (progressos.length > 0) {
      const latest = progressos[0];
      const checkMeta = (
        atual: number | null | undefined,
        alvo: number | null | undefined,
        dir: string | null | undefined,
        tolerancia: number,
      ) => {
        if (atual == null || alvo == null || !dir) return;
        let atingida = false;
        if (dir === "diminuir") atingida = Number(atual) <= Number(alvo);
        else if (dir === "aumentar") atingida = Number(atual) >= Number(alvo);
        else if (dir === "manter") atingida = Math.abs(Number(atual) - Number(alvo)) <= tolerancia;
        if (atingida) metasBatidas++;
        else metasNaoAtingidas++;
      };
      checkMeta(latest.peso_kg, latest.meta_peso_kg, latest.meta, 1);
      checkMeta(latest.gordura_percentual, latest.meta_gordura_valor, latest.meta_gordura, 0.5);
      checkMeta(latest.musculo_percentual, latest.meta_musculo_valor, latest.meta_musculo, 0.5);
    }
    let metasMesTotal = 25;
    if (metasNaoAtingidas === 1) metasMesTotal = 16;
    else if (metasNaoAtingidas === 2) metasMesTotal = 7;
    else if (metasNaoAtingidas >= 3) metasMesTotal = 0;

    // 4. Conquista semanal preenchida (max 10)
    const weeklyConquista = weeks.map((w) =>
      avaliacoes.some((a) => {
        const d = new Date(a.created_at);
        return isWithinInterval(d, { start: w.start, end: w.end }) && a.conquista && a.conquista.trim();
      })
    );
    const conquistaBase = Math.min(weeklyConquista.filter(Boolean).length * 2, 8);
    const conquistaBonus = calcStreakBonus(weeklyConquista, [1, 2]);
    const conquistaTotal = Math.min(conquistaBase + conquistaBonus, 10);

    // 5. Compromisso cumprido — bateu ≥1 meta na semana (max 10)
    const weeklyCompCumprido = weeks.map((w) => {
      const comps = compromissos.filter((c) => {
        if (c.semana === w.key) return true;
        const d = new Date(c.created_at);
        return isWithinInterval(d, { start: w.start, end: w.end });
      });
      return comps.some((c: any) =>
        ((c.compromisso_metas as any[]) || []).some((m: any) => m.concluida)
      );
    });
    const compCumpridoBase = Math.min(weeklyCompCumprido.filter(Boolean).length * 2, 8);
    const compCumpridoBonus = calcStreakBonus(weeklyCompCumprido, [1, 2]);
    const compCumpridoTotal = Math.min(compCumpridoBase + compCumpridoBonus, 10);

    // 6. Água: média semanal >1500ml (max 5)
    const weeklyAgua = weeks.map((w) => {
      const weekDieta = dietaAdesao.filter((d) => isInWeek(d.data, w.start, w.end));
      if (weekDieta.length === 0) return false;
      const avg = weekDieta.reduce((s, d) => s + (d.agua_ml || 0), 0) / weekDieta.length;
      return avg >= 1500;
    });
    const aguaBase = Math.min(weeklyAgua.filter(Boolean).length, 4);
    const aguaStreakBonus = weeklyAgua.filter(Boolean).length >= 2 ? 1 : 0;
    const aguaTotal = Math.min(aguaBase + aguaStreakBonus, 5);

    // 7. Desafios do mês (max 20) — considera conclusão manual e automática
    const progressoPorDesafio: Record<string, any> = {};
    (desafioProgresso as any[]).forEach((dp: any) => {
      progressoPorDesafio[dp.desafio_id] = dp;
    });

    // Lista de desafios: usa a lista do aluno; complementa com os que já têm progresso
    const desafiosLista: any[] = [...(desafiosAluno as any[])];
    (desafioProgresso as any[]).forEach((dp: any) => {
      if (dp.desafios && !desafiosLista.some((d) => d.id === dp.desafios.id)) {
        desafiosLista.push(dp.desafios);
      }
    });

    const calcAuto = (d: any) => {
      const inicio = d.data_inicio;
      const fim = d.data_fim;
      const meta = d.meta_valor || 0;
      switch (d.tipo) {
        case "sem_doce": {
          const count = (dietaAdesaoAll as any[]).filter(
            (a) => a.data >= inicio && a.data <= fim && a.consumiu_doce
          ).length;
          return { valor: count, meta, isInverse: true };
        }
        case "sem_alcool": {
          const count = (dietaAdesaoAll as any[]).filter(
            (a) => a.data >= inicio && a.data <= fim && a.consumiu_alcool
          ).length;
          return { valor: count, meta, isInverse: true };
        }
        case "consumo_agua": {
          const total = (dietaAdesaoAll as any[])
            .filter((a) => a.data >= inicio && a.data <= fim)
            .reduce((sum, a) => sum + (a.agua_ml || 0), 0);
          return { valor: total, meta, isInverse: false };
        }
        case "numero_treinos": {
          const count = (registrosTreinoAll as any[]).filter(
            (r) => r.data >= inicio && r.data <= fim
          ).length;
          return { valor: count, meta, isInverse: false };
        }
        case "modalidades": {
          const tipos = new Set<string>();
          (calendarioTreinosAll as any[])
            .filter((c) => c.data >= inicio && c.data <= fim)
            .forEach((c) => (c.tipos || []).forEach((t: string) => tipos.add(t)));
          return { valor: tipos.size, meta, isInverse: false };
        }
        case "desempenho_dieta": {
          const entries = (dietaAdesaoAll as any[]).filter(
            (a) => a.data >= inicio && a.data <= fim
          );
          const avg = entries.length
            ? entries.reduce((sum, a) => sum + (a.adesao_percentual || 0), 0) / entries.length
            : 0;
          return { valor: Math.round(avg), meta, isInverse: false };
        }
        default:
          return null;
      }
    };

    const mStart = new Date(year, month, 1);
    const mEnd = endOfMonth(mStart);
    const hoje = new Date();

    const pontosDesafios = desafiosLista.reduce((sum: number, d: any) => {
      if (!d?.data_fim) return sum;
      // O desafio é contabilizado no mês em que termina
      const dEnd = new Date(d.data_fim + "T12:00:00");
      if (dEnd < mStart || dEnd > mEnd) return sum;

      const progresso = progressoPorDesafio[d.id];
      let concluido = !!progresso?.concluido;

      if (!concluido) {
        const auto = calcAuto(d);
        if (auto) {
          const encerrado = dEnd < hoje;
          concluido = auto.isInverse
            ? auto.valor <= auto.meta && encerrado
            : auto.meta > 0 && auto.valor >= auto.meta;
        }
      }

      return concluido ? sum + (d.pontos || 0) : sum;
    }, 0);

    const desafiosTotal = Math.min(pontosDesafios, 20);

    // 8. Penalidade álcool (-5 por dia)
    const diasAlcool = dietaAdesao.filter((d) => d.consumiu_alcool).length;
    const penalidade = diasAlcool * 5;

    const performanceTotal = Math.max(
      0,
      Math.min(
        treinoTotal + dietaTotal + metasMesTotal + conquistaTotal +
        compCumpridoTotal + aguaTotal + desafiosTotal + modalidadesTotal - penalidade,
        100
      )
    );

    const totalGeral = engajamentoTotal + performanceTotal;

    return {
      dedicacaoDiaria: { base: diasPreenchidos, bonus: dedicacaoBonus, total: dedicacaoTotal, max: 25 },
      progressoSemanal: { base: progressoBase / 3, bonus: progressoBonus, total: progressoTotal, max: 15 },
      objetivos: { total: objetivosTotal, max: 10 },
      valores: { total: valoresTotalPts, max: 10 },
      compromissosCriados: { base: compromissosBase, bonus: compBonus, total: compromissosTotal, max: 15 },
      feed: { total: feedTotal, max: 5 },
      calendarioDieta: { total: calendarioDietaTotal, max: 20 },
      engajamentoTotal,

      metaTreino: { base: treinoBase / 3, bonus: treinoBonus, total: treinoTotal, max: 15 },
      dietaSemanal: { base: dietaBase / 3, bonus: dietaBonus, total: dietaTotal, max: 15 },
      metasMes: { total: metasMesTotal, metasBatidas, max: 25 },
      conquistaSemanal: { base: conquistaBase / 2, bonus: conquistaBonus, total: conquistaTotal, max: 10 },
      compromissoCumprido: { base: compCumpridoBase / 2, bonus: compCumpridoBonus, total: compCumpridoTotal, max: 10 },
      agua: { base: aguaBase, bonus: aguaStreakBonus, total: aguaTotal, max: 5 },
      desafios: { total: desafiosTotal, max: 20 },
      penalidade: { total: penalidade, diasAlcool },
      modalidades: { total: modalidadesTotal, count: modalidadesCount, max: 5 },
      performanceTotal,

      totalGeral,
      isLoading,
    };
  }, [
    checkins, avaliacoes, objetivos, valoresData, compromissos,
    feedPosts, feedLikes, feedComments, dietaAdesao, registrosTreino,
    calendarioTreinos, alunoPerfil, progressos, desafioProgresso,
    desafiosAluno, dietaAdesaoAll, registrosTreinoAll, calendarioTreinosAll,
    weeks, year, month, isLoading,
  ]);
}
