import { Link } from "react-router-dom";
import { PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AVISO_MODO_ESSENCIAL } from "@/lib/modoEssencial";

/**
 * O que a recepção vê no modo essencial (`src/lib/modoEssencial.ts`). Só a
 * equipe passa por aqui: o app do aluno e o display da catraca não sabem do
 * bloqueio B2B. Sem valor e sem link da fatura: quem paga é o gestor.
 */

/** A faixa discreta no topo do painel. */
export function FaixaModoEssencial() {
  return (
    <div role="status" className="bg-amber-500/15 text-warning text-xs text-center px-3 py-2 no-print">
      {AVISO_MODO_ESSENCIAL}
    </div>
  );
}

/** A rota pausada aberta pelo endereço: a explicação, no lugar da tela. */
export function PaginaPausada() {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <PauseCircle className="h-8 w-8 text-muted-foreground" aria-hidden />
      <h1 className="text-base font-semibold">Esta função está pausada</h1>
      <p className="text-sm text-muted-foreground">{AVISO_MODO_ESSENCIAL}</p>
      <p className="text-sm text-muted-foreground">
        O atendimento do aluno no balcão continua: a ficha, a matrícula, a cobrança, o check-in e as mensagens.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/dashboard">Voltar ao início</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/ajuda/painel-primeiros-passos">Saiba o que continua</Link>
        </Button>
      </div>
    </div>
  );
}
