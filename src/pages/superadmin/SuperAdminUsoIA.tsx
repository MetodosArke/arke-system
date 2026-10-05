import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AGENTES_IA, custoEmDolar, milhares, nomeDoAgente, taxaDeRecusa, useUsoIA } from "@/lib/usoIA";
import { cn } from "@/lib/utils";

const PERIODOS = [7, 30, 90] as const;

/**
 * Visão Master → Uso das IAs. Quanto cada IA foi chamada, quanto a trava
 * recusou, quanto ficou indisponível, os tokens, o custo estimado e a
 * latência. Nenhum texto: o medidor guarda só números.
 */
export default function SuperAdminUsoIA() {
  const [dias, setDias] = useState<number>(30);
  const { data = [], isLoading, error } = useUsoIA(dias);
  const total = data.reduce((s, l) => s + l.custo_usd, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Uso das IAs</h1>
        </div>
        <Select value={String(dias)} onValueChange={(v) => setDias(Number(v))}>
          <SelectTrigger className="w-40" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODOS.map((p) => (
              <SelectItem key={p} value={String(p)}>
                Últimos {p} dias
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Por IA</CardTitle>
          <CardDescription>
            "Recusada pela trava" é a resposta que o modelo deu e o nosso código descartou antes de chegar a alguém. Uma
            taxa alta quer dizer que o modelo está errando, ou que o roteiro dele precisa de ajuste. O custo é estimado pela
            tabela pública da AWS, em dólar. O Sentinela segue congelado e não entra no medidor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">Não foi possível carregar o uso das IAs.</p>
          ) : isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : data.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma chamada às IAs no período.</p>
          ) : (
            <div className="divide-y divide-border">
              {data.map((l) => {
                const taxa = taxaDeRecusa(l);
                return (
                  <div key={l.agente} className="space-y-1.5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{nomeDoAgente(l.agente)}</p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="secondary">{milhares(l.chamadas)} chamada(s)</Badge>
                        {l.recusadas_trava > 0 && (
                          <Badge variant="outline" className={cn((taxa ?? 0) >= 20 && "text-amber-700 dark:text-amber-400")}>
                            {milhares(l.recusadas_trava)} recusada(s) pela trava ({taxa}%)
                          </Badge>
                        )}
                        {l.indisponiveis > 0 && <Badge variant="destructive">{milhares(l.indisponiveis)} indisponível(is)</Badge>}
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">Tokens (entrada / saída)</dt>
                        <dd className="font-medium">
                          {milhares(l.tokens_entrada)} / {milhares(l.tokens_saida)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Custo estimado</dt>
                        <dd className="font-medium">{l.sem_preco ? "modelo sem preço na tabela" : custoEmDolar(l.custo_usd)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Latência média</dt>
                        <dd className="font-medium">{l.latencia_media_ms != null ? `${milhares(l.latencia_media_ms)} ms` : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Latência máxima</dt>
                        <dd className="font-medium">{l.latencia_max_ms != null ? `${milhares(l.latencia_max_ms)} ms` : "—"}</dd>
                      </div>
                    </dl>
                    {AGENTES_IA[l.agente] && (
                      <p className="text-[11px] text-muted-foreground">A trava recusa: {AGENTES_IA[l.agente].trava}.</p>
                    )}
                  </div>
                );
              })}
              <p className="pt-3 text-sm">
                Custo estimado no período: <span className="font-semibold">{custoEmDolar(total)}</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
