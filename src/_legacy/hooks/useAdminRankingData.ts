import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import {
  startOfMonth, endOfMonth, format, differenceInCalendarDays,
  endOfWeek, eachWeekOfInterval, isWithinInterval, getISOWeek, getYear,
} from "date-fns";

function getWeeksInMonth(year: number, month: number) {
  const monthStart = startOfMonth(new Date(year, month, 1));
  const monthEnd = endOfMonth(new Date(year, month, 1));
  const weeks = eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 1 });
  return weeks.map((ws) => ({
    start: ws,
    end: endOfWeek(ws, { weekStartsOn: 1 }),
    key: `${getYear(ws)}-W${getISOWeek(ws)}`,
  }));
}

function isInWeek(dateStr: string, ws: Date, we: Date) {
  return isWithinInterval(new Date(dateStr + "T12:00:00"), { start: ws, end: we });
}

function calcStreakBonus(hits: boolean[], table: number[]): number {
  let streak = 0, max = 0;
  for (const h of hits) { if (h) { streak++; max = Math.max(max, streak); } else streak = 0; }
  let bonus = 0;
  for (let i = table.length - 1; i >= 0; i--) { if (max >= i + 2) { bonus = table[i]; break; } }
  return bonus;
}

export interface RankingAluno {
  userId: string;
  nome: string;
  avatarUrl: string | null;
  engajamento: number;
  performance: number;
  total: number;
  // Specialized metrics
  kmCorridos: number;
  kmNatacao: number;
  kmCiclismo: number;
  kmCorrida: number;
  treinosRealizados: number;
  dietaMedia: number;
  modalidades: number;
  gorduraPercentual: number | null;
  musculoPercentual: number | null;
}

export function useAdminRankingData(year: number, month: number) {
  const monthStart = format(new Date(year, month, 1), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(new Date(year, month, 1)), "yyyy-MM-dd");
  const weeks = useMemo(() => getWeeksInMonth(year, month), [year, month]);

  // Fetch all alunos
  const { data: profiles = [] } = useQuery({
    queryKey: ["ranking-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, avatar_url");
      return data || [];
    },
  });

  // Fetch aluno role user_ids
  const { data: alunoRoles = [] } = useQuery({
    queryKey: ["ranking-aluno-roles"],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("user_id").eq("role", "aluno");
      return data || [];
    },
  });

  // Bulk data fetches
  const { data: allCheckins = [], isLoading: l1 } = useQuery({
    queryKey: ["ranking-checkins", monthStart],
    queryFn: async () => {
      const { data } = await supabase.from("checkin_diario").select("user_id, data").gte("data", monthStart).lte("data", monthEnd);
      return data || [];
    },
  });

  const { data: allAvaliacoes = [], isLoading: l2 } = useQuery({
    queryKey: ["ranking-avaliacoes", monthStart],
    queryFn: async () => {
      const { data } = await supabase.from("avaliacao_semanal").select("user_id, semana, conquista, created_at");
      return (data || []).filter((a) => {
        const d = new Date(a.created_at);
        return d.getMonth() === month && d.getFullYear() === year;
      });
    },
  });

  const { data: allObjetivos = [] } = useQuery({
    queryKey: ["ranking-objetivos"],
    queryFn: async () => {
      const { data } = await supabase.from("aluno_objetivos").select("user_id, objetivos, proxima_revisao");
      return data || [];
    },
  });

  const { data: allValores = [] } = useQuery({
    queryKey: ["ranking-valores"],
    queryFn: async () => {
      const { data } = await supabase.from("aluno_valores").select("user_id, valores, validade");
      return data || [];
    },
  });

  const { data: allCompromissos = [] } = useQuery({
    queryKey: ["ranking-compromissos", monthStart],
    queryFn: async () => {
      const { data } = await supabase.from("compromisso_semanal").select("user_id, semana, created_at, compromisso_metas(concluida)");
      return data || [];
    },
  });

  const { data: allFeedPosts = [] } = useQuery({
    queryKey: ["ranking-feed-posts", monthStart],
    queryFn: async () => {
      const { data } = await supabase.from("feed_posts").select("user_id, created_at").gte("created_at", monthStart + "T00:00:00").lte("created_at", monthEnd + "T23:59:59");
      return data || [];
    },
  });

  const { data: allFeedLikes = [] } = useQuery({
    queryKey: ["ranking-feed-likes", monthStart],
    queryFn: async () => {
      const { data } = await supabase.from("feed_likes").select("user_id, created_at").gte("created_at", monthStart + "T00:00:00").lte("created_at", monthEnd + "T23:59:59");
      return data || [];
    },
  });

  const { data: allFeedComments = [] } = useQuery({
    queryKey: ["ranking-feed-comments", monthStart],
    queryFn: async () => {
      const { data } = await supabase.from("feed_comments").select("user_id, created_at").gte("created_at", monthStart + "T00:00:00").lte("created_at", monthEnd + "T23:59:59");
      return data || [];
    },
  });

  const { data: allDietaAdesao = [], isLoading: l3 } = useQuery({
    queryKey: ["ranking-dieta", monthStart],
    queryFn: async () => {
      const { data } = await supabase.from("dieta_adesao").select("aluno_id, data, adesao_percentual, agua_ml, consumiu_alcool, created_at").gte("data", monthStart).lte("data", monthEnd);
      return data || [];
    },
  });

  const { data: allRegistroTreino = [] } = useQuery({
    queryKey: ["ranking-registro-treino", monthStart],
    queryFn: async () => {
      const { data } = await supabase.from("registro_treino").select("aluno_id, data").gte("data", monthStart).lte("data", monthEnd);
      return data || [];
    },
  });

  const { data: allCalendarioTreinos = [] } = useQuery({
    queryKey: ["ranking-calendario-treino", monthStart],
    queryFn: async () => {
      const { data } = await supabase.from("treino_calendario").select("aluno_id, data, tipos, distancia_km").gte("data", monthStart).lte("data", monthEnd);
      return data || [];
    },
  });

  const { data: allPerfil = [] } = useQuery({
    queryKey: ["ranking-aluno-perfil"],
    queryFn: async () => {
      const { data } = await supabase.from("aluno_perfil").select("user_id, meta_semanal_dias");
      return data || [];
    },
  });

  const { data: allProgressos = [] } = useQuery({
    queryKey: ["ranking-progressos", monthStart],
    queryFn: async () => {
      const { data } = await supabase.from("progresso_semanal").select("aluno_id, data, peso_kg, meta_peso_kg, meta, gordura_percentual, meta_gordura_valor, meta_gordura, musculo_percentual, meta_musculo_valor, meta_musculo").gte("data", monthStart).lte("data", monthEnd).order("data", { ascending: false });
      return data || [];
    },
  });

  const { data: allDesafioProgresso = [] } = useQuery({
    queryKey: ["ranking-desafio-progresso"],
    queryFn: async () => {
      const { data } = await supabase.from("desafio_progresso").select("aluno_id, concluido, desafios(data_inicio, data_fim, pontos)");
      return data || [];
    },
  });

  const isLoading = l1 || l2 || l3;

  const rankings = useMemo<RankingAluno[]>(() => {
    const alunoIds = new Set(alunoRoles.map((r) => r.user_id));
    const alunoProfiles = profiles.filter((p) => alunoIds.has(p.user_id));

    return alunoProfiles.map((profile) => {
      const uid = profile.user_id;

      // Filter data for this user
      const checkins = allCheckins.filter((c) => c.user_id === uid);
      const avaliacoes = allAvaliacoes.filter((a) => a.user_id === uid);
      const objetivos = allObjetivos.find((o) => o.user_id === uid);
      const valores = allValores.find((v) => v.user_id === uid);
      const compromissos = allCompromissos.filter((c) => c.user_id === uid);
      const feedPosts = allFeedPosts.filter((p) => p.user_id === uid);
      const feedLikes = allFeedLikes.filter((l) => l.user_id === uid);
      const feedComments = allFeedComments.filter((c) => c.user_id === uid);
      const dietaAdesao = allDietaAdesao.filter((d) => d.aluno_id === uid);
      const registros = allRegistroTreino.filter((r) => r.aluno_id === uid);
      const calendario = allCalendarioTreinos.filter((c) => c.aluno_id === uid);
      const perfil = allPerfil.find((p) => p.user_id === uid);
      const progressos = allProgressos.filter((p) => p.aluno_id === uid);
      const desafioP = allDesafioProgresso.filter((d) => d.aluno_id === uid);

      // === ENGAGEMENT ===
      const diasPreenchidos = Math.min(checkins.length, 15);
      let maxConsec = 0, curStreak = 0;
      const sorted = checkins.map((c) => c.data).sort();
      for (let i = 0; i < sorted.length; i++) {
        if (i === 0) curStreak = 1;
        else {
          const diff = differenceInCalendarDays(new Date(sorted[i] + "T12:00:00"), new Date(sorted[i - 1] + "T12:00:00"));
          curStreak = diff === 1 ? curStreak + 1 : 1;
        }
        maxConsec = Math.max(maxConsec, curStreak);
      }
      const dedTotal = Math.min(diasPreenchidos + Math.min(Math.floor(maxConsec / 2), 10), 25);

      const weeklyAval = weeks.map((w) => avaliacoes.some((a) => isWithinInterval(new Date(a.created_at), { start: w.start, end: w.end })));
      const progBase = Math.min(weeklyAval.filter(Boolean).length * 3, 12);
      const progTotal = Math.min(progBase + calcStreakBonus(weeklyAval, [1, 2, 3]), 15);

      let objTotal = 0;
      if (objetivos) {
        const rev = objetivos.proxima_revisao ? new Date(objetivos.proxima_revisao + "T12:00:00") : null;
        if (!rev || rev >= new Date(year, month, 1)) {
          const cnt = (objetivos.objetivos || []).filter((o: string) => o?.trim()).length;
          objTotal = cnt >= 3 ? 10 : cnt === 2 ? 7 : cnt === 1 ? 4 : 0;
        }
      }

      let valTotal = 0;
      if (valores?.valores && valores.valores.length >= 3) {
        const val = valores.validade ? new Date(valores.validade + "T12:00:00") : null;
        if (!val || val >= new Date(year, month, 1)) valTotal = 10;
      }

      const weeklyComp = weeks.map((w) => {
        const comps = compromissos.filter((c) => c.semana === w.key || isWithinInterval(new Date(c.created_at), { start: w.start, end: w.end }));
        return Math.min(comps.reduce((s: number, c: any) => s + ((c.compromisso_metas as any[]) || []).length, 0), 3);
      });
      const compBase = Math.min(weeklyComp.reduce((s, v) => s + v, 0), 12);
      const compHit = weeklyComp.map((v) => v > 0);
      let cStrk = 0, cMax = 0;
      for (const h of compHit) { if (h) { cStrk++; cMax = Math.max(cMax, cStrk); } else cStrk = 0; }
      const cBonus = cMax >= 6 ? 3 : cMax >= 4 ? 2 : cMax >= 2 ? 1 : 0;
      const compTotal = Math.min(compBase + cBonus, 15);

      const feedW = weeks.map((w) => {
        const has = (arr: any[]) => arr.some((x) => isWithinInterval(new Date(x.created_at), { start: w.start, end: w.end }));
        return has(feedPosts) || has(feedLikes) || has(feedComments);
      });
      const feedTotal = Math.min(feedW.filter(Boolean).length, 5);

      let calDietaTotal = 0;
      dietaAdesao.forEach((d) => {
        const diff = differenceInCalendarDays(new Date(d.created_at), new Date(d.data + "T12:00:00"));
        calDietaTotal += diff === 0 ? 1 : 0.5;
      });
      calDietaTotal = Math.min(Math.floor(calDietaTotal), 20);

      const engajamento = Math.min(dedTotal + progTotal + objTotal + valTotal + compTotal + feedTotal + calDietaTotal, 100);

      // === PERFORMANCE ===
      const metaSemanal = perfil?.meta_semanal_dias || 3;
      const allTDates = [...registros.map((r) => r.data), ...calendario.map((c) => c.data)];
      const wTreino = weeks.map((w) => allTDates.filter((d) => isInWeek(d, w.start, w.end)).length >= metaSemanal);
      const tBase = Math.min(wTreino.filter(Boolean).length * 3, 12);
      const tTotal = Math.min(tBase + calcStreakBonus(wTreino, [1, 2, 3]), 15);

      const wDieta = weeks.map((w) => {
        const wd = dietaAdesao.filter((d) => isInWeek(d.data, w.start, w.end));
        return wd.length > 0 && wd.reduce((s, d) => s + d.adesao_percentual, 0) / wd.length >= 80;
      });
      const dBase = Math.min(wDieta.filter(Boolean).length * 3, 12);
      const dTotal = Math.min(dBase + calcStreakBonus(wDieta, [1, 2, 3]), 15);

      let metasNaoAtingidas = 0;
      if (progressos.length > 0) {
        const l = progressos[0];
        if (l.peso_kg != null && l.meta_peso_kg != null && l.meta) {
          const ok = (l.meta === "diminuir" && l.peso_kg <= l.meta_peso_kg) || (l.meta === "aumentar" && l.peso_kg >= l.meta_peso_kg) || (l.meta === "manter" && Math.abs(Number(l.peso_kg) - Number(l.meta_peso_kg)) <= 1);
          if (!ok) metasNaoAtingidas++;
        }
        if (l.gordura_percentual != null && l.meta_gordura_valor != null && l.meta_gordura) {
          const ok = (l.meta_gordura === "diminuir" && l.gordura_percentual <= l.meta_gordura_valor) || (l.meta_gordura === "aumentar" && l.gordura_percentual >= l.meta_gordura_valor) || (l.meta_gordura === "manter" && Math.abs(Number(l.gordura_percentual) - Number(l.meta_gordura_valor)) <= 0.5);
          if (!ok) metasNaoAtingidas++;
        }
        if (l.musculo_percentual != null && l.meta_musculo_valor != null && l.meta_musculo) {
          const ok = (l.meta_musculo === "diminuir" && l.musculo_percentual <= l.meta_musculo_valor) || (l.meta_musculo === "aumentar" && l.musculo_percentual >= l.meta_musculo_valor) || (l.meta_musculo === "manter" && Math.abs(Number(l.musculo_percentual) - Number(l.meta_musculo_valor)) <= 0.5);
          if (!ok) metasNaoAtingidas++;
        }
      }
      const metasMes = metasNaoAtingidas === 0 ? 25 : metasNaoAtingidas === 1 ? 16 : metasNaoAtingidas === 2 ? 7 : 0;

      const wConq = weeks.map((w) => avaliacoes.some((a) => isWithinInterval(new Date(a.created_at), { start: w.start, end: w.end }) && a.conquista?.trim()));
      const conqTotal = Math.min(Math.min(wConq.filter(Boolean).length * 2, 8) + calcStreakBonus(wConq, [1, 2]), 10);

      const wCompC = weeks.map((w) => {
        const cs = compromissos.filter((c) => c.semana === w.key || isWithinInterval(new Date(c.created_at), { start: w.start, end: w.end }));
        return cs.some((c: any) => ((c.compromisso_metas as any[]) || []).some((m: any) => m.concluida));
      });
      const compCTotal = Math.min(Math.min(wCompC.filter(Boolean).length * 2, 8) + calcStreakBonus(wCompC, [1, 2]), 10);

      const wAgua = weeks.map((w) => {
        const wd = dietaAdesao.filter((d) => isInWeek(d.data, w.start, w.end));
        return wd.length > 0 && wd.reduce((s, d) => s + (d.agua_ml || 0), 0) / wd.length >= 1500;
      });
      const aguaTotal = Math.min(Math.min(wAgua.filter(Boolean).length, 4) + (wAgua.filter(Boolean).length >= 2 ? 1 : 0), 5);

      const mStart = new Date(year, month, 1);
      const mEnd = endOfMonth(mStart);
      const desafiosTotal = Math.min(
        desafioP.filter((dp: any) => {
          const d = dp.desafios;
          if (!d || !dp.concluido) return false;
          return new Date(d.data_inicio + "T12:00:00") <= mEnd && new Date(d.data_fim + "T12:00:00") >= mStart;
        }).reduce((s: number, dp: any) => s + (dp.desafios?.pontos || 0), 0),
        20
      );

      const diasAlcool = dietaAdesao.filter((d) => d.consumiu_alcool).length;

      // Modalidades bonus in performance
      const modalidadesSet2 = new Set<string>();
      calendario.forEach((c: any) => {
        if (c.tipos && Array.isArray(c.tipos)) {
          c.tipos.forEach((t: string) => {
            const lower = t.toLowerCase();
            if (["natação", "ciclismo", "corrida"].includes(lower)) modalidadesSet2.add(lower);
          });
        }
      });
      const modCount = modalidadesSet2.size;
      const modalidadesBonus = modCount >= 3 ? 5 : modCount === 2 ? 3 : modCount === 1 ? 2 : 0;

      const performance = Math.max(0, Math.min(tTotal + dTotal + metasMes + conqTotal + compCTotal + aguaTotal + desafiosTotal + modalidadesBonus - diasAlcool * 5, 100));

      // Specialized metrics
      let kmCorridos = 0;
      let kmNatacao = 0;
      let kmCiclismo = 0;
      let kmCorrida = 0;
      const modalidadesSet = new Set<string>();
      calendario.forEach((c: any) => {
        const dist = c.distancia_km ? parseFloat(c.distancia_km) : 0;
        if (dist > 0) kmCorridos += dist;
        if (c.tipos && Array.isArray(c.tipos)) {
          c.tipos.forEach((t: string) => {
            const lower = t.toLowerCase();
            if (["natação", "ciclismo", "corrida"].includes(lower)) {
              modalidadesSet.add(lower);
              if (lower === "natação") kmNatacao += dist;
              else if (lower === "ciclismo") kmCiclismo += dist;
              else if (lower === "corrida") kmCorrida += dist;
            }
          });
        }
      });
      const modalidades = modalidadesSet.size;

      const treinosRealizados = allTDates.length;

      const dietaMedia = dietaAdesao.length > 0 ? Math.round(dietaAdesao.reduce((s, d) => s + d.adesao_percentual, 0) / dietaAdesao.length) : 0;

      const latestProgresso = progressos.length > 0 ? progressos[0] : null;
      const gorduraPercentual = latestProgresso?.gordura_percentual != null ? Number(latestProgresso.gordura_percentual) : null;
      const musculoPercentual = latestProgresso?.musculo_percentual != null ? Number(latestProgresso.musculo_percentual) : null;

      return {
        userId: uid,
        nome: profile.full_name || "Sem nome",
        avatarUrl: profile.avatar_url,
        engajamento,
        performance,
        total: engajamento + performance,
        kmCorridos,
        kmNatacao,
        kmCiclismo,
        kmCorrida,
        treinosRealizados,
        dietaMedia,
        modalidades,
        gorduraPercentual,
        musculoPercentual,
      };
    });
  }, [profiles, alunoRoles, allCheckins, allAvaliacoes, allObjetivos, allValores, allCompromissos, allFeedPosts, allFeedLikes, allFeedComments, allDietaAdesao, allRegistroTreino, allCalendarioTreinos, allPerfil, allProgressos, allDesafioProgresso, weeks, year, month]);

  return { rankings, isLoading };
}
