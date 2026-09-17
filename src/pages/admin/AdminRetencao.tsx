import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Users, UserMinus, Activity } from "lucide-react";

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

export default function AdminRetencao() {
  const { organization } = useAuth();

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
