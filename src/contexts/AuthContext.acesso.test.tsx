import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Achados da auditoria de 06/10/2026 no AuthContext:
 *  - A12: falha ao ler papéis e vínculos virava "sem vínculo" e mandava a
 *    gestão para o app do aluno; a anamnese com leitura falha virava
 *    "incompleta" e mandava o aluno do Método refazer o acolhimento.
 *  - A11: o "Sair" deixava o cache das consultas, os avisos do aparelho e a
 *    cópia da sessão da ArkeFit para trás, e saía de todos os aparelhos.
 */

const banco = vi.hoisted(() => ({
  falhasPapeis: 0,
  leiturasPapeis: 0,
  vinculos: [] as unknown[],
  aluno: null as unknown,
  anamnese: null as unknown,
  falharAnamnese: false,
}));

type Sessao = { access_token: string; user: { id: string; email: string } } | null;
const auth = vi.hoisted(() => ({
  ouvinte: null as null | ((evento: string, sessao: unknown) => void),
  sessao: null as unknown,
}));
const ordem = vi.hoisted(() => [] as string[]);
const simulacao = vi.hoisted(() => ({ ativa: false }));

function resposta(tabela: string, unico: boolean) {
  if (tabela === "user_roles") {
    banco.leiturasPapeis++;
    if (banco.falhasPapeis > 0) {
      banco.falhasPapeis--;
      return { data: null, error: { message: "TypeError: Failed to fetch" } };
    }
    return { data: [], error: null };
  }
  if (tabela === "organization_members") return { data: banco.vinculos, error: null };
  if (tabela === "alunos") return { data: banco.aluno, error: null };
  if (tabela === "anamnese_acolhimento") {
    return banco.falharAnamnese ? { data: null, error: { message: "timeout" } } : { data: banco.anamnese, error: null };
  }
  return { data: unico ? null : [], error: null };
}

function consulta(tabela: string) {
  let unico = false;
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown) => Promise.resolve(resposta(tabela, unico)).then(ok);
        }
        return () => {
          if (prop === "maybeSingle" || prop === "single") unico = true;
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => consulta(tabela),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      onAuthStateChange: (fn: (evento: string, sessao: unknown) => void) => {
        auth.ouvinte = fn;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getSession: () => Promise.resolve({ data: { session: auth.sessao } }),
      signOut: async (opcoes?: { scope?: string }) => {
        ordem.push(`encerrou a sessão (${opcoes?.scope ?? "global"})`);
        auth.sessao = null;
        auth.ouvinte?.("SIGNED_OUT", null);
        return { error: null };
      },
    },
  },
}));
vi.mock("@/lib/monitoramento", () => ({ identificarSessao: () => {} }));
vi.mock("@/lib/avisosDoAparelho", () => ({
  esquecerAvisosDesteAparelho: async (userId: string | null, opcoes: { cancelarNoNavegador: boolean }) => {
    ordem.push(`esqueceu os avisos de ${userId} (navegador: ${opcoes.cancelarNoNavegador})`);
  },
}));
vi.mock("@/lib/impersonation", () => ({
  emPerfilSimulado: () => simulacao.ativa,
  descartarCopiaDaSimulacao: () => {
    simulacao.ativa = false;
    ordem.push("apagou a cópia da simulação");
  },
  stopImpersonation: async () => {
    ordem.push("voltou para a conta da ArkeFit");
    simulacao.ativa = false;
    auth.sessao = sessao("arkefit");
    return { error: null };
  },
}));
// Sem as esperas de verdade entre as tentativas (1, 2 e 4 segundos).
vi.mock("@/lib/tentativas", async (original) => {
  const real = await original<typeof import("@/lib/tentativas")>();
  return {
    ...real,
    comNovasTentativas: <T,>(acao: () => Promise<T>, opcoes: Parameters<typeof real.comNovasTentativas>[1] = {}) =>
      real.comNovasTentativas(acao, { ...opcoes, esperar: async () => {} }),
  };
});

import { AuthProvider, useAuth } from "./AuthContext";

function sessao(id: string): Sessao {
  return { access_token: `t-${id}`, user: { id, email: `${id}@exemplo.com` } };
}

let contexto: ReturnType<typeof useAuth>;
function Espiao() {
  contexto = useAuth();
  return null;
}

function montar() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Espiao />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

const VINCULO_ALUNO = {
  role: "aluno",
  organization_id: "org-1",
  created_at: "2026-09-01T00:00:00Z",
  organizations: {
    id: "org-1",
    nome: "Academia Teste",
    slug: "teste",
    tipo: "academia",
    especialidade_profissional: null,
    onboarding_completed: true,
    status: "active",
    logo_url: null,
    cor_marca: null,
    icone_app_192_url: null,
    icone_app_512_url: null,
  },
};
const ALUNO_DO_METODO = {
  id: "aluno-1",
  fase_jornada: "mapa",
  primeiro_acesso_em: "2026-09-02T00:00:00Z",
  metodo_arke_status: "ativo",
  nivel_atacado: "integrado",
  situacao_academia: "em_dia",
  situacao_academia_em: null,
};

beforeEach(() => {
  banco.falhasPapeis = 0;
  banco.leiturasPapeis = 0;
  banco.vinculos = [];
  banco.aluno = null;
  banco.anamnese = null;
  banco.falharAnamnese = false;
  auth.sessao = sessao("ana");
  ordem.length = 0;
  simulacao.ativa = false;
  window.sessionStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AuthContext: falha ao ler o acesso (A12)", () => {
  it("tenta de novo e, quando a leitura volta, carrega normalmente", async () => {
    banco.falhasPapeis = 2;
    montar();
    await waitFor(() => expect(contexto.rolesLoaded).toBe(true));
    expect(contexto.erroAcesso).toBe(false);
    expect(banco.leiturasPapeis).toBe(3);
  });

  it("falha que não passa é erro de acesso, e não conta sem vínculo", async () => {
    banco.falhasPapeis = 99;
    montar();
    await waitFor(() => expect(contexto.erroAcesso).toBe(true));
    // Papéis não carregados: nenhuma rota decide destino com base no vazio.
    expect(contexto.rolesLoaded).toBe(false);
    expect(contexto.isLoading).toBe(false);

    banco.falhasPapeis = 0;
    act(() => contexto.tentarAcessoDeNovo());
    await waitFor(() => expect(contexto.rolesLoaded).toBe(true));
    expect(contexto.erroAcesso).toBe(false);
  });

  it("anamnese com leitura falha fica desconhecida, e não incompleta", async () => {
    banco.vinculos = [VINCULO_ALUNO];
    banco.aluno = ALUNO_DO_METODO;
    banco.falharAnamnese = true;
    montar();
    await waitFor(() => expect(contexto.rolesLoaded).toBe(true));
    expect(contexto.alunoId).toBe("aluno-1");
    expect(contexto.metodoArkeAtivo).toBe(true);
    expect(contexto.anamneseCompleta).toBeNull();
    expect(contexto.consentimentoLgpdAceito).toBeNull();
  });

  it("aluno sem anamnese, com a leitura certa, é incompleto", async () => {
    banco.vinculos = [VINCULO_ALUNO];
    banco.aluno = ALUNO_DO_METODO;
    montar();
    await waitFor(() => expect(contexto.rolesLoaded).toBe(true));
    expect(contexto.anamneseCompleta).toBe(false);
  });
});

describe("AuthContext: Sair (A11)", () => {
  it("apaga os avisos ainda conectado, sai só deste aparelho e limpa cache e rascunhos", async () => {
    const queryClient = montar();
    await waitFor(() => expect(contexto.rolesLoaded).toBe(true));
    queryClient.setQueryData(["exercicios-biblioteca", "ana"], [{ id: "ex-da-academia" }]);
    window.sessionStorage.setItem("arke_rascunho:avaliacao-fisica:aluno-9", "{}");

    await act(() => contexto.signOut());

    expect(ordem).toEqual([
      "esqueceu os avisos de ana (navegador: true)",
      "encerrou a sessão (local)",
      "apagou a cópia da simulação",
      "apagou a cópia da simulação",
    ]);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(window.sessionStorage.getItem("arke_rascunho:avaliacao-fisica:aluno-9")).toBeNull();
    expect(contexto.isAuthenticated).toBe(false);
    expect(contexto.user).toBeNull();
  });

  it("na simulação, volta para a conta da ArkeFit e sai dela também", async () => {
    auth.sessao = sessao("aluna-simulada");
    simulacao.ativa = true;
    montar();
    await waitFor(() => expect(contexto.rolesLoaded).toBe(true));

    await act(() => contexto.signOut());

    expect(ordem.slice(0, 3)).toEqual([
      "voltou para a conta da ArkeFit",
      "esqueceu os avisos de arkefit (navegador: true)",
      "encerrou a sessão (local)",
    ]);
    expect(simulacao.ativa).toBe(false);
    expect(auth.sessao).toBeNull();
  });

  it("outra pessoa na sessão não herda o cache da anterior", async () => {
    const queryClient = montar();
    await waitFor(() => expect(contexto.rolesLoaded).toBe(true));
    queryClient.setQueryData(["aluno-competicoes", "aluno-da-ana"], [{ id: "c1" }]);
    act(() => auth.ouvinte!("SIGNED_IN", sessao("bia")));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    await waitFor(() => expect(contexto.rolesLoaded).toBe(true));
  });

  it("a sessão que termina sozinha leva junto a cópia da simulação", async () => {
    simulacao.ativa = true;
    montar();
    await waitFor(() => expect(contexto.rolesLoaded).toBe(true));
    act(() => auth.ouvinte!("SIGNED_OUT", null));
    expect(simulacao.ativa).toBe(false);
  });
});
