import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * O que não sai para o Sentry, com os casos reais do ARKE (auditoria de
 * prontidão, 07/10/2026). O `beforeSend` antigo limpava os objetos pela chave
 * (`cpf`, `email`) e cortava a query string, mas deixava passar:
 *
 * - o texto do erro (`exception.value`) e a mensagem: o erro do Postgres repete
 *   a linha que falhou ("Key (email)=(maria@…) already exists");
 * - o `#access_token=` do link de senha que o Supabase manda por e-mail, que
 *   não tem `?` e por isso passava pelo corte inteiro;
 * - o texto das migalhas e o endereço da página nos quadros da pilha.
 *
 * Cada caso daqui é um formato que o app de fato produz. Se a limpeza de um
 * deles sumir, a guarda falha.
 */

const sentry = vi.hoisted(() => ({ init: vi.fn(), setUser: vi.fn(), setTag: vi.fn(), captureException: vi.fn() }));
vi.mock("@sentry/react", () => sentry);

async function configuracao() {
  vi.resetModules();
  vi.stubEnv("VITE_SENTRY_DSN", "https://abc@o1.ingest.us.sentry.io/2");
  const { iniciarMonitoramento } = await import("./monitoramento");
  iniciarMonitoramento();
  return sentry.init.mock.calls[0][0] as {
    beforeSend: (e: Record<string, unknown>) => Record<string, unknown>;
    beforeBreadcrumb: (m: Record<string, unknown>) => Record<string, unknown> | null;
  };
}

beforeEach(() => sentry.init.mockReset());
afterEach(() => vi.unstubAllEnvs());

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYmMiLCJlbWFpbCI6Im1hcmlhQGdtYWlsLmNvbSJ9.c2lnbmF0dXJh";
const LINK_SENHA = `https://app.arkefit.com.br/#access_token=${JWT}&expires_at=1759900000&expires_in=3600&refresh_token=v1Zx9QpL0aB&token_type=bearer&type=recovery`;

/** Nada que identifique alguém ou dê acesso pode sobrar no evento serializado. */
function semVazamento(evento: unknown) {
  const texto = JSON.stringify(evento);
  for (const proibido of [
    JWT, "v1Zx9QpL0aB", "maria.silva@gmail.com", "joao@academia.com.br", "529.982.247-25", "52998224725",
    "98765-4321", "11987654321", "aact_hmlg", "AbC-123_xyz", "pkce0123456789abcdef", "ff3c2a10-6b8e-4c1d-9f00-3e2d1c0b9a87",
  ]) {
    expect(texto, `vazou ${proibido}`).not.toContain(proibido);
  }
}

describe("o evento que sai para o Sentry", () => {
  it("o link de senha do e-mail: o #access_token e o refresh_token saem do endereço", async () => {
    const { beforeSend } = await configuracao();
    const evento = beforeSend({ request: { url: LINK_SENHA } });
    semVazamento(evento);
    expect((evento.request as { url: string }).url).toContain("access_token=[removido]");
  });

  it("o mesmo token com a rota do app antes (#/auth/reset-password#access_token=…)", async () => {
    const { beforeSend } = await configuracao();
    const url = `https://app.arkefit.com.br/#/auth/reset-password#access_token=${JWT}&refresh_token=v1Zx9QpL0aB&type=recovery`;
    semVazamento(beforeSend({ request: { url } }));
  });

  it("o convite, o retorno do login, o link do responsável e o \"não quero mais receber\"", async () => {
    const { beforeSend } = await configuracao();
    for (const url of [
      "https://lzyxqjibkfblrrjboylp.supabase.co/auth/v1/verify?token_hash=pkce0123456789abcdef&type=invite",
      "https://app.arkefit.com.br/?code=pkce0123456789abcdef#/auth/definir-senha",
      "https://app.arkefit.com.br/#/responsavel/AbC-123_xyz",
      "https://app.arkefit.com.br/#/contato/parar?t=ff3c2a10-6b8e-4c1d-9f00-3e2d1c0b9a87",
    ]) {
      semVazamento(beforeSend({ request: { url, query_string: url.split("?")[1] } }));
    }
  });

  it("o erro do Postgres que repete a linha: e-mail, CPF e telefone saem do exception.value e da mensagem", async () => {
    const { beforeSend } = await configuracao();
    const evento = beforeSend({
      message: "Falha ao matricular 529.982.247-25 (11) 98765-4321",
      exception: {
        values: [
          {
            type: "Error",
            value:
              'duplicate key value violates unique constraint "profiles_email_key": Key (email)=(maria.silva@gmail.com) already exists. code=23505',
          },
          { type: "Error", value: "CPF 52998224725 já cadastrado; celular 11987654321; +55 11 98765-4321" },
        ],
      },
    });
    semVazamento(evento);
    const valores = (evento.exception as { values: { value: string }[] }).values.map((v) => v.value);
    // O que ajuda a entender o erro fica: a restrição e o código do Postgres.
    expect(valores[0]).toContain("profiles_email_key");
    expect(valores[0]).toContain("code=23505");
  });

  it("o endereço da página nos quadros da pilha, as migalhas e o texto dos dados extras", async () => {
    const { beforeSend } = await configuracao();
    const evento = beforeSend({
      exception: { values: [{ type: "TypeError", value: "x is undefined", stacktrace: { frames: [{ filename: LINK_SENHA, abs_path: LINK_SENHA }] } }] },
      breadcrumbs: [
        { category: "navigation", message: `voltou de ${LINK_SENHA}`, data: { from: LINK_SENHA, to: "/#/app" } },
        { category: "custom", message: `Authorization: Bearer ${JWT}` },
      ],
      extra: { detalhe: "convite para joao@academia.com.br falhou", chave: "$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OmQ" },
      contexts: { tela: { endereco: LINK_SENHA } },
    });
    semVazamento(evento);
  });

  it("o usuário sai só com o UUID, mesmo que o SDK junte e-mail, nome ou IP", async () => {
    const { beforeSend } = await configuracao();
    const evento = beforeSend({ user: { id: "u-1", email: "maria.silva@gmail.com", username: "Maria", ip_address: "189.1.2.3" } });
    expect(evento.user).toEqual({ id: "u-1" });
  });

  it("não estraga o que ajuda a investigar: UUID, código do erro, rota e mensagem de rede", async () => {
    const { beforeSend } = await configuracao();
    const evento = beforeSend({
      message: "Failed to fetch",
      extra: { aluno_id: "ff3c2a10-6b8e-4c1d-9f00-3e2d1c0b9a87", code: "23505", rota: "/#/admin/alunos", total: 1250 },
      tags: { organization_id: "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d", papel: "gestor" },
    });
    expect(evento.message).toBe("Failed to fetch");
    expect(evento.extra).toEqual({ aluno_id: "ff3c2a10-6b8e-4c1d-9f00-3e2d1c0b9a87", code: "23505", rota: "/#/admin/alunos", total: 1250 });
    expect(evento.tags).toEqual({ organization_id: "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d", papel: "gestor" });
  });
});

describe("a migalha, quando é anotada", () => {
  it("perde o token do endereço e da mensagem, e a de console nem entra", async () => {
    const { beforeBreadcrumb } = await configuracao();
    expect(beforeBreadcrumb({ category: "console", message: "maria.silva@gmail.com" })).toBeNull();
    const migalha = beforeBreadcrumb({
      category: "fetch",
      message: `GET ${LINK_SENHA}`,
      data: { url: LINK_SENHA, method: "GET", status_code: 401 },
    });
    semVazamento(migalha);
    expect((migalha!.data as { status_code: number }).status_code).toBe(401);
  });
});
