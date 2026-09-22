import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText } from "lucide-react";
import { DOCUMENTOS, type TipoDocumento } from "@/lib/documentosLegais";

/**
 * Aceite dos documentos legais vigentes antes de usar a plataforma: termos e
 * privacidade para todos; o contrato da academia para o gestor (em nome dela,
 * fora de trial). Nova versão de um documento = aceite pedido de novo.
 *
 * O que falta vem de `get_aceites_pendentes` (a ArkeFit não passa por aqui), e
 * o aceite só nasce por `registrar_aceite`, com data, versão e navegador.
 * Falha ao consultar não tranca ninguém: o aceite volta a ser pedido no
 * próximo carregamento.
 */
export function AceiteDocumentosGate({ children }: { children: React.ReactNode }) {
  const { user, organization, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [marcado, setMarcado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const { data: pendentes = [] } = useQuery({
    queryKey: ["aceites-pendentes", user?.id, organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_aceites_pendentes", { _organization_id: organization?.id ?? undefined });
      if (error) {
        console.error("Falha ao consultar aceites pendentes", error.code);
        return [];
      }
      return (data ?? []).map((d) => d.tipo as TipoDocumento);
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  if (!pendentes.length) return <>{children}</>;

  const pessoais = pendentes.filter((t) => t !== "contrato_academia");
  const contrato = pendentes.includes("contrato_academia");

  const aceitar = async () => {
    setSalvando(true);
    setErro(null);
    const agente = navigator.userAgent;
    for (const tipo of pendentes) {
      const { error } = await supabase.rpc("registrar_aceite", {
        _tipo: tipo,
        _organization_id: tipo === "contrato_academia" ? organization?.id : undefined,
        _user_agent: agente,
      });
      if (error) {
        setErro("Não foi possível registrar o aceite. Tente de novo.");
        setSalvando(false);
        return;
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["aceites-pendentes"] });
    await queryClient.invalidateQueries({ queryKey: ["onboarding-academia"] });
    setSalvando(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <FileText className="h-10 w-10 text-primary mb-2" />
          <CardTitle>{pessoais.length ? "Antes de continuar" : "Contrato da academia"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {pessoais.length
              ? "Leia e aceite os documentos abaixo para usar a plataforma."
              : `Aceite o contrato de uso da plataforma em nome da ${organization?.nome ?? "academia"}.`}
          </p>
          <ul className="space-y-1.5 text-sm">
            {pendentes.map((t) => (
              <li key={t}>
                <a href={`/#${DOCUMENTOS[t].caminho}`} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                  {DOCUMENTOS[t].titulo}
                </a>
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={marcado} onCheckedChange={(v) => setMarcado(v === true)} className="mt-0.5" />
            <span>
              Li e aceito {pendentes.length > 1 ? "os documentos acima" : "o documento acima"}
              {contrato ? `, e tenho poderes para aceitar o contrato em nome da ${organization?.nome ?? "academia"}` : ""}.
            </span>
          </label>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex flex-col gap-2">
            <Button disabled={!marcado || salvando} onClick={() => void aceitar()}>
              {salvando ? "Registrando..." : "Aceitar e continuar"}
            </Button>
            <Button variant="ghost" onClick={() => void signOut()}>
              Sair
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
