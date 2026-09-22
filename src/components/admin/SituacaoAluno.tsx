import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROTULO_SITUACAO, SITUACOES, type SituacaoAcademia } from "@/lib/planoAluno";
import { cn } from "@/lib/utils";

const COR: Record<SituacaoAcademia, string> = {
  em_dia: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  inadimplente: "border-destructive/50 text-destructive",
  pausado: "border-amber-500/50 text-amber-700 dark:text-amber-400",
};

/**
 * Situação do aluno na academia (em dia, inadimplente, pausado). Só "em dia"
 * entra no app. Gestor e recepção alteram; o resto da equipe só vê — a trava
 * de verdade é o gatilho `trg_proteger_situacao_aluno` no banco.
 */
export function SituacaoAluno({
  alunoId,
  situacao,
  desabilitado,
  onAlterada,
}: {
  alunoId: string;
  situacao: SituacaoAcademia;
  desabilitado?: boolean;
  onAlterada?: () => void;
}) {
  const { hasRole, organizationRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const podeAlterar =
    hasRole("admin_arke") || hasRole("superadmin") || organizationRole === "gestor" || organizationRole === "recepcao";

  const alterar = useMutation({
    mutationFn: async (nova: SituacaoAcademia) => {
      const { error } = await supabase.from("alunos").update({ situacao_academia: nova }).eq("id", alunoId);
      if (error) throw error;
      return nova;
    },
    onSuccess: (nova) => {
      toast({
        title: `Situação: ${ROTULO_SITUACAO[nova]}`,
        description:
          nova === "em_dia"
            ? "O aluno volta a acessar o app."
            : "O acesso ao app fica suspenso e as tarefas automáticas dele foram encerradas.",
      });
      void queryClient.invalidateQueries({ queryKey: ["admin-alunos"] });
      void queryClient.invalidateQueries({ queryKey: ["aluno-perfil", alunoId] });
      onAlterada?.();
    },
    onError: (error: Error) => toast({ title: "Não foi possível alterar", description: error.message, variant: "destructive" }),
  });

  if (!podeAlterar || desabilitado) {
    return (
      <Badge variant="outline" className={cn("text-[11px]", COR[situacao])}>
        {ROTULO_SITUACAO[situacao]}
      </Badge>
    );
  }

  return (
    <Select value={situacao} onValueChange={(v) => alterar.mutate(v as SituacaoAcademia)} disabled={alterar.isPending}>
      <SelectTrigger className={cn("h-7 w-[132px] text-xs", COR[situacao])} aria-label="Situação do aluno na academia">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SITUACOES.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">
            {ROTULO_SITUACAO[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
