import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Gauge, Timer, Users } from "lucide-react";

/**
 * Como a célula de Mentor está indo — para quem responde por ela.
 *
 * Três perguntas, nesta ordem de importância:
 *
 * 1. **Estamos cumprindo o SLA?** É a promessa central do modelo de BPO. Sem
 *    esta medida, a primeira notícia de que ela parou de ser cumprida chega
 *    pela academia cancelando.
 * 2. **A fila está distribuída?** Uma célula de serviço quebra por uma pessoa
 *    segurando tudo, e isso não aparece no total.
 * 3. **Quanto um aluno custa de fila?** É o número que dimensiona a célula e
 *    o que sustenta (ou derruba) o preço por aluno.
 *
 * Cada indicador diz na tela como é calculado. Painel de operação em que
 * ninguém sabe de onde sai o número vira painel que ninguém usa para decidir.
 */

type Operacao = {
  abertas: number;
  vencidas: number;
  concluidas: number;
  dentro_do_sla: number;
  fora_do_sla: number;
  pct_sla: number | null;
  horas_ate_resposta_mediana: number | null;
  horas_ate_resposta_media: number | null;
  alunos_sob_acompanhamento: number;
  organizacoes_atendidas: number;
  mentores_ativos: number;
  alunos_por_mentor: number | null;
  tarefas_por_aluno_mes: number | null;
};

type Carga = {
  mentor_id: string;
  mentor_nome: string;
  abertas: number;
  concluidas: number;
  dentro_do_sla: number;
  pct_sla: number | null;
  horas_ate_resposta_mediana: number | null;
  por_semana: number | null;
};

function Indicador({
  titulo,
  valor,
  comoSeCalcula,
  alerta,
}: {
  titulo: string;
  valor: string;
  comoSeCalcula: string;
  alerta?: boolean;
}) {
  return (
    <div className={`rounded-md border p-3 ${alerta ? "border-destructive/40 bg-destructive/5" : ""}`}>
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className={`text-2xl font-bold ${alerta ? "text-destructive" : ""}`}>{valor}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{comoSeCalcula}</p>
    </div>
  );
}

export function OperacaoMentor() {
  const [dias, setDias] = useState(30);

  const { data: op, isLoading } = useQuery({
    queryKey: ["operacao-mentor", dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_operacao_mentor", { _dias: dias });
      if (error) throw error;
      return (data?.[0] ?? null) as Operacao | null;
    },
  });

  const { data: carga = [] } = useQuery({
    queryKey: ["carga-mentores", dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_carga_mentores", { _dias: dias });
      if (error) throw error;
      return (data ?? []) as Carga[];
    },
  });

  const n = (v: number | null | undefined, sufixo = "") =>
    v === null || v === undefined ? "—" : `${v}${sufixo}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Operação da célula</h2>
        </div>
        <Tabs value={String(dias)} onValueChange={(v) => setDias(Number(v))}>
          <TabsList className="h-8">
            <TabsTrigger value="7" className="text-xs">7 dias</TabsTrigger>
            <TabsTrigger value="30" className="text-xs">30 dias</TabsTrigger>
            <TabsTrigger value="90" className="text-xs">90 dias</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div
            role="status"
            aria-label="Carregando"
            className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
          />
        </div>
      ) : !op ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Ainda não há atendimento registrado neste período.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Timer className="h-4 w-4" /> Cumprimento do SLA
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador
                titulo="Dentro do prazo"
                valor={op.pct_sla === null ? "—" : `${op.pct_sla}%`}
                comoSeCalcula={`${op.dentro_do_sla} de ${op.concluidas} chamados encerrados até o prazo, no período.`}
                alerta={op.pct_sla !== null && op.pct_sla < 90}
              />
              <Indicador
                titulo="Fila aberta"
                valor={n(op.abertas)}
                comoSeCalcula="Chamados do Mentor ainda não encerrados, em qualquer academia."
              />
              <Indicador
                titulo="Vencidos agora"
                valor={n(op.vencidas)}
                comoSeCalcula="Abertos cujo prazo já passou. É o número que se olha primeiro de manhã."
                alerta={op.vencidas > 0}
              />
              <Indicador
                titulo="Tempo até a resposta"
                valor={op.horas_ate_resposta_mediana === null ? "—" : `${op.horas_ate_resposta_mediana}h`}
                comoSeCalcula={`Mediana em horas de expediente (seg–sex 08–20, sáb 08–12). Média: ${n(op.horas_ate_resposta_media, "h")}. É latência, não esforço: um chamado resolvido em 3h pode ter dado 10 minutos de trabalho.`}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" /> Capacidade
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador
                titulo="Alunos sob acompanhamento"
                valor={n(op.alunos_sob_acompanhamento)}
                comoSeCalcula={`Todos os alunos com o Método ativo, em ${op.organizacoes_atendidas} academia(s) — e não só os que deram trabalho neste mês.`}
              />
              <Indicador
                titulo="Mentores atuando"
                valor={n(op.mentores_ativos)}
                comoSeCalcula="Pessoas que encerraram pelo menos um chamado no período."
              />
              <Indicador
                titulo="Alunos por mentor"
                valor={n(op.alunos_por_mentor)}
                comoSeCalcula="Alunos sob acompanhamento ÷ mentores atuando."
              />
              <Indicador
                titulo="Chamados por aluno/mês"
                valor={n(op.tarefas_por_aluno_mes)}
                comoSeCalcula="Encerrados no período, projetados para 30 dias, ÷ alunos sob acompanhamento. É daqui que sai o tamanho da célula quando a base crescer."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Carga por mentor</CardTitle>
              <p className="text-xs text-muted-foreground">
                Fila concentrada numa pessoa é como uma célula de serviço quebra sem aviso — e isso não
                aparece no total acima.
              </p>
            </CardHeader>
            <CardContent>
              {carga.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  Nenhum chamado com responsável registrado ainda.
                </p>
              ) : (
                <div className="space-y-2">
                  {carga.map((m) => (
                    <div
                      key={m.mentor_id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{m.mentor_nome}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {m.abertas} aberto(s) · {n(m.por_semana)} encerrados por semana · resposta em{" "}
                          {n(m.horas_ate_resposta_mediana, "h")} úteis
                        </p>
                      </div>
                      <Badge variant={m.pct_sla !== null && m.pct_sla < 90 ? "destructive" : "secondary"}>
                        {m.pct_sla === null ? "sem encerramento" : `${m.pct_sla}% no prazo`}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {op.vencidas > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm">
                <strong>{op.vencidas}</strong> chamado(s) com prazo vencido esperando a célula. Eles
                aparecem no topo da aba <em>Chamados</em>.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
