import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowDownRight, ArrowUpRight, BarChart3, Handshake, ShieldCheck, UserPlus, Users } from "lucide-react";
import { Link } from "react-router-dom";

type Numeros = {
  ativos: number;
  ativos_mes_passado: number;
  retencao_pct: number | null;
  variacao_pct: number | null;
  novos: number;
  em_risco: number;
  resgates: number;
  presenciais: number;
};

type Registro = { semana: string; numeros: Numeros; enviado_em: string | null };

const formatarSemana = (iso: string) => {
  const inicio = new Date(`${iso}T12:00:00`);
  const fim = new Date(inicio.getTime() + 6 * 86_400_000);
  const f = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${f(inicio)} a ${f(fim)}`;
};

/**
 * O resumo da semana da academia.
 *
 * Era para ir pelo WhatsApp. Foi trazido para dentro do sistema em 23/09/2026
 * por governança — a conta da Meta está num CNPJ que a ArkeFit não controla —
 * e o resultado ficou melhor: um template de WhatsApp são oito parâmetros
 * curtos, e aqui cabe explicar de onde cada número veio e a série das semanas
 * anteriores. O gestor ainda recebe e-mail e push avisando que saiu.
 *
 * **Cada número diz como é calculado.** Um indicador que o gestor não
 * consegue reproduzir no painel vale menos que nenhum indicador: na primeira
 * divergência ele para de confiar no conjunto todo.
 */
export default function AdminRelatorioSemanal() {
  const { organization } = useAuth();

  const { data: registros = [], isLoading } = useQuery({
    queryKey: ["relatorio-semanal", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefings_enviados")
        .select("semana, numeros, enviado_em")
        .eq("organization_id", organization!.id)
        .order("semana", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as unknown as Registro[];
    },
    enabled: !!organization?.id,
  });

  const atual = registros[0];
  const n = atual?.numeros;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Resumo da semana</h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div role="status" aria-label="Carregando" className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : !atual || !n ? (
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="font-medium">O primeiro resumo sai na próxima segunda</p>
            <p className="text-sm text-muted-foreground">
              Toda segunda de manhã a ArkeFit fecha o retrato da sua base e avisa você por e-mail e notificação.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                Semana de {formatarSemana(atual.semana)}
                <Badge variant="secondary" className="text-[10px]">atual</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Indicador
                  icone={Users}
                  rotulo="Alunos ativos"
                  valor={String(n.ativos)}
                  detalhe={
                    n.retencao_pct === null
                      ? "Primeira semana de acompanhamento — ainda não há base anterior para comparar."
                      : `Retenção de ${n.retencao_pct}% sobre os ${n.ativos_mes_passado} de 30 dias atrás.`
                  }
                  variacao={n.variacao_pct}
                  comoCalcula="Aluno com presença ou treino registrado nos últimos 30 dias. Conta o uso, não a marcação de situação — que é feita à mão e atrasa."
                />
                <Indicador
                  icone={UserPlus}
                  rotulo="Novos nesta semana"
                  valor={String(n.novos)}
                  comoCalcula="Alunos cadastrados nos últimos 7 dias, em qualquer plano."
                />
                <Indicador
                  icone={ShieldCheck}
                  rotulo="Em risco de evasão"
                  valor={String(n.em_risco)}
                  detalhe={n.em_risco > 0 ? "Já na fila do Mentor ArkeFit — sua equipe não precisa agir." : "Ninguém sumido no momento."}
                  comoCalcula="Alunos do Método sem sinal de vida há 5 dias ou mais. O acompanhamento é da nossa equipe."
                />
                <Indicador
                  icone={ShieldCheck}
                  rotulo="Resgatados pelo Mentor"
                  valor={String(n.resgates)}
                  detalhe="Chamados que a nossa equipe encerrou nos últimos 7 dias."
                  comoCalcula="Tarefas da célula de Mentor concluídas com desfecho registrado na semana."
                />
              </div>

              <div className="rounded-md border p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Handshake className="h-4 w-4 text-muted-foreground" />
                  {n.presenciais > 0
                    ? `${n.presenciais} acolhimento(s) presencial(is) esperando sua equipe`
                    : "Nenhuma pendência presencial esta semana"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  É o que só acontece no salão. O Mentor já investigou e ajustou o que era digital.
                </p>
                {n.presenciais > 0 && (
                  <Link to="/admin" className="mt-2 inline-block text-xs text-primary underline">
                    Abrir na Minha Fila
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>

          {registros.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Semanas anteriores</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {registros.slice(1).map((r) => (
                  <div key={r.semana} className="flex flex-wrap items-center justify-between gap-2 border-b pb-1.5 text-sm last:border-0">
                    <span className="text-muted-foreground">{formatarSemana(r.semana)}</span>
                    <span className="text-xs">
                      {r.numeros.ativos} ativos
                      {r.numeros.retencao_pct !== null && ` · retenção ${r.numeros.retencao_pct}%`}
                      {r.numeros.novos > 0 && ` · ${r.numeros.novos} novo(s)`}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Indicador({
  icone: Icone,
  rotulo,
  valor,
  detalhe,
  variacao,
  comoCalcula,
}: {
  icone: typeof Users;
  rotulo: string;
  valor: string;
  detalhe?: string;
  variacao?: number | null;
  comoCalcula: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icone className="h-3.5 w-3.5" />
        {rotulo}
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{valor}</span>
        {variacao !== null && variacao !== undefined && variacao !== 0 && (
          <span
            className={`flex items-center text-xs ${
              variacao > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
            }`}
          >
            {variacao > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {Math.abs(variacao)}%
          </span>
        )}
      </p>
      {detalhe && <p className="mt-0.5 text-xs text-muted-foreground">{detalhe}</p>}
      {/* Como o número é calculado fica na tela, não numa documentação que
          ninguém abre: indicador que o gestor não consegue reproduzir perde a
          confiança dele no conjunto todo na primeira divergência. */}
      <p className="mt-1.5 text-[11px] italic text-muted-foreground">{comoCalcula}</p>
    </div>
  );
}
