import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Evento = { ocorrido_em: string; tipo: string; titulo: string; detalhe: string | null; autor: string | null };

// Cor do marcador por tipo de evento, para a linha do tempo ser lida de
// relance: vermelho é o que pediu atenção, verde o que foi resolvido.
const COR: Record<string, string> = {
  atendimento_aberto: "bg-amber-500",
  atendimento_resolvido: "bg-emerald-600",
  checkin: "bg-sky-500",
  fase: "bg-violet-500",
  agendamento: "bg-slate-400",
  observacao: "bg-primary",
  treino_publicado: "bg-slate-400",
  dieta_publicada: "bg-slate-400",
};

const INICIAL = 15;

/**
 * Histórico do aluno na ficha: atendimentos abertos e resolvidos (com o
 * desfecho), check-ins, mudanças de fase, agendamentos, publicações e as
 * observações da equipe — o "prontuário" do app original. Antes a ficha
 * mostrava só as pendências abertas, e o que foi resolvido sumia da vista.
 */
export function HistoricoAluno({ alunoId, organizationId }: { alunoId: string; organizationId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const [mostrarTudo, setMostrarTudo] = useState(false);

  const { data: eventos = [], isLoading, error } = useQuery({
    queryKey: ["historico-aluno", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_historico_aluno", { _aluno_id: alunoId, _limite: 200 });
      if (error) throw error;
      return (data ?? []) as Evento[];
    },
  });

  const registrar = useMutation({
    mutationFn: async () => {
      const limpo = texto.trim();
      if (!limpo) throw new Error("Escreva a observação.");
      const { error } = await supabase
        .from("aluno_observacoes")
        .insert({ organization_id: organizationId, aluno_id: alunoId, autor_id: user!.id, texto: limpo });
      if (error) throw error;
    },
    onSuccess: () => {
      setTexto("");
      void queryClient.invalidateQueries({ queryKey: ["historico-aluno", alunoId] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível registrar", description: e.message, variant: "destructive" }),
  });

  const visiveis = mostrarTudo ? eventos : eventos.slice(0, INICIAL);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Registrar uma observação (só a equipe vê)"
          rows={2}
          maxLength={4000}
          aria-label="Nova observação sobre o aluno"
        />
        {texto.trim() && (
          <Button size="sm" onClick={() => registrar.mutate()} disabled={registrar.isPending}>
            {registrar.isPending ? "Salvando..." : "Registrar observação"}
          </Button>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando histórico…</p>}
      {error && <p className="text-sm text-destructive">Não foi possível carregar o histórico.</p>}
      {!isLoading && !error && eventos.length === 0 && (
        <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>
      )}

      <ol className="space-y-3 border-l border-border ml-1.5">
        {visiveis.map((e, i) => (
          <li key={`${e.tipo}-${e.ocorrido_em}-${i}`} className="relative pl-4">
            <span className={cn("absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full", COR[e.tipo] ?? "bg-slate-400")} aria-hidden />
            <p className="text-sm font-medium leading-snug">{e.titulo}</p>
            {e.detalhe && <p className="text-xs text-muted-foreground whitespace-pre-line">{e.detalhe}</p>}
            <p className="text-[11px] text-muted-foreground">
              {format(new Date(e.ocorrido_em), "dd/MM/yyyy HH:mm", { locale: ptBR })}
              {e.autor && ` · ${e.autor}`}
            </p>
          </li>
        ))}
      </ol>

      {eventos.length > INICIAL && (
        <Button variant="ghost" size="sm" onClick={() => setMostrarTudo((v) => !v)}>
          {mostrarTudo ? "Mostrar menos" : `Ver todo o histórico (${eventos.length})`}
        </Button>
      )}
    </div>
  );
}
