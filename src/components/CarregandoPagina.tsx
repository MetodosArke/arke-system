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
