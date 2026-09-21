import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type PontoHistorico = {
  mes: string;
  receita_metodo_arke: number;
  receita_mensalidades: number;
  receita_b2b: number;
  receita_total: number;
  repasse_arke: number;
  mrr_contratado: number | null;
  arr_contratado: number | null;
};

const PERIODOS = [
  { valor: 6, label: "6 meses" },
  { valor: 12, label: "12 meses" },
  { valor: 24, label: "24 meses" },
] as const;

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarMoedaCompacta = (valor: number) =>
  valor >= 1000 ? `R$ ${(valor / 1000).toFixed(valor >= 10000 ? 0 : 1)}k` : `R$ ${valor.toFixed(0)}`;

const formatarMesCurto = (mes: string) => {
  // mes vem como 'YYYY-MM-DD' (primeiro dia). Monta a data em UTC para não
  // cair no mês anterior por causa do fuso de Brasília.
  const [ano, mesNum] = mes.split("-");
  const data = new Date(Number(ano), Number(mesNum) - 1, 1);
  return data.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
};

function VariacaoBadge({ atual, anterior }: { atual: number; anterior: number | null }) {
  if (anterior === null || anterior === 0) {
    return <span className="text-xs text-muted-foreground">sem base de comparação</span>;
  }
  const variacao = ((atual - anterior) / anterior) * 100;
  const Icon = variacao > 0 ? TrendingUp : variacao < 0 ? TrendingDown : Minus;
  const cor = variacao > 0 ? "text-emerald-600" : variacao < 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={`text-xs font-medium flex items-center gap-1 ${cor}`}>
      <Icon className="h-3 w-3" />
      {variacao > 0 ? "+" : ""}
      {variacao.toFixed(1)}% vs. mês anterior
    </span>
  );
}

export function ReceitaHistoricoCard() {
  const [meses, setMeses] = useState<number>(12);

  const { data: serie = [], isLoading, error } = useQuery({
    queryKey: ["superadmin-receita-historica", meses],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_receita_historica", { _meses: meses });
      if (error) throw error;
      return (data ?? []) as PontoHistorico[];
    },
  });

  const dadosGrafico = useMemo(
    () =>
      serie.map((p) => ({
        mes: formatarMesCurto(p.mes),
        "Método ARKE": Number(p.receita_metodo_arke),
        Mensalidades: Number(p.receita_mensalidades),
        "Assinatura B2B": Number(p.receita_b2b),
        "Repasse ARKE (líquido)": Number(p.repasse_arke),
        "MRR contratado": p.mrr_contratado === null ? null : Number(p.mrr_contratado),
      })),
    [serie]
  );

  const ultimo = serie.length > 0 ? serie[serie.length - 1] : null;
  const penultimo = serie.length > 1 ? serie[serie.length - 2] : null;

  const semMovimento = serie.every(
    (p) => Number(p.receita_total) === 0 && (p.mrr_contratado === null || Number(p.mrr_contratado) === 0)
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">Evolução de Receita e MRR</CardTitle>
            <p className="text-xs text-muted-foreground">
              Barras: receita efetivamente recebida no mês, por origem. Linha: MRR contratado (assinaturas e
              matrículas ativas no fechamento do mês).
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
            Não foi possível carregar o histórico: {(error as Error).message}
          </p>
        )}

        {!error && isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Carregando...</p>}

        {!error && !isLoading && (
          <>
            {ultimo && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Receita do mês</p>
                  <p className="text-lg font-bold">{formatarMoeda(Number(ultimo.receita_total))}</p>
                  <VariacaoBadge
                    atual={Number(ultimo.receita_total)}
                    anterior={penultimo ? Number(penultimo.receita_total) : null}
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Repasse ARKE líquido no mês</p>
                  <p className="text-lg font-bold">{formatarMoeda(Number(ultimo.repasse_arke))}</p>
                  <VariacaoBadge
                    atual={Number(ultimo.repasse_arke)}
                    anterior={penultimo ? Number(penultimo.repasse_arke) : null}
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">MRR contratado</p>
                  <p className="text-lg font-bold">
                    {ultimo.mrr_contratado === null ? "—" : formatarMoeda(Number(ultimo.mrr_contratado))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">ARR projetado</p>
                  <p className="text-lg font-bold">
                    {ultimo.arr_contratado === null ? "—" : formatarMoeda(Number(ultimo.arr_contratado))}
                  </p>
                </div>
              </div>
            )}

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dadosGrafico} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="mes" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatarMoedaCompacta} />
                  <Tooltip
                    formatter={(valor: number | null) => (valor === null ? "—" : formatarMoeda(Number(valor)))}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "0.5rem",
                      fontSize: "12px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="Método ARKE" stackId="receita" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Mensalidades" stackId="receita" fill="hsl(var(--primary) / 0.55)" />
                  <Bar dataKey="Assinatura B2B" stackId="receita" fill="hsl(var(--primary) / 0.3)" radius={[4, 4, 0, 0]} />
                  <Line
                    type="monotone"
                    dataKey="MRR contratado"
                    stroke="hsl(var(--destructive))"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {semMovimento && (
              <p className="text-xs text-muted-foreground">
                Ainda não há pagamentos confirmados nem assinaturas ativas na plataforma — o gráfico passa a
                preencher sozinho conforme as cobranças forem liquidadas.
              </p>
            )}

            <p className="text-[11px] text-muted-foreground">
              O MRR contratado é capturado por um snapshot diário automático e só existe a partir de hoje — meses
              anteriores aparecem sem a linha porque o sistema não guardava esse retrato antes. A receita recebida,
              essa sim, é histórica e vem das cobranças reais.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
