import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Evento de sessão da mesma pessoa (token renovado de hora em hora, código
 * das duas etapas confirmado) não pode marcar os papéis como não carregados:
 * o ProtectedRoute desmontaria o painel inteiro, e o formulário aberto e a
 * ação que esperava o código das duas etapas se perdiam. Achado conferindo
 * pela tela, em 05/10/2026: a exportação não rodava depois do código.
 */

type Evento = (evento: string, sessao: unknown) => void;
const auth = vi.hoisted(() => ({ ouvinte: null as null | ((e: string, s: unknown) => void), sessaoInicial: null as unknown }));
const consultas = vi.hoisted(() => ({ papeis: 0 }));

// Uma consulta encadeável que responde vazio: `.maybeSingle()` dá nulo, o resto dá lista vazia.
function consulta(tabela: string) {
  let unico = false;
  if (tabela === "user_roles") consultas.papeis++;
  const alvo: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        const resposta = { data: unico ? null : [], error: null };
        return (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok);
      }
      return (..._args: unknown[]) => {
        if (prop === "maybeSingle" || prop === "single") unico = true;
        return proxy;
      };
    },
  });
  return proxy;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => consulta(tabela),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      onAuthStateChange: (fn: Evento) => {
        auth.ouvinte = fn;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getSession: () => Promise.resolve({ data: { session: auth.sessaoInicial } }),
    },
  },
}));
vi.mock("@/lib/monitoramento", () => ({ identificarSessao: () => {} }));

import { AuthProvider, useAuth } from "./AuthContext";

const sessao = (id: string) => ({ access_token: `t-${id}-${Math.random()}`, user: { id, email: `${id}@exemplo.com` } });
const estados: boolean[] = [];
function Espiao() {
  const { rolesLoaded } = useAuth();
  estados.push(rolesLoaded);
  return null;
}
const montar = (filhos: ReactNode = <Espiao />) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>{filhos}</AuthProvider>
    </QueryClientProvider>,
  );

describe("AuthContext: evento de sessão da mesma pessoa", () => {
  beforeEach(() => {
    estados.length = 0;
    consultas.papeis = 0;
    auth.sessaoInicial = sessao("ana");
  });

  it("token renovado não recarrega os papéis nem os marca como não carregados", async () => {
    montar();
    await waitFor(() => expect(estados.at(-1)).toBe(true));
    const papeisAntes = consultas.papeis;
    const n = estados.length;
    await act(async () => auth.ouvinte!("TOKEN_REFRESHED", sessao("ana")));
    expect(estados.slice(n)).not.toContain(false);
    expect(consultas.papeis).toBe(papeisAntes);
  });

  it("código das duas etapas confirmado relê os papéis em segundo plano, sem desmontar", async () => {
    montar();
    await waitFor(() => expect(estados.at(-1)).toBe(true));
    const papeisAntes = consultas.papeis;
    const n = estados.length;
    await act(async () => auth.ouvinte!("MFA_CHALLENGE_VERIFIED", sessao("ana")));
    await waitFor(() => expect(consultas.papeis).toBe(papeisAntes + 1));
    expect(estados.slice(n)).not.toContain(false);
  });

  it("outra pessoa entrando recarrega tudo", async () => {
    montar();
    await waitFor(() => expect(estados.at(-1)).toBe(true));
    const n = estados.length;
    await act(async () => auth.ouvinte!("SIGNED_IN", sessao("bia")));
    expect(estados.slice(n)).toContain(false);
    await waitFor(() => expect(estados.at(-1)).toBe(true));
  });
});
