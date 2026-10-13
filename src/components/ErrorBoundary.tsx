import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { reportarErro } from "@/lib/monitoramento";

interface Props {
  children: ReactNode;
  /**
   * Fronteira de uma área (o conteúdo de um layout), e não a da raiz: a
   * mensagem ocupa só o lugar da tela, e o menu continua de pé.
   */
  naArea?: boolean;
  /** Quando muda (a rota), o erro é esquecido e a tela nova renderiza. */
  chaveReset?: string;
}

interface State {
  error: Error | null;
}

// Defesa em profundidade: captura erros de renderização para nunca deixar a
// tela em branco sem nenhuma mensagem visível ao usuário.
//
// Até 13/10/2026 havia uma fronteira só, na raiz: o erro de render de
// qualquer tela derrubava o app inteiro, menu junto, e só recarregar saía
// dali. Agora cada área tem a sua em volta do conteúdo (`FronteiraDaTela`):
// a mensagem aparece dentro do layout, o menu segue funcionando, e ir para
// outra rota limpa o erro. A da raiz fica para o que escapa (providers, o
// próprio layout).
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

  componentDidUpdate(anterior: Props) {
    if (this.state.error && anterior.chaveReset !== this.props.chaveReset) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error && this.props.naArea) {
      return (
        <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <h2 className="text-lg font-semibold text-foreground">Esta tela teve um problema</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            O resto do aplicativo continua funcionando: escolha outra opção no menu, tente de novo ou recarregue a
            página. Se o problema continuar, contate o suporte.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground"
            >
              Tentar de novo
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center"
        >
          <h1 className="text-lg font-semibold text-foreground">Algo deu errado ao carregar o aplicativo</h1>
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

/**
 * A fronteira de uma área, em volta do conteúdo do layout (o `<Outlet />`) ou
 * das rotas públicas: o erro de uma tela fica nela, e a navegação para outra
 * rota limpa o erro.
 */
export function FronteiraDaTela({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary naArea chaveReset={pathname}>
      {children}
    </ErrorBoundary>
  );
}
