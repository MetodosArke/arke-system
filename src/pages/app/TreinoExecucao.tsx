import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Check, Clock, Dumbbell, History } from "lucide-react";
import { seriesDoExercicio, rotuloTecnica, type SerieDetalhe } from "@/lib/seriesTreino";
import { AvaliacaoTreinoDialog } from "@/components/aluno/AvaliacaoTreinoDialog";
import { MidiaExercicio } from "@/components/acervo/MidiaExercicio";
import { hojeBrasilia } from "@/lib/dataBrasilia";

/**
 * Execução do treino, série a série — o módulo do app original trazido para o
 * esquema multitenant (23/09/2026).
 *
 * O que muda em relação à tela de treinos: ali o aluno marcava o exercício
 * como feito e anotava **uma** carga. Aqui cada série tem a sua carga e as
 * suas repetições, que é como o treino realmente acontece — pirâmide sobe,
 * drop-set desce, e um número só apagava justamente o que o professor usa para
 * progredir.
 *
 * Três coisas fazem a tela valer o que custa:
 *
 *  - **A carga da última vez**, por série, lida do `registro_serie` anterior
 *    do mesmo `exercicio_id`. É a referência que o aluno procura antes de
 *    escolher o peso, e sem ela ele chuta ou repete o de sempre.
 *  - **O cronômetro de descanso**, que começa sozinho ao concluir a série,
 *    porque é quando o descanso de fato começa.
 *  - **A avaliação no fim**, com esforço percebido: é o que separa "não subiu a
 *    carga porque está leve" de "não subiu porque está no limite".
 *
 * A gravação é por série, na hora: quem treina larga o celular no banco e
 * volta, e um "salvar" no fim perderia a sessão inteira a cada interrupção.
 */

interface ExercicioSnapshot {
  ordem: number;
  nome_exercicio: string;
  grupo_muscular: string[];
  series: number;
  repeticoes: string;
  descanso_seg: number;
  observacoes: string | null;
  video_url: string | null;
  descricao_execucao: string | null;
  gif_url: string | null;
  divisao?: string | null;
  series_detalhe?: unknown;
  equipamento?: string | null;
  exercicio_id?: string | null;
}

type SerieGravada = {
  exercicio_ordem: number;
  serie_numero: number;
  carga_kg: number | null;
  repeticoes: number | null;
  concluida: boolean;
};

const HOJE = hojeBrasilia();

/** Chave local de uma série, para indexar sem depender do id do banco. */
const chaveSerie = (ordem: number, numero: number) => `${ordem}:${numero}`;

function formatarCronometro(segundos: number) {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function TreinoExecucao() {
  const { divisao } = useParams<{ divisao: string }>();
  const navigate = useNavigate();
  const { alunoId, organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [descansoRestante, setDescansoRestante] = useState(0);
  const [avaliacaoAberta, setAvaliacaoAberta] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inicioRef = useRef<number>(Date.now());

  const { data: treino, isLoading: carregandoTreino } = useQuery({
    queryKey: ["aluno-treino-ativo", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treinos")
        .select("id, titulo, snapshot_conteudo")
        .eq("aluno_id", alunoId!)
        .eq("status", "ativo")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!alunoId,
  });

  const todos = (treino?.snapshot_conteudo as unknown as ExercicioSnapshot[] | null) ?? [];
  const divisaoAtual = (divisao ?? "A").toUpperCase();
  const exercicios = useMemo(
    () => todos.filter((e) => (e.divisao || "A") === divisaoAtual).sort((a, b) => a.ordem - b.ordem),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [treino?.id, divisaoAtual],
  );

  // O registro da sessão. Criado na entrada da tela, não no fim: sem ele não
  // há onde pendurar as séries, e o aluno começa a treinar antes de concluir.
  const { data: registro } = useQuery({
    queryKey: ["execucao-registro", alunoId, HOJE, divisaoAtual],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registro_treino")
        .upsert(
          {
            organization_id: organization!.id,
            aluno_id: alunoId!,
            treino_id: treino?.id ?? null,
            data: HOJE,
            divisao: divisaoAtual,
          },
          { onConflict: "aluno_id,data" },
        )
        .select("id, concluido, esforco_percebido")
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!alunoId && !!organization && !carregandoTreino,
  });

  const { data: seriesGravadas = [] } = useQuery({
    queryKey: ["execucao-series", registro?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registro_serie")
        .select("exercicio_ordem, serie_numero, carga_kg, repeticoes, concluida")
        .eq("registro_treino_id", registro!.id);
      if (error) throw error;
      return (data ?? []) as SerieGravada[];
    },
    enabled: !!registro?.id,
  });

  // Carga da última vez, por exercício e série. Lida por `exercicio_id`, que
  // sobrevive à republicação da ficha — comparar por ordem mostraria a carga
  // de outro movimento depois de uma revisão que reordenou a prescrição.
  const idsExercicios = exercicios.map((e) => e.exercicio_id).filter(Boolean) as string[];
  const { data: anteriores = [] } = useQuery({
    queryKey: ["execucao-anteriores", registro?.id, idsExercicios.join(",")],
    queryFn: async () => {
      if (!idsExercicios.length) return [];
      const { data, error } = await supabase
        .from("registro_serie")
        .select("exercicio_id, serie_numero, carga_kg, repeticoes, created_at")
        .in("exercicio_id", idsExercicios)
        .neq("registro_treino_id", registro!.id)
        .eq("concluida", true)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!registro?.id && idsExercicios.length > 0,
  });

  /** A carga mais recente de cada (exercício, série). */
  const ultimaCarga = useMemo(() => {
    const mapa = new Map<string, { carga: number | null; reps: number | null }>();
    for (const a of anteriores) {
      const chave = `${a.exercicio_id}:${a.serie_numero}`;
      if (!mapa.has(chave)) mapa.set(chave, { carga: a.carga_kg, reps: a.repeticoes });
    }
    return mapa;
  }, [anteriores]);

  const gravadaPorChave = useMemo(() => {
    const mapa = new Map<string, SerieGravada>();
    for (const s of seriesGravadas) mapa.set(chaveSerie(s.exercicio_ordem, s.serie_numero), s);
    return mapa;
  }, [seriesGravadas]);

  // Rascunho do que está sendo digitado, para o input não piscar a cada
  // gravação. O que vale é sempre o banco; isto só cobre o intervalo.
  const [rascunho, setRascunho] = useState<Record<string, { carga: string; reps: string }>>({});

  useEffect(() => {
    if (descansoRestante <= 0) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => setDescansoRestante((s) => Math.max(0, s - 1)), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [descansoRestante]);

  const salvarSerie = useMutation({
    mutationFn: async (dados: {
      ex: ExercicioSnapshot;
      numero: number;
      carga: number | null;
      reps: number | null;
      concluida: boolean;
    }) => {
      if (!registro?.id || !organization) throw new Error("Sessão de treino não encontrada.");
      const { error } = await supabase.from("registro_serie").upsert(
        {
          organization_id: organization.id,
          registro_treino_id: registro.id,
          exercicio_id: dados.ex.exercicio_id ?? null,
          exercicio_ordem: dados.ex.ordem,
          serie_numero: dados.numero,
          carga_kg: dados.carga,
          repeticoes: dados.reps,
          concluida: dados.concluida,
        },
        { onConflict: "registro_treino_id,exercicio_ordem,serie_numero" },
      );
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["execucao-series", registro?.id] }),
    onError: (e: Error) =>
      toast({ title: "Não foi possível salvar a série", description: e.message, variant: "destructive" }),
  });

  const totalSeries = exercicios.reduce((soma, ex) => soma + seriesDoExercicio(ex).length, 0);
  const feitas = seriesGravadas.filter((s) => s.concluida).length;
  const pct = totalSeries > 0 ? Math.round((feitas / totalSeries) * 100) : 0;
  const tudoFeito = totalSeries > 0 && feitas >= totalSeries;

  const concluirSerie = (ex: ExercicioSnapshot, numero: number, serie: SerieDetalhe) => {
    const chave = chaveSerie(ex.ordem, numero);
    const atual = gravadaPorChave.get(chave);
    const digitado = rascunho[chave];
    const carga = digitado?.carga !== undefined && digitado.carga !== "" ? Number(digitado.carga) : atual?.carga_kg ?? null;
    const reps = digitado?.reps !== undefined && digitado.reps !== "" ? Number(digitado.reps) : atual?.repeticoes ?? null;
    const concluida = !atual?.concluida;

    salvarSerie.mutate({ ex, numero, carga, reps, concluida });

    // O descanso começa quando a série termina, não quando a próxima começa.
    if (concluida && serie.descanso_seg > 0) setDescansoRestante(serie.descanso_seg);
  };

  if (carregandoTreino) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div role="status" aria-label="Carregando" className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!treino || exercicios.length === 0) {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/app/treinos")}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Voltar
        </Button>
        <Card>
          <CardContent className="py-8 text-center space-y-2">
            <p className="font-medium">Nada para treinar aqui</p>
            <p className="text-sm text-muted-foreground">
              {treino ? `A divisão ${divisaoAtual} não tem exercícios nesta ficha.` : "Sua ficha ainda não foi publicada."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-24">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/app/treinos")}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Treinos
        </Button>
        {descansoRestante > 0 && (
          <div
            role="timer"
            aria-live="polite"
            className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary"
          >
            <Clock className="h-4 w-4" /> Descanso {formatarCronometro(descansoRestante)}
            <button className="ml-1 text-xs underline" onClick={() => setDescansoRestante(0)}>
              pular
            </button>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <h1 className="text-xl font-bold">
          {treino.titulo}
          <span className="text-muted-foreground font-normal"> · Treino {divisaoAtual}</span>
        </h1>
        <Progress value={pct} aria-label={`${feitas} de ${totalSeries} séries concluídas`} />
        <p className="text-xs text-muted-foreground">
          {feitas} de {totalSeries} séries
        </p>
      </div>

      {exercicios.map((ex) => {
        const series = seriesDoExercicio(ex);
        return (
          <Card key={ex.ordem}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Dumbbell className="h-4 w-4 text-primary" /> {ex.nome_exercicio}
              </CardTitle>
              {ex.equipamento && <p className="text-xs text-muted-foreground">{ex.equipamento}</p>}
              <MidiaExercicio imagemUrl={ex.gif_url} nome={ex.nome_exercicio} className="max-w-xs mt-1" />
            </CardHeader>
            <CardContent className="space-y-2">
              {series.map((serie, i) => {
                const numero = i + 1;
                const chave = chaveSerie(ex.ordem, numero);
                const gravada = gravadaPorChave.get(chave);
                const anterior = ex.exercicio_id ? ultimaCarga.get(`${ex.exercicio_id}:${numero}`) : undefined;
                const tecnica = rotuloTecnica(serie.tecnica);
                return (
                  <div key={numero} className="rounded-md border border-border p-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        Série {numero} · {serie.reps} reps
                        {tecnica && <span className="ml-1.5 text-xs text-primary">{tecnica}</span>}
                      </span>
                      <Button
                        size="sm"
                        variant={gravada?.concluida ? "default" : "outline"}
                        aria-pressed={!!gravada?.concluida}
                        disabled={salvarSerie.isPending}
                        onClick={() => concluirSerie(ex, numero, serie)}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        {gravada?.concluida ? "Feita" : "Concluir"}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min={0}
                        placeholder="kg"
                        aria-label={`Carga da série ${numero} de ${ex.nome_exercicio}`}
                        className="h-9"
                        value={rascunho[chave]?.carga ?? (gravada?.carga_kg != null ? String(gravada.carga_kg) : "")}
                        onChange={(e) =>
                          setRascunho((r) => ({ ...r, [chave]: { carga: e.target.value, reps: r[chave]?.reps ?? "" } }))
                        }
                      />
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        placeholder="reps"
                        aria-label={`Repetições feitas na série ${numero} de ${ex.nome_exercicio}`}
                        className="h-9"
                        value={rascunho[chave]?.reps ?? (gravada?.repeticoes != null ? String(gravada.repeticoes) : "")}
                        onChange={(e) =>
                          setRascunho((r) => ({ ...r, [chave]: { carga: r[chave]?.carga ?? "", reps: e.target.value } }))
                        }
                      />
                    </div>
                    {anterior && (anterior.carga != null || anterior.reps != null) && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <History className="h-3 w-3" /> Última vez:{" "}
                        {anterior.carga != null ? `${anterior.carga} kg` : "sem carga"}
                        {anterior.reps != null ? ` × ${anterior.reps}` : ""}
                      </p>
                    )}
                  </div>
                );
              })}
              {ex.observacoes && <p className="text-xs text-muted-foreground">{ex.observacoes}</p>}
            </CardContent>
          </Card>
        );
      })}

      <div className="fixed bottom-16 left-0 right-0 px-4">
        <div className="mx-auto max-w-2xl">
          <Button
            className="w-full"
            size="lg"
            disabled={feitas === 0}
            onClick={() => setAvaliacaoAberta(true)}
          >
            {tudoFeito ? "Concluir treino" : `Encerrar (${feitas}/${totalSeries} séries)`}
          </Button>
        </div>
      </div>

      {registro?.id && (
        <AvaliacaoTreinoDialog
          aberto={avaliacaoAberta}
          onOpenChange={setAvaliacaoAberta}
          registroId={registro.id}
          todasFeitas={tudoFeito}
          duracaoMin={Math.max(1, Math.round((Date.now() - inicioRef.current) / 60000))}
          onConcluido={() => {
            void queryClient.invalidateQueries({ queryKey: ["aluno-registro-hoje", alunoId] });
            void queryClient.invalidateQueries({ queryKey: ["aluno-treino-streak", alunoId] });
            navigate("/app/treinos");
          }}
        />
      )}
    </div>
  );
}
