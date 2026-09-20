import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, Wifi, WifiOff, PlugZap, ListChecks, AlertTriangle, ArrowUpRight } from "lucide-react";
import type { Enums } from "@/integrations/supabase/types";

// Nulos são reais aqui (catraca que nunca conectou, organização sem fila),
// e o gerador de tipos do Supabase declara tudo como não-nulo.
type Gateway = {
  catraca_id: string;
  organization_id: string;
  organizacao_nome: string;
  nome: string;
  localizacao: string | null;
  status: string;
  driver: string | null;
  ultimo_heartbeat_em: string | null;
  minutos_sem_heartbeat: number | null;
  situacao: "online" | "offline" | "nunca_conectou";
  acessos_24h: number;
};

type FilaOrg = {
  organization_id: string;
  organizacao_nome: string;
  status_org: Enums<"org_status">;
  abertas: number;
  vencidas: number;
  criticas_abertas: number;
  escaladas: number;
  sem_responsavel: number;
  concluidas_7d: number;
  horas_pendencia_mais_antiga: number | null;
};

const SITUACAO = {
  online: { label: "Online", icon: Wifi, classe: "text-emerald-600 dark:text-emerald-400" },
  offline: { label: "Offline", icon: WifiOff, classe: "text-destructive" },
  nunca_conectou: { label: "Nunca conectou", icon: PlugZap, classe: "text-amber-600 dark:text-amber-400" },
} as const;

const formatarSilencio = (minutos: number | null) => {
  if (minutos === null) return null;
  if (minutos < 60) return `${Math.round(minutos)} min sem reportar`;
  const horas = minutos / 60;
  if (horas < 24) return `${horas.toFixed(1)} h sem reportar`;
  return `${Math.floor(horas / 24)} d sem reportar`;
};

export function OperacaoGlobalCard() {
  const { data: gateways = [], error: erroGateways } = useQuery({
    queryKey: ["superadmin-gateways"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_gateways");
      if (error) throw error;
      return (data ?? []) as unknown as Gateway[];
    },
  });

  const { data: fila = [], error: erroFila } = useQuery({
    queryKey: ["superadmin-fila-global"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_fila_global");
      if (error) throw error;
      return (data ?? []) as unknown as FilaOrg[];
    },
  });

  const resumoGateways = useMemo(
    () => ({
      online: gateways.filter((g) => g.situacao === "online").length,
      offline: gateways.filter((g) => g.situacao === "offline").length,
      nunca: gateways.filter((g) => g.situacao === "nunca_conectou").length,
    }),
    [gateways]
  );

  const resumoFila = useMemo(
    () =>
      fila.reduce(
        (acc, f) => ({
          abertas: acc.abertas + Number(f.abertas),
          vencidas: acc.vencidas + Number(f.vencidas),
          criticas: acc.criticas + Number(f.criticas_abertas),
          escaladas: acc.escaladas + Number(f.escaladas),
        }),
        { abertas: 0, vencidas: 0, criticas: 0, escaladas: 0 }
      ),
    [fila]
  );

  // Organização sem nenhuma pendência não precisa ocupar linha na lista —
  // o que interessa aqui é onde há fila.
  const filaComPendencia = useMemo(() => fila.filter((f) => Number(f.abertas) > 0), [fila]);

  const erro = erroGateways ?? erroFila;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" /> Operação da Plataforma
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Gateways Locais e fila de atendimento somados de todas as academias — o que hoje só dá para ver entrando
          em cada unidade separadamente.
        </p>
      </CardHeader>
      <CardContent>
        {erro && (
          <p className="text-sm text-destructive py-6 text-center">
            Não foi possível carregar a operação: {(erro as Error).message}
          </p>
        )}

        {!erro && (
          <Tabs defaultValue="fila">
            <TabsList>
              <TabsTrigger value="fila" className="text-xs gap-1.5">
                <ListChecks className="h-3.5 w-3.5" /> Fila
                {resumoFila.vencidas > 0 && (
                  <Badge variant="destructive" className="h-4 min-w-4 justify-center px-1 text-[10px]">
                    {resumoFila.vencidas}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="gateways" className="text-xs gap-1.5">
                <Wifi className="h-3.5 w-3.5" /> Gateways
                {resumoGateways.offline > 0 && (
                  <Badge variant="destructive" className="h-4 min-w-4 justify-center px-1 text-[10px]">
                    {resumoGateways.offline}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="fila" className="space-y-3 pt-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Pendências abertas</p>
                  <p className="text-lg font-bold">{resumoFila.abertas}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Com prazo vencido</p>
                  <p className={`text-lg font-bold ${resumoFila.vencidas > 0 ? "text-destructive" : ""}`}>
                    {resumoFila.vencidas}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Críticas</p>
                  <p className="text-lg font-bold">{resumoFila.criticas}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Escaladas</p>
                  <p className="text-lg font-bold">{resumoFila.escaladas}</p>
                </div>
              </div>

              {filaComPendencia.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Nenhuma pendência aberta em nenhuma academia.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {filaComPendencia.map((f) => (
                    <div key={f.organization_id} className="py-2.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium">{f.organizacao_nome}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {f.status_org}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {f.abertas} aberta(s)
                          {Number(f.sem_responsavel) > 0 && ` · ${f.sem_responsavel} sem responsável`}
                          {Number(f.concluidas_7d) > 0 && ` · ${f.concluidas_7d} encerrada(s) em 7d`}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {Number(f.vencidas) > 0 && (
                            <Badge variant="destructive" className="gap-1 text-[10px]">
                              <AlertTriangle className="h-3 w-3" /> {f.vencidas} vencida(s)
                            </Badge>
                          )}
                          {Number(f.criticas_abertas) > 0 && (
                            <Badge variant="outline" className="text-[10px]">
                              {f.criticas_abertas} crítica(s)
                            </Badge>
                          )}
                          {Number(f.escaladas) > 0 && (
                            <Badge variant="outline" className="gap-1 text-[10px]">
                              <ArrowUpRight className="h-3 w-3" /> {f.escaladas} escalada(s)
                            </Badge>
                          )}
                        </div>
                      </div>
                      {f.horas_pendencia_mais_antiga !== null && (
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold">
                            {Number(f.horas_pendencia_mais_antiga) < 24
                              ? `${Number(f.horas_pendencia_mais_antiga).toFixed(0)}h`
                              : `${Math.floor(Number(f.horas_pendencia_mais_antiga) / 24)}d`}
                          </p>
                          <p className="text-[10px] text-muted-foreground">mais antiga</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="gateways" className="space-y-3 pt-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Online</p>
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                    {resumoGateways.online}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Offline</p>
                  <p className={`text-lg font-bold ${resumoGateways.offline > 0 ? "text-destructive" : ""}`}>
                    {resumoGateways.offline}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Nunca conectaram</p>
                  <p className="text-lg font-bold">{resumoGateways.nunca}</p>
                </div>
              </div>

              {gateways.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Nenhuma catraca cadastrada em nenhuma academia.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {gateways.map((g) => {
                    const { label, icon: Icon, classe } = SITUACAO[g.situacao];
                    const silencio = formatarSilencio(
                      g.minutos_sem_heartbeat === null ? null : Number(g.minutos_sem_heartbeat)
                    );
                    return (
                      <div key={g.catraca_id} className="py-2.5 flex items-start gap-2.5">
                        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${classe}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-medium">{g.organizacao_nome}</span>
                            <span className="text-xs text-muted-foreground">· {g.nome}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            <span className={classe}>{label}</span>
                            {silencio && g.situacao !== "online" && ` · ${silencio}`}
                            {g.localizacao && ` · ${g.localizacao}`}
                            {Number(g.acessos_24h) > 0 && ` · ${g.acessos_24h} acesso(s) em 24h`}
                          </p>
                          {g.situacao === "nunca_conectou" && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Catraca cadastrada, mas o Gateway Local nunca autenticou nesta unidade.
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                A situação vem do último contato do Gateway Local, que sincroniza a cada 5 minutos. Offline = 15
                minutos em silêncio (3 ciclos perdidos). O campo "status" do cadastro da catraca não é sinal de
                vida: ele continua "ativo" mesmo com a unidade desligada.
              </p>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
