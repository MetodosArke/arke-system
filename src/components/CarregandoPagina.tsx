import { Loader2 } from "lucide-react";

/**
 * Enquanto o arquivo da página chega. Fica dentro do layout — o menu e o
 * cabeçalho continuam no lugar e só a área de conteúdo espera —, então trocar
 * de tela não faz o app inteiro piscar.
 */
export function CarregandoPagina() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Carregando">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * A tela inteira esperando o acesso (a raiz, a rota protegida, o vínculo do
 * aluno). O `role="status"` faz o leitor de tela dizer "Carregando" em vez de
 * silêncio; até 06/10/2026 esses spinners não se anunciavam.
 */
export function CarregandoTela() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        role="status"
        aria-label="Carregando"
        className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
      />
    </div>
  );
}
