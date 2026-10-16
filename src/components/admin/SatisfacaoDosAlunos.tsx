import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ThumbsUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErroAoCarregar } from "@/components/ErroAoCarregar";
import { todasAsLinhas } from "@/lib/paginar";
import { formatarDataBR, inicioDoMesBrasilia } from "@/lib/dataBrasilia";
import { npsPorMes, resumoNps, type ResumoNps } from "@/lib/pesquisaSatisfacao";

const pct = (parte: number, total: number) => `${total ? Math.round((parte / total) * 100) : 0}%`;
const notaNps = (nps: number | null) => (nps === null ? "—" : String(nps));

/**
 * O NPS da academia no Gestão 360° (pesquisa de satisfação do app do aluno):
 * a nota dos últimos 90 dias (uma janela da pesquisa, em que cada aluno
 * responde uma vez) e a evolução por mês, nos últimos 12. Só a gestão lê as
 * respostas (o RLS de `pesquisa_satisfacao`).
 */
export function SatisfacaoDosAlunos({ organizationId }: { organizationId: string }) {
  // O primeiro dia do mês, 11 meses atrás: a tabela mostra 12 meses inteiros.
  const desde = useMemo(() => inicioDoMesBrasilia(new Date(Date.now() - 335 * 86_400_000)), []);

  const {
    data: respostas = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["gestao360-nps", organizationId, desde],
    queryFn: () =>
      todasAsLinhas((de, ate) =>
        supabase
          .from("pesquisa_satisfacao")
          .select("nota, created_at")
          .eq("organization_id", organizationId)
          .not("nota", "is", null)
          .gte("created_at", `${desde}T00:00:00-03:00`)
          .order("id")
          .range(de, ate),
      ),
  });

  const { recente, meses } = useMemo(() => {
    const validas = respostas.filter((r): r is { nota: number; created_at: string } => r.nota !== null);
    const limite = Date.now() - 90 * 86_400_000;
    return {
      recente: resumoNps(validas.filter((r) => new Date(r.created_at).getTime() >= limite).map((r) => r.nota)),
      meses: npsPorMes(validas),
    };
  }, [respostas]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ThumbsUp className="h-4 w-4 text-primary" aria-hidden="true" /> Satisfação dos alunos (NPS)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          No app, o aluno responde de 0 a 10 quanto recomendaria a academia a um amigo. O NPS é a % de promotores (9 e 10)
          menos a % de detratores (0 a 6), de −100 a 100. Cada nota de 0 a 6 abre uma tarefa da gestão na fila.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {isLoading && (
          <p role="status" className="text-muted-foreground">
            Carregando...
          </p>
        )}
        {error && <ErroAoCarregar oQue="as respostas da pesquisa" onTentarDeNovo={() => void refetch()} tentando={isFetching} />}
        {!isLoading && !error && meses.length === 0 && (
          <p className="text-muted-foreground">
            Ainda sem respostas: a pesquisa aparece para o aluno 30 dias depois da matrícula.
          </p>
        )}
        {!isLoading && !error && meses.length > 0 && (
          <>
            <ResumoRecente resumo={recente} />
            <table className="w-full text-left">
              <caption className="sr-only">NPS por mês</caption>
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="pb-1 font-medium">Mês</th>
                  <th scope="col" className="pb-1 text-right font-medium">Respostas</th>
                  <th scope="col" className="pb-1 text-right font-medium">NPS</th>
                </tr>
              </thead>
              <tbody>
                {meses.map((m) => (
                  <tr key={m.mes} className="border-b border-border last:border-0">
                    <td className="py-1.5 first-letter:uppercase">{formatarDataBR(`${m.mes}-01`, { month: "long", year: "numeric" })}</td>
                    <td className="py-1.5 text-right">{m.respostas}</td>
                    <td className="py-1.5 text-right font-semibold">{notaNps(m.nps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ResumoRecente({ resumo }: { resumo: ResumoNps }) {
  if (resumo.respostas === 0) {
    return <p className="text-muted-foreground">Nenhuma resposta nos últimos 90 dias. A evolução por mês está abaixo.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-lg bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">NPS, últimos 90 dias</p>
        <p className="text-2xl font-bold">{notaNps(resumo.nps)}</p>
        <p className="text-[11px] text-muted-foreground">{resumo.respostas} resposta(s)</p>
      </div>
      <div className="rounded-lg bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">Promotores (9–10)</p>
        <p className="text-lg font-bold text-success">{pct(resumo.promotores, resumo.respostas)}</p>
        <p className="text-[11px] text-muted-foreground">{resumo.promotores} aluno(s)</p>
      </div>
      <div className="rounded-lg bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">Neutros (7–8)</p>
        <p className="text-lg font-bold">{pct(resumo.neutros, resumo.respostas)}</p>
        <p className="text-[11px] text-muted-foreground">{resumo.neutros} aluno(s)</p>
      </div>
      <div className="rounded-lg bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">Detratores (0–6)</p>
        <p className="text-lg font-bold text-destructive">{pct(resumo.detratores, resumo.respostas)}</p>
        <p className="text-[11px] text-muted-foreground">{resumo.detratores} aluno(s)</p>
      </div>
    </div>
  );
}
