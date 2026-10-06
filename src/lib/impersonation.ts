import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { esquecerAvisosDesteAparelho } from "@/lib/avisosDoAparelho";
import { comPrazo } from "@/lib/tentativas";

const STORAGE_KEY = "arke_admin_session_backup";

interface SessionBackup {
  access_token: string;
  refresh_token: string;
  admin_email: string | null;
  impersonating_email: string;
}

// "Chaveador de perfil": admin_arke/gestor simula outro usuário já
// cadastrado (para testes de homologação) trocando a sessão do navegador
// pela do usuário-alvo, via o Edge Function `impersonar-perfil` (que nunca
// expõe nem altera a senha de ninguém). A sessão original fica guardada em
// sessionStorage (por aba) até `stopImpersonation` restaurá-la.
//
// A sessão simulada nasce no servidor, marcada: nela o banco recusa as
// autorizações que só a própria pessoa dá (IA, digital e rosto, documentos,
// consentimento de saúde e contrato). As telas usam `emPerfilSimulado()` só
// para mostrar isso antes de a pessoa tentar.
export async function startImpersonation(
  targetUserId: string,
  organizationId: string
): Promise<{ error: Error | null }> {
  const { data: currentSession } = await supabase.auth.getSession();
  if (!currentSession.session) {
    return { error: new Error("Sessão atual inválida.") };
  }

  const { data, error } = await supabase.functions.invoke<{
    email?: string;
    access_token?: string;
    refresh_token?: string;
    error?: string;
  }>("impersonar-perfil", { body: { user_id: targetUserId, organization_id: organizationId } });
  if (error) {
    return { error: new Error(await mensagemDeErroEdge(error, "Falha ao simular o perfil.")) };
  }
  if (data?.error || !data?.email || !data?.access_token || !data?.refresh_token) {
    return { error: new Error(data?.error ?? "Falha ao simular o perfil.") };
  }

  const backup: SessionBackup = {
    access_token: currentSession.session.access_token,
    refresh_token: currentSession.session.refresh_token,
    admin_email: currentSession.session.user.email ?? null,
    impersonating_email: data.email,
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(backup));

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionError) {
    sessionStorage.removeItem(STORAGE_KEY);
    return { error: sessionError };
  }

  return { error: null };
}

export function getImpersonationBackup(): SessionBackup | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionBackup;
  } catch {
    return null;
  }
}

/** Esta aba está num perfil simulado. */
export function emPerfilSimulado(): boolean {
  try {
    return !!sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

export const MENSAGEM_PERFIL_SIMULADO =
  "Em perfil simulado, só a própria pessoa autoriza, retira a autorização, aceita ou assina. Peça a ela para fazer isso no app dela.";

/**
 * Apaga da aba a cópia da sessão da ArkeFit. Sem ela a aba deixa de estar em
 * perfil simulado: é o que o "Sair", o fim da sessão e uma entrada nova com
 * senha fazem. Antes de 06/10/2026 a cópia sobrevivia a eles, e o próximo login
 * na mesma aba pulava o aceite de documentos e as duas etapas, como se fosse
 * simulação.
 */
export function descartarCopiaDaSimulacao(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sem armazenamento, não há cópia para apagar.
  }
}

export async function stopImpersonation(): Promise<{ error: Error | null }> {
  const backup = getImpersonationBackup();
  if (!backup) return { error: null };

  // Antes de 06/10/2026 a simulação registrava este aparelho para os avisos da
  // pessoa simulada. A linha sai aqui, ainda com a sessão dela; a assinatura
  // do navegador fica, porque é a mesma da conta da ArkeFit.
  const { data: simulada } = await supabase.auth.getSession();
  await comPrazo(
    esquecerAvisosDesteAparelho(simulada.session?.user.id ?? null, { cancelarNoNavegador: false }),
    4000,
  );

  // Encerra a sessão simulada no servidor: sem isso ela seguiria válida,
  // esquecida, com a marca de simulada até expirar.
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);

  const { error } = await supabase.auth.setSession({
    access_token: backup.access_token,
    refresh_token: backup.refresh_token,
  });
  sessionStorage.removeItem(STORAGE_KEY);
  return { error };
}
