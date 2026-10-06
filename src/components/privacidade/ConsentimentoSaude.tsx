import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartPulse } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AvisoPerfilSimulado } from "@/components/AvisoPerfilSimulado";
import { emPerfilSimulado } from "@/lib/impersonation";
import { formatarDataBR } from "@/lib/dataBrasilia";
import { situacaoConsentimentoSaude, EFEITO_RETIRAR_CONSENTIMENTO_SAUDE } from "@/lib/consentimentoSaude";

/**
 * O consentimento de saúde em Perfil → Privacidade: ver quando foi dado e
 * retirar. A Política promete que o aluno revoga a qualquer momento, e até
 * 06/10/2026 não havia como (auditoria de 05/10).
 *
 * Retirar apaga as respostas da anamnese e o resumo da IA feito a partir
 * delas (`revogar_consentimento_saude`, migration 20261361010000). Autorizar de
 * novo é preencher a anamnese outra vez: o consentimento é dado junto com ela.
 */
export function ConsentimentoSaude({ alunoId }: { alunoId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { metodoArkeAtivo, refreshAluno } = useAuth();
  const simulado = emPerfilSimulado();

  const { data: anamnese, isLoading } = useQuery({
    queryKey: ["consentimento-saude", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anamnese_acolhimento")
        .select("consentimento_lgpd_aceito_em, consentimento_lgpd_versao, consentimento_lgpd_revogado_em")
        .eq("aluno_id", alunoId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const retirar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("revogar_consentimento_saude", { _aluno_id: alunoId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast({
        title: "Autorização retirada",
        description: "As respostas da sua anamnese e o resumo feito a partir delas foram apagados.",
      });
      void queryClient.invalidateQueries({ queryKey: ["consentimento-saude", alunoId] });
      await refreshAluno();
    },
    onError: (e: Error) => toast({ title: "Não foi possível retirar", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return null;
  const situacao = situacaoConsentimentoSaude(anamnese ?? null);
  if (situacao.tipo === "sem_anamnese") return null;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <HeartPulse className="h-4 w-4 text-primary" aria-hidden /> Dados de saúde
      </p>
      {(situacao.tipo === "autorizado" || situacao.tipo === "pendente") && (
        <>
          <p className="text-xs text-muted-foreground">
            {situacao.tipo === "autorizado"
              ? `Você autorizou o uso da sua anamnese no seu acompanhamento em ${formatarDataBR(situacao.em)}.`
              : "Há uma anamnese sua guardada sem a autorização do termo atual. Você pode retirar e apagar as respostas aqui."}
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={simulado || retirar.isPending}>
                Retirar autorização
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Retirar a autorização dos dados de saúde?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    {EFEITO_RETIRAR_CONSENTIMENTO_SAUDE.map((frase) => (
                      <p key={frase}>{frase}</p>
                    ))}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Manter</AlertDialogCancel>
                <AlertDialogAction onClick={() => retirar.mutate()}>Retirar e apagar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
      {situacao.tipo === "retirado" && (
        <>
          <p className="text-xs text-muted-foreground">
            Você retirou a autorização em {formatarDataBR(situacao.em)}. As respostas da sua anamnese foram apagadas, e
            a equipe não as vê mais.
          </p>
          {metodoArkeAtivo && (
            <Button size="sm" variant="outline" disabled={simulado} onClick={() => navigate("/app/onboarding")}>
              Autorizar de novo e preencher a anamnese
            </Button>
          )}
        </>
      )}
      {simulado && <AvisoPerfilSimulado />}
    </div>
  );
}
