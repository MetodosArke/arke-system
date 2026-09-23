import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { mensagemDeErroEdge } from "@/lib/erroEdge";

type Resposta = {
  resumo?: string;
  exige_atencao?: boolean;
  reaproveitado?: boolean;
  sem_consentimento?: boolean;
  indisponivel?: boolean;
  motivo?: string;
};

/**
 * O consentimento do aluno para a IA ler a anamnese dele.
 *
 * **Específico e destacado** (LGPD art. 11, I), e por isso um bloco próprio em
 * vez de uma linha no termo geral: o consentimento da anamnese não cobre isto,
 * pela mesma razão que não cobria a digital — são finalidades diferentes, e
 * consentimento genérico não é consentimento.
 *
 * A finalidade e a retenção aparecem na tela com as mesmas palavras que ficam
 * gravadas na tabela. Quem autoriza precisa ver o que está autorizando, e não
 * um resumo simpático do que está autorizando.
 */
export function ConsentimentoSentinela({ alunoId, organizationId }: { alunoId: string; organizationId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: consentimento, isLoading } = useQuery({
    queryKey: ["consentimento-ia", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aluno_consentimento_ia")
        .select("id, aceito_em, revogado_em, finalidade, retencao_descricao")
        .eq("aluno_id", alunoId)
        .is("revogado_em", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const alternar = useMutation({
    mutationFn: async (autorizar: boolean) => {
      if (autorizar) {
        const { error } = await supabase
          .from("aluno_consentimento_ia")
          .insert({ aluno_id: alunoId, organization_id: organizationId });
        if (error) throw error;
      } else {
        // Revogar, não apagar: o registro de que houve autorização e de quando
        // ela foi retirada é o que prova depois que a regra foi seguida.
        const { error } = await supabase
          .from("aluno_consentimento_ia")
          .update({ revogado_em: new Date().toISOString() })
          .eq("aluno_id", alunoId)
          .is("revogado_em", null);
        if (error) throw error;
      }
    },
    onSuccess: (_, autorizar) => {
      toast({
        title: autorizar ? "Autorização registrada" : "Autorização retirada",
        description: autorizar
          ? "A equipe passa a ver um resumo da sua anamnese."
          : "O resumo foi apagado e a análise não será mais feita.",
      });
      void queryClient.invalidateQueries({ queryKey: ["consentimento-ia", alunoId] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return null;
  const autorizado = !!consentimento;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label htmlFor="consentimento-ia" className="text-sm font-medium">
            Resumo da anamnese para a equipe
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Autorizo que a inteligência artificial do ARKE leia a minha anamnese para resumir, à equipe que me
            acompanha, o histórico que exige cuidado no treino.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            O resumo fica no ARKE enquanto durar a minha matrícula. O provedor de IA processa sem reter, e o texto não é
            usado para treinar modelo. <strong>Posso retirar esta autorização quando quiser</strong>, e o resumo é
            apagado.
          </p>
        </div>
        <Switch
          id="consentimento-ia"
          checked={autorizado}
          disabled={alternar.isPending}
          onCheckedChange={(v) => alternar.mutate(v)}
          aria-label="Autorizar análise da anamnese por inteligência artificial"
        />
      </div>
      {autorizado && consentimento?.aceito_em && (
        <p className="text-[11px] text-muted-foreground">
          Autorizado em {new Date(consentimento.aceito_em).toLocaleDateString("pt-BR")}.
        </p>
      )}
    </div>
  );
}

/**
 * O resumo, para quem atende o aluno.
 *
 * Não substitui ler a anamnese — resume o que precisa de atenção **antes** do
 * primeiro contato. E diz de onde veio: um texto de IA apresentado como se
 * fosse avaliação profissional seria o mesmo problema que a fronteira
 * CREF/CRN existe para evitar.
 */
export function ResumoSentinela({ alunoId }: { alunoId: string }) {
  const { toast } = useToast();

  const gerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("sentinela-anamnese", { body: { aluno_id: alunoId } });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível falar com o Sentinela."));
      return data as Resposta;
    },
    onError: (e: Error) => toast({ title: "Sem resumo agora", description: e.message }),
  });

  const { data: salvo } = useQuery({
    queryKey: ["sentinela-anamnese", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sentinela_anamnese")
        .select("resumo, exige_atencao, created_at")
        .eq("aluno_id", alunoId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const r = gerar.data;
  const resumo = r?.resumo ?? salvo?.resumo ?? null;
  const atencao = r?.exige_atencao ?? salvo?.exige_atencao ?? false;

  if (r?.sem_consentimento) {
    return (
      <p className="text-xs text-muted-foreground">
        O aluno não autorizou a análise da anamnese por IA. Leia a anamnese na íntegra na aba de acolhimento.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {resumo ? (
        <div className={`rounded-md border p-3 ${atencao ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
          {atencao && (
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Histórico que exige cuidado
            </p>
          )}
          <p className="text-sm">{resumo}</p>
          <p className="mt-2 text-[11px] italic text-muted-foreground">
            Resumo gerado por IA a partir do que o aluno declarou. Não é avaliação profissional e não substitui ler a
            anamnese.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {r?.indisponivel ? r.motivo : "Nenhum resumo gerado ainda."}
        </p>
      )}
      <Button size="sm" variant="outline" disabled={gerar.isPending} onClick={() => gerar.mutate()}>
        {gerar.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
        {resumo ? "Atualizar resumo" : "Gerar resumo"}
      </Button>
    </div>
  );
}
