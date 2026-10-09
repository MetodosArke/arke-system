import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatPanel } from "./ChatPanel";

/**
 * Quem escreveu cada mensagem, na tela (09/10/2026). Na Ponto Alto, a gestora
 * e o professor escreveram "Teste" para a mesma aluna, e o professor via as
 * duas como "Você". O banco guardava quem enviou; a tela não lia.
 */

let usuario = "diego";
let mensagens: unknown[] = [];
let perfis: { data: unknown[] | null; error: { message: string } | null } = { data: [], error: null };
const perfisPedidos: string[][] = [];

const consultaDaConversa = () => ({
  select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: mensagens, error: null }) }) }),
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "mensagens_treino" || tabela === "mensagens_dieta") return consultaDaConversa();
      if (tabela === "alunos") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { user_id: "isabela" }, error: null }) }) }) };
      }
      if (tabela === "profiles") {
        return {
          select: () => ({
            in: (_coluna: string, ids: string[]) => {
              perfisPedidos.push(ids);
              return Promise.resolve(perfis);
            },
          }),
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: usuario } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/sendChatPush", () => ({ sendChatPush: vi.fn() }));
vi.mock("@/components/chat/VideoChat", () => ({ VideoChat: () => null }));

beforeAll(() => {
  // O jsdom não rola a tela; o chat rola até a última mensagem.
  Element.prototype.scrollIntoView = vi.fn();
});

const msg = (id: string, remetente_tipo: string, remetente_id: string, mensagem: string) => ({
  id,
  remetente_tipo,
  remetente_id,
  mensagem,
  video_url: null,
  lida: true,
  created_at: "2026-10-09T12:00:00Z",
});

const conversaDaPontoAlto = (tipoDaEquipe: string) => [
  msg("1", "aluno", "isabela", "Oi, tudo bem?"),
  msg("2", tipoDaEquipe, "renata", "Teste da Renata"),
  msg("3", tipoDaEquipe, "diego", "Teste do Diego"),
];

const abrir = (props: Partial<Parameters<typeof ChatPanel>[0]> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ChatPanel organizationId="org-1" alunoId="aluno-1" viewerType="staff" type="treino" {...props} />
    </QueryClientProvider>
  );

/** O rótulo que fica em cima da bolha de uma mensagem. */
const rotuloDe = async (texto: string) => (await screen.findByText(texto)).closest("div.flex-col")?.firstElementChild?.textContent;

describe("quem escreveu cada mensagem da conversa com o aluno", () => {
  beforeEach(() => {
    usuario = "diego";
    mensagens = conversaDaPontoAlto("treinador");
    perfis = { data: [{ user_id: "renata", full_name: "Renata Albuquerque" }], error: null };
    perfisPedidos.length = 0;
  });

  it("a equipe vê a própria mensagem como Você e a de outra pessoa da equipe com o nome dela", async () => {
    abrir();
    expect(await screen.findByText("Renata Albuquerque")).toBeInTheDocument();
    expect(await rotuloDe("Teste do Diego")).toBe("Você");
    expect(await rotuloDe("Teste da Renata")).toBe("Renata Albuquerque");
    expect(await rotuloDe("Oi, tudo bem?")).toBe("Aluno");
    // Só o nome de quem não é a própria pessoa é pedido, e uma vez.
    expect(perfisPedidos).toEqual([["renata"]]);
  });

  it("quem abre a conversa decide o que é Você: para a Renata, a mensagem do Diego leva o nome dele", async () => {
    usuario = "renata";
    perfis = { data: [{ user_id: "diego", full_name: "Diego Fontes" }], error: null };
    abrir();
    expect(await screen.findByText("Diego Fontes")).toBeInTheDocument();
    expect(await rotuloDe("Teste da Renata")).toBe("Você");
    expect(await rotuloDe("Teste do Diego")).toBe("Diego Fontes");
  });

  it("o nome que não carrega vira um rótulo neutro, e a conversa continua", async () => {
    perfis = { data: null, error: { message: "falhou" } };
    abrir();
    expect(await rotuloDe("Teste da Renata")).toBe("Equipe da academia");
    expect(await rotuloDe("Teste do Diego")).toBe("Você");
    expect(screen.getByText("Oi, tudo bem?")).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível carregar/i)).not.toBeInTheDocument();
  });

  it("quem não volta da leitura (saiu da academia) também cai no rótulo neutro", async () => {
    perfis = { data: [], error: null };
    abrir();
    expect(await rotuloDe("Teste da Renata")).toBe("Equipe da academia");
  });

  it("na conversa da nutrição vale o mesmo", async () => {
    mensagens = conversaDaPontoAlto("nutricionista");
    abrir({ type: "nutri", dietaId: "dieta-1" });
    expect(await screen.findByText("Renata Albuquerque")).toBeInTheDocument();
    expect(await rotuloDe("Teste do Diego")).toBe("Você");
  });

  it("o aluno continua vendo a função de quem respondeu, sem ler o perfil da equipe", async () => {
    usuario = "isabela";
    abrir({ viewerType: "aluno" });
    expect(await rotuloDe("Oi, tudo bem?")).toBe("Você");
    expect(await rotuloDe("Teste da Renata")).toBe("Treinador(a)");
    expect(await rotuloDe("Teste do Diego")).toBe("Treinador(a)");
    expect(perfisPedidos).toEqual([]);
  });
});
