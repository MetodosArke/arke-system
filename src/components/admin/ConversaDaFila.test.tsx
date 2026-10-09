import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BotaoMensagem, ConversaDaFilaDialog, type ConversaDaFila } from "./ConversaDaFila";

// O chat em si é o da ficha; aqui importa só qual canal abre, e de quem.
vi.mock("@/components/chat/ChatPanel", () => ({
  ChatPanel: (p: { alunoId: string; type: string; viewerType: string }) => (
    <div data-testid="chat">{`${p.viewerType}:${p.type}:${p.alunoId}`}</div>
  ),
}));

const montar = (conversa: ConversaDaFila | null, onFechar = vi.fn()) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConversaDaFilaDialog conversa={conversa} organizationId="org-1" onFechar={onFechar} />
    </QueryClientProvider>
  );

describe("a conversa aberta direto da fila de atendimento", () => {
  it("o botão diz de quem é a conversa no rótulo acessível", () => {
    const abrir = vi.fn();
    render(<BotaoMensagem nome="Ana Souza" onClick={abrir} />);
    fireEvent.click(screen.getByRole("button", { name: "Mensagem para Ana Souza" }));
    expect(abrir).toHaveBeenCalledOnce();
  });

  it("abre o canal que a pessoa atende, como equipe, sem escolha quando há um só", () => {
    montar({ alunoId: "aluno-1", nome: "Ana Souza", canais: ["treino"] });
    expect(screen.getByRole("heading", { name: "Chat Treino — Ana Souza" })).toBeInTheDocument();
    expect(screen.getByTestId("chat")).toHaveTextContent("staff:treino:aluno-1");
    expect(screen.queryByRole("group", { name: "Canal da conversa" })).not.toBeInTheDocument();
  });

  it("a nutricionista abre direto a conversa da nutrição", () => {
    montar({ alunoId: "aluno-2", nome: "Bia", canais: ["nutri"] });
    expect(screen.getByTestId("chat")).toHaveTextContent("staff:nutri:aluno-2");
  });

  it("quem atende os dois canais troca de canal no próprio diálogo", () => {
    montar({ alunoId: "aluno-1", nome: "Ana Souza", canais: ["treino", "nutri"] });
    expect(screen.getByTestId("chat")).toHaveTextContent("staff:treino:aluno-1");
    fireEvent.click(screen.getByRole("button", { name: "Chat Nutrição" }));
    expect(screen.getByTestId("chat")).toHaveTextContent("staff:nutri:aluno-1");
    expect(screen.getByRole("button", { name: "Chat Nutrição" })).toHaveAttribute("aria-pressed", "true");
  });

  it("fechado, não monta conversa nenhuma", () => {
    montar(null);
    expect(screen.queryByTestId("chat")).not.toBeInTheDocument();
  });
});
