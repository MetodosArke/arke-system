import { describe, it, expect } from "vitest";
import { emailDoLead, validarLead } from "../../supabase/functions/lead-site/validar";

const base = { nome: "Carla Mendes", academia: "Academia Horizonte", email: "Carla@Exemplo.com", telefone: "(11) 98888-7777" };

describe("formulário da página de vendas", () => {
  it("aceita o mínimo e normaliza e-mail, telefone e UF", () => {
    const r = validarLead({ ...base, uf: "sp", cidade: "  São   Paulo " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lead.email).toBe("carla@exemplo.com");
      expect(r.lead.telefone).toBe("11988887777");
      expect(r.lead.uf).toBe("SP");
      expect(r.lead.cidade).toBe("São Paulo");
    }
  });

  it("recusa o que falta ou está errado, com mensagem para quem digitou", () => {
    expect(validarLead({ ...base, nome: "" })).toEqual({ ok: false, erro: "Informe o seu nome." });
    expect(validarLead({ ...base, email: "sem-arroba" })).toEqual({ ok: false, erro: "Confira o e-mail." });
    expect(validarLead({ ...base, telefone: "9999" })).toEqual({ ok: false, erro: "Informe o WhatsApp com DDD." });
    expect(validarLead({ ...base, alunos_faixa: "muitos" })).toEqual({ ok: false, erro: "Escolha a faixa de alunos." });
  });

  it("o e-mail do comercial escapa o que veio do formulário", () => {
    const r = validarLead({ ...base, mensagem: "<script>alert(1)</script>" });
    if (!r.ok) throw new Error("erro" in r ? r.erro : "inválido");
    const { html, assunto } = emailDoLead(r.lead, "https://www.arkefit.com.br/#/superadmin/contatos");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(assunto).toBe("Contato pelo site: Academia Horizonte");
  });
});
