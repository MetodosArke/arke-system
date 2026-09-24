import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Radar } from "lucide-react";
import { tempoDesde } from "@/lib/gateway";
import {
  JANELAS,
  ROTULO_CAUSA,
  ROTULO_CLASSE,
  ROTULO_FERRAMENTA,
  ROTULO_RECUSA,
  ROTULO_STATUS_ANALISE,
  desfechoOcorrencia,
  periodoSombra,
  useVigia,
  type AcaoVigia,
  type AnaliseVigia,
  type ResumoVigia,
} from "@/lib/vigia";
import { cn } from "@/lib/utils";

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
 * Visão Master → Vigia. O agente de saúde técnica, em modo sombra: regras e
 * análise por IA observam a plataforma e registram o que fariam, sem executar
 * nada. A tela existe para a avaliação das duas semanas — quantas vezes cada
 * regra dispararia, quantas vezes o problema sumiria sozinho, o que a IA
 * diagnosticou e se as ações que ela escolheu fazem sentido.
 */
export default function SuperAdminVigia() {
  const [horas, setHoras] = useState<number>(24);
  const { data, isLoading, error } = useVigia(horas);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Radar className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Vigia</h1>
        <Badge variant="outline">Modo sombra</Badge>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Não foi possível carregar o Vigia.</p>
      ) : isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          <Situacao resumo={data} horas={horas} onHoras={setHoras} />
          <Regras resumo={data} />
          <Analises resumo={data} />
          <Ocorrencias resumo={data} />
        </>
      )}
    </div>
  );
}

function Situacao({ resumo, horas, onHoras }: { resumo: ResumoVigia; horas: number; onHoras: (h: number) => void }) {
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
            <p className="font-semibold">{periodoSombra(resumo)}</p>
            <p className="text-sm text-muted-foreground">
              Regras e análise por IA observam a plataforma a cada 5 minutos e registram o que fariam.{" "}
              <strong>Nada é executado no modo sombra.</strong> Um resumo sai por e-mail todo dia às 8h.
            </p>
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
            {resumo.varreduras} varreduras no período · {resumo.total.deteccoes} detecções e {resumo.total.analises} análises desde{" "}
            {new Date(resumo.sombra_desde).toLocaleDateString("pt-BR")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Regras({ resumo }: { resumo: ResumoVigia }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Regras</CardTitle>
        <p className="text-sm text-muted-foreground">
          Nível 1 faria sozinho; nível 2 pediria aprovação. "Sumiram antes" são as vezes em que o problema passou antes da hora de
          agir — ali a ação teria sido desnecessária.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nível</TableHead>
              <TableHead>Regra e o que faria</TableHead>
              <TableHead className="text-right">Detecções</TableHead>
              <TableHead className="text-right">Teria agido</TableHead>
              <TableHead className="text-right">Sumiram antes</TableHead>
              <TableHead className="text-right">Escalaria</TableHead>
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
  return (
    <li className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
      <Badge variant="outline" className={cn("w-fit shrink-0", TOM_CLASSE[tom])}>
        {rotulo}
      </Badge>
      <span className="text-sm">
        <strong>{ROTULO_FERRAMENTA[acao.ferramenta] ?? acao.ferramenta}</strong>
        {acao.alvo !== "plataforma" && <> em {acao.alvo_nome}</>}
        {acao.justificativa && <span className="text-muted-foreground"> — {acao.justificativa}</span>}
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
          · {analise.anomalias} anomalia(s){analise.latencia_ms != null && ` · ${(analise.latencia_ms / 1000).toFixed(1)} s`}
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
          quadro enviado ao modelo só tem tipos de anomalia, números e pseudônimos, sem dado de ninguém. A classe de cada ação vem
          da lista de ferramentas, nunca do modelo; a confiança que ele declara fica registrada para a avaliação e não decide nada.
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
