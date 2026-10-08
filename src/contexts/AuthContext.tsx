import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { escolherVinculo, gravarOrganizacaoPreferida, lerOrganizacaoPreferida } from "@/lib/vinculos";
import { identificarSessao } from "@/lib/monitoramento";
import type { User as SupabaseUser, Session } from "@supabase/supabase-js";
import type { Enums } from "@/integrations/supabase/types";
import { planoDoAluno, type PlanoAluno } from "@/lib/planoAluno";
import { VERSAO_CONSENTIMENTO_SAUDE } from "@/lib/consentimentoSaude";
import { comNovasTentativas, TentativasInterrompidas } from "@/lib/tentativas";
import { apagarSessaoGuardada, sair } from "@/lib/sair";
import { descartarCopiaDaSimulacao, emPerfilSimulado, stopImpersonation } from "@/lib/impersonation";
import { esquecerAvisosDesteAparelho } from "@/lib/avisosDoAparelho";
import { armazenamentoPadrao, descartarTodosOsRascunhos, type ArmazenamentoListavel } from "@/lib/rascunho";
import { vigiarSituacao } from "@/lib/releituraSituacao";

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
  status: Enums<"org_status">;
  /** Alunos no app e cobranças: onboarding concluído, ou trial (homologação). Decisão D5. */
  liberada: boolean;
  /** A marca da academia no app do aluno (logo, cor e ícones do app instalado). */
  logoUrl: string | null;
  corMarca: string | null;
  icone192: string | null;
  icone512: string | null;
}

type FaseJornada = Enums<"fase_jornada">;
type SituacaoAcademia = Enums<"situacao_aluno_academia">;

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
  planoAluno: PlanoAluno; // Free, Método Integrado ou Método Elite (lib/planoAluno)
  situacaoAcademia: SituacaoAcademia | null; // marcada pela academia; "em_dia" entra, inadimplente por 5 dias
  situacaoAcademiaDesde: string | null; // quando a situação foi marcada (conta a tolerância)
  /**
   * Anamnese de Acolhimento (M.A.P.A.®) já preenchida. `null` = desconhecida:
   * a leitura falhou, e isso não é o mesmo que "incompleta" (que mandaria o
   * aluno refazer o acolhimento).
   */
  anamneseCompleta: boolean | null;
  /** Termo de consentimento (dados de saúde) já aceito. `null` = desconhecido, como acima. */
  consentimentoLgpdAceito: boolean | null;
  /**
   * O próprio aluno retirou o consentimento de saúde pelo app (Perfil →
   * Privacidade). O acolhimento não o prende: ele autoriza de novo quando
   * quiser, e até lá usa o app sem a anamnese.
   */
  consentimentoSaudeRetirado: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  rolesLoaded: boolean;
  /**
   * A leitura dos papéis e vínculos falhou mesmo depois de tentar de novo.
   * Não é "sem vínculo": as telas mostram o erro, e não redirecionam.
   */
  erroAcesso: boolean;
  /** Tenta carregar o acesso de novo, depois de `erroAcesso`. */
  tentarAcessoDeNovo: () => void;
  hasRole: (role: AppRole) => boolean;
  refreshAluno: () => Promise<void>;
  refreshOrganization: () => Promise<void>;
  /** Unidades em que a pessoa tem vínculo ativo (multiunidade). */
  vinculos: { organizationId: string; nome: string; role: AppRole }[];
  /** Troca a unidade corrente e recarrega o app no contexto novo. */
  trocarOrganizacao: (organizationId: string) => void;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  // Sem signUp de propósito (06/10/2026): nenhum fluxo do produto usa o
  // cadastro aberto do Auth. A conta nasce na matrícula pública, no convite da
  // academia ou da ArkeFit, e a conta criada pelo "Cadastre-se" ficava sem
  // academia nenhuma. Ver docs/registro/seguranca-e-acesso.md.
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** O que a leitura do aluno devolve, antes de virar estado da tela. */
interface LeituraAluno {
  alunoId: string;
  faseJornada: FaseJornada | null;
  metodoArkeAtivo: boolean;
  planoAluno: PlanoAluno;
  situacaoAcademia: SituacaoAcademia | null;
  situacaoAcademiaDesde: string | null;
  anamneseCompleta: boolean | null;
  consentimentoLgpdAceito: boolean | null;
  consentimentoSaudeRetirado: boolean;
}

type Vinculo = { organizationId: string; nome: string; role: AppRole };

/** O acesso inteiro de uma pessoa: lido de uma vez, aplicado de uma vez. */
interface LeituraAcesso {
  roles: AppRole[];
  vinculos: Vinculo[];
  organizationRole: AppRole | null;
  organization: Organization | null;
  aluno: LeituraAluno | null;
}

const ACESSO_VAZIO: LeituraAcesso = { roles: [], vinculos: [], organizationRole: null, organization: null, aluno: null };

async function lerAluno(userId: string, organizationId: string): Promise<LeituraAluno | null> {
  const { data: aluno, error } = await supabase
    .from("alunos")
    .select("id, fase_jornada, primeiro_acesso_em, metodo_arke_status, nivel_atacado, situacao_academia, situacao_academia_em")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  // Falha de leitura não é "sem cadastro de aluno": quem chama tenta de novo.
  if (error) throw error;
  if (!aluno) return null;

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

  // Sinal de vida para a regra de inércia do Mentor ("sem abrir o app por 5
  // dias"). `primeiro_acesso_em` é de uma vez só e não serve para isso.
  //
  // Pelo mesmo motivo acima é RPC, e não UPDATE: o RLS descartaria a escrita
  // em silêncio, e a inércia acusaria justamente quem usa o app todo dia. O
  // freio de 15 minutos mora no banco — aqui a chamada é solta de propósito,
  // porque nenhuma tela depende do resultado dela.
  void supabase.rpc("registrar_atividade_aluno").then(({ error: atividadeError }) => {
    if (atividadeError) console.error("Falha ao registrar a atividade do aluno", atividadeError);
  });

  const { data: anamnese, error: anamneseError } = await supabase
    .from("anamnese_acolhimento")
    .select("concluida_em, consentimento_lgpd_aceito_em, consentimento_lgpd_versao, consentimento_lgpd_revogado_em")
    .eq("aluno_id", aluno.id)
    .maybeSingle();
  if (anamneseError) {
    // Desconhecida, e não incompleta: tratar a falha como "sem anamnese"
    // mandava o aluno do Método de volta ao acolhimento, e o envio dele
    // sobrescrevia a anamnese que o mentor já tinha lido.
    console.error("Falha ao ler a anamnese do aluno", anamneseError);
  }

  return {
    alunoId: aluno.id,
    faseJornada: aluno.fase_jornada,
    metodoArkeAtivo: aluno.metodo_arke_status === "ativo",
    planoAluno: planoDoAluno(aluno),
    situacaoAcademia: aluno.situacao_academia,
    situacaoAcademiaDesde: aluno.situacao_academia_em,
    anamneseCompleta: anamneseError ? null : !!anamnese?.concluida_em,
    // Aceite dado sob texto anterior NAO conta. E o que faz o aluno legado
    // reconfirmar na proxima abertura do app, como o parecer de 23/09/2026
    // determinou -- carimbar a versao nova numa linha antiga diria que a
    // pessoa concordou com um texto que nunca viu.
    consentimentoLgpdAceito: anamneseError
      ? null
      : !!anamnese?.consentimento_lgpd_aceito_em && anamnese?.consentimento_lgpd_versao === VERSAO_CONSENTIMENTO_SAUDE,
    consentimentoSaudeRetirado: !anamneseError && !!anamnese?.consentimento_lgpd_revogado_em,
  };
}

/**
 * Só a situação do aluno, para a releitura com o app aberto
 * (`src/lib/releituraSituacao.ts`). Sem os registros de acesso e de
 * atividade de `lerAluno`: é uma consulta leve, que não conta como abrir o app.
 */
async function lerSituacao(alunoId: string) {
  const { data, error } = await supabase
    .from("alunos")
    .select("situacao_academia, situacao_academia_em")
    .eq("id", alunoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function lerAcesso(userId: string): Promise<LeituraAcesso> {
  // Lista, não `.maybeSingle()`: quem tem vínculo ativo em duas organizações
  // — gestor de uma academia e aluno de outra, professor em duas unidades —
  // fazia a consulta falhar, e o app ficava sem organização nenhuma para
  // essa pessoa. Cenário legítimo tratado como impossível.
  const [{ data: globalRoles, error: erroPapeis }, { data: vinculos, error: erroVinculos }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase
      .from("organization_members")
      .select("role, organization_id, created_at, organizations ( id, nome, slug, tipo, especialidade_profissional, onboarding_completed, status, logo_url, cor_marca, icone_app_192_url, icone_app_512_url )")
      .eq("user_id", userId)
      .eq("status", "active"),
  ]);
  // Até 06/10/2026 estes erros eram ignorados: uma falha de rede virava "sem
  // vínculo", e a gestão era mandada para o app do aluno.
  if (erroPapeis) throw erroPapeis;
  if (erroVinculos) throw erroVinculos;

  const membership = escolherVinculo(vinculos ?? [], lerOrganizacaoPreferida(userId));
  const leitura: LeituraAcesso = {
    roles: (globalRoles || []).map((r) => r.role),
    vinculos: (vinculos ?? [])
      .map((v) => ({
        organizationId: v.organization_id,
        nome: (v.organizations as unknown as { nome: string } | null)?.nome ?? "Organização",
        role: v.role,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    organizationRole: null,
    organization: null,
    aluno: null,
  };
  if (!membership) return leitura;

  const org = membership.organizations as unknown as {
    id: string;
    nome: string;
    slug: string;
    tipo: OrganizationTipo;
    especialidade_profissional: AppRole | null;
    onboarding_completed: boolean;
    status: Enums<"org_status">;
    logo_url: string | null;
    cor_marca: string | null;
    icone_app_192_url: string | null;
    icone_app_512_url: string | null;
  } | null;

  leitura.organizationRole = membership.role;
  leitura.organization = org
    ? {
        id: org.id,
        nome: org.nome,
        slug: org.slug,
        tipo: org.tipo,
        especialidadeProfissional: org.especialidade_profissional,
        onboardingCompleted: org.onboarding_completed,
        status: org.status,
        liberada: org.onboarding_completed || org.status === "trial",
        logoUrl: org.logo_url,
        corMarca: org.cor_marca,
        icone192: org.icone_app_192_url,
        icone512: org.icone_app_512_url,
      }
    : null;
  if (membership.role === "aluno") leitura.aluno = await lerAluno(userId, membership.organization_id);
  return leitura;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizationRole, setOrganizationRole] = useState<AppRole | null>(null);
  const [alunoId, setAlunoId] = useState<string | null>(null);
  const [faseJornada, setFaseJornada] = useState<FaseJornada | null>(null);
  const [metodoArkeAtivo, setMetodoArkeAtivo] = useState(false);
  const [planoAluno, setPlanoAluno] = useState<PlanoAluno>("free");
  const [situacaoAcademia, setSituacaoAcademia] = useState<SituacaoAcademia | null>(null);
  const [situacaoAcademiaDesde, setSituacaoAcademiaDesde] = useState<string | null>(null);
  const [anamneseCompleta, setAnamneseCompleta] = useState<boolean | null>(false);
  const [consentimentoLgpdAceito, setConsentimentoLgpdAceito] = useState<boolean | null>(false);
  const [consentimentoSaudeRetirado, setConsentimentoSaudeRetirado] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [erroAcesso, setErroAcesso] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // De quem são o perfil e os papéis carregados (ou carregando). Evento de
  // sessão da mesma pessoa não recarrega nada: ver o onAuthStateChange. Toda
  // leitura confere este valor antes de virar estado: resposta que chega
  // depois de a pessoa sair (ou de outra entrar) é descartada.
  const usuarioCarregado = useRef<string | null>(null);
  const saidaEmAndamento = useRef<Promise<void> | null>(null);
  const [vinculosDisponiveis, setVinculosDisponiveis] = useState<Vinculo[]>([]);

  const aplicarAluno = (aluno: LeituraAluno | null) => {
    setAlunoId(aluno?.alunoId ?? null);
    setFaseJornada(aluno?.faseJornada ?? null);
    setMetodoArkeAtivo(aluno?.metodoArkeAtivo ?? false);
    setPlanoAluno(aluno?.planoAluno ?? "free");
    setSituacaoAcademia(aluno?.situacaoAcademia ?? null);
    setSituacaoAcademiaDesde(aluno?.situacaoAcademiaDesde ?? null);
    setAnamneseCompleta(aluno ? aluno.anamneseCompleta : false);
    setConsentimentoLgpdAceito(aluno ? aluno.consentimentoLgpdAceito : false);
    setConsentimentoSaudeRetirado(aluno?.consentimentoSaudeRetirado ?? false);
  };

  const aplicarAcesso = (leitura: LeituraAcesso) => {
    setRoles(leitura.roles);
    setVinculosDisponiveis(leitura.vinculos);
    setOrganizationRole(leitura.organizationRole);
    setOrganization(leitura.organization);
    aplicarAluno(leitura.aluno);
  };

  /** Ninguém na sessão: nada da pessoa anterior fica no estado da tela. */
  const limparEstado = () => {
    setUser(null);
    setSession(null);
    setProfile(null);
    aplicarAcesso(ACESSO_VAZIO);
    setCurrentUserId(null);
    setErroAcesso(false);
    setRolesLoaded(true);
    setIsLoading(false);
  };

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, avatar_url, status")
      .eq("user_id", userId)
      .maybeSingle();
    if (data && usuarioCarregado.current === userId) setProfile(data as Profile);
  };

  /**
   * Lê o acesso tentando de novo, com espera crescente. Na carga inicial, se
   * continuar falhando, marca `erroAcesso` e as telas dizem isso, em vez de
   * tratar a falha como "sem vínculo". Na releitura em segundo plano (depois
   * das duas etapas, de trocar a marca, de concluir a implantação), a falha
   * mantém o que já estava carregado.
   */
  const carregarAcesso = async (userId: string, inicial: boolean) => {
    try {
      const leitura = await comNovasTentativas(() => lerAcesso(userId), {
        continuar: () => usuarioCarregado.current === userId,
      });
      if (usuarioCarregado.current !== userId) return;
      aplicarAcesso(leitura);
      setErroAcesso(false);
      setRolesLoaded(true);
    } catch (erro) {
      if (erro instanceof TentativasInterrompidas || usuarioCarregado.current !== userId) return;
      console.error("Não foi possível carregar o acesso", erro);
      if (inicial) setErroAcesso(true);
    }
  };

  /**
   * Começa a carregar uma pessoa que acabou de entrar na sessão. Nada da
   * anterior fica na tela enquanto isso: nem o nome no cabeçalho, nem a
   * academia. `adiar` tira as consultas de dentro do aviso de sessão do
   * Supabase, que não aceita chamada dele mesmo ali.
   */
  const carregarPessoa = (userId: string, adiar: boolean) => {
    usuarioCarregado.current = userId;
    setProfile(null);
    aplicarAcesso(ACESSO_VAZIO);
    setRolesLoaded(false);
    setErroAcesso(false);
    setCurrentUserId(userId);
    const buscar = () =>
      void Promise.all([fetchProfile(userId), carregarAcesso(userId, true)]).finally(() => {
        if (usuarioCarregado.current === userId) setIsLoading(false);
      });
    if (adiar) setTimeout(buscar, 0);
    else buscar();
  };

  const tentarAcessoDeNovo = () => {
    const userId = usuarioCarregado.current;
    if (!userId) return;
    setErroAcesso(false);
    setRolesLoaded(false);
    void carregarAcesso(userId, true);
  };

  const refreshAluno = async () => {
    const userId = currentUserId;
    const organizationId = organization?.id;
    if (!userId || !organizationId) return;
    try {
      const aluno = await comNovasTentativas(() => lerAluno(userId, organizationId), {
        continuar: () => usuarioCarregado.current === userId,
      });
      if (usuarioCarregado.current === userId) aplicarAluno(aluno);
    } catch (erro) {
      // Mantém o que já estava carregado: quem chama segue o fluxo, e a
      // próxima abertura do app lê de novo.
      if (!(erro instanceof TentativasInterrompidas)) console.error("Não foi possível reler o aluno", erro);
    }
  };

  // Recarrega o app inteiro em vez de só trocar o estado: nenhum dado da
  // unidade anterior (consultas em cache, rascunhos na tela) sobrevive à troca.
  const trocarOrganizacao = (organizationId: string) => {
    if (!currentUserId) return;
    const destino = vinculosDisponiveis.find((v) => v.organizationId === organizationId);
    if (!destino) return;
    gravarOrganizacaoPreferida(currentUserId, organizationId);
    window.location.hash = destino.role === "aluno" ? "#/app" : "#/admin";
    window.location.reload();
  };

  const refreshOrganization = async () => {
    if (!currentUserId) return;
    await carregarAcesso(currentUserId, false);
  };

  const refreshProfile = async () => {
    if (!currentUserId) return;
    await fetchProfile(currentUserId);
  };

  useEffect(() => {
    // Set up auth listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (evento, nextSession) => {
        setSession(nextSession);
        setUser(nextSession?.user ?? null);

        if (nextSession?.user) {
          // A mesma pessoa, só a sessão mudou: o token renovado de hora em
          // hora, o código das duas etapas confirmado. Recarregar marcaria os
          // papéis como não carregados, e o ProtectedRoute desmontaria o
          // painel inteiro: o formulário aberto e a ação que esperava o código
          // das duas etapas se perdiam. Depois do código, os papéis são lidos
          // de novo em segundo plano, sem desmontar nada.
          if (nextSession.user.id === usuarioCarregado.current) {
            if (evento === "MFA_CHALLENGE_VERIFIED") {
              void Promise.all([fetchProfile(nextSession.user.id), carregarAcesso(nextSession.user.id, false)]);
            }
            return;
          }
          // Outra pessoa no lugar de quem estava: o cache das consultas é de
          // uma pessoa só. Na primeira entrada não há de quem limpar, e o
          // cache só tem o que é público (a página de vendas, a marca).
          if (usuarioCarregado.current !== null) queryClient.clear();
          carregarPessoa(nextSession.user.id, true);
          return;
        }

        // Fim da sessão, por "Sair" ou porque ela venceu: nada da pessoa
        // fica na aba, nem a cópia da sessão da ArkeFit de uma simulação. A
        // volta da simulação já guardou a cópia antes de encerrar a sessão
        // simulada, e não depende dela aqui.
        if (usuarioCarregado.current !== null) queryClient.clear();
        usuarioCarregado.current = null;
        descartarCopiaDaSimulacao();
        limparEstado();
      }
    );

    // THEN check existing session
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      setUser(initialSession?.user ?? null);

      if (initialSession?.user) {
        // O onAuthStateChange já começou a carregar esta pessoa.
        if (initialSession.user.id === usuarioCarregado.current) return;
        carregarPessoa(initialSession.user.id, false);
        return;
      }

      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A academia pausa o aluno, ou o marca inadimplente, com o app aberto: a
  // situação é relida ao voltar para o app e de 15 em 15 minutos, e o
  // AlunoSituacaoGate passa a valer sem o aluno sair e entrar de novo. Ver
  // src/lib/releituraSituacao.ts.
  useEffect(() => {
    if (!alunoId || !currentUserId) return;
    const userId = currentUserId;
    return vigiarSituacao(() => {
      lerSituacao(alunoId)
        .then((situacao) => {
          if (!situacao || usuarioCarregado.current !== userId) return;
          setSituacaoAcademia(situacao.situacao_academia);
          setSituacaoAcademiaDesde(situacao.situacao_academia_em);
        })
        // Falhou: fica a situação que já estava, e a próxima volta lê de novo.
        .catch((erro) => console.error("Não foi possível reler a situação do aluno", erro));
    });
  }, [alunoId, currentUserId]);

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
    // Entrada com senha nunca é simulação: uma cópia esquecida da sessão da
    // ArkeFit faria esta entrada pular o aceite de documentos e as duas etapas.
    descartarCopiaDaSimulacao();
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

  // O passo a passo e o porquê de cada passo estão em src/lib/sair.ts.
  // Enquanto sai, a árvore do app fica desmontada: nenhuma tela mostra dado
  // nem dispara consulta no meio da troca de sessão.
  const signOut = () => {
    if (saidaEmAndamento.current) return saidaEmAndamento.current;
    setSaindo(true);
    const saida = sair({
      emSimulacao: emPerfilSimulado,
      encerrarSimulacao: stopImpersonation,
      pessoaDaSessao: async () => (await supabase.auth.getSession()).data.session?.user.id ?? null,
      esquecerAvisos: (userId) => esquecerAvisosDesteAparelho(userId, { cancelarNoNavegador: true }),
      encerrarSessao: async () => {
        // Só este aparelho: sair do celular não derruba o computador da recepção.
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) apagarSessaoGuardada();
      },
      limparAba: () => {
        usuarioCarregado.current = null;
        queryClient.clear();
        descartarCopiaDaSimulacao();
        descartarTodosOsRascunhos(armazenamentoPadrao("sessao") as ArmazenamentoListavel | null);
        descartarTodosOsRascunhos(armazenamentoPadrao("persistente") as ArmazenamentoListavel | null);
        limparEstado();
      },
    }).finally(() => {
      saidaEmAndamento.current = null;
      setSaindo(false);
    });
    saidaEmAndamento.current = saida;
    return saida;
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
        planoAluno,
        situacaoAcademia,
        situacaoAcademiaDesde,
        anamneseCompleta,
        consentimentoLgpdAceito,
        consentimentoSaudeRetirado,
        isAuthenticated: !!session,
        isLoading,
        rolesLoaded,
        erroAcesso,
        tentarAcessoDeNovo,
        hasRole,
        refreshAluno,
        vinculos: vinculosDisponiveis,
        trocarOrganizacao,
        refreshOrganization,
        refreshProfile,
        signIn,
        signOut,
        resetPassword,
        updatePassword,
      }}
    >
      {saindo ? (
        <div role="status" className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Saindo...</p>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
