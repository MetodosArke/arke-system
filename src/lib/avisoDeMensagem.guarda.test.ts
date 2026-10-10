import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O aviso de mensagem nova (10/10/2026): cada conversa avisa o outro lado no
 * celular, cada uma oferece ligar os avisos, e a conversa com o mentor não
 * manda o texto da mensagem ao aviso (é o canal da dor e do que o aluno não
 * contaria à academia; a tela bloqueada é pública).
 */
const ler = (...p: string[]) => readFileSync(join(__dirname, "..", "..", ...p), "utf8");

describe("aviso de mensagem nova", () => {
  const chatPanel = ler("src", "components", "chat", "ChatPanel.tsx");
  const chatMentor = ler("src", "components", "chat", "ChatMentor.tsx");
  const funcao = ler("supabase", "functions", "send-chat-push", "index.ts");

  it("as três conversas avisam o outro lado depois de gravar", () => {
    expect(chatPanel).toMatch(/from\("mensagens_treino"\)\.insert[\s\S]*?sendChatPush\(/);
    expect(chatPanel).toMatch(/from\("mensagens_dieta"\)\.insert[\s\S]*?sendChatPush\(/);
    expect(chatMentor).toMatch(/from\("mensagens_mentor"\)\.insert[\s\S]*?avisarConversaComMentor\(alunoId\)/);
  });

  it("a conversa com o mentor não manda texto ao aviso; o servidor usa o texto fixo", () => {
    expect(chatMentor).not.toMatch(/sendChatPush\(/);
    const ramo = funcao.slice(funcao.indexOf("async function avisarCanalMentor"), funcao.indexOf("servir("));
    expect(ramo).toContain("AVISO_DO_MENTOR");
    expect(ramo).not.toMatch(/\bbody\b|mensagem\b/);
    // A mensagem é lida com a sessão de quem chama (o RLS decide), não com a service role.
    expect(ramo).toMatch(/asUser\s*\.from\("mensagens_mentor"\)/);
  });

  it("cada conversa que aceita mensagem oferece ligar os avisos", () => {
    expect(chatPanel).toContain("{!somenteLeitura && <AtivarAvisosCelular />}");
    expect(chatMentor).toContain("<AtivarAvisosCelular />");
  });

  it("lida a mensagem, o cartão da home sai na hora", () => {
    expect(chatPanel).toMatch(/const invalidar = [\s\S]*?queryKey: \["aluno-mensagem-nova"\]/);
    expect(chatMentor).toMatch(/update\(\{ lida: true \}\)[\s\S]*?queryKey: \["aluno-mensagem-nova"\]/);
  });
});
