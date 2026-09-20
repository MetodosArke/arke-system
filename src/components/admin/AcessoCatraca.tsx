import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Fingerprint, ShieldOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const formatarData = (valor: string) =>
  new Date(valor).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Acesso físico do aluno pela catraca.
 *
 * O número aqui é o identificador do aluno DENTRO do equipamento. A digital
 * é comparada na própria catraca (1:N local) e o que ela manda para o ARKE
 * é esse número — nenhum dado biométrico trafega para decidir acesso, nem
 * fica guardado aqui.
 *
 * O consentimento vive ao lado de propósito: digital é dado pessoal
 * sensível (LGPD art. 5º, II) e a base legal em academia é o consentimento
 * específico e destacado (art. 11, I), separado do termo de saúde que a
 * anamnese já coleta. Cadastrar biometria sem esse registro é coletar dado
 * sensível sem base legal.
 */
export function AcessoCatraca({
  alunoId,
  organizationId,
  identificadorAtual,
}: {
  alunoId: string;
  organizationId: string;
  identificadorAtual: string | null;
}) {
  const [identificador, setIdentificador] = useState(identificadorAtual ?? "");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: consentimento } = useQuery({
    queryKey: ["consentimento-biometrico", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aluno_consentimento_biometrico")
        .select("id, aceito_em, finalidade, retencao_descricao")
        .eq("aluno_id", alunoId)
        .is("revogado_em", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const registrar = useMutation({
    mutationFn: async () => {
      const valor = identificador.trim();
      if (!valor) throw new Error("Informe o número do aluno no equipamento.");
      if (!consentimento) {
        throw new Error(
          "Registre o consentimento biométrico antes de vincular a digital — é exigência da LGPD."
        );
      }
      const { error } = await supabase
        .from("alunos")
        .update({ identificador_catraca: valor })
        .eq("id", alunoId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Acesso vinculado", description: "O aluno já pode liberar a catraca." });
      void queryClient.invalidateQueries({ queryKey: ["aluno-perfil", alunoId] });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível vincular", description: error.message, variant: "destructive" }),
  });

  const registrarConsentimento = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("aluno_consentimento_biometrico").insert({
        organization_id: organizationId,
        aluno_id: alunoId,
        template_no_servidor: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Consentimento registrado",
        description: "Guarde também a via assinada pelo aluno.",
      });
      void queryClient.invalidateQueries({ queryKey: ["consentimento-biometrico", alunoId] });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível registrar", description: error.message, variant: "destructive" }),
  });

  const revogar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("revogar_consentimento_biometrico", { _aluno_id: alunoId });
      if (error) throw error;
    },
    onSuccess: () => {
      setIdentificador("");
      toast({
        title: "Consentimento revogado",
        description: "Apague a digital no equipamento para concluir a exclusão.",
      });
      void queryClient.invalidateQueries({ queryKey: ["consentimento-biometrico", alunoId] });
      void queryClient.invalidateQueries({ queryKey: ["aluno-perfil", alunoId] });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível revogar", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      {consentimento ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary" className="gap-1">
            <Fingerprint className="h-3.5 w-3.5" /> Consentimento em {formatarData(consentimento.aceito_em)}
          </Badge>
          <span className="text-xs text-muted-foreground">{consentimento.finalidade}</span>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
          <p className="text-sm font-medium">Consentimento biométrico não registrado</p>
          <p className="text-xs text-muted-foreground">
            Digital é dado pessoal sensível e exige consentimento específico, por escrito e destacado —
            separado do termo da anamnese. Colha a assinatura do aluno antes de cadastrar a digital no
            equipamento.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={registrarConsentimento.isPending}
            onClick={() => registrarConsentimento.mutate()}
          >
            {registrarConsentimento.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Registrar consentimento assinado
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Número do aluno no equipamento
        </label>
        <div className="flex gap-2">
          <Input
            value={identificador}
            onChange={(e) => setIdentificador(e.target.value)}
            placeholder="Ex.: 6"
            disabled={!consentimento}
          />
          <Button disabled={registrar.isPending || !consentimento} onClick={() => registrar.mutate()}>
            {registrar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Vincular
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          É o número que a catraca usa para identificar o aluno, não o CPF. A digital fica no
          equipamento; o ARKE guarda só este número.
        </p>
      </div>

      {consentimento && (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={revogar.isPending}
          onClick={() => revogar.mutate()}
        >
          {revogar.isPending ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldOff className="mr-2 h-3.5 w-3.5" />
          )}
          Revogar consentimento e desvincular
        </Button>
      )}
    </div>
  );
}
