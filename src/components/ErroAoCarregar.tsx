import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A consulta falhou: diz isso, e não "nenhum registro".
 *
 * Até 06/10/2026 quase toda lista da gestão e do app do aluno tratava o erro
 * da consulta como lista vazia. Num soluço de rede, a lista de alunos dizia
 * "Nenhum aluno cadastrado ainda." e o treino, "Nenhum treino publicado
 * ainda." — o gestor achava que tinha perdido a base e importava de novo, e o
 * aluno achava que a academia tinha apagado o treino. Um estado vazio só é
 * verdade quando a consulta respondeu; quando ela falhou, a tela diz que
 * falhou e oferece tentar de novo.
 *
 * `estadoVazio.guarda.test.ts` cobra que a tela com estado vazio trate o erro
 * da mesma consulta.
 */
export function ErroAoCarregar({
  oQue,
  onTentarDeNovo,
  tentando = false,
  className,
}: {
  /** O que não carregou, com o artigo: "os alunos", "o treino". */
  oQue: string;
  onTentarDeNovo: () => void;
  tentando?: boolean;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-2 p-6 text-center", className)}>
      <WifiOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">Não foi possível carregar {oQue}.</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        A conexão falhou no caminho. Nada foi apagado: tente de novo em instantes.
      </p>
      <Button size="sm" variant="outline" className="mt-1" disabled={tentando} onClick={onTentarDeNovo}>
        <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", tentando && "animate-spin")} aria-hidden="true" />
        {tentando ? "Tentando..." : "Tentar de novo"}
      </Button>
    </div>
  );
}
