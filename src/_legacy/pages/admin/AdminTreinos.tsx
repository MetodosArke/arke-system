import { useState, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Dumbbell, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { NovoTreinoDialog } from "@/components/admin/treinos/NovoTreinoDialog";
import { TreinoCard, type TreinoGrupo } from "@/components/admin/treinos/TreinoCard";
import { TemplatesList } from "@/components/admin/treinos/TemplatesList";
import { useSearchParams } from "react-router-dom";
import { useAcademias } from "@/hooks/useAcademias";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function AdminTreinos() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "vencidos" | "a_vencer">(
    (searchParams.get("filter") as any) || "all"
  );
  const [academiaFilter, setAcademiaFilter] = useState<string>("todas");
  const { academias } = useAcademias();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const f = searchParams.get("filter");
    if (f === "vencidos" || f === "a_vencer") {
      setStatusFilter(f);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  const { data: treinos = [], isLoading } = useQuery({
    queryKey: ["admin-treinos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treinos")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: allProfiles = [] } = useQuery({
    queryKey: ["admin-profiles-map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .order("full_name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: alunos = [] } = useQuery({
    queryKey: ["admin-alunos-select"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data || [];
    },
  });

  const profileMap = useMemo(() => {
    const map = new Map<string, string>();
    allProfiles.forEach((p) => map.set(p.user_id, p.full_name));
    return map;
  }, [allProfiles]);

  const grupos: TreinoGrupo[] = useMemo(() => {
    const map = new Map<string, any[]>();
    treinos.forEach((t: any) => {
      const key = t.grupo_id || t.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    return Array.from(map.entries()).map(([grupoId, items]) => ({
      grupo_id: grupoId,
      titulo: items[0].titulo,
      aluno_nome: profileMap.get(items[0].aluno_id) || "—",
      aluno_id: items[0].aluno_id,
      descricao: items[0].descricao,
      academia_id: items[0].academia_id ?? null,
      validade_inicio: items[0].validade_inicio,
      validade_fim: items[0].validade_fim,
      treinos: items
        .sort((a: any, b: any) => a.tipo.localeCompare(b.tipo))
        .map((t: any) => ({
          id: t.id,
          tipo: t.tipo,
          status: t.status,
          duracao_esperada_min: t.duracao_esperada_min,
          distancia_esperada_km: t.distancia_esperada_km,
          titulo: t.titulo,
        })),
    }));
  }, [treinos, profileMap]);

  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }, []);

  const alunoLatestEnd = useMemo(() => {
    const map = new Map<string, string>();
    grupos.forEach((g) => {
      if (g.validade_fim) {
        const current = map.get(g.aluno_id) || "";
        if (g.validade_fim > current) map.set(g.aluno_id, g.validade_fim);
      }
    });
    return map;
  }, [grupos]);

  const isGrupoExpired = (g: typeof grupos[0]) => {
    if (!g.validade_fim) return false;
    if (g.validade_fim >= today) return false;
    const latestEnd = alunoLatestEnd.get(g.aluno_id);
    return !latestEnd || latestEnd < today;
  };

  const isGrupoExpiringSoon = (g: typeof grupos[0]) => {
    if (!g.validade_fim) return false;
    return g.validade_fim >= today && g.validade_fim <= nextWeek;
  };

  const searchLower = search.toLowerCase();
  const filtered = useMemo(() => {
    let result = grupos;

    if (statusFilter === "vencidos") {
      result = result.filter((g) => isGrupoExpired(g));
    } else if (statusFilter === "a_vencer") {
      result = result.filter((g) => isGrupoExpiringSoon(g));
    }

    if (academiaFilter !== "todas") {
      result = result.filter((g) => (g as any).academia_id === academiaFilter);
    }

    if (search) {
      result = result.filter(
        (g) =>
          g.titulo.toLowerCase().includes(searchLower) ||
          g.aluno_nome.toLowerCase().includes(searchLower)
      );
    }

    return result;
  }, [grupos, statusFilter, search, searchLower, academiaFilter]);

  const deleteGrupo = useMutation({
    mutationFn: async (grupoId: string) => {
      const grupo = grupos.find((g) => g.grupo_id === grupoId);
      if (!grupo) return;
      const ids = grupo.treinos.map((t) => t.id);
      for (const id of ids) {
        await supabase.from("treino_exercicios").delete().eq("treino_id", id);
      }
      await supabase.from("treinos").delete().in("id", ids);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-treinos"] });
      toast({ title: "Treino removido!" });
    },
  });

  const duplicateGrupo = useMutation({
    mutationFn: async (grupoId: string) => {
      const grupo = grupos.find((g) => g.grupo_id === grupoId);
      if (!grupo) return;
      const newGrupoId = crypto.randomUUID();
      for (const t of grupo.treinos) {
        const { data: newTreino } = await supabase
          .from("treinos")
          .insert({
            titulo: `${grupo.titulo} (cópia)`,
            tipo: t.tipo,
            descricao: grupo.descricao,
            aluno_id: grupo.aluno_id,
            validade_inicio: grupo.validade_inicio,
            validade_fim: grupo.validade_fim,
            grupo_id: newGrupoId,
          } as any)
          .select()
          .single();

        if (newTreino) {
          const { data: exs } = await supabase
            .from("treino_exercicios")
            .select("exercicio_id, ordem, series, repeticoes, descanso_seg, observacoes")
            .eq("treino_id", t.id);
          if (exs && exs.length > 0) {
            await supabase.from("treino_exercicios").insert(
              exs.map((ex: any) => ({ ...ex, treino_id: newTreino.id }))
            );
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-treinos"] });
      toast({ title: "Treino duplicado!" });
    },
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 min-w-0 overflow-x-hidden"
    >
      <div>
        <h2 className="text-xl sm:text-2xl font-bold">Treinos</h2>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Gerencie treinos dos alunos e templates reutilizáveis
        </p>
      </div>

      <Tabs defaultValue="treinos" className="w-full">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="treinos" className="flex-1 sm:flex-none text-xs sm:text-sm">
            Treinos
          </TabsTrigger>
          <TabsTrigger value="templates" className="flex-1 sm:flex-none text-xs sm:text-sm">
            Templates Prontos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="treinos" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <NovoTreinoDialog alunos={alunos} />
          </div>

          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar treino ou aluno..."
                  className="pl-10"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={academiaFilter} onValueChange={setAcademiaFilter}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Academia" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as academias</SelectItem>
                  {academias.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {statusFilter !== "all" && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="gap-1 text-xs">
                  {statusFilter === "vencidos" ? "🔴 Treinos vencidos" : "🟡 Treinos a vencer"}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => setStatusFilter("all")} />
                </Badge>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {isLoading ? (
              [1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/50" />
              ))
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center py-12">
                <Dumbbell className="h-10 w-10 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">Nenhum treino encontrado</p>
              </div>
            ) : (
              filtered.map((grupo) => (
                <TreinoCard
                  key={grupo.grupo_id}
                  grupo={grupo}
                  onDuplicate={(id) => duplicateGrupo.mutate(id)}
                  onDelete={(id) => deleteGrupo.mutate(id)}
                  isExpired={isGrupoExpired(grupo)}
                  alunos={alunos}
                />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <TemplatesList alunos={alunos} />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
