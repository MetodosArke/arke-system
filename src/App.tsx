import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { NetworkStatusBanner } from "@/components/NetworkStatusBanner";

// Auth pages
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import ResetPassword from "@/pages/auth/ResetPassword";

// Layouts
import { AppLayout } from "@/components/layout/AppLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";

// Aluno pages
import AlunoDashboard from "@/pages/app/AlunoDashboard";
import AlunoPerfil from "@/pages/app/AlunoPerfil";

// Staff pages (gestor / professor / nutricionista / admin_arke)
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminAlunos from "@/pages/admin/AdminAlunos";
import AdminOrganizacao from "@/pages/admin/AdminOrganizacao";

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <NetworkStatusBanner />
          <HashRouter>
            <Routes>
              <Route path="/" element={<Navigate to="/auth/login" replace />} />

              {/* Auth routes */}
              <Route path="/auth/login" element={<Login />} />
              <Route path="/auth/register" element={<Register />} />
              <Route path="/auth/reset-password" element={<ResetPassword />} />

              {/* Aluno routes */}
              <Route
                path="/app"
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<AlunoDashboard />} />
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
                <Route path="alunos" element={<AdminAlunos />} />
                <Route path="organizacao" element={<AdminOrganizacao />} />
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
