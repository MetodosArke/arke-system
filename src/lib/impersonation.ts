import { supabase } from "@/integrations/supabase/client";

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
export async function startImpersonation(targetUserId: string): Promise<{ error: Error | null }> {
  const { data: currentSession } = await supabase.auth.getSession();
  if (!currentSession.session) {
    return { error: new Error("Sessão atual inválida.") };
  }

  const { data, error } = await supabase.functions.invoke<{ email: string; token_hash: string }>(
    "impersonar-perfil",
    { body: { user_id: targetUserId } }
  );
  if (error || !data) {
    return { error: error instanceof Error ? error : new Error("Falha ao simular o perfil.") };
  }

  const backup: SessionBackup = {
    access_token: currentSession.session.access_token,
    refresh_token: currentSession.session.refresh_token,
    admin_email: currentSession.session.user.email ?? null,
    impersonating_email: data.email,
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(backup));

  // VerifyTokenHashParams aceita SOMENTE { type, token_hash } — incluir
  // `email` junto (como este código fazia) faz o próprio servidor do
  // Supabase Auth rejeitar com "Only the token_hash and type should be
  // provided" (o TS não pega isso: excess-property-check em union types é
  // permissivo o bastante para deixar passar uma combinação inválida).
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.token_hash,
  });
  if (verifyError) {
    sessionStorage.removeItem(STORAGE_KEY);
    return { error: verifyError };
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

export async function stopImpersonation(): Promise<{ error: Error | null }> {
  const backup = getImpersonationBackup();
  if (!backup) return { error: null };

  const { error } = await supabase.auth.setSession({
    access_token: backup.access_token,
    refresh_token: backup.refresh_token,
  });
  sessionStorage.removeItem(STORAGE_KEY);
  return { error };
}
