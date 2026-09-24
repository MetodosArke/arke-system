import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, DoorOpen, RefreshCw, Stethoscope, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useComandoGateway } from "@/hooks/useComandoGateway";
import { ProgressoComando } from "@/components/catraca/ProgressoComando";
import {
  ROTULO_COMANDO,
  ROTULO_STATUS_COMANDO,
  SITUACAO_GATEWAY,
  equipamentosDeGestao,
  situacaoGateway,
  tempoDesde,
  type StatusComando,
  type TipoComando,
} from "@/lib/gateway";
import { cn } from "@/lib/utils";

const TOM_BADGE = {
  ok: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  atencao: "border-amber-500/50 text-amber-700 dark:text-amber-400",
  problema: "border-destructive/50 text-destructive",
  neutro: "",
} as const;

const EVENTO: Record<string, string> = {
  conectou: "Passou a reportar",
  voltou: "Voltou",
  contingencia: "Entrou em contingência",
  normalizou: "Saiu da contingência",
  erro: "Erro",
};

/**
 * Saúde de um Gateway Local e as ações remotas sobre ele.
 *
 * Mesmo componente na tela da academia e na Visão Master: o suporte da
 * ArkeFit e a recepção olham para os mesmos números, e "sem sinal há 20 min"
 * quer dizer a mesma coisa para os dois. As ações passam por
 * solicitar_comando_gateway(), que confere papel e capacidade no banco — o
 * botão escondido aqui é conveniência, não trava.
 */
export function SaudeGateway({
  catracaId,
  status,
  heartbeat,
  podeComandar,
}: {
  catracaId: string;
  status: string;
  heartbeat: string | null;
  podeComandar: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const comando = useComandoGateway();
  const [liberarAberto, setLiberarAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [sentido, setSentido] = useState<"entrada" | "saida" | "ambos">("entrada");

  const { data } = useQuery({
    queryKey: ["gateway-saude", catracaId],
    queryFn: async () => {
      const [tel, eventos, comandos] = await Promise.all([
        supabase.from("gateway_telemetria").select("*").eq("catraca_id", catracaId).maybeSingle(),
        supabase
          .from("gateway_eventos")
          .select("id, tipo, detalhe, ocorrido_em")
          .eq("catraca_id", catracaId)
          .order("ocorrido_em", { ascending: false })
          .limit(8),
        supabase
          .from("gateway_comandos")
          .select("id, tipo, status, erro, solicitado_em, concluido_em")
          .eq("catraca_id", catracaId)
          .order("solicitado_em", { ascending: false })
          .limit(8),
      ]);
      if (tel.error) throw tel.error;
      if (eventos.error) throw eventos.error;
      if (comandos.error) throw comandos.error;
      return { tel: tel.data, eventos: eventos.data ?? [], comandos: comandos.data ?? [] };
    },
    refetchInterval: 20_000,
  });

  const tel = data?.tel ?? null;
  const situacao = status !== "ativo" ? "desativada" : situacaoGateway(heartbeat, tel?.reportado_em, tel?.estado);
  const info = SITUACAO_GATEWAY[situacao];
  const capacidades = tel?.capacidades ?? [];
  const pode = (t: TipoComando) => podeComandar && status === "ativo" && capacidades.includes(t);
  const noAr = situacao === "online" || situacao === "contingencia";

  const ordem = async (tipo: TipoComando, opcoes: { parametros?: Record<string, unknown>; motivo?: string } = {}) => {
    try {
      await comando.executar(catracaId, tipo, opcoes);
    } catch (e) {
      toast({ title: "Não foi possível enviar ao Gateway", description: (e as Error).message, variant: "destructive" });
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["gateway-saude", catracaId] });
    }
  };

  const equipamentos = Array.isArray(tel?.equipamentos)
    ? (tel!.equipamentos as { nome?: string; tipo?: string; visto_em?: string | null; detalhe?: string }[]).filter(
        (e) => e?.tipo !== "controlid-gestao"
      )
    : [];
  const gestao = equipamentosDeGestao(tel?.equipamentos);

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn("gap-1", TOM_BADGE[info.tom])}>
          <Activity className="h-3 w-3" /> {info.rotulo}
        </Badge>
        {tel?.versao && <span className="text-xs text-muted-foreground">Gateway {tel.versao}</span>}
        <span className="text-xs text-muted-foreground">
          último sinal {tempoDesde(tel?.reportado_em ?? heartbeat)}
        </span>
      </div>
      {situacao !== "online" && <p className="text-xs text-muted-foreground">{info.descricao}</p>}

      {tel && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Acessos guardados</dt>
            <dd className={cn("font-medium", tel.fila_offline > 0 && "text-amber-700 dark:text-amber-400")}>{tel.fila_offline}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Alunos no cadastro local</dt>
            <dd className="font-medium">{tel.cache_alunos}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Última sincronização</dt>
            <dd className="font-medium">{tempoDesde(tel.ultima_sincronizacao)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Gestão remota</dt>
            <dd className="font-medium">{gestao.length ? gestao.join(", ") : "não configurada"}</dd>
          </div>
        </dl>
      )}

      {equipamentos.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {equipamentos.map((e, i) => (
            <li key={`${e.nome}-${i}`}>
              <span className="font-medium">{e.nome}</span>{" "}
              <span className="text-muted-foreground">
                — {e.visto_em ? `sinal ${tempoDesde(e.visto_em)}` : "sem sinal"}
                {e.detalhe ? ` · ${e.detalhe}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tel?.ultimo_erro && (
        <p className="rounded-md bg-muted p-2 font-mono text-[11px]">
          {tempoDesde(tel.ultimo_erro_em)}: {tel.ultimo_erro}
        </p>
      )}

      {podeComandar && status === "ativo" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!noAr || comando.emAndamento || !pode("sincronizar_completo")} onClick={() => void ordem("sincronizar_completo")}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Sincronizar agora
          </Button>
          <Button size="sm" variant="outline" disabled={!noAr || comando.emAndamento || !pode("enviar_logs")} onClick={() => void ordem("enviar_logs")}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Enviar acessos guardados
          </Button>
          <Button size="sm" variant="outline" disabled={!noAr || comando.emAndamento || !pode("diagnostico")} onClick={() => void ordem("diagnostico")}>
            <Stethoscope className="mr-1.5 h-3.5 w-3.5" /> Diagnóstico
          </Button>
          {pode("liberar_catraca") && (
            <Button size="sm" disabled={!noAr || comando.emAndamento} onClick={() => setLiberarAberto(true)}>
              <DoorOpen className="mr-1.5 h-3.5 w-3.5" /> Liberar catraca
            </Button>
          )}
        </div>
      )}
      {podeComandar && status === "ativo" && !tel && (
        <p className="text-xs text-muted-foreground">
          Ações remotas precisam do Gateway Local 1.0 — a versão anterior não recebe ordens da nuvem.
        </p>
      )}
      <ProgressoComando estado={comando.estado} />

      {((data?.eventos.length ?? 0) > 0 || (data?.comandos.length ?? 0) > 0) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Histórico recente</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <ul className="space-y-1">
              {data!.eventos.map((e) => (
                <li key={e.id}>
                  <span className="text-muted-foreground">{new Date(e.ocorrido_em).toLocaleString("pt-BR")}</span> ·{" "}
                  {EVENTO[e.tipo] ?? e.tipo}
                  {e.detalhe ? ` — ${e.detalhe}` : ""}
                </li>
              ))}
            </ul>
            <ul className="space-y-1">
              {data!.comandos.map((c) => (
                <li key={c.id}>
                  <span className="text-muted-foreground">{new Date(c.solicitado_em).toLocaleString("pt-BR")}</span> ·{" "}
                  {ROTULO_COMANDO[c.tipo as TipoComando] ?? c.tipo}:{" "}
                  <span className={cn(c.status === "falhou" || c.status === "expirado" ? "text-destructive" : "")}>
                    {ROTULO_STATUS_COMANDO[c.status as StatusComando] ?? c.status}
                  </span>
                  {c.erro ? ` — ${c.erro}` : ""}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <Dialog open={liberarAberto} onOpenChange={setLiberarAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Liberar a catraca remotamente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Abre a catraca uma vez, sem identificar ninguém. Fica registrado quem liberou, quando e por quê — não conta
              como presença de aluno.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor={`motivo-${catracaId}`}>Motivo</Label>
              <Input
                id={`motivo-${catracaId}`}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: aluno sem celular, conferido na recepção"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sentido</Label>
              <Select value={sentido} onValueChange={(v) => setSentido(v as typeof sentido)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada</SelectItem>
                  <SelectItem value="saida">Saída</SelectItem>
                  <SelectItem value="ambos">Os dois</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={motivo.trim().length < 3 || comando.emAndamento}
              onClick={() => {
                setLiberarAberto(false);
                void ordem("liberar_catraca", { parametros: { sentido }, motivo: motivo.trim() });
                setMotivo("");
              }}
            >
              Liberar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
