import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Lock, Eye, EyeOff, Moon, Sun, Download, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { resolveHomePath } from "@/lib/authRouting";
import logo from "@/assets/logo.png";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { signIn, roles, organizationRole, isAuthenticated, rolesLoaded } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { canInstall, promptInstall } = useInstallPrompt();
  const [showInstallBanner, setShowInstallBanner] = useState(true);

  // Redirect based on role after authentication
  useEffect(() => {
    if (isAuthenticated && rolesLoaded) {
      navigate(resolveHomePath(roles, organizationRole), { replace: true });
    }
  }, [isAuthenticated, rolesLoaded, roles, organizationRole, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { error } = await signIn(email, password);
    setIsLoading(false);
    if (error) {
      toast({
        title: "Erro ao entrar",
        description: error.message === "Invalid login credentials"
          ? "Email ou senha incorretos."
          : error.message,
        variant: "destructive",
      });
      return;
    }
    // Redirect handled by useEffect above
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <AnimatePresence>
        {canInstall && showInstallBanner && (
          <motion.div
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40 }}
            transition={{ duration: 0.3 }}
            className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-3 bg-primary px-4 py-3 text-primary-foreground shadow-lg"
          >
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 shrink-0" />
              <span className="text-sm font-medium">Instale o app para uma experiência melhor!</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="h-8 text-xs font-semibold"
                onClick={promptInstall}
              >
                Instalar
              </Button>
              <button onClick={() => setShowInstallBanner(false)} className="text-primary-foreground/70 hover:text-primary-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        className="absolute right-4 top-4"
      >
        {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </Button>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={logo} alt="Arke" className="h-24 w-24 mb-4 rounded-xl" />
          <h1 className="text-2xl font-bold tracking-wide text-primary" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
            ARKE
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gestão inteligente de treinos
          </p>
        </div>

        <Card className="border-0 shadow-xl">
          <CardContent className="p-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-muted-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => navigate("/auth/reset-password")}
                  className="text-xs text-primary hover:underline"
                >
                  Esqueceu a senha?
                </button>
              </div>

              <Button
                type="submit"
                className="w-full gradient-primary text-primary-foreground font-semibold"
                disabled={isLoading}
              >
                {isLoading ? "Entrando..." : "Entrar"}
              </Button>

            </form>

            <Button
              variant="ghost"
              className="mt-4 w-full"
              onClick={() => navigate("/auth/register")}
            >
              Não tem conta? Cadastre-se
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
