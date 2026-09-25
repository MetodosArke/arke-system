import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2 } from "lucide-react";
import { DOCUMENTOS } from "@/lib/documentosLegais";
import { formatarDataBR } from "@/lib/dataBrasilia";

/**
 * Contrato da academia (licença + tratamento de dados). Fora de trial ele já é
 * pedido na entrada do painel (AceiteDocumentosGate); aqui aparece aceito, com
 * a data, ou — em trial — pode ser aceito na própria etapa.
 */
export function EtapaContrato({ onSalvo }: { onSalvo: () => void }) {
  const { organization } = useAuth();
  const { toast } = useToast();
  const [marcado, setMarcado] = useState(false);
  const doc = DOCUMENTOS.contrato_academia;

  const { data: aceite, refetch } = useQuery({
    queryKey: ["aceite-contrato", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aceites_documentos")
        .select("aceito_em, documentos_legais!inner(tipo, versao)")
        .eq("organization_id", organization!.id)
        .eq("documentos_legais.tipo", "contrato_academia")
        .eq("documentos_legais.versao", doc.versao)
        .order("aceito_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const aceitar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("registrar_aceite", {
        _tipo: "contrato_academia",
        _organization_id: organization!.id,
        _user_agent: navigator.userAgent,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Contrato aceito" });
      void refetch();
      onSalvo();
    },
    onError: (e: Error) => toast({ title: "Não foi possível registrar", description: e.message, variant: "destructive" }),
  });

  const link = (
    <a href={`/#${doc.caminho}`} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
      {doc.titulo}
    </a>
  );

  if (aceite) {
    return (
      <p className="text-sm flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <span>
          {link} aceito em {formatarDataBR(aceite.aceito_em)}.
        </span>
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">Leia o {link}: plano e cobrança, regras de uso e o acordo de tratamento dos dados dos seus alunos.</p>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={marcado} onCheckedChange={(v) => setMarcado(v === true)} className="mt-0.5" />
        <span>Li e aceito o contrato, e tenho poderes para aceitá-lo em nome da {organization?.nome ?? "academia"}.</span>
      </label>
      <Button disabled={!marcado || aceitar.isPending} onClick={() => aceitar.mutate()}>
        {aceitar.isPending ? "Registrando..." : "Aceitar contrato"}
      </Button>
    </div>
  );
}
