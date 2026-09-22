import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PauseCircle, RefreshCw } from "lucide-react";

// Gate da situação do aluno na academia (plano Free). O app é para quem está
// em dia; pausado ou inadimplente é a academia que marca, na ficha ou na
// importação, e só ela desfaz. Por isso a tela não oferece pagamento — a
// cobrança da mensalidade, hoje, é da academia — e sim o caminho de volta:
// falar com a recepção e conferir de novo.
//
// Gate de experiência, como o de cobrança: o que protege os dados é o RLS.
export function AlunoSituacaoGate({ children }: { children: React.ReactNode }) {
  const { alunoId, situacaoAcademia, organization, refreshAluno, signOut } = useAuth();
  const [verificando, setVerificando] = useState(false);

  if (!alunoId || !situacaoAcademia || situacaoAcademia === "em_dia") {
    return <>{children}</>;
  }

  const academia = organization?.nome ?? "sua academia";
  const pausado = situacaoAcademia === "pausado";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <PauseCircle className="h-10 w-10 text-muted-foreground mb-2" />
          <CardTitle>{pausado ? "Sua matrícula está pausada" : "Seu acesso está suspenso"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            {pausado
              ? `A ${academia} pausou a sua matrícula. Seus treinos e seu histórico continuam guardados e voltam assim que ela for reativada.`
              : `A ${academia} registrou uma pendência na sua mensalidade. Seus treinos e seu histórico continuam guardados e voltam assim que ela for resolvida.`}
          </p>
          <p className="text-sm">Fale com a recepção da academia para retomar.</p>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              disabled={verificando}
              onClick={async () => {
                setVerificando(true);
                await refreshAluno();
                setVerificando(false);
              }}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${verificando ? "animate-spin" : ""}`} />
              {verificando ? "Verificando..." : "Já resolvi, verificar de novo"}
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
