import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PushNotificationManager } from "@/components/PushNotificationManager";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { NetworkStatusBanner } from "@/components/NetworkStatusBanner";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { resolveHomePath } from "@/lib/authRouting";

// Auth pages
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import ResetPassword from "@/pages/auth/ResetPassword";
import DefinirSenha from "@/pages/auth/DefinirSenha";
import PublicMatricula from "@/pages/public/PublicMatricula";

// Layouts
import { AppLayout } from "@/components/layout/AppLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { AlunoBillingGate } from "@/components/app/AlunoBillingGate";

// Aluno pages
import AlunoDashboard from "@/pages/app/AlunoDashboard";
import AlunoPerfil from "@/pages/app/AlunoPerfil";
import AlunoTreinos from "@/pages/app/AlunoTreinos";
import AlunoDieta from "@/pages/app/AlunoDieta";
import AlunoAgenda from "@/pages/app/AlunoAgenda";
import AlunoEvolucao from "@/pages/app/AlunoEvolucao";
import AlunoJornada from "@/pages/app/AlunoJornada";
import AlunoDesafios from "@/pages/app/AlunoDesafios";
import AlunoCompeticoes from "@/pages/app/AlunoCompeticoes";
import AlunoFeed from "@/pages/app/AlunoFeed";
import Onboarding from "@/pages/app/Onboarding";
import ConsentimentoLgpd from "@/pages/app/ConsentimentoLgpd";

// Staff pages (gestor / professor / nutricionista / admin_arke)
import AdminDashboard from "@/pages/admin/AdminDashboard";
import DashboardHome from "@/pages/admin/DashboardHome";
import AdminAlunos from "@/pages/admin/AdminAlunos";
import AdminFinanceiro from "@/pages/admin/AdminFinanceiro";
import AdminEquipe from "@/pages/admin/AdminEquipe";
import AdminOrganizacao from "@/pages/admin/AdminOrganizacao";
import AdminGestao360 from "@/pages/admin/AdminGestao360";
import AdminTreinos from "@/pages/admin/AdminTreinos";
import AdminDietas from "@/pages/admin/AdminDietas";
import AdminRetencao from "@/pages/admin/AdminRetencao";
import AdminImportarAlunos from "@/pages/admin/AdminImportarAlunos";
import AdminOnboarding from "@/pages/admin/AdminOnboarding";
import AdminCatracas from "@/pages/admin/AdminCatracas";
import AdminIntegracoes from "@/pages/admin/AdminIntegracoes";
import AdminPerfil from "@/pages/admin/AdminPerfil";
import AdminAgenda from "@/pages/admin/AdminAgenda";
import AdminEngajamento from "@/pages/admin/AdminEngajamento";

// Super Admin (Visão Master ArkeFit)
import SuperAdminDashboard from "@/pages/superadmin/SuperAdminDashboard";
import SuperAdminProfissionais from "@/pages/superadmin/SuperAdminProfissionais";
import SuperAdminConfiguracoes from "@/pages/superadmin/SuperAdminConfiguracoes";

import NotFound from "./pages/NotFound";

const isNetworkError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|fetch failed|network|load failed|timeout|aborted/i.test(message);
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => failureCount < (isNetworkError(error) ? 4 : 1),
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15000),
      refetchOnReconnect: true,
      staleTime: 30_000,
      networkMode: "offlineFirst",
    },
    mutations: {
      retry: (failureCount, error) => isNetworkError(error) && failureCount < 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      networkMode: "offlineFirst",
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      console.error("[query-error]", query.queryKey, error);
      if (isNetworkError(error)) {
        toast.error("Falha de conexão ao carregar os dados. Tentando novamente...", {
          id: "network-error",
        });
      }
    },
  }),
});

const STAFF_ROLES = ["admin_arke", "gestor", "professor", "nutricionista", "recepcao"] as const;
const SUPERADMIN_ROLES = ["superadmin"] as const;

// M.A.P.A.®/onboarding é a experiência do produto Método ARKE — um
// adicional que a academia vende à parte, não o cadastro básico de aluno
// matriculado (que já vem pronto do sistema normal da academia). Só força
// esse fluxo pra quem de fato aderiu ao método; aluno sem adesão segue
// direto pro app, com acesso básico (treino, dieta) funcionando do jeito
// que a equipe publicar pra ele.
function AlunoOnboardingGate({ children }: { children: React.ReactNode }) {
  const { alunoId, metodoArkeAtivo, anamneseCompleta, consentimentoLgpdAceito, rolesLoaded } = useAuth();
  if (rolesLoaded && alunoId && metodoArkeAtivo && !anamneseCompleta) {
    return <Navigate to="/app/onboarding" replace />;
  }
  // Aluno com anamnese antiga (anterior ao termo LGPD) precisa registrar o
  // consentimento antes de continuar, sem refazer a anamnese inteira.
  if (rolesLoaded && alunoId && metodoArkeAtivo && anamneseCompleta && !consentimentoLgpdAceito) {
    return <Navigate to="/app/consentimento" replace />;
  }
  return <>{children}</>;
}

// Rota raiz: sem sessão vai para o login; autenticado, vai direto para o
// painel correspondente ao seu papel (admin_arke/gestor/professor/
// nutricionista → /admin, aluno → /app).
function RootRedirect() {
  const { isAuthenticated, isLoading, roles, organizationRole, organization, rolesLoaded } = useAuth();

  if (isLoading || (isAuthenticated && !rolesLoaded)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  return <Navigate to={resolveHomePath(roles, organizationRole, organization?.tipo)} replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <PushNotificationManager>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <NetworkStatusBanner />
          <ImpersonationBanner />
          <HashRouter>
            <Routes>
              <Route path="/" element={<RootRedirect />} />

              {/* Auth routes */}
              <Route path="/auth/login" element={<Login />} />
              <Route path="/auth/register" element={<Register />} />
              <Route path="/auth/reset-password" element={<ResetPassword />} />
              <Route path="/auth/definir-senha" element={<DefinirSenha />} />

              {/* Auto-matrícula pública por slug da academia (sem login) */}
              <Route path="/p/:slug" element={<PublicMatricula />} />

              {/* Onboarding M.A.P.A.® (fora do AppLayout — fluxo em tela cheia) */}
              <Route
                path="/app/onboarding"
                element={
                  <ProtectedRoute>
                    <Onboarding />
                  </ProtectedRoute>
                }
              />

              {/* Consentimento LGPD isolado, para alunos com anamnese anterior ao termo */}
              <Route
                path="/app/consentimento"
                element={
                  <ProtectedRoute>
                    <ConsentimentoLgpd />
                  </ProtectedRoute>
                }
              />

              {/* Aluno routes */}
              <Route
                path="/app"
                element={
                  <ProtectedRoute>
                    <AlunoOnboardingGate>
                      <AlunoBillingGate>
                        <AppLayout />
                      </AlunoBillingGate>
                    </AlunoOnboardingGate>
                  </ProtectedRoute>
                }
              >
                <Route index element={<AlunoDashboard />} />
                <Route path="treinos" element={<AlunoTreinos />} />
                <Route path="dieta" element={<AlunoDieta />} />
                <Route path="evolucao" element={<AlunoEvolucao />} />
                <Route path="jornada" element={<AlunoJornada />} />
                <Route path="desafios" element={<AlunoDesafios />} />
                <Route path="competicoes" element={<AlunoCompeticoes />} />
                <Route path="feed" element={<AlunoFeed />} />
                <Route path="agenda" element={<AlunoAgenda />} />
                <Route path="perfil" element={<AlunoPerfil />} />
              </Route>

              {/* Staff routes (gestor, professor, nutricionista, admin_arke) */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute requiredRoles={[...STAFF_ROLES]}>
                    <AdminLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<AdminDashboard />} />
                <Route path="dashboard" element={<DashboardHome />} />
                <Route path="onboarding" element={<AdminOnboarding />} />
                <Route path="alunos" element={<AdminAlunos />} />
                <Route path="alunos/importar" element={<AdminImportarAlunos />} />
                <Route path="financeiro" element={<AdminFinanceiro />} />
                <Route path="equipe" element={<AdminEquipe />} />
                <Route path="treinos" element={<AdminTreinos />} />
                <Route path="dietas" element={<AdminDietas />} />
                <Route path="retencao" element={<AdminRetencao />} />
                <Route path="gestao-360" element={<AdminGestao360 />} />
                <Route path="catracas" element={<AdminCatracas />} />
                <Route path="configuracoes/integracoes" element={<AdminIntegracoes />} />
                <Route path="organizacao" element={<AdminOrganizacao />} />
                <Route path="perfil" element={<AdminPerfil />} />
                <Route path="agenda" element={<AdminAgenda />} />
                <Route path="engajamento" element={<AdminEngajamento />} />
              </Route>

              {/* Super Admin — Visão Master ArkeFit, restrita ao papel global 'superadmin' */}
              <Route
                path="/superadmin"
                element={
                  <ProtectedRoute requiredRoles={[...SUPERADMIN_ROLES]}>
                    <SuperAdminLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<SuperAdminDashboard />} />
                <Route path="profissionais" element={<SuperAdminProfissionais />} />
                <Route path="configuracoes" element={<SuperAdminConfiguracoes />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </HashRouter>
        </TooltipProvider>
        </PushNotificationManager>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
