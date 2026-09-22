import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dumbbell, MailCheck } from "lucide-react";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { Turnstile } from "@/components/public/Turnstile";
import { LinksLegais } from "@/components/legal/LinksLegais";

const TURNSTILE_SITE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined;

/**
 * "Primeiro acesso" da academia (`/p/:slug/primeiro-acesso`, o QR Code da
 * recepção). O aluno que a academia já cadastrou digita o e-mail ou o celular
 * e recebe o próprio link para criar a senha. A resposta é sempre a mesma,
 * exista ou não o cadastro — quem não é aluno segue para a matrícula.
 */
export default function PrimeiroAcesso() {
  const { slug } = useParams<{ slug: string }>();
  const [contato, setContato] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaVersao, setCaptchaVersao] = useState(0);
  const [resposta, setResposta] = useState<string | null>(null);

  const { data: academia } = useQuery({
    queryKey: ["primeiro-acesso-org", slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_organizacao_publica", { _slug: slug! });
      if (error) throw error;
      return (data?.[0] as { nome?: string } | undefined) ?? null;
    },
    enabled: !!slug,
  });

  const enviar = useMutation({
    mutationFn: async () => {
      if (!contato.trim()) throw new Error("Informe o e-mail ou o celular cadastrado na academia.");
      if (TURNSTILE_SITE_KEY && !captchaToken) throw new Error("Aguarde a verificação de segurança terminar.");
      const { data, error } = await supabase.functions.invoke<{ mensagem?: string; error?: string }>("primeiro-acesso", {
        body: { slug, contato: contato.trim(), captcha_token: captchaToken ?? undefined },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível enviar agora. Tente de novo."));
      if (data?.error) throw new Error(data.error);
      return data?.mensagem ?? "Se você está cadastrado nesta academia, enviamos um link para o seu e-mail.";
    },
    onSuccess: (mensagem) => setResposta(mensagem),
    onError: () => {
      if (TURNSTILE_SITE_KEY) {
        setCaptchaToken(null);
        setCaptchaVersao((v) => v + 1);
      }
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Dumbbell className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Primeiro acesso{academia?.nome ? ` — ${academia.nome}` : ""}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Já é aluno? Digite o e-mail ou o celular que você informou na academia. Enviamos um link para você criar a sua senha.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {resposta ? (
            <div className="space-y-3 text-center">
              <MailCheck className="h-10 w-10 text-primary mx-auto" />
              <p className="text-sm">{resposta}</p>
              <Button variant="outline" onClick={() => setResposta(null)}>
                Tentar outro e-mail ou celular
              </Button>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                enviar.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="primeiro-acesso-contato">E-mail ou celular</Label>
                <Input
                  id="primeiro-acesso-contato"
                  autoComplete="email"
                  value={contato}
                  onChange={(e) => setContato(e.target.value)}
                  placeholder="voce@email.com ou (11) 91234-5678"
                  required
                />
              </div>
              {TURNSTILE_SITE_KEY && <Turnstile key={captchaVersao} siteKey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />}
              {enviar.error && <p className="text-sm text-destructive">{enviar.error.message}</p>}
              <Button type="submit" className="w-full" disabled={enviar.isPending || (!!TURNSTILE_SITE_KEY && !captchaToken)}>
                {enviar.isPending ? "Enviando..." : "Receber meu link"}
              </Button>
            </form>
          )}
          <p className="text-xs text-center text-muted-foreground">
            Ainda não é aluno?{" "}
            <Link to={`/p/${slug}`} className="text-primary underline-offset-2 hover:underline">
              Faça sua matrícula
            </Link>{" "}
            · Já criou a senha?{" "}
            <Link to="/auth/login" className="text-primary underline-offset-2 hover:underline">
              Entrar
            </Link>
          </p>
          <LinksLegais />
        </CardContent>
      </Card>
    </div>
  );
}
