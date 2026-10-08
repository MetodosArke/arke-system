import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { VerificacaoDuasEtapas } from "@/components/VerificacaoDuasEtapas";
import { ErroAoCarregarAcesso } from "@/components/acesso/TelasDeAcesso";
import { CarregandoTela } from "@/components/CarregandoPagina";
import { podeAbrirNaVisaoMaster, rotaInicial, temAcessoArkefit } from "@/lib/acessosArkefit";

const DESCRICAO_EQUIPE =
  "A Visão Master alcança dados de todas as academias. Além da senha, ela pede um código do aplicativo autenticador do seu celular, sempre.";

/**
 * A porta da Visão Master (08/10/2026, os níveis da equipe ArkeFit).
 *
 * Entra quem é Sócio (o papel `superadmin`) ou tem nível ativo na equipe
 * contratada (`equipe_arkefit.niveis`), e sempre com as duas etapas: na
 * primeira entrada, a tela cadastra o aplicativo autenticador. Sem isso o
 * banco não abre nada (`has_role` e `acesso_arkefit` exigem a sessão
 * verificada), e a tela não finge que abre.
 */
export function PortaoVisaoMaster({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, rolesLoaded, erroAcesso, acessoArkefit } = useAuth();

  // Falha ao ler o acesso não é falta de acesso.
  if (isAuthenticated && erroAcesso) return <ErroAoCarregarAcesso />;
  if (isLoading || !rolesLoaded) return <CarregandoTela />;
  if (!isAuthenticated) return <Navigate to="/auth/login" replace />;
  if (!temAcessoArkefit(acessoArkefit)) return <Navigate to="/app" replace />;

  return (
    <VerificacaoDuasEtapas descricao={acessoArkefit.socio ? undefined : DESCRICAO_EQUIPE}>{children}</VerificacaoDuasEtapas>
  );
}

/**
 * Cada página da Visão Master confere a área de quem abre, pela mesma tabela
 * do menu (`ROTAS_DA_VISAO_MASTER`). O endereço digitado não abre a página de
 * outra área; o banco recusaria os dados dela de qualquer jeito.
 */
export function PortaoDaRotaVisaoMaster({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { acessoArkefit } = useAuth();
  if (podeAbrirNaVisaoMaster(pathname, acessoArkefit)) return <>{children}</>;
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <Lock className="h-8 w-8 text-muted-foreground" aria-hidden />
      <h1 className="text-base font-semibold">Esta página não faz parte do seu acesso</h1>
      <p className="text-sm text-muted-foreground">
        O que cada pessoa da equipe da ArkeFit vê depende do nível dela. Se você precisa desta página, fale com um sócio.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to={rotaInicial(acessoArkefit)}>Voltar ao início</Link>
      </Button>
    </div>
  );
}
