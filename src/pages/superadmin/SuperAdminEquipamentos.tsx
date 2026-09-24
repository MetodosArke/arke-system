import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Cpu, Fingerprint, ScrollText, ShieldAlert } from "lucide-react";
import { SaudeGateway } from "@/components/catraca/SaudeGateway";
import { SITUACAO_GATEWAY, tempoDesde } from "@/lib/gateway";
import { ordenarEquipamentos, useEquipamentosGlobais, type EquipamentoGlobal } from "@/lib/equipamentos";
import { cn } from "@/lib/utils";

const TOM = {
  ok: "text-emerald-700 dark:text-emerald-400",
  atencao: "text-amber-700 dark:text-amber-400",
  problema: "text-destructive",
  neutro: "text-muted-foreground",
} as const;

const RESULTADO: Record<string, string> = {
  liberado: "Liberado",
  liberado_parceiro_externo: "Liberado (parceiro)",
  liberado_remoto: "Liberado pela recepção",
  negado_inadimplente: "Inadimplente",
  negado_pausado: "Pausado",
  negado_nao_encontrado: "Não encontrado",
  negado_catraca_inativa: "Catraca inativa",
  negado_sem_agendamento: "Sem agendamento",
  negado_falha_verificacao_agendamento: "Falha no agendamento",
};

const CREDENCIAL: Record<string, string> = {
  cpf: "CPF",
  identificador: "Digital/cartão",
  remoto: "Remoto",
  parceiro: "Parceiro",
  nenhuma: "—",
};

/**
 * Visão Master → Equipamentos. As três perguntas de operação que a auditoria
 * 360° encontrou sem resposta: quais catracas estão fora do ar (e dá para
 * agir daqui), o que passou por elas (sem identificar aluno) e se a biometria
 * está sendo tratada como a LGPD pede.
 */
export default function SuperAdminEquipamentos() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center gap-2">
        <Cpu className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Equipamentos</h1>
      </div>
      <Tabs defaultValue="equipamentos">
        <TabsList>
          <TabsTrigger value="equipamentos" className="gap-1.5">
            <Cpu className="h-3.5 w-3.5" /> Gateways e catracas
          </TabsTrigger>
          <TabsTrigger value="acessos" className="gap-1.5">
            <ScrollText className="h-3.5 w-3.5" /> Acessos
          </TabsTrigger>
          <TabsTrigger value="biometria" className="gap-1.5">
            <Fingerprint className="h-3.5 w-3.5" /> Biometria
          </TabsTrigger>
        </TabsList>
        <TabsContent value="equipamentos" className="pt-3">
          <ListaEquipamentos />
        </TabsContent>
        <TabsContent value="acessos" className="pt-3">
          <ConsultaAcessos />
        </TabsContent>
        <TabsContent value="biometria" className="pt-3">
          <PainelBiometria />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ListaEquipamentos() {
  const { data = [], isLoading, error } = useEquipamentosGlobais();
  const [aberto, setAberto] = useState<EquipamentoGlobal | null>(null);
  const lista = useMemo(() => ordenarEquipamentos(data), [data]);
  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of data) c[e.situacao] = (c[e.situacao] ?? 0) + 1;
    return c;
  }, [data]);

  if (error) return <p className="text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</p>;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap gap-4">
          {(["offline", "contingencia", "online", "nunca_conectou"] as const).map((s) => (
            <div key={s}>
              <p className={cn("text-2xl font-bold", (contagem[s] ?? 0) > 0 && TOM[SITUACAO_GATEWAY[s].tom])}>
                {contagem[s] ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">{SITUACAO_GATEWAY[s].rotulo}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          "Sem sinal" é o Gateway Local 1.0 que não reporta há mais de 3 minutos; um e-mail sai depois de 15, no horário
          configurado em Configurações. Toque numa linha para ver o histórico e agir remotamente.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? null : lista.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma catraca cadastrada em nenhuma academia.</p>
        ) : (
          <div className="divide-y divide-border">
            {lista.map((e) => {
              const info = SITUACAO_GATEWAY[e.situacao];
              return (
                <button
                  key={e.catraca_id}
                  type="button"
                  onClick={() => setAberto(e)}
                  className="flex w-full flex-wrap items-start justify-between gap-2 py-2.5 text-left hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {e.academia} <span className="font-normal text-muted-foreground">· {e.catraca}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      <span className={TOM[info.tom]}>{info.rotulo}</span>
                      {e.situacao !== "nunca_conectou" && ` · sinal ${tempoDesde(e.reportado_em ?? e.ultimo_heartbeat_em)}`}
                      {e.versao ? ` · Gateway ${e.versao}` : e.situacao !== "nunca_conectou" ? " · Gateway anterior à 1.0" : ""}
                      {e.modelo ? ` · ${e.modelo}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(e.fila_offline ?? 0) > 0 && <Badge variant="outline">{e.fila_offline} guardado(s)</Badge>}
                    {e.comandos_falhos_7d > 0 && <Badge variant="destructive">{e.comandos_falhos_7d} ordem(ns) falha(s)</Badge>}
                    {e.contingencias_7d > 0 && <Badge variant="outline">{e.contingencias_7d} contingência(s) em 7d</Badge>}
                    <Badge variant="secondary">{e.acessos_hoje} acesso(s) hoje</Badge>
                    {e.checkins_parceiro_mes > 0 && <Badge variant="secondary">{e.checkins_parceiro_mes} parceiro(s) no mês</Badge>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
      <Sheet open={!!aberto} onOpenChange={(v) => !v && setAberto(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {aberto && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {aberto.academia} · {aberto.catraca}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4">
                <SaudeGateway
                  catracaId={aberto.catraca_id}
                  status={aberto.status_catraca}
                  heartbeat={aberto.ultimo_heartbeat_em}
                  podeComandar
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

type Acesso = {
  id: string;
  ocorrido_em: string;
  academia: string;
  catraca: string | null;
  resultado: string;
  giro: string | null;
  validado_offline: boolean | null;
  credencial: string;
  aluno_ref: string | null;
  parceiro_externo: string | null;
};

const PERIODOS = { "1h": 1, "24h": 24, "7d": 24 * 7, "31d": 24 * 31 } as const;

function ConsultaAcessos() {
  const { data: equipamentos = [] } = useEquipamentosGlobais();
  const academias = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of equipamentos) m.set(e.organization_id, e.academia);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [equipamentos]);
  const [org, setOrg] = useState("todas");
  const [catraca, setCatraca] = useState("todas");
  const [resultado, setResultado] = useState("todos");
  const [periodo, setPeriodo] = useState<keyof typeof PERIODOS>("24h");

  const consulta = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_acessos_catraca", {
        _organization_id: org === "todas" ? undefined : org,
        _catraca_id: catraca === "todas" ? undefined : catraca,
        _resultado: resultado === "todos" ? undefined : resultado,
        _desde: new Date(Date.now() - PERIODOS[periodo] * 3_600_000 + 60_000).toISOString(),
        _ate: new Date().toISOString(),
        _limite: 500,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as Acesso[];
    },
  });

  const catracasDaOrg = equipamentos.filter((e) => org === "todas" || e.organization_id === org);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" /> Acessos pela catraca
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Para o suporte entender o que aconteceu na catraca de uma academia — não quem entrou. O aluno aparece como um
          código (o mesmo aluno, o mesmo código, dentro da consulta), sem nome nem CPF. <strong>Cada consulta fica
          registrada na Auditoria</strong>, com os filtros usados.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Academia</Label>
            <Select value={org} onValueChange={(v) => { setOrg(v); setCatraca("todas"); }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {academias.map(([id, nome]) => (
                  <SelectItem key={id} value={id}>{nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Catraca</Label>
            <Select value={catraca} onValueChange={setCatraca}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {catracasDaOrg.map((e) => (
                  <SelectItem key={e.catraca_id} value={e.catraca_id}>
                    {org === "todas" ? `${e.academia} · ` : ""}{e.catraca}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Resultado</Label>
            <Select value={resultado} onValueChange={setResultado}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {Object.entries(RESULTADO).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Período</Label>
            <Select value={periodo} onValueChange={(v) => setPeriodo(v as keyof typeof PERIODOS)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Última hora</SelectItem>
                <SelectItem value="24h">Últimas 24 h</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="31d">Últimos 31 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button disabled={consulta.isPending} onClick={() => consulta.mutate()}>
          {consulta.isPending ? "Consultando..." : "Consultar (fica registrado)"}
        </Button>
        {consulta.error && <p className="text-sm text-destructive">{(consulta.error as Error).message}</p>}
        {consulta.data && (
          consulta.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum acesso no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Quando</th>
                    <th className="py-1 pr-2 font-medium">Onde</th>
                    <th className="py-1 pr-2 font-medium">Resultado</th>
                    <th className="py-1 pr-2 font-medium">Credencial</th>
                    <th className="py-1 font-medium">Aluno</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {consulta.data.map((a) => (
                    <tr key={a.id}>
                      <td className="py-1 pr-2 whitespace-nowrap">{new Date(a.ocorrido_em).toLocaleString("pt-BR")}</td>
                      <td className="py-1 pr-2">{a.academia}{a.catraca ? ` · ${a.catraca}` : ""}</td>
                      <td className="py-1 pr-2">
                        {RESULTADO[a.resultado] ?? a.resultado}
                        {a.giro === "desistencia" ? " (não passou)" : ""}
                        {a.validado_offline ? " · offline" : ""}
                      </td>
                      <td className="py-1 pr-2">{CREDENCIAL[a.credencial] ?? a.credencial}{a.parceiro_externo ? ` · ${a.parceiro_externo}` : ""}</td>
                      <td className="py-1 font-mono">{a.aluno_ref ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {consulta.data.length} linha(s){consulta.data.length === 500 ? " — o limite da consulta; estreite os filtros para ver o resto" : ""}.
              </p>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

type LinhaBiometria = {
  organization_id: string;
  academia: string;
  consentimentos_vigentes: number;
  consentimentos_texto_antigo: number;
  alunos_com_identificador: number;
  revogacoes_30d: number;
  remocoes_em_andamento: number;
  remocoes_paradas: number;
  tarefas_equipamento_abertas: number;
};

function PainelBiometria() {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["superadmin-biometria"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_biometria");
      if (error) throw error;
      return (data ?? []) as unknown as LinhaBiometria[];
    },
  });

  if (error) return <p className="text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</p>;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Fingerprint className="h-4 w-4" /> Biometria por academia
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Só contagens — nenhuma digital passa pela nuvem, e aqui não se vê de quem é cada consentimento. O que exige
          ação: <strong>remoção parada</strong> (autorização retirada há mais de 24 h e a digital ainda no equipamento) e
          tarefa de remoção aberta na fila da academia. Retirar a autorização e não apagar do equipamento é
          descumprimento da LGPD.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? null : data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma academia com catraca ou biometria.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Academia</th>
                  <th className="py-1 pr-2 font-medium">Autorizações vigentes</th>
                  <th className="py-1 pr-2 font-medium">Sob texto antigo</th>
                  <th className="py-1 pr-2 font-medium">Com número na catraca</th>
                  <th className="py-1 pr-2 font-medium">Retiradas (30d)</th>
                  <th className="py-1 pr-2 font-medium">Remoções em andamento</th>
                  <th className="py-1 font-medium">Paradas / tarefas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((b) => {
                  const problema = b.remocoes_paradas > 0 || b.tarefas_equipamento_abertas > 0;
                  return (
                    <tr key={b.organization_id} className={cn(problema && "bg-destructive/5")}>
                      <td className="py-1.5 pr-2 font-medium">{b.academia}</td>
                      <td className="py-1.5 pr-2">{b.consentimentos_vigentes}</td>
                      <td className="py-1.5 pr-2">{b.consentimentos_texto_antigo}</td>
                      <td className="py-1.5 pr-2">{b.alunos_com_identificador}</td>
                      <td className="py-1.5 pr-2">{b.revogacoes_30d}</td>
                      <td className="py-1.5 pr-2">{b.remocoes_em_andamento}</td>
                      <td className={cn("py-1.5", problema && "font-semibold text-destructive")}>
                        {b.remocoes_paradas} / {b.tarefas_equipamento_abertas}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
