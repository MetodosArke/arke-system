import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck } from "lucide-react";
import {
  CAIXA_CONSENTIMENTO_SAUDE,
  TEXTO_CONSENTIMENTO_SAUDE,
  VERSAO_CONSENTIMENTO_SAUDE,
} from "@/lib/consentimentoSaude";

// Tela de consentimento LGPD isolada: cobre o caso de alunos que já
// concluíram a anamnese M.A.P.A.® antes deste termo existir. Diferente do
// onboarding completo (src/pages/app/Onboarding.tsx), aqui não se refaz a
// anamnese — só se grava o aceite do termo sobre o registro já existente.
export default function ConsentimentoLgpd() {
  const { alunoId, refreshAluno } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [aceito, setAceito] = useState(false);

  const confirmar = useMutation({
    mutationFn: async () => {
      if (!alunoId) throw new Error("Cadastro de aluno não encontrado");
      const { error } = await supabase
        .from("anamnese_acolhimento")
        .update({
          consentimento_lgpd_aceito_em: new Date().toISOString(),
          consentimento_lgpd_versao: VERSAO_CONSENTIMENTO_SAUDE,
        })
        .eq("aluno_id", alunoId);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast({ title: "Consentimento registrado. Obrigado!" });
      await refreshAluno();
      navigate("/app", { replace: true });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível registrar", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-wide">LGPD — Dados de Saúde</span>
          </div>
          <CardTitle className="mt-2">Precisamos do seu consentimento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{TEXTO_CONSENTIMENTO_SAUDE}</p>
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <Checkbox id="consentimento-lgpd-retro" checked={aceito} onCheckedChange={(c) => setAceito(c === true)} />
            <Label htmlFor="consentimento-lgpd-retro" className="text-sm font-normal leading-snug">
              {CAIXA_CONSENTIMENTO_SAUDE}
            </Label>
          </div>
          <Button className="w-full" disabled={!aceito || confirmar.isPending} onClick={() => confirmar.mutate()}>
            {confirmar.isPending ? "Confirmando..." : "Confirmar e continuar"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
