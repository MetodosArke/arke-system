import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErroAoCarregar } from "@/components/ErroAoCarregar";
import { useAcessoArkefit } from "@/hooks/useAcessoArkefit";
import { diaBrasilia, hojeBrasilia, inicioDoMesBrasilia } from "@/lib/dataBrasilia";
import { decimal } from "@/lib/numeros";

type Periodo = "mes" | "mes_passado" | "90d";

const NOMES: Record<Periodo, string> = { mes: "Este mês", mes_passado: "Mês passado", "90d": "Últimos 90 dias" };

/** O período em datas de Brasília (texto AAAA-MM-DD). */
function datasDoPeriodo(periodo: Periodo): { de: string; ate: string } {
  if (periodo === "mes") return { de: inicioDoMesBrasilia(), ate: hojeBrasilia() };
  if (periodo === "90d") return { de: diaBrasilia(-89), ate: hojeBrasilia() };
  // O último dia do mês passado é a véspera do dia 1 deste mês.
  const ate = diaBrasilia(-1, new Date(`${inicioDoMesBrasilia()}T12:00:00-03:00`));
  return { de: `${ate.slice(0, 7)}-01`, ate };
}

const pct = (parte: number, todo: number) => (todo > 0 ? `${decimal((100 * parte) / todo, 0)}%` : "—");

/**
 * Visão Master → Engajamento. A Pontuação ARKE e o uso do app de cada academia
 * no período. Os números por academia são da carteira; o ranking com o nome
 * dos alunos é só do Sócio.
 */
export default function SuperAdminEngajamento() {
  const { pode } = useAcessoArkefit();
  const socio = pode("socio");
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [aberta, setAberta] = useState<string | null>(null);
  const { de, ate } = datasDoPeriodo(periodo);

  const academias = useQuery({
    queryKey: ["superadmin-engajamento", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_engajamento", { _de: de, _ate: ate });
      if (error) throw error;
      return data ?? [];
    },
  });

  const ranking = useQuery({
    queryKey: ["superadmin-pontos-alunos", aberta, de, ate],
    enabled: socio && !!aberta,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_pontos_alunos", {
        _organization_id: aberta!,
        _de: de,
        _ate: ate,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const linhas = academias.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" aria-hidden="true" />
          <h1 className="text-xl font-bold">Engajamento</h1>
        </div>
        <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
          <SelectTrigger className="w-44" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(NOMES) as Periodo[]).map((p) => (
              <SelectItem key={p} value={p}>
                {NOMES[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Por academia</CardTitle>
          <CardDescription>
            A Pontuação ARKE de cada aluno no período: até 20 pontos por semana pela constância contra a meta dele, 2 por
            dia com check-in e os pontos de cada desafio concluído. Entra quem não está pausado. Ordenado pela média de
            pontos por aluno.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {academias.error ? (
            <ErroAoCarregar
              oQue="o engajamento"
              onTentarDeNovo={() => academias.refetch()}
              tentando={academias.isFetching}
            />
          ) : academias.isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">
              Carregando…
            </p>
          ) : linhas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma academia cadastrada ainda.</p>
          ) : (
            <div className="divide-y divide-border">
              {linhas.map((l) => (
                <div key={l.organization_id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{l.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.alunos} {l.alunos === 1 ? "aluno" : "alunos"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold tabular-nums">
                        {l.pontos_media === null ? "—" : decimal(Number(l.pontos_media), 1)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">pontos por aluno</p>
                    </div>
                  </div>
                  {l.alunos > 0 && (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">Treinaram</dt>
                        <dd className="font-medium tabular-nums">
                          {l.treinaram} ({pct(l.treinaram, l.alunos)})
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Fizeram check-in</dt>
                        <dd className="font-medium tabular-nums">
                          {l.com_checkin} ({pct(l.com_checkin, l.alunos)})
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Desafios concluídos</dt>
                        <dd className="font-medium tabular-nums">{l.desafios_concluidos}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Pontos no total</dt>
                        <dd className="font-medium tabular-nums">{l.pontos_total}</dd>
                      </div>
                    </dl>
                  )}
                  {socio && l.alunos > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAberta(aberta === l.organization_id ? null : l.organization_id)}
                    >
                      {aberta === l.organization_id ? "Esconder os alunos" : "Ver os alunos"}
                    </Button>
                  )}
                  {socio && aberta === l.organization_id && <RankingAlunos consulta={ranking} />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RankingAlunos({
  consulta,
}: {
  consulta: {
    data?: { aluno_id: string; nome: string; constancia: number; checkins: number; desafios: number; total: number }[];
    error: unknown;
    isLoading: boolean;
    isFetching: boolean;
    refetch: () => unknown;
  };
}) {
  if (consulta.error)
    return (
      <ErroAoCarregar oQue="os alunos" onTentarDeNovo={() => consulta.refetch()} tentando={consulta.isFetching} />
    );
  if (consulta.isLoading)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Carregando…
      </p>
    );
  const alunos = consulta.data ?? [];
  if (alunos.length === 0) return <p className="text-xs text-muted-foreground">Nenhum aluno no período.</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">#</th>
            <th className="px-2 py-1.5 text-left font-medium">Aluno</th>
            <th className="px-2 py-1.5 text-right font-medium">Constância</th>
            <th className="px-2 py-1.5 text-right font-medium">Check-in</th>
            <th className="px-2 py-1.5 text-right font-medium">Desafios</th>
            <th className="px-2 py-1.5 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {alunos.map((a, i) => (
            <tr key={a.aluno_id} className="border-t">
              <td className="px-2 py-1.5">{i + 1}</td>
              <td className="px-2 py-1.5">{a.nome}</td>
              <td className="px-2 py-1.5 text-right">{a.constancia}</td>
              <td className="px-2 py-1.5 text-right">{a.checkins}</td>
              <td className="px-2 py-1.5 text-right">{a.desafios}</td>
              <td className="px-2 py-1.5 text-right font-semibold">{a.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
