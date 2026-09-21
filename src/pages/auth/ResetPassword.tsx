import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, ArrowLeft, Dumbbell, Lock, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { verificarSenhaVazada, senhaDeveSerRecusada, mensagemSenhaVazada } from "@/lib/senhaVazada";

// Links de convite (novo aluno/equipe) e de ativação de cadastro chegam com
// type=invite/signup, ou type=recovery redirecionado para /auth/definir-senha
// (ver gerar-link-ativacao e index.html) — tratados por /auth/definir-senha;
// esta página cuida apenas do "esqueci minha senha" de contas já ativas.
const getRecoveryParamsFromUrl = () => {
  const href = window.location.href;
  const startIndexes = [
    href.indexOf("type=recovery"),
    href.indexOf("access_token="),
    href.indexOf("refresh_token="),
  ].filter((index) => index >= 0);

  if (!startIndexes.length) return null;

  return new URLSearchParams(href.slice(Math.min(...startIndexes)).split("#")[0]);
};

export default function ResetPassword() {
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [sent, setSent] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [recoveryUserEmail, setRecoveryUserEmail] = useState<string | null>(null);
  const [recoveryTokens, setRecoveryTokens] = useState<{ accessToken: string; refreshToken: string } | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { resetPassword } = useAuth();

  useEffect(() => {
    let isMounted = true;

    const bootstrapRecovery = async () => {
      const recoveryParams = getRecoveryParamsFromUrl();
      const accessToken = recoveryParams?.get("access_token");
      const refreshToken = recoveryParams?.get("refresh_token");
      const recoveryType = recoveryParams?.get("type");

      // SECURITY: Do NOT call setSession here. Establishing a session on mount
      // would authenticate the user just by opening the recovery link, even if
      // they never actually set a new password. Only exchange the tokens when
      // the user submits the new password form.
      if (accessToken && refreshToken && recoveryType === "recovery") {
        // Ensure no stale session is left over from a previous user in this browser
        await supabase.auth.signOut().catch(() => {});
        if (!isMounted) return;
        setRecoveryTokens({ accessToken, refreshToken });
        setIsRecovery(true);
        // Clean sensitive tokens from the address bar
        window.history.replaceState(
          {},
          document.title,
          `${window.location.pathname}${window.location.search}#/auth/reset-password`
        );
        return;
      }

      if (recoveryType === "recovery" || window.location.href.includes("type=recovery")) {
        setIsRecovery(true);
      }
    };

    void bootstrapRecovery();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { error } = await resetPassword(email);
    setIsLoading(false);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    setSent(true);
    toast({ title: "Email enviado!", description: "Verifique sua caixa de entrada." });
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast({ title: "Senha muito curta", description: "Use no mínimo 6 caracteres.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Senhas não coincidem", description: "Confirme a mesma senha nos dois campos.", variant: "destructive" });
      return;
    }
    setIsLoading(true);

    const { data: { session } } = await supabase.auth.getSession();

    if (!session && recoveryTokens) {
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: recoveryTokens.accessToken,
        refresh_token: recoveryTokens.refreshToken,
      });

      if (sessionError) {
        setIsLoading(false);
        toast({
          title: "Link inválido ou expirado",
          description: "Abra novamente o link recebido por email para redefinir a senha.",
          variant: "destructive",
        });
        return;
      }
    }

    // Recusa senha que já aparece em vazamentos públicos. Substitui o
    // recurso equivalente do Supabase, que só existe a partir do plano
    // pago. A senha não sai do navegador: só os 5 primeiros caracteres
    // do hash viajam (k-anonimato) — ver src/lib/senhaVazada.ts.
    const vazamento = await verificarSenhaVazada(newPassword);
    if (senhaDeveSerRecusada(vazamento)) {
      toast({
        title: "Escolha outra senha",
        description: mensagemSenhaVazada(vazamento.ocorrencias),
        variant: "destructive",
      });
      setIsLoading(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setIsLoading(false);

    if (error) {
      toast({
        title: "Erro",
        description: error.message === "Auth session missing!"
          ? "Seu link de recuperação expirou. Solicite um novo email de redefinição."
          : error.message,
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Senha atualizada!", description: "Você já pode fazer login." });
    await supabase.auth.signOut();
    navigate("/auth/login");
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm"
      >
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary">
            <Dumbbell className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">
            {isRecovery ? "Nova Senha" : "Recuperar Senha"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isRecovery
              ? `Defina sua nova senha${recoveryUserEmail ? ` para ${recoveryUserEmail}` : ""}`
              : sent
                ? "Verifique seu email"
                : "Informe seu email para resetar a senha"}
          </p>
        </div>

        <Card className="border-0 shadow-xl">
          <CardContent className="p-6">
            {isRecovery ? (
              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Label htmlFor="redefinir-senha" className="sr-only">
                    Nova senha (mínimo 6 caracteres)
                  </Label>
                  <Input
                    type={showNewPassword ? "text" : "password"}
                    id="redefinir-senha"
                    autoComplete="new-password"
                    placeholder="Nova senha (mínimo 6 caracteres)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pl-10 pr-10"
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label={showNewPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Label htmlFor="redefinir-confirmacao" className="sr-only">
                    Confirmar nova senha
                  </Label>
                  <Input
                    type={showConfirmPassword ? "text" : "password"}
                    id="redefinir-confirmacao"
                    autoComplete="new-password"
                    placeholder="Confirmar nova senha"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10 pr-10"
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  type="submit"
                  className="w-full gradient-primary text-primary-foreground font-semibold"
                  disabled={isLoading}
                >
                  {isLoading ? "Atualizando..." : "Atualizar senha"}
                </Button>
              </form>
            ) : !sent ? (
              <form onSubmit={handleReset} className="space-y-4">
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Label htmlFor="redefinir-email" className="sr-only">
                    E-mail
                  </Label>
                  <Input
                    type="email"
                    id="redefinir-email"
                    autoComplete="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full gradient-primary text-primary-foreground font-semibold"
                  disabled={isLoading}
                >
                  {isLoading ? "Enviando..." : "Enviar link"}
                </Button>
              </form>
            ) : (
              <div className="text-center">
                <p className="mb-4 text-sm text-muted-foreground">
                  Um link de recuperação foi enviado para <strong>{email}</strong>.
                </p>
                <Button variant="outline" onClick={() => setSent(false)} className="w-full">
                  Enviar novamente
                </Button>
              </div>
            )}

            <Button
              variant="ghost"
              className="mt-4 w-full"
              onClick={() => navigate("/auth/login")}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar ao login
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
