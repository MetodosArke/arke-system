import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dumbbell } from "lucide-react";
import { MetodoArkeEmBreve } from "@/components/aluno/MetodoArkeEmBreve";
import { useToast } from "@/hooks/use-toast";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { Turnstile } from "@/components/public/Turnstile";

// Sem a chave, a matrícula segue sem captcha (e o servidor não o exige sem
// TURNSTILE_SECRET_KEY). Ver components/public/Turnstile.
const TURNSTILE_SITE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined;

interface OrganizacaoPublica {
  organization_id: string;
  nome: string;
}

export default function PublicMatricula() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signIn } = useAuth();

  // Captcha só quando configurado (ver components/public/Turnstile). O token é
  // de uso único: a cada falha o widget é remontado para gerar outro.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaVersao, setCaptchaVersao] = useState(0);
  const [form, setForm] = useState({ full_name: "", email: "", telefone: "", cpf: "", password: "", confirmar: "" });

  const { data: org, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["organizacao-publica", slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_organizacao_publica", { _slug: slug! });
      if (error) throw error;
      return (data?.[0] as unknown as OrganizacaoPublica | undefined) ?? null;
    },
    enabled: !!slug,
  });

  const matricular = useMutation({
    mutationFn: async () => {
      if (!slug) throw new Error("Academia inválida.");
      if (form.password.length < 6) throw new Error("A senha deve ter no mínimo 6 caracteres.");
      if (form.password !== form.confirmar) throw new Error("As senhas não coincidem.");
      if (TURNSTILE_SITE_KEY && !captchaToken) throw new Error("Aguarde a verificação de segurança terminar.");

      const { data, error } = await supabase.functions.invoke<{ user_id: string; error?: string }>(
        "matricula-publica",
        {
          body: {
            slug,
            full_name: form.full_name,
            email: form.email,
            telefone: form.telefone,
            cpf: form.cpf,
            password: form.password,
            captcha_token: captchaToken ?? undefined,
          },
        }
      );
      // Resposta de erro da função vem em error.context, não em data — sem
      // isto, senha vazada, e-mail repetido e excesso de tentativas chegavam
      // ao aluno como uma frase genérica em inglês.
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível concluir a matrícula."));
      if (data?.error) throw new Error(data.error);

      const { error: signInError } = await signIn(form.email, form.password);
      if (signInError) throw signInError;
    },
    onSuccess: () => {
      toast({ title: "Matrícula concluída!", description: "Bem-vindo! Seus treinos aparecem aqui assim que a academia publicar." });
      navigate("/app", { replace: true });
    },
    onError: (error: Error) => {
      if (TURNSTILE_SITE_KEY) {
        setCaptchaToken(null);
        setCaptchaVersao((v) => v + 1);
      }
      toast({ title: "Não foi possível concluir a matrícula", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
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

  // Falha ao carregar não é academia inexistente. Antes as duas caíam na mesma
  // tela, e um soluço de rede dizia a quem tinha o link certo que a academia
  // não existe — o tipo de coisa que faz a pessoa desistir da matrícula.
  if (isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center space-y-3">
            <p className="font-medium">Não foi possível carregar a matrícula agora</p>
            <p className="text-sm text-muted-foreground">A conexão falhou no meio do caminho. Tente de novo em instantes.</p>
            <Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? "Tentando..." : "Tentar de novo"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center space-y-2">
            <p className="font-medium">Academia não encontrada</p>
            <p className="text-sm text-muted-foreground">
              Verifique o link com a sua academia ou entre em contato para obter o link correto de matrícula.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 py-10">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="text-center space-y-1">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl gradient-primary">
            <Dumbbell className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">{org.nome}</h1>
          <p className="text-sm text-muted-foreground">Crie sua conta para acessar o app da academia.</p>
        </div>

        <MetodoArkeEmBreve />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Seus dados</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                matricular.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="full_name">Nome completo</Label>
                <Input id="full_name" required value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="telefone">Telefone</Label>
                  <Input id="telefone" value={form.telefone} onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))} placeholder="(11) 91234-5678" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cpf">CPF</Label>
                  <Input id="cpf" value={form.cpf} onChange={(e) => setForm((f) => ({ ...f, cpf: e.target.value }))} placeholder="000.000.000-00" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="password">Senha</Label>
                  <Input id="password" type="password" required minLength={6} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmar">Confirmar senha</Label>
                  <Input id="confirmar" type="password" required minLength={6} value={form.confirmar} onChange={(e) => setForm((f) => ({ ...f, confirmar: e.target.value }))} />
                </div>
              </div>
              {TURNSTILE_SITE_KEY && (
                <Turnstile key={captchaVersao} siteKey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />
              )}
              <Button
                type="submit"
                className="w-full gradient-primary text-primary-foreground font-semibold"
                disabled={matricular.isPending || (!!TURNSTILE_SITE_KEY && !captchaToken)}
              >
                {matricular.isPending ? "Criando sua conta..." : "Confirmar matrícula"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
