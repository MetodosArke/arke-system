import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { escolherVinculo } from "@/lib/vinculos";
import { identificarSessao } from "@/lib/monitoramento";
import type { User as SupabaseUser, Session } from "@supabase/supabase-js";
import type { Enums } from "@/integrations/supabase/types";

export type AppRole = Enums<"app_role">;

interface Profile {
  full_name: string;
  avatar_url: string | null;
  status: "active" | "pending" | "inactive";
}

type OrganizationTipo = Enums<"organization_tipo">;

interface Organization {
  id: string;
  nome: string;
  slug: string;
  tipo: OrganizationTipo;
  especialidadeProfissional: AppRole | null;
  onboardingCompleted: boolean;
}

type FaseJornada = Enums<"fase_jornada">;

interface AuthContextType {
  user: SupabaseUser | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[]; // papéis globais de plataforma (ex.: admin_arke)
  organization: Organization | null;
  organizationRole: AppRole | null; // papel do usuário dentro da organização atual
  alunoId: string | null; // id em `alunos`, quando o papel na org é "aluno"
  faseJornada: FaseJornada | null; // M.A.P.A. → B.A.S.E. → R.O.T.A. → A.P.E.X. → L.E.G.A.D.O.
  metodoArkeAtivo: boolean; // aderiu ao produto Método ARKE (além da matrícula normal na academia)
  anamneseCompleta: boolean; // Anamnese de Acolhimento (M.A.P.A.®) já preenchida
  consentimentoLgpdAceito: boolean; // Termo de consentimento (dados de saúde) já aceito
  isAuthenticated: boolean;
  isLoading: boolean;
  rolesLoaded: boolean;
  hasRole: (role: AppRole) => boolean;
  refreshAluno: () => Promise<void>;
  refreshOrganization: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizationRole, setOrganizationRole] = useState<AppRole | null>(null);
  const [alunoId, setAlunoId] = useState<string | null>(null);
  const [faseJornada, setFaseJornada] = useState<FaseJornada | null>(null);
  const [metodoArkeAtivo, setMetodoArkeAtivo] = useState(false);
  const [anamneseCompleta, setAnamneseCompleta] = useState(false);
  const [consentimentoLgpdAceito, setConsentimentoLgpdAceito] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, avatar_url, status")
      .eq("user_id", userId)
      .maybeSingle();
    if (data) setProfile(data as Profile);
  };

  const loadAlunoStatus = async (userId: string, organizationId: string) => {
    const { data: aluno } = await supabase
      .from("alunos")
      .select("id, fase_jornada, primeiro_acesso_em, metodo_arke_status")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!aluno) {
      setAlunoId(null);
      setFaseJornada(null);
      setMetodoArkeAtivo(false);
      setAnamneseCompleta(false);
      setConsentimentoLgpdAceito(false);
      return;
    }

    setAlunoId(aluno.id);
    setFaseJornada(aluno.fase_jornada);
    setMetodoArkeAtivo(aluno.metodo_arke_status === "ativo");

    // M.A.P.A.®: registra o 1º acesso, para a automação de "48h sem 1º
    // acesso" não abrir tarefa de ativação para quem já entrou.
    //
    // Via RPC, e não UPDATE direto: o aluno tem apenas SELECT na policy de
    // `alunos` (escrita é da equipe), então o update daqui era silenciosamente
    // descartado pelo RLS e o campo nunca era gravado. O erro é checado —
    // era justamente o descarte que escondia o defeito.
    if (!aluno.primeiro_acesso_em) {
      const { error: primeiroAcessoError } = await supabase.rpc("registrar_primeiro_acesso_aluno");
      if (primeiroAcessoError) {
        console.error("Falha ao registrar o primeiro acesso do aluno", primeiroAcessoError);
      }
    }

    const { data: anamnese } = await supabase
      .from("anamnese_acolhimento")
      .select("concluida_em, consentimento_lgpd_aceito_em")
      .eq("aluno_id", aluno.id)
      .maybeSingle();
    setAnamneseCompleta(!!anamnese?.concluida_em);
    setConsentimentoLgpdAceito(!!anamnese?.consentimento_lgpd_aceito_em);
  };

  const fetchRoles = async (userId: string) => {
    // Lista, não `.maybeSingle()`: quem tem vínculo ativo em duas organizações
    // — gestor de uma academia e aluno de outra, professor em duas unidades —
    // fazia a consulta falhar, e o app ficava sem organização nenhuma para
    // essa pessoa. Cenário legítimo tratado como impossível.
    const [{ data: globalRoles }, { data: vinculos }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase
        .from("organization_members")
        .select("role, organization_id, created_at, organizations ( id, nome, slug, tipo, especialidade_profissional, onboarding_completed )")
        .eq("user_id", userId)
        .eq("status", "active"),
    ]);

    const membership = escolherVinculo(vinculos ?? []);

    setRoles((globalRoles || []).map((r) => r.role));

    if (membership) {
      setOrganizationRole(membership.role);
      const org = membership.organizations as unknown as {
        id: string;
        nome: string;
        slug: string;
        tipo: OrganizationTipo;
        especialidade_profissional: AppRole | null;
        onboarding_completed: boolean;
      } | null;
      setOrganization(
        org
          ? {
              id: org.id,
              nome: org.nome,
              slug: org.slug,
              tipo: org.tipo,
              especialidadeProfissional: org.especialidade_profissional,
              onboardingCompleted: org.onboarding_completed,
            }
          : null
      );

      if (membership.role === "aluno") {
        await loadAlunoStatus(userId, membership.organization_id);
      } else {
        setAlunoId(null);
        setFaseJornada(null);
        setMetodoArkeAtivo(false);
        setAnamneseCompleta(false);
      }
    } else {
      setOrganizationRole(null);
      setOrganization(null);
      setAlunoId(null);
      setFaseJornada(null);
      setMetodoArkeAtivo(false);
      setAnamneseCompleta(false);
    }

    setRolesLoaded(true);
  };

  const refreshAluno = async () => {
    if (!currentUserId || !organization) return;
    await loadAlunoStatus(currentUserId, organization.id);
  };

  const refreshOrganization = async () => {
    if (!currentUserId) return;
    await fetchRoles(currentUserId);
  };

  const refreshProfile = async () => {
    if (!currentUserId) return;
    await fetchProfile(currentUserId);
  };

  useEffect(() => {
    // Set up auth listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        setUser(nextSession?.user ?? null);

        if (nextSession?.user) {
          setRolesLoaded(false);
          setCurrentUserId(nextSession.user.id);

          setTimeout(() => {
            void Promise.all([
              fetchProfile(nextSession.user.id),
              fetchRoles(nextSession.user.id),
            ]).finally(() => {
              setIsLoading(false);
            });
          }, 0);

          return;
        }

        setProfile(null);
        setRoles([]);
        setOrganization(null);
        setOrganizationRole(null);
        setAlunoId(null);
        setFaseJornada(null);
        setMetodoArkeAtivo(false);
        setAnamneseCompleta(false);
        setCurrentUserId(null);
        setRolesLoaded(true);
        setIsLoading(false);
      }
    );

    // THEN check existing session
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      setUser(initialSession?.user ?? null);

      if (initialSession?.user) {
        setRolesLoaded(false);
        setCurrentUserId(initialSession.user.id);
        void Promise.all([
          fetchProfile(initialSession.user.id),
          fetchRoles(initialSession.user.id),
        ]).finally(() => {
          setIsLoading(false);
        });
        return;
      }

      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Carimba os erros com a academia e a pessoa da sessão. Sem isso não dá
  // para separar "quebrou para uma academia" de "quebrou para todo mundo",
  // que é a diferença entre dado ruim num tenant e defeito de produto.
  // Só UUID viaja — ver src/lib/monitoramento.ts.
  useEffect(() => {
    identificarSessao({
      userId: user?.id ?? null,
      organizationId: organization?.id ?? null,
      papel: organizationRole ?? roles[0] ?? null,
    });
  }, [user?.id, organization?.id, organizationRole, roles]);

  const hasRole = (role: AppRole) => roles.includes(role) || organizationRole === role;

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error as Error };

    if (data.user) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("status")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (prof?.status === "inactive") {
        await supabase.auth.signOut();
        return {
          error: new Error("Sua conta está inativa. Entre em contato com o administrador."),
        };
      }
    }

    return { error: null };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: window.location.origin,
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
    setOrganization(null);
    setOrganizationRole(null);
    setAlunoId(null);
    setFaseJornada(null);
    setMetodoArkeAtivo(false);
    setAnamneseCompleta(false);
    setCurrentUserId(null);
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/#/auth/reset-password`,
    });
    return { error: error as Error | null };
  };

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error as Error | null };
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        roles,
        organization,
        organizationRole,
        alunoId,
        faseJornada,
        metodoArkeAtivo,
        anamneseCompleta,
        consentimentoLgpdAceito,
        isAuthenticated: !!session,
        isLoading,
        rolesLoaded,
        hasRole,
        refreshAluno,
        refreshOrganization,
        refreshProfile,
        signIn,
        signUp,
        signOut,
        resetPassword,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
