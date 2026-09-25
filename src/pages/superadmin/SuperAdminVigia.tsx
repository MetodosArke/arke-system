import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Radar } from "lucide-react";
import { tempoDesde } from "@/lib/gateway";
import {
  JANELAS,
  ROTULO_CAUSA,
  ROTULO_CLASSE,
  ROTULO_MODO,
  ROTULO_RECUSA,
  ROTULO_STATUS_ANALISE,
  aprovarAcaoVigia,
  definirModoRegra,
  desfechoOcorrencia,
  dispensarAcaoVigia,
  executando,
  modosDaRegra,
  periodoSombra,
  rotuloFerramenta,
  useVigia,
  type AcaoVigia,
  type AnaliseVigia,
  type ExecutadaVigia,
  type ModoRegra,
  type PendenteVigia,
  type ResumoVigia,
} from "@/lib/vigia";
import { cn } from "@/lib/utils";
import { decimal } from "@/lib/numeros";
import { formatarDataBR } from "@/lib/dataBrasilia";

const TOM = {
  ok: "text-emerald-700 dark:text-emerald-400",
  atencao: "text-amber-700 dark:text-amber-400",
  problema: "text-destructive",
  neutro: "text-muted-foreground",
} as const;

const TOM_CLASSE: Record<string, string> = {
  sozinho: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  aprovacao: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  humano: "border-sky-600/40 text-sky-700 dark:text-sky-400",
  recusada: "border-destructive/40 text-destructive",
};

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Visão Master → Vigia, o agente de saúde técnica. As regras de nível 1
 * corrigem sozinhas; as de nível 2 e as ações propostas pela análise por IA
 * esperam aprovação de um clique aqui. A tela responde três perguntas: o que
 * espera decisão, o que o Vigia fez, e o que ele está vendo.
 */
export default function SuperAdminVigia() {
  const [horas, setHoras] = useState<number>(24);
  const { data, isLoading, error } = useVigia(horas);
  const emExecucao = data ? executando(data.regras) : false;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Radar className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Vigia</h1>
        {data && <Badge variant="outline">{emExecucao ? "Executando" : "Modo sombra"}</Badge>}
      </div>

      {error ? (
        <p className="text-sm text-destructive">Não foi possível carregar o Vigia.</p>
      ) : isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          <Situacao resumo={data} horas={horas} onHoras={setHoras} emExecucao={emExecucao} />
          {emExecucao && <Pendentes pendentes={data.pendentes ?? []} />}
          {emExecucao && <Executadas resumo={data} />}
          <Regras resumo={data} />
          <Analises resumo={data} />
          <Ocorrencias resumo={data} />
        </>
      )}
    </div>
  );
}

function Situacao({
  resumo,
  horas,
  onHoras,
  emExecucao,
}: {
  resumo: ResumoVigia;
  horas: number;
  onHoras: (h: number) => void;
  emExecucao: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const alternar = useMutation({
    mutationFn: async (ativo: boolean) => {
      const { error } = await supabase.rpc("definir_vigia_ativo", { _ativo: ativo });
      if (error) throw error;
    },
    onSuccess: (_d, ativo) => {
      toast({ title: ativo ? "Vigia ligado" : "Vigia desligado" });
      qc.invalidateQueries({ queryKey: ["vigia"] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível mudar", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {emExecucao ? (
              <p className="text-sm text-muted-foreground">
                A cada 5 minutos o Vigia confere a plataforma. <strong>As regras de nível 1 corrigem sozinhas</strong>; as de
                nível 2 e as ações da análise por IA esperam aprovação aqui. O que pede aprovação, ou precisa de uma pessoa, é
                avisado por e-mail na hora; um resumo sai todo dia às 8h.
              </p>
            ) : (
              <>
                <p className="font-semibold">{periodoSombra(resumo)}</p>
                <p className="text-sm text-muted-foreground">
                  Regras e análise por IA observam a plataforma a cada 5 minutos e registram o que fariam.{" "}
                  <strong>Nada é executado no modo sombra.</strong> Um resumo sai por e-mail todo dia às 8h.
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="vigia-ativo"
              checked={resumo.ativo}
              disabled={alternar.isPending}
              onCheckedChange={(v) => alternar.mutate(v)}
            />
            <Label htmlFor="vigia-ativo">{resumo.ativo ? "Ligado" : "Desligado"}</Label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Select value={String(horas)} onValueChange={(v) => onHoras(Number(v))}>
            <SelectTrigger className="w-44" aria-label="Período">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JANELAS.map((j) => (
                <SelectItem key={j.horas} value={String(j.horas)}>
                  {j.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">
            {resumo.varreduras} varreduras no período · {resumo.total.deteccoes} detecções
            {emExecucao && ` e ${resumo.total.executadas ?? 0} ações executadas`} desde{" "}
            {formatarDataBR(resumo.sombra_desde)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Pendentes({ pendentes }: { pendentes: PendenteVigia[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dispensando, setDispensando] = useState<PendenteVigia | null>(null);
  const [motivo, setMotivo] = useState("");

  const aprovar = useMutation({
    mutationFn: aprovarAcaoVigia,
    onSuccess: (detalhe) => toast({ title: "Aprovado", description: detalhe }),
    onError: (e: Error) => toast({ title: "Não foi possível aprovar", description: e.message, variant: "destructive" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["vigia"] }),
  });
  const dispensar = useMutation({
    mutationFn: ({ p, m }: { p: PendenteVigia; m: string }) => dispensarAcaoVigia(p, m),
    onSuccess: () => {
      toast({ title: "Dispensado" });
      setDispensando(null);
      setMotivo("");
    },
    onError: (e: Error) => toast({ title: "Não foi possível dispensar", description: e.message, variant: "destructive" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["vigia"] }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Aguardando aprovação</CardTitle>
      </CardHeader>
      <CardContent>
        {pendentes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada esperando aprovação.</p>
        ) : (
          <ul className="divide-y">
            {pendentes.map((p) => {
              const chave = `${p.origem}-${p.id}-${p.indice ?? ""}`;
              const ocupado =
                (aprovar.isPending && aprovar.variables?.id === p.id && aprovar.variables?.indice === p.indice) ||
                (dispensar.isPending && dispensar.variables?.p.id === p.id);
              return (
                <li key={chave} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{p.origem === "regra" ? "Regra" : "Análise por IA"}</Badge>
                      <span className="font-medium">{rotuloFerramenta(p.ferramenta)}</span>
                    </div>
                    <p className="text-sm">{p.origem === "regra" ? p.titulo : p.alvo_nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.origem === "regra" ? p.alvo_nome : p.descricao} · {tempoDesde(p.desde)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" disabled={ocupado} onClick={() => aprovar.mutate(p)}>
                      Aprovar
                    </Button>
                    <Button size="sm" variant="outline" disabled={ocupado} onClick={() => setDispensando(p)}>
                      Dispensar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <Dialog open={dispensando !== null} onOpenChange={(v) => !v && setDispensando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispensar esta ação</DialogTitle>
            <DialogDescription>
              {dispensando && rotuloFerramenta(dispensando.ferramenta)} não será executada. A decisão fica registrada.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="motivo-dispensa">Motivo (opcional)</Label>
          <Textarea id="motivo-dispensa" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispensando(null)}>
              Voltar
            </Button>
            <Button
              disabled={dispensar.isPending}
              onClick={() => dispensando && dispensar.mutate({ p: dispensando, m: motivo.trim() })}
            >
              Dispensar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const ROTULO_FORMA: Record<ExecutadaVigia["forma"], string> = {
  automatica: "sozinho",
  aprovada: "aprovada",
  dispensada: "dispensada",
};

function Executadas({ resumo }: { resumo: ResumoVigia }) {
  const e = resumo.executadas;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">O que o Vigia fez</CardTitle>
        <p className="text-sm text-muted-foreground">
          {e.automaticas} sozinho, {e.aprovadas} aprovada(s), {e.dispensadas} dispensada(s)
          {e.erros > 0 && `, ${e.erros} com erro`}. Ordem ao Gateway conta como feita quando entra na fila; o desfecho dela
          aparece ao lado.
        </p>
      </CardHeader>
      <CardContent>
        {e.lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ação no período.</p>
        ) : (
          <ul className="divide-y">
            {e.lista.map((x) => (
              <li key={x.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm">
                    <strong>{rotuloFerramenta(x.ferramenta)}</strong>
                    {x.alvo_nome && <span className="text-muted-foreground"> — {x.alvo_nome}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {hora(x.criada_em)} · {ROTULO_FORMA[x.forma]}
                    {x.decidido_por && ` por ${x.decidido_por}`}
                    {x.detalhe && ` · ${x.detalhe}`}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-sm",
                    x.resultado === "erro" || x.comando_status === "falhou" || x.comando_status === "expirado"
                      ? TOM.problema
                      : x.resultado === "ok"
                        ? TOM.ok
                        : TOM.neutro,
                  )}
                >
                  {x.resultado === "erro"
                    ? "falhou"
                    : x.comando_status
                      ? `ordem ${x.comando_status}`
                      : x.resultado === "dispensada"
                        ? "dispensada"
                        : x.resultado === "executando"
                          ? "executando"
                          : "feito"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Regras({ resumo }: { resumo: ResumoVigia }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const mudar = useMutation({
    mutationFn: ({ codigo, modo }: { codigo: string; modo: ModoRegra }) => definirModoRegra(codigo, modo),
    onSuccess: () => toast({ title: "Modo da regra alterado" }),
    onError: (e: Error) => toast({ title: "Não foi possível mudar", description: e.message, variant: "destructive" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["vigia"] }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Regras</CardTitle>
        <p className="text-sm text-muted-foreground">
          Nível 1 corrige sozinho; nível 2 pede aprovação. "Sumiram antes" são as vezes em que o problema passou antes da hora
          de agir. Cada mudança de modo fica na Auditoria.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nível</TableHead>
              <TableHead>Regra e o que faz</TableHead>
              <TableHead>Modo</TableHead>
              <TableHead className="text-right">Detecções</TableHead>
              <TableHead className="text-right">Agiu</TableHead>
              <TableHead className="text-right">Sumiram antes</TableHead>
              <TableHead className="text-right">Para uma pessoa</TableHead>
              <TableHead className="text-right">Freio</TableHead>
              <TableHead className="text-right">Abertas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resumo.regras.map((r) => (
              <TableRow key={r.codigo} className={cn(r.modo === "desligada" && "opacity-50")}>
                <TableCell>{r.nivel}</TableCell>
                <TableCell>
                  <p className="font-medium">{r.titulo}</p>
                  <p className="text-xs text-muted-foreground">{r.acao}</p>
                </TableCell>
                <TableCell>
                  <Select
                    value={r.modo}
                    disabled={mudar.isPending}
                    onValueChange={(v) => mudar.mutate({ codigo: r.codigo, modo: v as ModoRegra })}
                  >
                    <SelectTrigger className="h-8 w-36" aria-label={`Modo: ${r.titulo}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modosDaRegra(r.nivel).map((m) => (
                        <SelectItem key={m} value={m}>
                          {ROTULO_MODO[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right">{r.deteccoes}</TableCell>
                <TableCell className="text-right">{r.teria_agido}</TableCell>
                <TableCell className="text-right">
                  {r.sumiram_antes}
                  {r.mediana_min_sumiram != null && (
                    <span className="block text-xs text-muted-foreground">
                      mediana {String(r.mediana_min_sumiram).replace(".", ",")} min
                    </span>
                  )}
                </TableCell>
                <TableCell className={cn("text-right", r.escalariam > 0 && TOM.problema)}>{r.escalariam}</TableCell>
                <TableCell className={cn("text-right", r.freios > 0 && TOM.atencao)}>{r.freios}</TableCell>
                <TableCell className="text-right">{r.abertas}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Acao({ acao }: { acao: AcaoVigia }) {
  const tom = acao.recusada ? "recusada" : (acao.classe ?? "recusada");
  const rotulo = acao.recusada ? ROTULO_RECUSA[acao.recusada] : acao.classe ? ROTULO_CLASSE[acao.classe] : "";
  const decisao = acao.decisao;
  return (
    <li className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
      <Badge variant="outline" className={cn("w-fit shrink-0", TOM_CLASSE[tom])}>
        {rotulo}
      </Badge>
      <span className="text-sm">
        <strong>{rotuloFerramenta(acao.ferramenta)}</strong>
        {acao.alvo !== "plataforma" && <> em {acao.alvo_nome}</>}
        {acao.justificativa && <span className="text-muted-foreground"> — {acao.justificativa}</span>}
        {decisao && (
          <span className={cn("ml-1", decisao.resultado === "erro" ? TOM.problema : TOM.neutro)}>
            · {decisao.forma === "dispensada" ? "dispensada" : decisao.resultado === "erro" ? "aprovada, mas falhou" : "aprovada"}
          </span>
        )}
      </span>
    </li>
  );
}

function Analise({ analise }: { analise: AnaliseVigia }) {
  return (
    <div className="space-y-2 border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{hora(analise.criada_em)}</span>
        {analise.status === "ok" ? (
          <>
            {analise.gravidade && <Badge variant="secondary">gravidade {analise.gravidade}</Badge>}
            {analise.causa_provavel && (
              <span className="font-medium">{ROTULO_CAUSA[analise.causa_provavel] ?? analise.causa_provavel}</span>
            )}
            {analise.confianca != null && <span className="text-muted-foreground">· confiança declarada {analise.confianca}%</span>}
          </>
        ) : (
          <Badge variant="outline" className={TOM_CLASSE.recusada}>
            {ROTULO_STATUS_ANALISE[analise.status]}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          · {analise.anomalias} anomalia(s){analise.latencia_ms != null && ` · ${decimal(analise.latencia_ms / 1000, 1)} s`}
        </span>
      </div>
      {analise.diagnostico && <p className="text-sm">{analise.diagnostico}</p>}
      {analise.status !== "ok" && analise.motivo && <p className="text-xs text-muted-foreground">{analise.motivo}</p>}
      {analise.acoes.length > 0 && (
        <ul className="space-y-1.5">
          {analise.acoes.map((a, i) => (
            <Acao key={i} acao={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Analises({ resumo }: { resumo: ResumoVigia }) {
  const a = resumo.analises;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Análise por IA</CardTitle>
        <p className="text-sm text-muted-foreground">
          Roda quando o quadro de anomalias muda e vê tudo junto — é o que liga duas catracas caídas à internet de uma academia. O
          quadro enviado ao modelo só tem tipos de anomalia, números e pseudônimos, sem dado de ninguém. A IA é conselheira: as
          ações que ela propõe esperam aprovação em "Aguardando aprovação", e a confiança que ela declara não decide nada.
        </p>
      </CardHeader>
      <CardContent>
        {a.total === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma análise no período: o quadro não mudou ou estava vazio.</p>
        ) : (
          <>
            <p className="pb-2 text-sm">
              {a.total} análise(s) · ações propostas: {a.acoes_sozinho} faria sozinho, {a.acoes_aprovacao} pediria aprovação,{" "}
              {a.acoes_humano} pede uma pessoa{a.acoes_recusadas > 0 && `, ${a.acoes_recusadas} barrada(s) pelas travas`}
              {a.indisponiveis > 0 && ` · ${a.indisponiveis} com o modelo indisponível`}
            </p>
            {a.lista.map((x) => (
              <Analise key={x.id} analise={x} />
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Ocorrencias({ resumo }: { resumo: ResumoVigia }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Ocorrências</CardTitle>
      </CardHeader>
      <CardContent>
        {resumo.ocorrencias.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ocorrência no período.</p>
        ) : (
          <ul className="divide-y">
            {resumo.ocorrencias.map((o) => {
              const d = desfechoOcorrencia(o);
              return (
                <li key={o.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm">{o.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      Nível {o.nivel} · {o.titulo} · aberta {tempoDesde(o.aberta_em)}
                      {o.fechada_em && ` · fechada ${tempoDesde(o.fechada_em)}`}
                    </p>
                  </div>
                  <span className={cn("shrink-0 text-sm", TOM[d.tom])}>{d.texto}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
