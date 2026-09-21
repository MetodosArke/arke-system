import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportarErro } from "@/lib/monitoramento";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Defesa em profundidade: captura erros de renderização que escapam do
// restante do app (rotas, providers) para nunca deixar a tela em branco
// sem nenhuma mensagem visível ao usuário.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[error-boundary]", error, info.componentStack);
    // O console só ajuda quem está com o DevTools aberto — ou seja, nunca o
    // aluno no vestiário, que é justamente quem encontra o defeito.
    reportarErro(error, { componentStack: info.componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">
            Algo deu errado ao carregar o aplicativo
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Tente recarregar a página. Se o problema continuar, contate o suporte.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
