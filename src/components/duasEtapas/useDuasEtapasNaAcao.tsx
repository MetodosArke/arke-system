import { useEffect, useRef, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VerificacaoDuasEtapas } from "@/components/VerificacaoDuasEtapas";

/** Roda a ação uma vez, assim que a verificação deixa passar. */
function AoVerificar({ aoMontar }: { aoMontar: () => void }) {
  const feito = useRef(false);
  useEffect(() => {
    if (feito.current) return;
    feito.current = true;
    aoMontar();
  }, [aoMontar]);
  return null;
}

/**
 * Ações da gestão que pedem a verificação em duas etapas: exportar todos os
 * dados, encerrar a academia e trocar o e-mail de login de alguém (decisão de
 * 04/10/2026). Com a sessão já verificada, a ação roda direto; sem ela, abre
 * uma janela que pede o código, ou ativa o aplicativo autenticador para quem
 * ainda não ativou, e roda a ação depois. O banco e as funções exigem o
 * mesmo: esta janela só leva a pessoa até lá.
 */
export function useDuasEtapasNaAcao(motivo: ReactNode) {
  const [pendente, setPendente] = useState<null | (() => void)>(null);

  const exigir = async (acao: () => void) => {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel === "aal2") return acao();
    setPendente(() => acao);
  };

  const continuar = () => {
    const acao = pendente;
    setPendente(null);
    acao?.();
  };

  const dialogo = (
    <Dialog open={!!pendente} onOpenChange={(aberto) => !aberto && setPendente(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Verificação em duas etapas
          </DialogTitle>
        </DialogHeader>
        {pendente && (
          <VerificacaoDuasEtapas variante="embutida" descricao={motivo}>
            <AoVerificar aoMontar={continuar} />
          </VerificacaoDuasEtapas>
        )}
      </DialogContent>
    </Dialog>
  );

  return { exigir, dialogo };
}
