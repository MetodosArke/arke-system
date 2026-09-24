import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Filter, AlertTriangle, CalendarX } from "lucide-react";
import { decimal } from "@/lib/numeros";

type PontoFunil = {
  safra: string;
  total_entradas: number;
  em_trial: number;
  ativos: number;
  inadimplentes: number;
  suspensos: number;
  cancelados: number;
  taxa_conversao_pct: number;
  taxa_churn_pct: number;
};

type SinaisFunil = {
  trials_total: number;
  trials_sem_prazo: number;
  trials_vencidos: number;
  inadimplentes: number;
  suspensos: number;
  transicoes_30d: number;
};

const PERIODOS = [
  { valor: 6, label: "6 meses" },
  { valor: 12, label: "12 meses" },
  { valor: 24, label: "24 meses" },
] as const;

const formatarMesCurto = (mes: string) => {
  const [ano, mesNum] = mes.split("-");
  const data = new Date(Number(ano), Number(mesNum) - 1, 1);
  return data.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
};

function SinalTile({
  icon: Icon,
  valor,
  label,
  detalhe,
  alerta,
}: {
  icon: typeof AlertTriangle;
  valor: number;
  label: string;
  detalhe?: string;
  alerta?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        alerta && valor > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-border"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Icon
          className={`h-3.5 w-3.5 ${alerta && valor > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
        />
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="text-lg font-bold mt-0.5">{valor}</p>
      {detalhe && <p className="text-[11px] text-muted-foreground leading-snug">{detalhe}</p>}
    </div>
  );
}

export function FunilConversaoCard() {
  const [meses, setMeses] = useState<number>(12);

  const {
    data: safras = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["superadmin-funil-conversao", meses],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_funil_conversao", { _meses: meses });
      if (error) throw error;
      return (data ?? []) as PontoFunil[];
    },
  });

  const { data: sinais } = useQuery({
    queryKey: ["superadmin-funil-sinais"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_funil_sinais");
      if (error) throw error;
      return (data?.[0] ?? null) as SinaisFunil | null;
    },
  });

  const dadosGrafico = useMemo(
    () =>
      safras.map((s) => ({
        safra: formatarMesCurto(s.safra),
        Ativos: Number(s.ativos),
        "Em trial": Number(s.em_trial),
        Inadimplentes: Number(s.inadimplentes),
        Suspensos: Number(s.suspensos),
        Cancelados: Number(s.cancelados),
      })),
    [safras]
  );

  // Acumulado do período: dá a taxa de conversão geral da carteira, que é a
  // leitura que interessa quando cada safra tem poucas entradas.
  const totais = useMemo(() => {
    const soma = safras.reduce(
      (acc, s) => ({
        entradas: acc.entradas + Number(s.total_entradas),
        ativos: acc.ativos + Number(s.ativos),
        cancelados: acc.cancelados + Number(s.cancelados),
        trial: acc.trial + Number(s.em_trial),
      }),
      { entradas: 0, ativos: 0, cancelados: 0, trial: 0 }
    );
    return {
      ...soma,
      conversao: soma.entradas > 0 ? (soma.ativos / soma.entradas) * 100 : 0,
      churn: soma.entradas > 0 ? (soma.cancelados / soma.entradas) * 100 : 0,
    };
  }, [safras]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" /> Funil de Conversão da Carteira
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Cada barra é uma safra de entrada (mês em que a organização foi cadastrada), dividida pelo status em
              que ela está hoje.
            </p>
          </div>
          <Tabs value={String(meses)} onValueChange={(v) => setMeses(Number(v))} className="shrink-0">
            <TabsList>
              {PERIODOS.map((p) => (
                <TabsTrigger key={p.valor} value={String(p.valor)} className="text-xs">
                  {p.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p className="text-sm text-destructive py-6 text-center">
            Não foi possível carregar o funil: {(error as Error).message}
          </p>
        )}

        {!error && isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Carregando...</p>}

        {!error && !isLoading && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Entradas no período</p>
                <p className="text-lg font-bold">{totais.entradas}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Conversão para ativo</p>
                <p className="text-lg font-bold">{decimal(totais.conversao, 1)}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Churn (cancelados)</p>
                <p className="text-lg font-bold">{decimal(totais.churn, 1)}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ainda em trial</p>
                <p className="text-lg font-bold">{totais.trial}</p>
              </div>
            </div>

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dadosGrafico} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="safra" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "0.5rem",
                      fontSize: "12px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="Ativos" stackId="s" fill="hsl(var(--primary))" />
                  <Bar dataKey="Em trial" stackId="s" fill="hsl(var(--primary) / 0.4)" />
                  <Bar dataKey="Inadimplentes" stackId="s" fill="hsl(38 92% 50%)" />
                  <Bar dataKey="Suspensos" stackId="s" fill="hsl(var(--muted-foreground) / 0.5)" />
                  <Bar dataKey="Cancelados" stackId="s" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {sinais && (
              <div className="space-y-2">
                <p className="text-xs font-medium">Onde a carteira está vazando agora</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <SinalTile
                    icon={CalendarX}
                    valor={Number(sinais.trials_sem_prazo)}
                    label="Trials sem prazo"
                    detalhe="Não vencem nem cobram sozinhos"
                    alerta
                  />
                  <SinalTile
                    icon={AlertTriangle}
                    valor={Number(sinais.trials_vencidos)}
                    label="Trials vencidos"
                    detalhe="Passaram da data e seguem em trial"
                    alerta
                  />
                  <SinalTile
                    icon={AlertTriangle}
                    valor={Number(sinais.inadimplentes)}
                    label="Inadimplentes"
                    alerta
                  />
                  <SinalTile
                    icon={Filter}
                    valor={Number(sinais.transicoes_30d)}
                    label="Mudanças de status (30d)"
                  />
                </div>
                {Number(sinais.trials_sem_prazo) > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Trial sem data limite não vence, não gera cobrança e não entra em nenhuma fila — fica parado
                    até alguém lembrar dele na mão. Dá para definir a data em Editar Informações do tenant.
                  </p>
                )}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              A coorte acima compara a safra de entrada com o status de hoje, e por isso já vale retroativamente. O
              registro de <strong>quando</strong> cada mudança de status aconteceu passou a ser gravado agora, então
              a contagem de mudanças começa do zero e cresce a partir desta semana.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
