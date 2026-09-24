import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { ROTULO_COMANDO, ROTULO_STATUS_COMANDO, resumoResultado, type TipoComando } from "@/lib/gateway";
import type { EstadoComando } from "@/hooks/useComandoGateway";

/** O que dizer enquanto espera, por tipo de ordem: a instrução para quem está com o aluno na frente. */
const ENQUANTO_EXECUTA: Partial<Record<TipoComando, string>> = {
  cadastrar_digital: "Peça ao aluno para pôr o mesmo dedo no leitor, três vezes, quando o equipamento pedir.",
  cadastrar_cartao: "Peça ao aluno para aproximar o cartão do leitor.",
  liberar_catraca: "A catraca libera assim que o Gateway receber a ordem.",
};

export function ProgressoComando({ estado }: { estado: EstadoComando }) {
  if (estado.fase === "ocioso") return null;

  if (estado.fase === "enviando" || estado.fase === "aguardando") {
    const status = estado.fase === "aguardando" && estado.comando ? estado.comando.status : "pendente";
    return (
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" role="status" aria-live="polite">
        <p className="flex items-center gap-2 font-medium">
          <Loader2 className="h-4 w-4 animate-spin" />
          {ROTULO_COMANDO[estado.tipo]} — {ROTULO_STATUS_COMANDO[status as keyof typeof ROTULO_STATUS_COMANDO] ?? status}
        </p>
        {status === "entregue" && ENQUANTO_EXECUTA[estado.tipo] && (
          <p className="mt-1 text-xs text-muted-foreground">{ENQUANTO_EXECUTA[estado.tipo]}</p>
        )}
      </div>
    );
  }

  const c = estado.comando;
  if (c.status === "concluido") {
    return (
      <div className="rounded-md border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm" role="status">
        <p className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          {resumoResultado(c.tipo, c.resultado)}
        </p>
      </div>
    );
  }
  const motivo =
    c.status === "expirado"
      ? "O Gateway não respondeu a tempo. Confira se o computador da recepção está ligado e com internet."
      : c.status === "pendente" || c.status === "entregue"
        ? "O Gateway ainda não terminou. Acompanhe na tela de Catracas."
        : c.erro ?? "O Gateway não conseguiu executar.";
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
      <p className="flex items-start gap-2">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <span>
          <strong>{ROTULO_COMANDO[c.tipo as TipoComando] ?? c.tipo}:</strong> {motivo}
        </span>
      </p>
    </div>
  );
}
