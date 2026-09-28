import { useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { MailX, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { mensagemDeErroEdge } from "@/lib/erroEdge";

/**
 * "Não quero mais receber" (`/contato/parar?t=<token>`), o link no fim de cada
 * e-mail da resposta automática ao contato do site. Pede um clique, e não
 * para ao abrir: programas de e-mail abrem os links para conferir se são
 * seguros, e isso não pode descadastrar ninguém. A resposta é a mesma exista
 * ou não o token.
 */
export default function PararContatoSite() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";

  const parar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("agente-comercial", { body: { parar: token } });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível registrar agora. Tente de novo em instantes."));
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {parar.isSuccess ? <CheckCircle2 className="h-6 w-6 text-primary" /> : <MailX className="h-6 w-6 text-primary" />}
          </div>
          <CardTitle>{parar.isSuccess ? "Pronto" : "Não receber mais os nossos e-mails"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {parar.isSuccess ? (
            <p className="text-sm text-muted-foreground">
              Você não vai mais receber mensagens da ArkeFit sobre o seu pedido de contato. Se mudar de ideia, é só escrever para a gente pelo site.
            </p>
          ) : !token ? (
            <p className="text-sm text-muted-foreground">
              Este link está incompleto. Use o link que veio no fim do e-mail, ou responda o próprio e-mail pedindo para não receber mais.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Você pediu contato em arkefit.com.br e está recebendo o convite para uma demonstração. Confirme para não receber mais.
              </p>
              <Button className="w-full" onClick={() => parar.mutate()} disabled={parar.isPending}>
                {parar.isPending ? "Registrando…" : "Não quero mais receber"}
              </Button>
              {parar.isError && <p className="text-sm text-destructive">{parar.error.message}</p>}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
