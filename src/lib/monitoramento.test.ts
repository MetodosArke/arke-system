import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// O módulo lê o DSN na carga. Cada teste decide se o monitoramento está
// ligado antes de importá-lo.
async function carregar(dsn?: string) {
  vi.resetModules();
  vi.stubEnv("VITE_SENTRY_DSN", dsn ?? "");
  return await import("./monitoramento");
}

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@sentry/react", () => sentry);

const DSN_FALSO = "https://abc@o1.ingest.us.sentry.io/2";

beforeEach(() => {
  sentry.init.mockReset();
  sentry.setUser.mockReset();
  sentry.setTag.mockReset();
  sentry.captureException.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("iniciarMonitoramento", () => {
  it("não inicia nada sem DSN — é assim que se roda em desenvolvimento", async () => {
    const { iniciarMonitoramento } = await carregar();
    iniciarMonitoramento();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("nunca liga Session Replay nem envia PII por padrão", async () => {
    // Este é o teste que mais importa do arquivo. Numa tela de avaliação
    // física, o replay gravaria peso, dobras e queixas do aluno e mandaria
    // para um terceiro — dado pessoal sensível pela LGPD (art. 5º, II).
    const { iniciarMonitoramento } = await carregar(DSN_FALSO);
    iniciarMonitoramento();

    const config = sentry.init.mock.calls[0][0];
    expect(config.sendDefaultPii).toBe(false);
    expect(config.tracesSampleRate).toBe(0);

    const integracoes = config.integrations([
      { name: "Replay" },
      { name: "ReplayCanvas" },
      { name: "Breadcrumbs" },
      { name: "RequestData" },
      { name: "GlobalHandlers" },
    ]).map((i: { name: string }) => i.name);

    expect(integracoes).not.toContain("Replay");
    expect(integracoes).not.toContain("ReplayCanvas");
    expect(integracoes).not.toContain("RequestData");
    expect(integracoes).not.toContain("Breadcrumbs");
    // O que sobra continua funcionando: erro não capturado ainda é reportado.
    expect(integracoes).toContain("GlobalHandlers");
  });
});

describe("limpeza do evento", () => {
  async function beforeSend() {
    const { iniciarMonitoramento } = await carregar(DSN_FALSO);
    iniciarMonitoramento();
    return sentry.init.mock.calls[0][0].beforeSend;
  }

  it("remove dado de saúde e identificação de qualquer profundidade", async () => {
    const limpar = await beforeSend();
    const evento = limpar({
      extra: {
        aluno: {
          full_name: "Fulana de Tal",
          cpf: "123.456.789-09",
          avaliacao: { peso: 71.2, dobras: [12, 18, 9], observacoes: "dor no ombro direito" },
        },
        aluno_id: "uuid-que-pode-ficar",
      },
    });

    const aluno = evento.extra.aluno;
    expect(aluno.full_name).toBe("[removido]");
    expect(aluno.cpf).toBe("[removido]");
    expect(aluno.avaliacao.peso).toBe("[removido]");
    expect(aluno.avaliacao.dobras).toBe("[removido]");
    expect(aluno.avaliacao.observacoes).toBe("[removido]");
    // O id continua: é ele que torna o erro investigável.
    expect(evento.extra.aluno_id).toBe("uuid-que-pode-ficar");
  });

  it("corta query string e descarta corpo, cookies e cabeçalhos", async () => {
    const limpar = await beforeSend();
    const evento = limpar({
      request: {
        url: "https://arke.app/admin/alunos?busca=maria%20silva&cpf=12345678909",
        data: { password: "segredo" },
        cookies: { sb_access_token: "eyJ..." },
        headers: { authorization: "Bearer eyJ..." },
      },
    });

    expect(evento.request.url).toBe("https://arke.app/admin/alunos?[removido]");
    expect(evento.request.url).not.toContain("maria");
    expect(evento.request.data).toBeUndefined();
    expect(evento.request.cookies).toBeUndefined();
    expect(evento.request.headers).toBeUndefined();
  });

  it("não quebra com evento sem request nem extra", async () => {
    const limpar = await beforeSend();
    expect(() => limpar({ message: "erro seco" })).not.toThrow();
  });
});

describe("breadcrumbs", () => {
  async function beforeBreadcrumb() {
    const { iniciarMonitoramento } = await carregar(DSN_FALSO);
    iniciarMonitoramento();
    return sentry.init.mock.calls[0][0].beforeBreadcrumb;
  }

  it("descarta console — o app registra objeto de erro do Supabase nele", async () => {
    const filtrar = await beforeBreadcrumb();
    expect(filtrar({ category: "console", message: "[error-boundary] ..." })).toBeNull();
  });

  it("corta a query string de navegação e fetch", async () => {
    const filtrar = await beforeBreadcrumb();
    const m = filtrar({ category: "fetch", data: { url: "https://x/rest/v1/alunos?cpf=eq.123" } });
    expect(m.data.url).toBe("https://x/rest/v1/alunos?[removido]");
  });
});

describe("identificarSessao", () => {
  it("manda só UUID — nunca nome, e-mail ou CPF", async () => {
    const { identificarSessao } = await carregar(DSN_FALSO);
    identificarSessao({ userId: "u-1", organizationId: "org-1", papel: "aluno" });

    expect(sentry.setUser).toHaveBeenCalledWith({ id: "u-1" });
    // O objeto passado ao setUser não tem mais nada além do id.
    expect(Object.keys(sentry.setUser.mock.calls[0][0])).toEqual(["id"]);
    expect(sentry.setTag).toHaveBeenCalledWith("organization_id", "org-1");
    expect(sentry.setTag).toHaveBeenCalledWith("papel", "aluno");
  });

  it("marca quem não tem organização em vez de omitir", async () => {
    const { identificarSessao } = await carregar(DSN_FALSO);
    identificarSessao({ userId: null, organizationId: null, papel: null });

    expect(sentry.setUser).toHaveBeenCalledWith(null);
    expect(sentry.setTag).toHaveBeenCalledWith("organization_id", "sem_organizacao");
  });
});

describe("reportarErro", () => {
  it("sem DSN, cai no console em vez de sumir com o erro", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { reportarErro } = await carregar();
    reportarErro(new Error("x"));

    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("limpa o contexto antes de enviar", async () => {
    const { reportarErro } = await carregar(DSN_FALSO);
    reportarErro(new Error("x"), { aluno_id: "u-1", cpf: "12345678909" });

    const [, opcoes] = sentry.captureException.mock.calls[0];
    expect(opcoes.extra.aluno_id).toBe("u-1");
    expect(opcoes.extra.cpf).toBe("[removido]");
  });
});
