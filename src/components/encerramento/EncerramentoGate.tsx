import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarX, LogOut } from "lucide-react";
import { ExportarDadosAcademia } from "@/components/admin/ExportarDadosAcademia";
import { ExportarContador } from "@/components/admin/ExportarContador";
import { dataCurta, encerramentoDaAcademia } from "@/lib/encerramento";

/**
 * Encerramento do contrato da academia, do lado de quem usa o sistema.
 *
 * - Durante o aviso, tudo funciona; a gestão vê uma faixa com a data do
 *   término e onde exportar os dados.
 * - Depois do término, o painel fica só para exportação (a gestão) e o app
 *   avisa o aluno. É o que o contrato descreve: as cobranças já pararam e as
 *   digitais saíram das catracas.
 *
 * Gate de experiência, como os outros: quem protege os dados é o RLS.
 */
export function EncerramentoGate({ children, publico }: { children: ReactNode; publico: "equipe" | "aluno" }) {
  const { organization, organizationRole, signOut } = useAuth();
  const orgId = organization?.id;
  const { data: encerramento } = useQuery({
    queryKey: ["encerramento-academia", orgId],
    queryFn: () => encerramentoDaAcademia(orgId!),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });

  if (!encerramento) return <>{children}</>;
  const gestao = publico === "equipe" && organizationRole === "gestor";

  if (encerramento.etapa === "aviso") {
    if (!gestao) return <>{children}</>;
    return (
      <>
        <div role="status" className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
          O contrato com o ARKE termina em <strong>{dataCurta(encerramento.termino_em)}</strong>. Até lá tudo segue funcionando;
          exporte os dados em{" "}
          <Link to="/admin/organizacao" className="underline">
            Organização
          </Link>
          .
        </div>
        {children}
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarX className="h-5 w-5 text-muted-foreground" />
            {publico === "aluno" ? "Sua academia encerrou o uso do ARKE" : "Contrato encerrado"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {publico === "aluno" ? (
            <p>
              {organization?.nome ?? "A academia"} encerrou o uso do ARKE em {dataCurta(encerramento.termino_em)}. Seus treinos e pagamentos
              passam a ser tratados diretamente com a recepção.
            </p>
          ) : gestao ? (
            <>
              <p>
                O contrato com o ARKE terminou em {dataCurta(encerramento.termino_em)}. As cobranças dos alunos pararam e as digitais
                saíram das catracas.
              </p>
              <p>
                Até <strong>{dataCurta(encerramento.eliminacao_em)}</strong> você pode exportar os dados da academia. Depois disso eles
                são eliminados, como prevê o contrato.
              </p>
              <div className="flex flex-wrap gap-2">
                <ExportarDadosAcademia variante="default" />
                <ExportarContador />
              </div>
            </>
          ) : (
            <p>
              O contrato da academia com o ARKE terminou em {dataCurta(encerramento.termino_em)}. Fale com a gestão da academia.
            </p>
          )}
          <Button variant="ghost" onClick={() => void signOut()}>
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
