import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * Até 06/10/2026 a simulação de perfil registrava o aparelho da ArkeFit como
 * destino dos avisos da pessoa simulada, e o registro feito uma vez por aba
 * não valia para a pessoa seguinte depois de um "Sair".
 */

const estado = vi.hoisted(() => {
  const inscricao = {
    endpoint: "https://push.exemplo/aparelho",
    options: { applicationServerKey: null },
    toJSON: () => ({ endpoint: "https://push.exemplo/aparelho", keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: async () => true,
  };
  const registro = {
    pushManager: { getSubscription: async () => null, subscribe: async () => inscricao },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: async () => registro, ready: Promise.resolve(registro), getRegistration: async () => registro },
  });
  Object.assign(window, {
    PushManager: function PushManager() {},
    Notification: { permission: "granted", requestPermission: async () => "granted" },
  });
  return {
    simulado: false,
    auth: { user: { id: "ana" } as { id: string } | null, isAuthenticated: true },
    gravacoes: [] as unknown[],
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: { publicKey: "AQID" }, error: null }) },
    from: () => ({
      upsert: async (linha: unknown) => {
        estado.gravacoes.push(linha);
        return { error: null };
      },
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => estado.auth }));
vi.mock("@/lib/impersonation", () => ({ emPerfilSimulado: () => estado.simulado }));

import { usePushNotifications } from "./usePushNotifications";

const donos = () => estado.gravacoes.map((g) => (g as { user_id: string }).user_id);

describe("usePushNotifications", () => {
  beforeEach(() => {
    estado.simulado = false;
    estado.auth = { user: { id: "ana" }, isAuthenticated: true };
    estado.gravacoes.length = 0;
  });

  it("registra o aparelho para a pessoa da sessão", async () => {
    const { unmount } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(donos()).toEqual(["ana"]));
    unmount();
  });

  it("na simulação, não registra o aparelho para a pessoa simulada", async () => {
    estado.simulado = true;
    const { result, unmount } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.pushStatus).toBe("granted"));
    await expect(result.current.requestPushPermission()).resolves.toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(estado.gravacoes).toEqual([]);
    unmount();
  });

  it("a pessoa seguinte na mesma aba registra a dela", async () => {
    const { rerender, unmount } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(donos()).toEqual(["ana"]));
    estado.auth = { user: { id: "bia" }, isAuthenticated: true };
    rerender();
    await waitFor(() => expect(donos()).toEqual(["ana", "bia"]));
    unmount();
  });
});
