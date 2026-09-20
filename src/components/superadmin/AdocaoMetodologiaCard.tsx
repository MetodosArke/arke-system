import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Target, AlertTriangle } from "lucide-react";
import type { Enums } from "@/integrations/supabase/types";

// Os percentuais são nulos quando o pilar não se aplica (nutrição não
// contratada) ou quando a organização ainda não tem aluno. O gerador de
// tipos do Supabase declara tudo como number, então o tipo é redeclarado
// aqui para o componente não tratar "não se aplica" como zero.
type LinhaAdocao = {
  organization_id: string;
  nome: string;
  status: Enums<"org_status">;
  plano_b2b: Enums<"plano_b2b">;
  alunos_total: number;
  alunos_metodo_arke: number;
  anamnese_concluida: number;
  anamnese_pct: number | null;
  com_treino_ativo: number;
  treino_pct: number | null;
  nutricao_contratada: number;
  com_dieta_ativa: number;
  nutricao_pct: number | null;
  checkin_30d: number;
  checkin_pct: number | null;
  tarefas_concluidas_30d: number;
  tarefas_com_desfecho_30d: number;
  desfecho_pct: number | null;
  tarefas_vencidas_abertas: number;
  score_adocao: number | null;
};

const LIMITE_RISCO = 40;
const LIMITE_ATENCAO = 70;

const corDoScore = (score: number) =>
  score < LIMITE_RISCO
    ? "text-destructive"
    : score < LIMITE_ATENCAO
      ? "text-amber-600 dark:text-amber-400"
      : "text-emerald-600 dark:text-emerald-400";

function BarraPilar({
  label,
  pct,
  detalhe,
}: {
  label: string;
  pct: number | null;
  detalhe: string;
}) {
  // Pilar não aplicável não vira 0%: a barra some e o motivo aparece, para
  // não parecer que a academia deixou de fazer algo que ela não contratou.
  if (pct === null) {
    return (
      <div>
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground/70 italic">{detalhe}</p>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-baseline justify-between gap-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-[11px] font-medium">{pct.toFixed(0)}%</p>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-0.5">
        <div
          className={`h-full rounded-full ${
            pct < LIMITE_RISCO ? "bg-destructive" : pct < LIMITE_ATENCAO ? "bg-amber-500" : "bg-primary"
          }`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5">{detalhe}</p>
    </div>
  );
}

export function AdocaoMetodologiaCard() {
  const {
    data: linhas = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["superadmin-adocao-metodologia"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_adocao_metodologia");
      if (error) throw error;
      return (data ?? []) as unknown as LinhaAdocao[];
    },
  });

  const emRisco = useMemo(
    () =>
      linhas.filter(
        (l) => l.score_adocao !== null && Number(l.score_adocao) < LIMITE_RISCO && l.alunos_total > 0
      ).length,
    [linhas]
  );

  const semAlunos = useMemo(() => linhas.filter((l) => l.alunos_total === 0).length, [linhas]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4" /> Adoção da Metodologia por Academia
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Quem está realmente usando o método, e não só pagando a assinatura. Ordenado do pior score para o melhor —
          academia que paga em dia mas não prescreve nem faz check-in é a que cancela no próximo ciclo.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p className="text-sm text-destructive py-6 text-center">
            Não foi possível carregar a adoção: {(error as Error).message}
          </p>
        )}

        {!error && isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Carregando...</p>}

        {!error && !isLoading && linhas.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma academia cadastrada ainda.</p>
        )}

        {!error && !isLoading && linhas.length > 0 && (
          <>
            {(emRisco > 0 || semAlunos > 0) && (
              <div className="flex flex-wrap gap-2">
                {emRisco > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {emRisco} {emRisco === 1 ? "academia em risco" : "academias em risco"}
                  </Badge>
                )}
                {semAlunos > 0 && (
                  <Badge variant="secondary">
                    {semAlunos} {semAlunos === 1 ? "sem aluno cadastrado" : "sem alunos cadastrados"}
                  </Badge>
                )}
              </div>
            )}

            <div className="divide-y divide-border">
              {linhas.map((l) => {
                const score = l.score_adocao === null ? null : Number(l.score_adocao);
                return (
                  <div key={l.organization_id} className="py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium">{l.nome}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {l.status}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {l.alunos_total} {l.alunos_total === 1 ? "aluno" : "alunos"}
                          {l.alunos_metodo_arke > 0 && ` · ${l.alunos_metodo_arke} no Método ARKE`}
                          {l.tarefas_vencidas_abertas > 0 && (
                            <span className="text-destructive">
                              {" "}
                              · {l.tarefas_vencidas_abertas} tarefa(s) com prazo vencido
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {score === null ? (
                          <>
                            <p className="text-sm font-bold text-muted-foreground">—</p>
                            <p className="text-[10px] text-muted-foreground">sem alunos</p>
                          </>
                        ) : (
                          <>
                            <p className={`text-lg font-bold ${corDoScore(score)}`}>{score.toFixed(0)}</p>
                            <p className="text-[10px] text-muted-foreground">score</p>
                          </>
                        )}
                      </div>
                    </div>

                    {l.alunos_total > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <BarraPilar
                          label="Anamnese (M.A.P.A.)"
                          pct={l.anamnese_pct === null ? null : Number(l.anamnese_pct)}
                          detalhe={`${l.anamnese_concluida}/${l.alunos_total} concluíram`}
                        />
                        <BarraPilar
                          label="Treino prescrito"
                          pct={l.treino_pct === null ? null : Number(l.treino_pct)}
                          detalhe={`${l.com_treino_ativo}/${l.alunos_total} com ficha ativa`}
                        />
                        <BarraPilar
                          label="Nutrição"
                          pct={l.nutricao_pct === null ? null : Number(l.nutricao_pct)}
                          detalhe={
                            l.nutricao_contratada === 0
                              ? "não contratada"
                              : `${l.com_dieta_ativa}/${l.nutricao_contratada} com plano ativo`
                          }
                        />
                        <BarraPilar
                          label="Check-in (R.O.T.A.)"
                          pct={l.checkin_pct === null ? null : Number(l.checkin_pct)}
                          detalhe={`${l.checkin_30d}/${l.alunos_total} nos últimos 30d`}
                        />
                      </div>
                    )}

                    {l.tarefas_concluidas_30d > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Fila: {l.tarefas_com_desfecho_30d} de {l.tarefas_concluidas_30d} pendências encerradas nos
                        últimos 30d têm desfecho registrado
                        {l.desfecho_pct !== null && ` (${Number(l.desfecho_pct).toFixed(0)}%)`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] text-muted-foreground">
              O score é a média dos pilares que se aplicam a cada academia. Nutrição só entra na conta quando há
              aluno com nutrição contratada, e alunos anonimizados por LGPD ficam fora de todas as contagens.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
