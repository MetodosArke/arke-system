import { Toaster } from "@/components/ui/toaster";
import { appInstaladoNaTela, haSessaoGuardada, mostrarPaginaDeVendas } from "@/lib/landing";
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
import { emPerfilSimulado } from "@/lib/impersonation";
import { resolveHomePath } from "@/lib/authRouting";
import { tentarConsultaDeNovo } from "@/lib/tentativas";
import { Suspense, useState } from "react";
import { paginaPreguicosa } from "@/lib/carregamentoPreguicoso";
import { CarregandoPagina, CarregandoTela } from "@/components/CarregandoPagina";
import { MarcaAcademiaProvider } from "@/components/marca/MarcaAcademia";
import { slugDeEntrada } from "@/lib/marcaAcademia";

// Auth pages
import Login from "@/pages/auth/Login";

import { AlunoBillingGate } from "@/components/app/AlunoBillingGate";
import { AlunoSituacaoGate } from "@/components/app/AlunoSituacaoGate";
import { AlunoVinculoGate } from "@/components/app/AlunoVinculoGate";
import { ErroAoCarregarAcesso } from "@/components/acesso/TelasDeAcesso";
import { AceiteDocumentosGate } from "@/components/legal/AceiteDocumentosGate";
import { OrganizacaoBillingGate } from "@/components/admin/OrganizacaoBillingGate";
import { EncerramentoGate } from "@/components/encerramento/EncerramentoGate";

// Aluno pages

// Staff pages (gestor / professor / nutricionista / admin_arke)

// Super Admin (Visão Master ArkeFit)

import NotFound from "./pages/NotFound";

// Cada página vira um arquivo próprio, baixado quando a rota abre. Login e
// NotFound ficam no pacote principal: o primeiro é a porta de entrada de
// quase todo mundo, o segundo é mínimo. Ver src/lib/carregamentoPreguicoso.ts
// para o que acontece quando um deploy troca os arquivos com a aba aberta.
//
// Os três layouts também (07/10/2026, auditoria de prontidão): o pacote
// principal levava o menu e o cabeçalho do painel e da Visão Master para o
// aluno, e o do app do aluno para a recepção. Cada um baixa o seu.
const AppLayout = paginaPreguicosa(() => import("@/components/layout/AppLayout").then((m) => ({ default: m.AppLayout })));
const AdminLayout = paginaPreguicosa(() => import("@/components/layout/AdminLayout").then((m) => ({ default: m.AdminLayout })));
const SuperAdminLayout = paginaPreguicosa(() =>
  import("@/components/layout/SuperAdminLayout").then((m) => ({ default: m.SuperAdminLayout })),
);
const ResetPassword = paginaPreguicosa(() => import("@/pages/auth/ResetPassword"));
const DefinirSenha = paginaPreguicosa(() => import("@/pages/auth/DefinirSenha"));
const PublicMatricula = paginaPreguicosa(() => import("@/pages/public/PublicMatricula"));
const PrimeiroAcesso = paginaPreguicosa(() => import("@/pages/public/PrimeiroAcesso"));
const PararContatoSite = paginaPreguicosa(() => import("@/pages/public/PararContatoSite"));
const AceiteResponsavel = paginaPreguicosa(() => import("@/pages/public/AceiteResponsavel"));
const DocumentoLegal = paginaPreguicosa(() => import("@/pages/public/DocumentoLegal"));
const AlunoCheckin = paginaPreguicosa(() => import("@/pages/app/AlunoCheckin"));
const AdminCheckinQr = paginaPreguicosa(() => import("@/pages/admin/AdminCheckinQr"));
const AdminComunicados = paginaPreguicosa(() => import("@/pages/admin/AdminComunicados"));
const AdminFunil = paginaPreguicosa(() => import("@/pages/admin/AdminFunil"));
const AlunoDashboard = paginaPreguicosa(() => import("@/pages/app/AlunoDashboard"));
const AlunoPerfil = paginaPreguicosa(() => import("@/pages/app/AlunoPerfil"));
const AlunoTreinos = paginaPreguicosa(() => import("@/pages/app/AlunoTreinos"));
const TreinoExecucao = paginaPreguicosa(() => import("@/pages/app/TreinoExecucao"));
const AlunoDieta = paginaPreguicosa(() => import("@/pages/app/AlunoDieta"));
const AlunoAgenda = paginaPreguicosa(() => import("@/pages/app/AlunoAgenda"));
const AlunoEvolucao = paginaPreguicosa(() => import("@/pages/app/AlunoEvolucao"));
const AlunoJornada = paginaPreguicosa(() => import("@/pages/app/AlunoJornada"));
const AlunoDesafios = paginaPreguicosa(() => import("@/pages/app/AlunoDesafios"));
const AlunoCompeticoes = paginaPreguicosa(() => import("@/pages/app/AlunoCompeticoes"));
const AlunoFeed = paginaPreguicosa(() => import("@/pages/app/AlunoFeed"));
const Onboarding = paginaPreguicosa(() => import("@/pages/app/Onboarding"));
const ConsentimentoLgpd = paginaPreguicosa(() => import("@/pages/app/ConsentimentoLgpd"));
const AdminDashboard = paginaPreguicosa(() => import("@/pages/admin/AdminDashboard"));
const DashboardHome = paginaPreguicosa(() => import("@/pages/admin/DashboardHome"));
const AdminAlunos = paginaPreguicosa(() => import("@/pages/admin/AdminAlunos"));
const AdminFinanceiro = paginaPreguicosa(() => import("@/pages/admin/AdminFinanceiro"));
const AdminEquipe = paginaPreguicosa(() => import("@/pages/admin/AdminEquipe"));
const AdminOrganizacao = paginaPreguicosa(() => import("@/pages/admin/AdminOrganizacao"));
const AdminGestao360 = paginaPreguicosa(() => import("@/pages/admin/AdminGestao360"));
const AdminRelatorioSemanal = paginaPreguicosa(() => import("@/pages/admin/AdminRelatorioSemanal"));
const AdminAcompanhamento = paginaPreguicosa(() => import("@/pages/admin/AdminAcompanhamento"));
const AdminTreinos = paginaPreguicosa(() => import("@/pages/admin/AdminTreinos"));
const AdminDietas = paginaPreguicosa(() => import("@/pages/admin/AdminDietas"));
const AdminRetencao = paginaPreguicosa(() => import("@/pages/admin/AdminRetencao"));
const AdminImportarAlunos = paginaPreguicosa(() => import("@/pages/admin/AdminImportarAlunos"));
const AdminOnboarding = paginaPreguicosa(() => import("@/pages/admin/AdminOnboarding"));
const AdminCatracas = paginaPreguicosa(() => import("@/pages/admin/AdminCatracas"));
const AdminIntegracoes = paginaPreguicosa(() => import("@/pages/admin/AdminIntegracoes"));
const AdminPerfil = paginaPreguicosa(() => import("@/pages/admin/AdminPerfil"));
const AdminAgenda = paginaPreguicosa(() => import("@/pages/admin/AdminAgenda"));
const AdminEngajamento = paginaPreguicosa(() => import("@/pages/admin/AdminEngajamento"));
const AdminMensagens = paginaPreguicosa(() => import("@/pages/admin/AdminMensagens"));
const SuperAdminDashboard = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminDashboard"));
const SuperAdminProfissionais = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminProfissionais"));
const SuperAdminConfiguracoes = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminConfiguracoes"));
const SuperAdminAcervo = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminAcervo"));
const SuperAdminAuditoria = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminAuditoria"));
const SuperAdminWebhooks = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminWebhooks"));
const SuperAdminMentoria = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminMentoria"));
const SuperAdminEquipamentos = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminEquipamentos"));
const SuperAdminVigia = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminVigia"));
const SuperAdminUsoIA = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminUsoIA"));
const CentralAjuda = paginaPreguicosa(() => import("@/pages/ajuda/CentralAjuda"));
const Landing = paginaPreguicosa(() => import("@/pages/public/Landing"));
const SuperAdminComercial = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminComercial"));
const SuperAdminImplantacao = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminImplantacao"));
const SuperAdminSuporte = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminSuporte"));
const SuperAdminEquipe = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminEquipe"));
const SuperAdminFichaAluno = paginaPreguicosa(() => import("@/pages/superadmin/SuperAdminFichaAluno"));

const isNetworkError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|fetch failed|network|load failed|timeout|aborted/i.test(message);
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: tentarConsultaDeNovo,
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
  const { alunoId, metodoArkeAtivo, anamneseCompleta, consentimentoLgpdAceito, consentimentoSaudeRetirado, rolesLoaded } =
    useAuth();
  // Em perfil simulado, quem simula não preenche nem autoriza pelo aluno: vê o
  // app como ele, e as duas telas seguem abertas pelo endereço.
  if (emPerfilSimulado()) return <>{children}</>;
  // Quem retirou o consentimento de saúde (Perfil → Privacidade) não é preso
  // no acolhimento: autoriza de novo quando quiser, pelo mesmo lugar.
  if (consentimentoSaudeRetirado) return <>{children}</>;
  // `=== false`, e não `!`: anamnese com leitura falha é desconhecida (null),
  // e mandar esse aluno de volta ao acolhimento era o caminho para ele
  // reenviar e sobrescrever a anamnese que já existia.
  if (rolesLoaded && alunoId && metodoArkeAtivo && anamneseCompleta === false) {
    return <Navigate to="/app/onboarding" replace />;
  }
  // Aluno com anamnese antiga (anterior ao termo LGPD) precisa registrar o
  // consentimento antes de continuar, sem refazer a anamnese inteira.
  if (rolesLoaded && alunoId && metodoArkeAtivo && anamneseCompleta === true && consentimentoLgpdAceito === false) {
    return <Navigate to="/app/consentimento" replace />;
  }
  return <>{children}</>;
}

// Rota raiz: sem sessão vai para o login; autenticado, vai direto para o
// painel correspondente ao seu papel (admin_arke/gestor/professor/
// nutricionista → /admin, aluno → /app).
function RootRedirect() {
  const { isAuthenticated, isLoading, roles, organizationRole, organization, rolesLoaded, erroAcesso } = useAuth();
  // A raiz de arkefit.com.br é a página de vendas para quem chega de fora;
  // quem tem sessão ou abre o app instalado segue para o app. `?vendas`
  // força a página, para conferir em outro endereço.
  const [paginaDeVendas] = useState(() =>
    mostrarPaginaDeVendas({
      host: window.location.hostname,
      hash: window.location.hash,
      temSessao: haSessaoGuardada(),
      appInstalado: appInstaladoNaTela(),
      forcar: new URLSearchParams(window.location.search).has("vendas"),
      // O app instalado com a marca de uma academia começa em "/?academia=…".
      entradaDeAcademia: !!slugDeEntrada({ search: window.location.search, hash: window.location.hash }),
    }),
  );

  if (paginaDeVendas) return <Landing />;

  if (isAuthenticated && erroAcesso) return <ErroAoCarregarAcesso />;

  if (isLoading || (isAuthenticated && !rolesLoaded)) {
    return <CarregandoTela />;
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
            <MarcaAcademiaProvider>
            <Suspense fallback={<CarregandoPagina />}>
            <Routes>
              <Route path="/" element={<RootRedirect />} />

              {/* Auth routes */}
              <Route path="/auth/login" element={<Login />} />
              {/* O cadastro aberto saiu (06/10/2026): o link antigo cai no login. */}
              <Route path="/auth/register" element={<Navigate to="/auth/login" replace />} />
              <Route path="/auth/reset-password" element={<ResetPassword />} />
              <Route path="/auth/definir-senha" element={<DefinirSenha />} />

              {/* Auto-matrícula pública por slug da academia (sem login) */}
              <Route path="/p/:slug" element={<PublicMatricula />} />
              {/* Primeiro acesso de quem a academia já cadastrou (QR Code da recepção) */}
              <Route path="/p/:slug/primeiro-acesso" element={<PrimeiroAcesso />} />
              {/* Tela de entrar com a marca da academia: o link que ela divulga e o app instalado */}
              <Route path="/p/:slug/entrar" element={<Login />} />
              {/* "Não quero mais receber" dos e-mails da resposta automática ao contato do site */}
              <Route path="/contato/parar" element={<PararContatoSite />} />
              {/* O link que o responsável legal do aluno menor recebe por e-mail (sem login) */}
              <Route path="/responsavel/:token" element={<AceiteResponsavel />} />

              {/* Documentos legais, públicos */}
              <Route path="/termos" element={<DocumentoLegal tipo="termos_uso" />} />
              <Route path="/privacidade" element={<DocumentoLegal tipo="privacidade" />} />
              <Route path="/contrato-academia" element={<DocumentoLegal tipo="contrato_academia" />} />

              {/* Destino do QR de check-in da recepção: público, guarda o código e manda ao login se preciso */}
              <Route path="/checkin" element={<AlunoCheckin />} />

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
                    <AlunoVinculoGate>
                      <AceiteDocumentosGate>
                        <AlunoOnboardingGate>
                          <AlunoBillingGate>
                            <AlunoSituacaoGate>
                              <EncerramentoGate publico="aluno">
                                <AppLayout />
                              </EncerramentoGate>
                            </AlunoSituacaoGate>
                          </AlunoBillingGate>
                        </AlunoOnboardingGate>
                      </AceiteDocumentosGate>
                    </AlunoVinculoGate>
                  </ProtectedRoute>
                }
              >
                <Route index element={<AlunoDashboard />} />
                <Route path="treinos" element={<AlunoTreinos />} />
                <Route path="treinos/executar/:divisao" element={<TreinoExecucao />} />
                <Route path="dieta" element={<AlunoDieta />} />
                <Route path="evolucao" element={<AlunoEvolucao />} />
                <Route path="jornada" element={<AlunoJornada />} />
                <Route path="desafios" element={<AlunoDesafios />} />
                <Route path="competicoes" element={<AlunoCompeticoes />} />
                <Route path="feed" element={<AlunoFeed />} />
                <Route path="agenda" element={<AlunoAgenda />} />
                <Route path="perfil" element={<AlunoPerfil />} />
                <Route path="ajuda" element={<CentralAjuda />} />
                <Route path="ajuda/:slug" element={<CentralAjuda />} />
              </Route>

              {/* Staff routes (gestor, professor, nutricionista, admin_arke) */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute requiredRoles={[...STAFF_ROLES]}>
                    <AceiteDocumentosGate>
                      {/* Encerramento por fora: depois do término a exportação vale mesmo com mensalidade B2B vencida. */}
                      <EncerramentoGate publico="equipe">
                        <OrganizacaoBillingGate>
                          <AdminLayout />
                        </OrganizacaoBillingGate>
                      </EncerramentoGate>
                    </AceiteDocumentosGate>
                  </ProtectedRoute>
                }
              >
                <Route index element={<AdminDashboard />} />
                <Route path="dashboard" element={<DashboardHome />} />
                <Route path="onboarding" element={<AdminOnboarding />} />
                <Route path="checkin-qr" element={<AdminCheckinQr />} />
                <Route path="comunicados" element={<AdminComunicados />} />
                <Route path="funil" element={<AdminFunil />} />
                <Route path="alunos" element={<AdminAlunos />} />
                <Route path="alunos/importar" element={<AdminImportarAlunos />} />
                <Route path="financeiro" element={<AdminFinanceiro />} />
                <Route path="equipe" element={<AdminEquipe />} />
                <Route path="treinos" element={<AdminTreinos />} />
                <Route path="dietas" element={<AdminDietas />} />
                <Route path="retencao" element={<AdminRetencao />} />
                <Route path="gestao-360" element={<AdminGestao360 />} />
                <Route path="relatorio-semanal" element={<AdminRelatorioSemanal />} />
                <Route path="acompanhamento" element={<AdminAcompanhamento />} />
                <Route path="catracas" element={<AdminCatracas />} />
                <Route path="configuracoes/integracoes" element={<AdminIntegracoes />} />
                <Route path="organizacao" element={<AdminOrganizacao />} />
                <Route path="perfil" element={<AdminPerfil />} />
                <Route path="agenda" element={<AdminAgenda />} />
                <Route path="engajamento" element={<AdminEngajamento />} />
                <Route path="mensagens" element={<AdminMensagens />} />
                <Route path="ajuda" element={<CentralAjuda />} />
                <Route path="ajuda/:slug" element={<CentralAjuda />} />
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
                <Route path="acervo" element={<SuperAdminAcervo />} />
                <Route path="auditoria" element={<SuperAdminAuditoria />} />
                <Route path="webhooks" element={<SuperAdminWebhooks />} />
                <Route path="mentoria" element={<SuperAdminMentoria />} />
                <Route path="mentoria/aluno/:alunoId" element={<SuperAdminFichaAluno />} />
                <Route path="equipamentos" element={<SuperAdminEquipamentos />} />
                <Route path="vigia" element={<SuperAdminVigia />} />
                <Route path="ia" element={<SuperAdminUsoIA />} />
                <Route path="configuracoes" element={<SuperAdminConfiguracoes />} />
                <Route path="comercial" element={<SuperAdminComercial />} />
                <Route path="implantacao" element={<SuperAdminImplantacao />} />
                <Route path="suporte" element={<SuperAdminSuporte />} />
                {/* Endereço antigo, dos e-mails de aviso enviados antes do Pipeline comercial. */}
                <Route path="contatos" element={<Navigate to="/superadmin/comercial" replace />} />
                <Route path="equipe" element={<SuperAdminEquipe />} />
                <Route path="ajuda" element={<CentralAjuda />} />
                <Route path="ajuda/:slug" element={<CentralAjuda />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            </MarcaAcademiaProvider>
          </HashRouter>
        </TooltipProvider>
        </PushNotificationManager>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
