import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HeartHandshake, Lock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * O que o Mentor da ArkeFit fez pelos alunos desta academia.
 *
 * **Esta tela existe para reter a academia como cliente**, e não por
 * completude. O modelo de BPO tira o acompanhamento digital das costas dela —
 * o que, do lado de quem paga, é indistinguível de não estar recebendo nada.
 * A fila do Mentor é invisível para a academia de propósito (o aluno precisa
 * de um canal onde falar do que não contaria ao professor), então sem uma
 * prestação de contas explícita o serviço simplesmente não aparece.
 *
 * O que ela mostra é **resultado**: quantos atendimentos, em quantos alunos, e
 * o desfecho que o mentor teve de escrever para encerrar cada um. O conteúdo
 * da conversa entre aluno e mentor continua fora — o banco não o entrega nem
 * se a tela pedir.
 */

type Valor = {
  alunos_no_metodo: number;
  atendimentos_concluidos: number;
  alunos_alcancados: number;
  instrucoes_enviadas: number;
  instrucoes_concluidas: number;
  avancos_de_fase: number;
  mensagens_trocadas: number;
  pct_sla: number | null;
};

type Atendimento = {
  aluno_id: string;
  aluno_nome: string;
  tipo: string;
  motivo: string;
  desfecho: string | null;
  concluida_em: string;
};

const ROTULO_TIPO: Record<string, string> = {
  inercia: "Risco de evasão",
  ciclo_travado: "Ciclo travado",
  barreira: "Barreira de rotina",
  dor: "Relato de dor",
  engajamento_baixo: "Engajamento baixo",
  acolhimento_elite: "Acolhimento Elite",
  ativacao: "Primeiro acesso",
  anamnese: "Acolhimento",
  ajuste: "Ajuste de plano",
  instrucao_presencial: "Instrução presencial",
  outro: "Atendimento",
};

export default function AdminAcompanhamento() {
  const { organization } = useAuth();
  const [dias, setDias] = useState(30);

  const { data: valor, isLoading } = useQuery({
    queryKey: ["valor-mentor", organization?.id, dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_valor_mentor_organizacao", {
        _organization_id: organization!.id,
        _dias: dias,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as Valor | null;
    },
    enabled: !!organization?.id,
  });

  const { data: atendimentos = [] } = useQuery({
    queryKey: ["atendimentos-mentor", organization?.id, dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_atendimentos_mentor_organizacao", {
        _organization_id: organization!.id,
        _dias: dias,
      });
      if (error) throw error;
      return (data ?? []) as Atendimento[];
    },
    enabled: !!organization?.id,
  });

  const periodo = dias === 7 ? "nos últimos 7 dias" : dias === 90 ? "nos últimos 90 dias" : "nos últimos 30 dias";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HeartHandshake className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Acompanhamento ARKE</h1>
            <p className="text-xs text-muted-foreground">
              O que a equipe de mentoria da ARKE fez pelos seus alunos do Método.
            </p>
          </div>
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
      ) : !valor || valor.alunos_no_metodo === 0 ? (
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <p className="font-medium">Nenhum aluno seu está no Método ARKE ainda</p>
            <p className="text-sm text-muted-foreground">
              O acompanhamento da equipe ARKE vale para os alunos dos planos Integrado e Elite. Assim que
              o primeiro entrar, o que for feito por ele aparece aqui.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground">Atendimentos feitos</p>
                <p className="text-3xl font-bold">{valor.atendimentos_concluidos}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Em {valor.alunos_alcancados} de {valor.alunos_no_metodo} aluno(s) do Método, {periodo}.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground">Dentro do prazo combinado</p>
                <p className="text-3xl font-bold">{valor.pct_sla === null ? "—" : `${valor.pct_sla}%`}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Prazo contado em horas de expediente, não de relógio.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground">Pedidos para a sua equipe</p>
                <p className="text-3xl font-bold">
                  {valor.instrucoes_concluidas}/{valor.instrucoes_enviadas}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Instruções presenciais concluídas. Elas aparecem na Minha Fila.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground">Mensagens trocadas</p>
                <p className="text-3xl font-bold">{valor.mensagens_trocadas}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {valor.avancos_de_fase} avanço(s) de fase na jornada, {periodo}.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Desfecho de cada atendimento</CardTitle>
              <p className="text-xs text-muted-foreground">
                Contagem qualquer um escreve. Aqui está o que ficou registrado em cada caso — o mesmo
                texto que o mentor precisou escrever para poder encerrar.
              </p>
            </CardHeader>
            <CardContent>
              {atendimentos.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  Nenhum atendimento encerrado {periodo}.
                </p>
              ) : (
                <div className="space-y-2">
                  {atendimentos.map((a, i) => (
                    <div key={`${a.aluno_id}-${a.concluida_em}-${i}`} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{a.aluno_nome}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{ROTULO_TIPO[a.tipo] ?? a.tipo}</Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {format(new Date(a.concluida_em), "dd/MM HH:mm", { locale: ptBR })}
                          </span>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{a.motivo}</p>
                      {a.desfecho && <p className="mt-1.5 text-sm">{a.desfecho}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Dizer isto em voz alta é melhor do que a academia descobrir
              sozinha e achar que é falha do produto. */}
          <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              O conteúdo da conversa entre o aluno e o mentor da ARKE não aparece aqui, por escolha de
              desenho: é o canal em que o aluno fala do que não contaria a quem o atende presencialmente,
              e é isso que faz o acompanhamento funcionar. O que chega até você é o resultado — e, quando
              há algo a fazer no salão, uma instrução direta na Minha Fila.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
