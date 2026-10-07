import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { textoDaRecuperacao, varianteDaRecuperacao } from "../../supabase/functions/send-email/recuperacao";

// O e-mail de recuperação do Auth serve ao "Esqueceu a senha?" e, desde
// 07/10/2026, ao link de criar a senha da matrícula pública (a conta nasce sem
// senha). Quem recebe sem ter pedido, porque alguém usou o e-mail dele, precisa
// ler que pode ignorar e que ninguém entra sem o link.
describe("o texto do e-mail de recuperação", () => {
  it("a matrícula pública que ainda não confirmou recebe o texto de criar a senha", () => {
    expect(varianteDaRecuperacao({ app_metadata: { provider: "email", origem: "matricula_publica" } })).toBe("matricula");
    expect(varianteDaRecuperacao({ app_metadata: { origem: "matricula_publica" }, email_confirmed_at: null })).toBe("matricula");
  });

  it("qualquer outra conta recebe o texto de sempre", () => {
    // A da matrícula que já confirmou e esqueceu a senha.
    expect(varianteDaRecuperacao({ app_metadata: { origem: "matricula_publica" }, email_confirmed_at: "2026-10-07T10:00:00Z" })).toBe(
      "redefinir",
    );
    // A da importação ou do convite, que também chega sem senha ao primeiro acesso.
    expect(varianteDaRecuperacao({ app_metadata: { provider: "email" } })).toBe("redefinir");
    expect(varianteDaRecuperacao({ app_metadata: null })).toBe("redefinir");
    expect(varianteDaRecuperacao({})).toBe("redefinir");
  });

  it("o texto da matrícula diz o que fazer e o que acontece se não foi a pessoa", () => {
    const t = textoDaRecuperacao("matricula", "app da Tietê Fitness");
    expect(t.assunto).toBe("Crie a sua senha do app da Tietê Fitness");
    expect(t.corpo).toContain("Recebemos uma matrícula no app da Tietê Fitness com este e-mail.");
    expect(t.botao).toBe("Criar minha senha");
    expect(t.rodape).toMatch(/^Se não foi você, ignore este e-mail: sem o link, ninguém entra na conta/);
    // Os mesmos 7 dias da rotina que apaga a matrícula sem confirmação.
    expect(t.rodape).toContain("depois de 7 dias");
  });

  it("o texto de sempre não mudou", () => {
    expect(textoDaRecuperacao("redefinir", "ArkeFit")).toEqual({
      assunto: "Redefinir sua senha do ArkeFit",
      titulo: "Redefinir sua senha",
      corpo: "Recebemos uma solicitação para redefinir sua senha no ArkeFit. Clique no botão abaixo para escolher uma nova senha.",
      botao: "Redefinir senha",
      rodape: "Se você não solicitou a redefinição, pode ignorar este e-mail. Sua senha permanecerá a mesma.",
    });
  });

  it("o modelo e o hook usam o texto escolhido, sem frase fixa", () => {
    const raiz = join(__dirname, "..", "..", "supabase", "functions", "send-email");
    const modelo = readFileSync(join(raiz, "_templates", "recovery.tsx"), "utf8");
    expect(modelo).not.toMatch(/Redefinir sua senha|Sua senha permanecerá/);
    for (const campo of ["titulo", "corpo", "botao", "rodape", "assunto"]) expect(modelo).toContain(`texto.${campo}`);
    const hook = readFileSync(join(raiz, "index.ts"), "utf8");
    expect(hook).toMatch(/const texto = textoDaRecuperacao\(varianteDaRecuperacao\(user\), siteName\)/);
    expect(hook).toMatch(/subject = texto\.assunto/);
  });
});
