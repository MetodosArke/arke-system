import { diaBrasilia } from "@/lib/dataBrasilia";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todasAsLinhas } from "@/lib/paginar";
import { perfisDosUsuarios } from "@/lib/perfis";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Users, UserMinus, Activity, AlertTriangle, HeartPulse, CalendarX2, Trophy } from "lucide-react";

const FASES: { key: "alunos_fase_mapa" | "alunos_fase_base" | "alunos_fase_rota" | "alunos_fase_apex" | "alunos_fase_legado"; label: string }[] = [
  { key: "alunos_fase_mapa", label: "M.A.P.A.®" },
  { key: "alunos_fase_base", label: "B.A.S.E.®" },
  { key: "alunos_fase_rota", label: "R.O.T.A.®" },
  { key: "alunos_fase_apex", label: "A.P.E.X.®" },
  { key: "alunos_fase_legado", label: "L.E.G.A.D.O.®" },
];

function StatTile({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="h-4.5 w-4.5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

interface AlunoRisco {
  aluno_id: string;
  nome: string;
  motivo: "sem_treino" | "dor";
  detalhe: string;
}

interface AlunoEngajamento {
  aluno_id: string;
  nome: string;
  pontuacao: number;
}

function corPontuacao(pontuacao: number) {
  if (pontuacao >= 70) return "text-emerald-600";
  if (pontuacao >= 40) return "text-amber-500";
  return "text-red-500";
}

export default function AdminRetencao() {
  const { organization } = useAuth();
  const navigate = useNavigate();

  const { data: alunosRisco = [], isLoading: isLoadingRisco } = useQuery({
    queryKey: ["retencao-alunos-risco", organization?.id],
    queryFn: async () => {
      const cincoDiasIso = diaBrasilia(-5);

      // Em páginas: cinco dias de treino de uma academia de 500 alunos já
      // passam de mil registros, e quem treinou apareceria "em risco".
      const [alunosAtivos, registros, tarefasDor] = await Promise.all([
        todasAsLinhas((de, ate) =>
          supabase.from("alunos").select("id, user_id").eq("organization_id", organization!.id).order("id").range(de, ate)
        ),
        todasAsLinhas((de, ate) =>
          supabase
            .from("registro_treino")
            .select("aluno_id, data")
            .eq("organization_id", organization!.id)
            .gte("data", cincoDiasIso)
            .order("id")
            .range(de, ate)
        ),
        todasAsLinhas((de, ate) =>
          supabase
            .from("tarefas")
            .select("aluno_id, motivo")
            .eq("organization_id", organization!.id)
            .eq("tipo", "dor")
            .in("status", ["aberta", "em_andamento", "aguardando"])
            .order("id")
            .range(de, ate)
        ),
      ]);

      const perfis = await perfisDosUsuarios(alunosAtivos.map((a) => a.user_id));

      const treinouRecente = new Set(registros.map((r) => r.aluno_id));
      const alunoIdComDor = new Map(tarefasDor.map((t) => [t.aluno_id, t.motivo]));

      const risco: AlunoRisco[] = [];
      for (const aluno of alunosAtivos) {
        const nome = perfis.get(aluno.user_id)?.full_name ?? "—";
        if (alunoIdComDor.has(aluno.id)) {
          risco.push({ aluno_id: aluno.id, nome, motivo: "dor", detalhe: alunoIdComDor.get(aluno.id)! });
        } else if (!treinouRecente.has(aluno.id)) {
          risco.push({ aluno_id: aluno.id, nome, motivo: "sem_treino", detalhe: "5+ dias sem registrar treino" });
        }
      }
      return risco;
    },
    enabled: !!organization?.id,
  });

  // Pontuação de engajamento (Etapa K/M) — mesma fórmula do card que o
  // aluno vê no próprio app, aqui por aluno, pra equipe agir antes de
  // virar cancelamento. Ordenado do mais baixo pro mais alto: quem
  // precisa de atenção aparece primeiro.
  const { data: engajamento = [], isLoading: isLoadingEngajamento } = useQuery({
    queryKey: ["retencao-engajamento-alunos", organization?.id],
    queryFn: async () => {
      const [pontuacoes, alunosData] = await Promise.all([
        todasAsLinhas((de, ate) => supabase.rpc("obter_engajamento_alunos_organizacao").order("aluno_id").range(de, ate)),
        todasAsLinhas((de, ate) =>
          supabase.from("alunos").select("id, user_id").eq("organization_id", organization!.id).order("id").range(de, ate)
        ),
      ]);

      const userIdByAlunoId = new Map(alunosData.map((a) => [a.id, a.user_id]));
      const perfis = await perfisDosUsuarios(Array.from(userIdByAlunoId.values()));

      const lista: AlunoEngajamento[] = pontuacoes.map((p) => ({
        aluno_id: p.aluno_id,
        nome: perfis.get(userIdByAlunoId.get(p.aluno_id) ?? "")?.full_name ?? "—",
        pontuacao: Math.round(Number(p.pontuacao ?? 0)),
      }));
      return lista.sort((a, b) => a.pontuacao - b.pontuacao);
    },
    enabled: !!organization?.id,
  });

  const { data: metrics, isLoading } = useQuery({
    queryKey: ["org-churn-metrics", organization?.id],
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

  const totalAlunos = metrics?.alunos_total ?? 0;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Retenção &amp; Jornada</h1>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Alunos em risco (MQV)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Alunos com 5+ dias sem registrar treino ou com relato de dor/desconforto ainda em aberto.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoadingRisco && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {!isLoadingRisco && alunosRisco.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum aluno em risco no momento. 🎉</p>
          )}
          {alunosRisco.map((a) => (
            <div key={`${a.aluno_id}-${a.motivo}`} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
              <div className="flex items-center gap-2 min-w-0">
                {a.motivo === "dor" ? (
                  <HeartPulse className="h-4 w-4 text-red-500 shrink-0" />
                ) : (
                  <CalendarX2 className="h-4 w-4 text-amber-500 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{a.nome}</p>
                  <p className="text-xs text-muted-foreground truncate">{a.detalhe}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant={a.motivo === "dor" ? "destructive" : "outline"}>
                  {a.motivo === "dor" ? "Dor" : "Sem treino"}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => navigate("/admin")}>
                  Ver na Fila
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" /> Engajamento do Mês por Aluno
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Mesma pontuação (treino, check-in, adesão à dieta e água) que o aluno vê no próprio app — aqui pra
            equipe identificar quem está caindo antes de virar cancelamento.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoadingEngajamento && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {!isLoadingEngajamento && engajamento.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum aluno cadastrado ainda.</p>
          )}
          {engajamento.slice(0, 10).map((a) => (
            <div key={a.aluno_id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
              <span className="text-sm font-medium truncate">{a.nome}</span>
              <span className={`text-sm font-bold ${corPontuacao(a.pontuacao)}`}>{a.pontuacao}/100</span>
            </div>
          ))}
          {engajamento.length > 10 && (
            <p className="text-xs text-muted-foreground pt-1">
              Mostrando os 10 alunos com menor engajamento, de {engajamento.length} no total.
            </p>
          )}
        </CardContent>
      </Card>

      {metrics && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile icon={Users} label="Alunos ativos" value={totalAlunos} />
            <StatTile icon={Activity} label="Assinaturas ativas" value={metrics.assinaturas_ativas ?? 0} />
            <StatTile icon={UserMinus} label="Cancelamentos (mês)" value={metrics.cancelamentos_mes_atual ?? 0} />
            <StatTile icon={TrendingUp} label="Constância (7 dias)" value={`${metrics.constancia_pct_7d ?? 0}%`} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Alunos por fase da jornada</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {FASES.map(({ key, label }) => {
                const valor = Number(metrics[key] ?? 0);
                const pct = totalAlunos > 0 ? Math.round((valor / totalAlunos) * 100) : 0;
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium">{label}</span>
                      <span className="text-muted-foreground">{valor} aluno(s) · {pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {totalAlunos === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum aluno cadastrado ainda.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
