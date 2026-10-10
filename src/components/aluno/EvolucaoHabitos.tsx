import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErroAoCarregar } from "@/components/ErroAoCarregar";
import { formatarDataBR, hojeBrasilia } from "@/lib/dataBrasilia";
import { decimal } from "@/lib/numeros";
import { habitosPorSemana, semanasNaMeta, ultimasSemanas } from "@/lib/evolucaoHabitos";

const SEMANAS = 8;

/**
 * Os hábitos das últimas oito semanas, só com o que o app já coleta com data:
 * dias de treino contra a meta do próprio aluno, esforço percebido, adesão à
 * sono e energia (marcados no fim do treino), dieta e água contra a meta.
 */
export default function EvolucaoHabitos() {
  const { alunoId } = useAuth();
  const hoje = hojeBrasilia();
  const semanas = useMemo(() => ultimasSemanas(hoje, SEMANAS), [hoje]);
  const desde = semanas[0];

  // Até 8 semanas por aluno: no máximo um registro por dia em cada tabela,
  // longe do corte de mil linhas da API.
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["aluno-evolucao-habitos", alunoId, desde],
    queryFn: async () => {
      const [aluno, treinos, calendario, bemEstar, adesoes, habitos] = await Promise.all([
        supabase.from("alunos").select("meta_semanal_dias, meta_agua_ml").eq("id", alunoId!).maybeSingle(),
        supabase.from("registro_treino").select("data, esforco_percebido").eq("aluno_id", alunoId!).eq("concluido", true).gte("data", desde),
        supabase.from("treino_calendario").select("data").eq("aluno_id", alunoId!).gte("data", desde),
        // Sono e energia do fim do treino, com a data do treino; vale também o treino encerrado pela metade.
        supabase
          .from("registro_treino_bem_estar")
          .select("sono, energia, registro_treino!inner(data)")
          .eq("registro_treino.aluno_id", alunoId!)
          .gte("registro_treino.data", desde),
        supabase.from("dieta_adesao").select("data, adesao_percentual").eq("aluno_id", alunoId!).gte("data", desde),
        supabase.from("registro_habito").select("data, agua_ml").eq("aluno_id", alunoId!).gte("data", desde),
      ]);
      for (const r of [aluno, treinos, calendario, bemEstar, adesoes, habitos]) if (r.error) throw r.error;
      const respostas = bemEstar.data ?? [];
      return {
        metaDias: aluno.data?.meta_semanal_dias ?? 3,
        metaAgua: aluno.data?.meta_agua_ml ?? null,
        semanas: habitosPorSemana({
          semanas,
          diasDeTreino: [...(treinos.data ?? []), ...(calendario.data ?? [])].map((t) => t.data),
          esforcos: (treinos.data ?? []).filter((t) => t.esforco_percebido != null).map((t) => ({ data: t.data, valor: t.esforco_percebido! })),
          sonos: respostas.filter((b) => b.sono != null).map((b) => ({ data: b.registro_treino.data, valor: b.sono! })),
          energias: respostas.filter((b) => b.energia != null).map((b) => ({ data: b.registro_treino.data, valor: b.energia! })),
          adesoes: (adesoes.data ?? []).map((a) => ({ data: a.data, valor: a.adesao_percentual })),
          aguas: (habitos.data ?? []).map((h) => ({ data: h.data, valor: h.agua_ml })),
        }),
      };
    },
    enabled: !!alunoId,
  });

  const pontos = useMemo(
    () =>
      (data?.semanas ?? []).map((s, i, todas) => ({
        semana: i === todas.length - 1 ? "Esta" : formatarDataBR(s.inicio, { day: "2-digit", month: "2-digit" }),
        diasDeTreino: s.diasDeTreino,
        esforco: s.esforcoMedio,
        sono: s.sonoMedio,
        energia: s.energiaMedia,
        adesao: s.adesaoMedia == null ? null : Math.round(s.adesaoMedia),
        agua: s.aguaMedia == null ? null : Math.round(s.aguaMedia),
      })),
    [data],
  );

  if (isLoading) return <p className="text-sm text-muted-foreground" role="status">Carregando seus hábitos...</p>;

  if (error || !data) {
    return (
      <Card>
        <ErroAoCarregar oQue="os seus hábitos das últimas semanas" onTentarDeNovo={() => void refetch()} tentando={isFetching} />
      </Card>
    );
  }

  const constancia = semanasNaMeta(data.semanas, data.metaDias);
  const temTreino = pontos.some((p) => p.diasDeTreino > 0);
  const temEsforco = pontos.some((p) => p.esforco != null);
  const temSono = pontos.some((p) => p.sono != null);
  const temEnergia = pontos.some((p) => p.energia != null);
  const temAdesao = pontos.some((p) => p.adesao != null);
  const temAgua = pontos.some((p) => p.agua != null);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">Seus hábitos nas últimas {SEMANAS} semanas</h2>

      <Grafico
        titulo="Dias de treino por semana"
        legenda={
          temTreino
            ? `Sua meta é ${data.metaDias} dias por semana. Você chegou nela em ${constancia.batidas} de ${constancia.fechadas} semanas fechadas.`
            : undefined
        }
        vazio={temTreino ? null : "Nenhum treino registrado nas últimas semanas. Ao concluir um treino no app, ele aparece aqui."}
      >
        <BarChart data={pontos}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="semana" fontSize={11} tickLine={false} />
          <YAxis fontSize={11} tickLine={false} width={28} allowDecimals={false} domain={[0, (max: number) => Math.max(max, data.metaDias)]} />
          <Tooltip formatter={(v: number) => [`${v} ${v === 1 ? "dia" : "dias"}`, "Treino"]} />
          <ReferenceLine y={data.metaDias} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
          <Bar dataKey="diasDeTreino" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </Grafico>

      <Grafico
        titulo="Esforço percebido nos treinos"
        legenda={temEsforco ? "A média da semana, de 1 (leve) a 10 (máximo), como você marcou no fim de cada treino." : undefined}
        vazio={temEsforco ? null : "Ao concluir um treino, marque o esforço de 1 a 10 para ver a sua curva aqui."}
      >
        <LineChart data={pontos}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="semana" fontSize={11} tickLine={false} />
          <YAxis fontSize={11} tickLine={false} width={28} domain={[1, 10]} />
          <Tooltip formatter={(v: number) => [decimal(v, 1), "Esforço"]} />
          <Line type="monotone" dataKey="esforco" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} connectNulls />
        </LineChart>
      </Grafico>

      <Grafico
        titulo="Sono"
        legenda={temSono ? "A média da semana, de 1 (ruim) a 5 (ótimo), de como você disse que dormiu no fim de cada treino." : undefined}
        vazio={temSono ? null : "Ao concluir um treino, diga como dormiu, de 1 a 5, para ver a sua curva aqui."}
      >
        <LineChart data={pontos}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="semana" fontSize={11} tickLine={false} />
          <YAxis fontSize={11} tickLine={false} width={28} domain={[1, 5]} allowDecimals={false} />
          <Tooltip formatter={(v: number) => [decimal(v, 1), "Sono"]} />
          <Line type="monotone" dataKey="sono" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
        </LineChart>
      </Grafico>

      <Grafico
        titulo="Energia"
        legenda={temEnergia ? "A média da semana, de 1 (ruim) a 5 (ótimo), da energia que você marcou no fim de cada treino." : undefined}
        vazio={temEnergia ? null : "Ao concluir um treino, marque a sua energia, de 1 a 5, para ver a sua curva aqui."}
      >
        <LineChart data={pontos}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="semana" fontSize={11} tickLine={false} />
          <YAxis fontSize={11} tickLine={false} width={28} domain={[1, 5]} allowDecimals={false} />
          <Tooltip formatter={(v: number) => [decimal(v, 1), "Energia"]} />
          <Line type="monotone" dataKey="energia" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
        </LineChart>
      </Grafico>

      <Grafico
        titulo="Adesão à dieta"
        legenda={temAdesao ? "A média dos dias que você marcou as refeições na tela da Dieta." : undefined}
        vazio={temAdesao ? null : "Nenhum dia de dieta marcado nas últimas semanas."}
      >
        <BarChart data={pontos}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="semana" fontSize={11} tickLine={false} />
          <YAxis fontSize={11} tickLine={false} width={36} domain={[0, 100]} unit="%" />
          <Tooltip formatter={(v: number) => [`${v}%`, "Adesão"]} />
          <Bar dataKey="adesao" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </Grafico>

      <Grafico
        titulo="Água por dia"
        legenda={
          temAgua
            ? `A média dos dias com água registrada${data.metaAgua ? `. Sua meta é ${decimal(data.metaAgua / 1000, 1)} L por dia.` : "."}`
            : undefined
        }
        vazio={temAgua ? null : "Nenhum copo de água registrado nas últimas semanas."}
      >
        <BarChart data={pontos}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="semana" fontSize={11} tickLine={false} />
          <YAxis fontSize={11} tickLine={false} width={44} tickFormatter={(v: number) => `${decimal(v / 1000, 1)} L`} />
          <Tooltip formatter={(v: number) => [`${decimal(v / 1000, 1)} L`, "Água"]} />
          {data.metaAgua ? <ReferenceLine y={data.metaAgua} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" /> : null}
          <Bar dataKey="agua" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </Grafico>
    </div>
  );
}

function Grafico({
  titulo,
  legenda,
  vazio,
  children,
}: {
  titulo: string;
  legenda?: string;
  vazio: string | null;
  children: React.ReactElement;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{titulo}</CardTitle>
        {legenda && <p className="text-xs text-muted-foreground">{legenda}</p>}
      </CardHeader>
      <CardContent>
        {vazio ? (
          <p className="text-sm text-muted-foreground text-center py-6">{vazio}</p>
        ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
