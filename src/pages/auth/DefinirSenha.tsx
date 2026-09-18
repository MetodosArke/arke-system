import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { resolveHomePath } from "@/lib/authRouting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dumbbell, Lock, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

type Status = "carregando" | "pronto" | "enviando" | "concluido" | "invalido";

// index.html normaliza o link de convite recebido por e-mail
// (?access_token=...&refresh_token=...&type=invite|signup) para esta rota.
const getTokenParamsFromUrl = () => {
  const href = window.location.href;
  const startIndexes = [href.indexOf("access_token="), href.indexOf("refresh_token=")].filter(
    (index) => index >= 0
  );
  if (!startIndexes.length) return null;
  return new URLSearchParams(href.slice(Math.min(...startIndexes)).split("#")[0]);
};

// Página que recebe quem foi convidado (aluno, personal ou nutricionista)
// pelo cadastro em /admin/alunos ou /admin/equipe: estabelece a sessão a
// partir do link do e-mail, escuta SIGNED_IN/PASSWORD_RECOVERY para saber
// quando ela está pronta, deixa a pessoa definir a própria senha e então
// redireciona para a área correspondente ao papel dela.
export default function DefinirSenha() {
  const [status, setStatus] = useState<Status>("carregando");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { updatePassword, refreshOrganization, roles, organizationRole, rolesLoaded } = useAuth();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") && session) {
        setStatus("pronto");
      }
    });

    const bootstrap = async () => {
      const params = getTokenParamsFromUrl();
      const accessToken = params?.get("access_token");
      const refreshToken = params?.get("refresh_token");

      // Limpa os tokens sensíveis da barra de endereço assim que lidos.
      window.history.replaceState(
        {},
        document.title,
        `${window.location.pathname}${window.location.search}#/auth/definir-senha`
      );

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) setStatus("invalido");
        // sucesso: o listener acima recebe SIGNED_IN e muda para "pronto"
        return;
      }

      // Sem tokens no link — só é válido se já existir uma sessão ativa
      // (ex.: usuário atualizou a página depois do primeiro carregamento).
      const { data } = await supabase.auth.getSession();
      setStatus(data.session ? "pronto" : "invalido");
    };

    void bootstrap();

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (status === "concluido" && rolesLoaded) {
      navigate(resolveHomePath(roles, organizationRole), { replace: true });
    }
  }, [status, rolesLoaded, roles, organizationRole, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast({ title: "Senha muito curta", description: "Use no mínimo 6 caracteres.", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Senhas não coincidem", description: "Confirme a mesma senha nos dois campos.", variant: "destructive" });
      return;
    }

    setStatus("enviando");
    const { error } = await updatePassword(password);
    if (error) {
      setStatus("pronto");
      toast({ title: "Erro ao definir a senha", description: error.message, variant: "destructive" });
      return;
    }

    // Garante que organização/papel/perfil (vinculados no convite) já
    // estejam carregados no AuthContext antes de decidir para onde ir.
    await refreshOrganization();
    setStatus("concluido");
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
          <h1 className="text-2xl font-bold">Bem-vindo(a) à ArkeFit</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {status === "invalido"
              ? "Não foi possível validar seu convite"
              : "Defina sua senha para concluir o cadastro"}
          </p>
        </div>

        <Card className="border-0 shadow-xl">
          <CardContent className="p-6">
            {status === "carregando" && (
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="text-sm text-muted-foreground">Validando seu convite...</p>
              </div>
            )}

            {status === "invalido" && (
              <div className="text-center">
                <p className="mb-4 text-sm text-muted-foreground">
                  Este link de convite é inválido ou já expirou. Peça para quem te convidou enviar um novo
                  e-mail, ou entre com sua conta caso já tenha definido a senha.
                </p>
                <Button variant="outline" className="w-full" onClick={() => navigate("/auth/login")}>
                  Ir para o login
                </Button>
              </div>
            )}

            {(status === "pronto" || status === "enviando") && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Nova senha (mínimo 6 caracteres)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10"
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Confirmar nova senha"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10 pr-10"
                    minLength={6}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full gradient-primary text-primary-foreground font-semibold"
                  disabled={status === "enviando"}
                >
                  {status === "enviando" ? "Salvando..." : "Definir senha e entrar"}
                </Button>
              </form>
            )}

            {status === "concluido" && (
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="text-sm text-muted-foreground">Senha definida! Preparando seu acesso...</p>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
