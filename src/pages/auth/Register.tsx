import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dumbbell, Mail, Lock, User, ArrowLeft, Moon, Sun } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { verificarSenhaVazada, senhaDeveSerRecusada, mensagemSenhaVazada } from "@/lib/senhaVazada";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const { signUp } = useAuth();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // Recusa senha que já aparece em vazamentos públicos. Substitui o
    // recurso equivalente do Supabase, que só existe a partir do plano
    // pago. A senha não sai do navegador: só os 5 primeiros caracteres
    // do hash viajam (k-anonimato) — ver src/lib/senhaVazada.ts.
    const vazamento = await verificarSenhaVazada(password);
    if (senhaDeveSerRecusada(vazamento)) {
      toast({
        title: "Escolha outra senha",
        description: mensagemSenhaVazada(vazamento.ocorrencias),
        variant: "destructive",
      });
      setIsLoading(false);
      return;
    }

    const { error } = await signUp(email, password, name);
    setIsLoading(false);
    if (error) {
      toast({
        title: "Erro no cadastro",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Cadastro enviado!",
      description: "Verifique seu email para confirmar a conta. Após confirmação, aguarde aprovação do administrador.",
    });
    navigate("/auth/login");
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
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
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary">
            <Dumbbell className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Criar Conta</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Preencha seus dados para se cadastrar
          </p>
        </div>

        <Card className="border-0 shadow-xl">
          <CardContent className="p-6">
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Label htmlFor="cadastro-nome" className="sr-only">
                  Nome completo
                </Label>
                <Input
                  id="cadastro-nome"
                  autoComplete="name"
                  placeholder="Nome completo"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Label htmlFor="cadastro-email" className="sr-only">
                  E-mail
                </Label>
                <Input
                  type="email"
                  id="cadastro-email"
                  autoComplete="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Label htmlFor="cadastro-senha" className="sr-only">
                  Senha (mínimo 6 caracteres)
                </Label>
                <Input
                  type="password"
                  id="cadastro-senha"
                  autoComplete="new-password"
                  placeholder="Senha (mínimo 6 caracteres)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  minLength={6}
                  required
                />
              </div>

              <Button
                type="submit"
                className="w-full gradient-primary text-primary-foreground font-semibold"
                disabled={isLoading}
              >
                {isLoading ? "Cadastrando..." : "Cadastrar"}
              </Button>
            </form>

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
