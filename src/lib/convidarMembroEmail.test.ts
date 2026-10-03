import { describe, expect, it } from "vitest";
import { emailMatriculaNova } from "../../supabase/functions/convidar-membro/email";

describe("o aviso de matrícula a quem já tinha conta", () => {
  const base = { nome: "Carla Souza", academia: "Studio <Vida>", link: "https://app.arkefit.com.br/#/p/studio-vida/entrar" };

  it("quem já entra recebe o link de entrar na academia", () => {
    const e = emailMatriculaNova({ ...base, criarSenha: false });
    expect(e.assunto).toBe("Sua matrícula na Studio <Vida> está no app");
    expect(e.texto).toContain("Olá, Carla.");
    expect(e.texto).toContain("mesmo e-mail e a senha que você já usa");
    expect(e.texto).toContain("Entrar no app: https://app.arkefit.com.br/#/p/studio-vida/entrar");
    expect(e.texto).toContain("Se você não reconhece esta matrícula");
  });

  it("quem nunca criou a senha recebe o botão de criar", () => {
    const e = emailMatriculaNova({ ...base, criarSenha: true });
    expect(e.texto).toContain("Criar minha senha:");
    expect(e.texto).not.toContain("senha que você já usa");
  });

  it("o nome da academia não vira HTML", () => {
    const e = emailMatriculaNova({ ...base, criarSenha: false });
    expect(e.html).toContain("Studio &lt;Vida&gt;");
    expect(e.html).not.toContain("<Vida>");
  });
});
