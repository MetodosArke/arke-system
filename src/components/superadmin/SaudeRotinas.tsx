import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock } from "lucide-react";

/**
 * Saúde das rotinas agendadas (pg_cron) na Visão Master.
 *
 * São elas que abrem tarefa de ativação, escalam SLA, capturam MRR — o produto
 * se movendo sozinho. Quebrar não avisava ninguém. A situação mais traiçoeira
 * é "atrasada": a rotina parou de rodar, e parar de rodar não gera erro. Ver
 * public.get_superadmin_rotinas().
 */

export interface Rotina {
  nome: string;
  agendamento: string;
  ativa: boolean;
  situacao: "ok" | "falhou" | "atrasada" | "nunca_rodou" | "desativada";
  ultima_execucao: string | null;
  ultimo_erro: string | null;
  falhas_7d: number;
  execucoes_7d: number;
}

const PRECISA_ATENCAO = new Set(["falhou", "atrasada", "nunca_rodou"]);

const ROTULO: Record<Rotina["situacao"], string> = {
  ok: "ok",
  falhou: "falhou",
  atrasada: "parou de rodar",
  nunca_rodou: "nunca rodou",
  desativada: "desativada",
};

export function useSaudeRotinas() {
  return useQuery({
    queryKey: ["superadmin-rotinas"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_rotinas");
      if (error) throw error;
      return (data ?? []) as Rotina[];
    },
    // As mais frequentes rodam de hora em hora; 5 min basta para o aviso
    // aparecer cedo sem martelar o banco.
    refetchInterval: 5 * 60 * 1000,
  });
}

export function rotinasComProblema(rotinas: Rotina[] | undefined): Rotina[] {
  return (rotinas ?? []).filter((r) => PRECISA_ATENCAO.has(r.situacao));
}

function quando(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Faixa no topo da Visão Master — é a tela que se abre todo dia. */
export function AvisoRotinas() {
  const { data } = useSaudeRotinas();
  const navigate = useNavigate();
  const problemas = rotinasComProblema(data);
  if (problemas.length === 0) return null;

  return (
    <button
      type="button"
      onClick={() => navigate("/superadmin/webhooks")}
      className="flex w-full items-center justify-center gap-2 bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground"
    >
      <AlertTriangle className="h-4 w-4" />
      {problemas.length === 1
        ? `A rotina "${problemas[0].nome}" ${ROTULO[problemas[0].situacao]} — ver detalhes`
        : `${problemas.length} rotinas agendadas precisam de atenção — ver detalhes`}
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
