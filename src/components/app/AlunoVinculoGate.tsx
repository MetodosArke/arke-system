import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { resolveHomePath } from "@/lib/authRouting";
import { SemAcademiaVinculada } from "@/components/acesso/TelasDeAcesso";

/**
 * Porta do app do aluno: só passa quem tem cadastro de aluno na academia.
 *
 * A rota `/app` não pede papel, e quem chegava sem cadastro de aluno (conta
 * sem vínculo ativo, aluno desligado, gestor que digitou o endereço) ficava
 * na home em "carregando" para sempre. Agora: a equipe volta para o painel
 * dela, e quem não tem academia vê o motivo e pode sair.
 */
export function AlunoVinculoGate({ children }: { children: React.ReactNode }) {
  const { rolesLoaded, alunoId, roles, organizationRole, organization } = useAuth();

  if (!rolesLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (alunoId) return <>{children}</>;

  const destino = resolveHomePath(roles, organizationRole, organization?.tipo);
  if (destino !== "/app") return <Navigate to={destino} replace />;

  return <SemAcademiaVinculada />;
}
