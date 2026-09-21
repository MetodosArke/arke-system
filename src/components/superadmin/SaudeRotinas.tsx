import { useNavigate } from "react-router-dom";
import {
  PRECISA_ATENCAO,
  ROTULO,
  problemaReconciliacao,
  rotinasComProblema,
  useSaudeRotinas,
  useUltimaReconciliacao,
} from "@/lib/rotinas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, Scale } from "lucide-react";

/**
 * Saúde das rotinas agendadas (pg_cron) na Visão Master.
 *
 * São elas que abrem tarefa de ativação, escalam SLA, capturam MRR — o produto
 * se movendo sozinho. Quebrar não avisava ninguém. A situação mais traiçoeira
 * é "atrasada": a rotina parou de rodar, e parar de rodar não gera erro. Ver
 * public.get_superadmin_rotinas().
 */

function quando(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Faixa no topo da Visão Master — é a tela que se abre todo dia. */
export function AvisoRotinas() {
  const { data } = useSaudeRotinas();
  const { data: reconciliacao } = useUltimaReconciliacao();
  const navigate = useNavigate();
  const problemas = rotinasComProblema(data);
  const problemaFinanceiro = problemaReconciliacao(reconciliacao);
  if (problemas.length === 0 && !problemaFinanceiro) return null;

  const texto =
    problemas.length === 0
      ? problemaFinanceiro
      : problemas.length === 1
        ? `A rotina "${problemas[0].nome}" ${ROTULO[problemas[0].situacao]}`
        : `${problemas.length} rotinas agendadas precisam de atenção`;
  // Duas coisas ao mesmo tempo: a faixa mostra a de rotina e avisa que há mais.
  const extra = problemas.length > 0 && problemaFinanceiro ? " · e há divergência na reconciliação" : "";

  return (
    <button
      type="button"
      onClick={() => navigate("/superadmin/webhooks")}
      className="flex w-full items-center justify-center gap-2 bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground"
    >
      <AlertTriangle className="h-4 w-4" />
      {texto}
      {extra} — ver detalhes
    </button>
  );
}

/** Painel com todas as rotinas. */
export function SaudeRotinas() {
  const { data, isLoading, error } = useSaudeRotinas();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" /> Rotinas agendadas
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          "Parou de rodar" é quando a última execução tem mais que o dobro do intervalo do agendamento — não gera erro,
          só silêncio.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : error ? (
          <p className="text-sm text-destructive">Não foi possível ler as rotinas: {(error as Error).message}</p>
        ) : (
          <ul className="divide-y">
            {(data ?? []).map((r) => (
              <li key={r.nome} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{r.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.agendamento} · última: {quando(r.ultima_execucao)} · 7 dias: {r.execucoes_7d} execuções
                    {r.falhas_7d > 0 ? `, ${r.falhas_7d} com falha` : ""}
                  </p>
                  {r.ultimo_erro && <p className="mt-1 break-all text-xs text-destructive">{r.ultimo_erro}</p>}
                </div>
                <Badge variant={PRECISA_ATENCAO.has(r.situacao) ? "destructive" : r.situacao === "ok" ? "default" : "outline"}>
                  {ROTULO[r.situacao]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function valor(n: number, singular: string, plural: string) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Última varredura da reconciliação Asaas ↔ banco. */
export function UltimaReconciliacao() {
  const { data, isLoading, error } = useUltimaReconciliacao();
  const problema = problemaReconciliacao(data);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" /> Reconciliação com o Asaas
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Uma vez por dia, cada cobrança em aberto é conferida com o Asaas. Divergência é corrigida reenviando o
          evento ao webhook — aparece abaixo com o prefixo reconciliacao:.
        </p>
      </CardHeader>
      <CardContent className="text-sm">
        {isLoading ? (
          <p className="text-muted-foreground">Carregando...</p>
        ) : error ? (
          <p className="text-destructive">Não foi possível ler a reconciliação: {(error as Error).message}</p>
        ) : !data ? (
          <p className="text-muted-foreground">Nenhuma varredura registrada ainda.</p>
        ) : (
          <div className="space-y-1">
            <p>
              {quando(data.executada_em)} · {valor(data.cobrancas_verificadas, "cobrança verificada", "cobranças verificadas")} ·{" "}
              {valor(data.divergencias, "divergência", "divergências")} ({data.corrigidas} corrigidas) ·{" "}
              {valor(data.assinaturas_orfas, "assinatura órfã", "assinaturas órfãs")}
            </p>
            {problema && <p className="text-destructive">{problema}</p>}
            {data.erro && <p className="break-all text-xs text-destructive">{data.erro}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
