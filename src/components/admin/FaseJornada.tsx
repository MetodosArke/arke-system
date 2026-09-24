import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Enums } from "@/integrations/supabase/types";

type Fase = Enums<"fase_jornada">;

const FASES: { valor: Fase; label: string; resumo: string }[] = [
  { valor: "mapa", label: "M.A.P.A.®", resumo: "Acolhimento e diagnóstico" },
  { valor: "base", label: "B.A.S.E.®", resumo: "Prescrição em execução" },
  { valor: "rota", label: "R.O.T.A.®", resumo: "Acompanhamento e check-ins" },
  { valor: "apex", label: "A.P.E.X.®", resumo: "Evolução consolidada" },
  { valor: "legado", label: "L.E.G.A.D.O.®", resumo: "Autonomia e manutenção" },
];

const formatarDataHora = (valor: string) =>
  new Date(valor).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// Progressão da jornada: automática no fluxo de sucesso, manual por cima.
//
// Até 23/09/2026 era só manual, com a justificativa de que quem convive com o
// aluno é quem sabe se ele mudou de fase. O modelo de Mentor Centralizado
// removeu a premissa: não há mais um professor acompanhando digitalmente. O
// motor (`varrer_avanco_fases`) move quem cumpriu os critérios, e esta tela
// continua podendo mover à mão — para adiantar, corrigir ou recuar, coisas
// que critério nenhum decide bem.
//
// O registro é o que não mudou: quem moveu, quando e por quê. No avanço
// automático o autor fica nulo e o nome é "Avanço automático", e é isso que
// permite separar depois o que o sistema fez do que a equipe fez.
export function FaseJornada({
  alunoId,
  faseAtual,
}: {
  alunoId: string;
  faseAtual: Fase;
}) {
  const [fase, setFase] = useState<Fase>(faseAtual);
  const [observacao, setObservacao] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: historico = [] } = useQuery({
    queryKey: ["aluno-fase-historico", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aluno_fase_historico")
        .select("id, fase_anterior, fase_nova, movido_por_nome, observacao, created_at")
        .eq("aluno_id", alunoId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const mover = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("mover_fase_jornada", {
        _aluno_id: alunoId,
        _fase: fase,
        _observacao: observacao || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setObservacao("");
      toast({ title: "Fase atualizada", description: "O movimento ficou registrado no histórico." });
      void queryClient.invalidateQueries({ queryKey: ["aluno-fase-historico", alunoId] });
      void queryClient.invalidateQueries({ queryKey: ["aluno-perfil"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-alunos"] });
    },
    onError: (erro: Error) =>
      toast({ title: "Não foi possível mover a fase", description: erro.message, variant: "destructive" }),
  });

  const rotulo = (f: Fase | null) => (f ? FASES.find((x) => x.valor === f)?.label ?? f : "—");

  return (
    <div className="space-y-3">
      <SituacaoDoAvanco alunoId={alunoId} />
      <div className="flex flex-wrap gap-2">
        <Select value={fase} onValueChange={(v) => setFase(v as Fase)}>
          <SelectTrigger className="w-[230px]" aria-label="Fase da jornada">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FASES.map((f) => (
              <SelectItem key={f.valor} value={f.valor}>
                {f.label} — {f.resumo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={fase === faseAtual || mover.isPending} onClick={() => mover.mutate()}>
          {mover.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Mover fase
        </Button>
      </div>

      <Input
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
        placeholder="Por que está mudando de fase? (opcional)"
        className="text-sm"
      />

      {historico.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs font-medium text-muted-foreground">Movimentos recentes</p>
          {historico.map((h) => (
            <div key={h.id} className="text-[11px] text-muted-foreground">
              <span className="text-foreground">
                {rotulo(h.fase_anterior)} <ArrowRight className="inline h-3 w-3" /> {rotulo(h.fase_nova)}
              </span>
              {" · "}
              {h.movido_por_nome ?? "equipe"} · {formatarDataHora(h.created_at)}
              {h.observacao && <span className="block italic">“{h.observacao}”</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rótulo de cada motivo de bloqueio devolvido por `motivo_nao_avanca`. */
const MOTIVO_ROTULO: Record<string, string> = {
  dor: "Progressão suspensa por relato de dor — a equipe precisa avaliar antes de liberar.",
  inercia: "Aluno sem sinal de vida há 5 dias ou mais: o avanço fica suspenso até ele voltar.",
  fora_do_metodo: "A jornada de fases é do Método ARKE; o aluno está no plano Free.",
  situacao_pausado: "Matrícula pausada: o avanço fica suspenso durante a pausa.",
  situacao_inadimplente: "Aluno em situação de inadimplência na academia.",
};

/**
 * Por que o aluno não está avançando sozinho.
 *
 * Com o avanço automático, a ausência de movimento passa a ser informação: sem
 * dizer o motivo, a equipe olharia para uma fase parada sem saber se o sistema
 * está esperando constância, se há dor a avaliar ou se o aluno sumiu — três
 * situações com respostas completamente diferentes.
 */
function SituacaoDoAvanco({ alunoId }: { alunoId: string }) {
  const { data } = useQuery({
    queryKey: ["situacao-avanco", alunoId],
    queryFn: async () => {
      // Uma chamada só, que confere quem pergunta: as três funções de dentro
      // respondem sobre qualquer aluno e não ficam abertas ao app.
      const { data, error } = await supabase.rpc("get_jornada_aluno", { _aluno_id: alunoId });
      if (error) throw error;
      const linha = data?.[0];
      return {
        motivo: linha?.motivo ?? null,
        elegivel: (linha?.elegivel as Fase | null | undefined) ?? null,
        constancia: linha?.constancia == null ? null : Number(linha.constancia),
      };
    },
  });

  if (!data) return null;

  const rotuloFase = (f: Fase) => FASES.find((x) => x.valor === f)?.label ?? f;

  if (data.motivo) {
    return (
      <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
        {MOTIVO_ROTULO[data.motivo] ?? `Avanço suspenso (${data.motivo}).`}
      </p>
    );
  }
  if (data.elegivel) {
    return (
      <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs text-emerald-700 dark:text-emerald-400">
        Critérios cumpridos para {rotuloFase(data.elegivel)} — a varredura da madrugada move sozinha.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Em evolução dentro da fase
      {data.constancia !== null ? ` · constância de ${data.constancia}% nas últimas 4 semanas` : ""}.
    </p>
  );
}
