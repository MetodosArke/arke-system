import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
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
import Onboarding from "@/pages/app/Onboarding";

// Staff pages (gestor / professor / nutricionista / admin_arke)
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminAlunos from "@/pages/admin/AdminAlunos";
import AdminEquipe from "@/pages/admin/AdminEquipe";
import AdminOrganizacao from "@/pages/admin/AdminOrganizacao";
import AdminGestao360 from "@/pages/admin/AdminGestao360";
import AdminTreinos from "@/pages/admin/AdminTreinos";
import AdminDietas from "@/pages/admin/AdminDietas";
import AdminRetencao from "@/pages/admin/AdminRetencao";
import AdminImportarAlunos from "@/pages/admin/AdminImportarAlunos";
import AdminOnboarding from "@/pages/admin/AdminOnboarding";
import AdminCatracas from "@/pages/admin/AdminCatracas";

// Super Admin (Visão Master ArkeFit)
import SuperAdminDashboard from "@/pages/superadmin/SuperAdminDashboard";

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

const STAFF_ROLES = ["admin_arke", "gestor", "professor", "nutricionista"] as const;
const SUPERADMIN_ROLES = ["superadmin"] as const;

// M.A.P.A.®: aluno sem anamnese de acolhimento concluída é levado ao onboarding
// antes de acessar o restante do app.
function AlunoOnboardingGate({ children }: { children: React.ReactNode }) {
  const { alunoId, anamneseCompleta, rolesLoaded } = useAuth();
  if (rolesLoaded && alunoId && !anamneseCompleta) {
    return <Navigate to="/app/onboarding" replace />;
  }
  return <>{children}</>;
}

// Rota raiz: sem sessão vai para o login; autenticado, vai direto para o
// painel correspondente ao seu papel (admin_arke/gestor/professor/
// nutricionista → /admin, aluno → /app).
function RootRedirect() {
  const { isAuthenticated, isLoading, roles, organizationRole, rolesLoaded } = useAuth();

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

  return <Navigate to={resolveHomePath(roles, organizationRole)} replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
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
                <Route path="onboarding" element={<AdminOnboarding />} />
                <Route path="alunos" element={<AdminAlunos />} />
                <Route path="alunos/importar" element={<AdminImportarAlunos />} />
                <Route path="equipe" element={<AdminEquipe />} />
                <Route path="treinos" element={<AdminTreinos />} />
                <Route path="dietas" element={<AdminDietas />} />
                <Route path="retencao" element={<AdminRetencao />} />
                <Route path="gestao-360" element={<AdminGestao360 />} />
                <Route path="catracas" element={<AdminCatracas />} />
                <Route path="organizacao" element={<AdminOrganizacao />} />
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
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </HashRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
