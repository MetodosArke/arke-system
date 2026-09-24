import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SaudeRotinas, UltimaReconciliacao } from "@/components/superadmin/SaudeRotinas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Webhook,
  Search,
  CheckCircle2,
  AlertTriangle,
  CircleSlash,
  Clock,
  HelpCircle,
} from "lucide-react";
import { decimal } from "@/lib/numeros";

// Nulos são reais aqui (evento sem payment_id, sem resultado, sem erro) e o
// gerador de tipos do Supabase declara colunas de RPC como não-nulas.
type Evento = {
  id: string;
  created_at: string;
  processed_at: string | null;
  tipo_evento: string | null;
  asaas_event_id: string | null;
  asaas_payment_id: string | null;
  processado: boolean;
  resultado: string | null;
  erro: string | null;
  situacao: "ok" | "erro" | "pendente" | "sem_efeito" | "indeterminado";
  payload: unknown;
};

type Resumo = {
  total: number;
  ultimas_24h: number;
  erros: number;
  pendentes: number;
  sem_efeito: number;
  primeiro_evento_em: string | null;
  ultimo_evento_em: string | null;
  horas_desde_ultimo: number | null;
};

const SITUACOES = {
  ok: {
    label: "Aplicado",
    icon: CheckCircle2,
    classe: "text-emerald-600 dark:text-emerald-400",
    ajuda: "O evento encontrou a cobrança correspondente e atualizou o registro.",
  },
  erro: {
    label: "Erro",
    icon: AlertTriangle,
    classe: "text-destructive",
    ajuda: "O processamento levantou exceção. O evento ficou registrado com a mensagem.",
  },
  pendente: {
    label: "Não concluído",
    icon: Clock,
    classe: "text-amber-600 dark:text-amber-400",
    ajuda: "Registrado mas nunca finalizado — a função morreu no meio (timeout, deploy durante a execução).",
  },
  sem_efeito: {
    label: "Sem efeito",
    icon: CircleSlash,
    classe: "text-amber-600 dark:text-amber-400",
    ajuda:
      "Rodou até o fim sem casar com nenhuma cobrança do banco. É o sintoma de wallet ou assinatura apontando para outro ambiente do Asaas.",
  },
  indeterminado: {
    label: "Indeterminado",
    icon: HelpCircle,
    classe: "text-muted-foreground",
    ajuda: "Evento anterior ao registro de desfecho — não dá para afirmar retroativamente se teve efeito.",
  },
} as const;

// O que cada desfecho gravado pela Edge Function quer dizer, em português.
const RESULTADOS: Record<string, string> = {
  cobranca_b2b_atualizada: "Cobrança B2B atualizada",
  cobranca_b2b_emitida: "Mensalidade B2B emitida",
  cobranca_b2b_criada: "Mensalidade B2B registrada",
  mensalidade_atualizada: "Mensalidade da academia atualizada",
  mensalidade_criada: "Mensalidade da academia criada",
  pagamento_arke_atualizado: "Pagamento do Método ARKE atualizado",
  pagamento_arke_criado: "Pagamento do Método ARKE criado",
  sem_correspondencia: "Nenhuma cobrança correspondente no banco",
  evento_ignorado: "Tipo de evento que não movimenta cobrança",
  sem_payment_id: "Evento sem payment.id",
};

const formatarDataHora = (valor: string) =>
  new Date(valor).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatarSilencio = (horas: number | null) => {
  if (horas === null) return null;
  if (horas < 1) return `${Math.round(horas * 60)} min atrás`;
  if (horas < 24) return `${decimal(horas, 1)} h atrás`;
  return `${Math.floor(horas / 24)} d atrás`;
};

export default function SuperAdminWebhooks() {
  const [filtroSituacao, setFiltroSituacao] = useState<string>("todas");
  const [busca, setBusca] = useState("");

  const { data: eventos = [], error: erroEventos } = useQuery({
    queryKey: ["superadmin-webhooks-asaas"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_webhooks_asaas", { _limite: 200 });
      if (error) throw error;
      return (data ?? []) as unknown as Evento[];
    },
  });

  const { data: resumo, error: erroResumo } = useQuery({
    queryKey: ["superadmin-webhooks-asaas-resumo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_webhooks_asaas_resumo");
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as unknown as Resumo | null;
    },
  });

  const erro = erroEventos ?? erroResumo;

  const eventosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return eventos.filter((e) => {
      const bateSituacao = filtroSituacao === "todas" || e.situacao === filtroSituacao;
      const bateBusca =
        !termo ||
        (e.tipo_evento ?? "").toLowerCase().includes(termo) ||
        (e.asaas_payment_id ?? "").toLowerCase().includes(termo) ||
        (e.asaas_event_id ?? "").toLowerCase().includes(termo);
      return bateSituacao && bateBusca;
    });
  }, [eventos, filtroSituacao, busca]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Webhooks do Asaas</h1>
        <p className="text-sm text-muted-foreground">
          Todo evento que o gateway entrega, com o que ele efetivamente fez no banco.
        </p>
      </div>

      <SaudeRotinas />
      <UltimaReconciliacao />

      {erro && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-destructive text-center">
              Não foi possível carregar os webhooks: {(erro as Error).message}
            </p>
          </CardContent>
        </Card>
      )}

      {!erro && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Webhook className="h-4 w-4" /> Entrega
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Últimas 24h</p>
                  <p className="text-lg font-bold">{resumo?.ultimas_24h ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Com erro</p>
                  <p className={`text-lg font-bold ${(resumo?.erros ?? 0) > 0 ? "text-destructive" : ""}`}>
                    {resumo?.erros ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Sem efeito</p>
                  <p
                    className={`text-lg font-bold ${
                      (resumo?.sem_efeito ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : ""
                    }`}
                  >
                    {resumo?.sem_efeito ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total recebido</p>
                  <p className="text-lg font-bold">{resumo?.total ?? 0}</p>
                </div>
              </div>

              {resumo && resumo.total === 0 ? (
                // Zero evento tem duas causas bem diferentes e a ação do time
                // muda conforme a causa — dizer só "nenhum evento" esconde isso.
                <p className="text-[11px] text-muted-foreground">
                  Nenhum evento recebido até agora. Ou o Asaas ainda não foi apontado para a URL do webhook, ou os
                  secrets <code>ASAAS_API_KEY</code> e <code>ASAAS_WEBHOOK_SECRET</code> ainda não foram configurados
                  no projeto Supabase — sem eles a função recusa a entrega antes de registrar qualquer coisa.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Último evento: {resumo?.ultimo_evento_em ? formatarDataHora(resumo.ultimo_evento_em) : "—"}
                  {formatarSilencio(resumo?.horas_desde_ultimo ?? null) &&
                    ` (${formatarSilencio(resumo?.horas_desde_ultimo ?? null)})`}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Eventos recebidos</CardTitle>
              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar por tipo, payment_id ou event_id"
                    className="pl-8"
                  />
                </div>
                <Select value={filtroSituacao} onValueChange={setFiltroSituacao}>
                  <SelectTrigger className="sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas as situações</SelectItem>
                    {Object.entries(SITUACOES).map(([chave, { label }]) => (
                      <SelectItem key={chave} value={chave}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {eventosFiltrados.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  {eventos.length === 0
                    ? "Nenhum evento registrado ainda."
                    : "Nenhum evento corresponde ao filtro."}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {eventosFiltrados.map((e) => {
                    const { label, icon: Icon, classe, ajuda } = SITUACOES[e.situacao];
                    return (
                      <div key={e.id} className="py-3 flex items-start gap-2.5">
                        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${classe}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-medium">{e.tipo_evento || "evento sem tipo"}</span>
                            <Badge variant="outline" className={`text-[10px] ${classe}`}>
                              {label}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {formatarDataHora(e.created_at)}
                            {e.asaas_payment_id && ` · pagamento ${e.asaas_payment_id}`}
                          </p>
                          {e.resultado && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {RESULTADOS[e.resultado] ?? e.resultado}
                            </p>
                          )}
                          {/* A situação sozinha não diz o que fazer; a frase de
                              ajuda é o que separa "investigar" de "ignorar". */}
                          {e.situacao !== "ok" && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">{ajuda}</p>
                          )}
                          {e.erro && (
                            <p className="text-[11px] text-destructive mt-1 break-all">{e.erro}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
