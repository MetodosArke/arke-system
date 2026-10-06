import { describe, expect, it } from "vitest";
import * as espelho from "../../supabase/functions/_shared/nascimento";
import { erroDadosResponsavel as erroDadosNaFuncao, gerarTokenResponsavel, hashDoTokenResponsavel } from "../../supabase/functions/_shared/responsavel";
import { emailResponsavel } from "../../supabase/functions/responsavel-pedido/email";
import {
  erroDadosResponsavel,
  erroDataNascimento,
  idadeEm,
  lerDataDaPlanilha,
  liberacaoConsentimento,
  propositosParaPedir,
  situacaoIdade,
} from "./menorDeIdade";

const HOJE = "2026-10-06";

describe("idade", () => {
  it("conta a idade completa, com o aniversário do ano", () => {
    expect(idadeEm("2008-10-06", HOJE)).toBe(18);
    expect(idadeEm("2008-10-07", HOJE)).toBe(17);
    expect(idadeEm("2008-11-01", HOJE)).toBe(17);
    expect(idadeEm("1990-01-01", HOJE)).toBe(36);
  });

  it("quem nasceu em 29/02 faz 18 em 01/03 nos anos comuns (CC art. 132, § 3º)", () => {
    expect(idadeEm("2008-02-29", "2026-02-28")).toBe(17);
    expect(idadeEm("2008-02-29", "2026-03-01")).toBe(18);
    expect(idadeEm("2008-02-29", "2028-02-29")).toBe(20);
  });

  it("data que não existe não tem idade", () => {
    expect(idadeEm("2008-02-30", HOJE)).toBeNull();
    expect(idadeEm("2007-02-29", HOJE)).toBeNull();
    expect(idadeEm("06/10/2008", HOJE)).toBeNull();
  });

  it("menor, adulto ou desconhecida: sem data é desconhecida", () => {
    expect(situacaoIdade("2008-10-06", HOJE)).toBe("adulto");
    expect(situacaoIdade("2008-10-07", HOJE)).toBe("menor");
    expect(situacaoIdade(null, HOJE)).toBe("desconhecida");
    expect(situacaoIdade("", HOJE)).toBe("desconhecida");
    expect(situacaoIdade("lixo", HOJE)).toBe("desconhecida");
  });
});

describe("a trava, do lado da tela", () => {
  it("adulto segue; desconhecida pede a data; menor pede o responsável até o aceite vigente", () => {
    expect(liberacaoConsentimento("adulto", false)).toBe("livre");
    expect(liberacaoConsentimento("desconhecida", true)).toBe("informar_data");
    expect(liberacaoConsentimento("menor", false)).toBe("pedir_responsavel");
    expect(liberacaoConsentimento("menor", true)).toBe("livre");
  });

  it("pede ao responsável só o que existe para o aluno", () => {
    expect(propositosParaPedir({ noMetodo: true, temCatraca: true })).toEqual(["saude", "biometria", "ia_anamnese", "ia_chat"]);
    expect(propositosParaPedir({ noMetodo: true, temCatraca: false })).toEqual(["saude", "ia_anamnese", "ia_chat"]);
    expect(propositosParaPedir({ noMetodo: false, temCatraca: true })).toEqual(["biometria"]);
    expect(propositosParaPedir({ noMetodo: false, temCatraca: false })).toEqual([]);
  });
});

describe("data de nascimento", () => {
  const casos: [string | null, string | null][] = [
    ["2008-05-10", null],
    [null, "Informe a data de nascimento."],
    ["", "Informe a data de nascimento."],
    ["2008-13-01", "Data de nascimento inválida: confira o dia, o mês e o ano."],
    ["2007-02-29", "Data de nascimento inválida: confira o dia, o mês e o ano."],
    ["10/05/2008", "Data de nascimento inválida: confira o dia, o mês e o ano."],
    ["2026-10-07", "A data de nascimento não pode ser no futuro."],
    ["1899-12-31", "Data de nascimento inválida: confira o ano."],
    [HOJE, null],
  ];

  it.each(casos)("%s → %s", (valor, erro) => {
    expect(erroDataNascimento(valor, HOJE)).toBe(erro);
  });

  it("a edge function confere igual (espelho em _shared/nascimento.ts)", () => {
    for (const [valor] of casos) expect(espelho.erroDataNascimento(valor, HOJE)).toBe(erroDataNascimento(valor, HOJE));
    for (const n of ["2008-02-29", "2008-10-06", "2008-10-07", "1990-01-01", "2008-02-30"]) {
      for (const h of [HOJE, "2026-02-28", "2026-03-01"]) expect(espelho.idadeEm(n, h)).toBe(idadeEm(n, h));
    }
  });

  it("lê a data da planilha nos formatos dos sistemas, e o ilegível vira desconhecida", () => {
    expect(lerDataDaPlanilha("10/05/2008", HOJE)).toBe("2008-05-10");
    expect(lerDataDaPlanilha("1/5/2008", HOJE)).toBe("2008-05-01");
    expect(lerDataDaPlanilha("10-05-2008", HOJE)).toBe("2008-05-10");
    expect(lerDataDaPlanilha("2008-05-10", HOJE)).toBe("2008-05-10");
    expect(lerDataDaPlanilha("2008-05-10T00:00:00", HOJE)).toBe("2008-05-10");
    expect(lerDataDaPlanilha("39578", HOJE)).toBe("2008-05-10");
    expect(lerDataDaPlanilha("31/02/2008", HOJE)).toBeNull();
    expect(lerDataDaPlanilha("10/05/2030", HOJE)).toBeNull();
    expect(lerDataDaPlanilha("maio de 2008", HOJE)).toBeNull();
    expect(lerDataDaPlanilha("", HOJE)).toBeNull();
  });
});

describe("dados do responsável", () => {
  it("nome completo e e-mail que não é o do aluno", () => {
    expect(erroDadosResponsavel({ nome: "Maria Souza", email: "maria@exemplo.com" })).toBeNull();
    expect(erroDadosResponsavel({ nome: "Maria", email: "maria@exemplo.com" })).toBe("Informe o nome completo do responsável.");
    expect(erroDadosResponsavel({ nome: "Maria Souza", email: "maria@" })).toBe("E-mail do responsável inválido.");
    expect(erroDadosResponsavel({ nome: "Maria Souza", email: "Ana@Exemplo.com", emailDoAluno: "ana@exemplo.com" })).toBe(
      "O e-mail precisa ser o do responsável, e não o seu."
    );
  });

  it("a função confere as mesmas regras de nome e e-mail", () => {
    expect(erroDadosNaFuncao("Maria Souza", "maria@exemplo.com")).toBeNull();
    expect(erroDadosNaFuncao("Maria", "maria@exemplo.com")).toBe("Informe o nome completo do responsável.");
    expect(erroDadosNaFuncao("Maria Souza", 42)).toBe("E-mail do responsável inválido.");
  });
});

describe("o link ao responsável", () => {
  it("o token tem 256 bits e não se repete; o hash é o SHA-256 em hexadecimal", async () => {
    const a = gerarTokenResponsavel();
    const b = gerarTokenResponsavel();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    const h = await hashDoTokenResponsavel(a);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashDoTokenResponsavel(a)).toBe(h);
    expect(await hashDoTokenResponsavel("curto")).toBeNull();
    expect(await hashDoTokenResponsavel(null)).toBeNull();
  });

  it("o e-mail leva o primeiro nome do aluno, a academia, os itens e o link — e não vira HTML", () => {
    const e = emailResponsavel({
      responsavelNome: "Maria Souza",
      alunoPrimeiroNome: "Ana",
      academia: "Studio <Vida>",
      propositos: ["biometria", "ia_chat"],
      link: "https://app.arkefit.com.br/#/responsavel/abc",
      validoAte: "13/10/2026",
      pedidoPela: "aluno",
    });
    expect(e.assunto).toBe("Autorização para Ana na Studio <Vida>");
    expect(e.texto).toContain("Olá, Maria.");
    expect(e.texto).toContain("Ana informou você como responsável legal");
    expect(e.texto).toContain("- Digital e rosto na catraca");
    expect(e.texto).toContain("- Inteligência artificial no apoio às respostas do mentor");
    expect(e.texto).toContain("O link vale até 13/10/2026.");
    expect(e.texto).toContain("Ler e decidir: https://app.arkefit.com.br/#/responsavel/abc");
    expect(e.html).toContain("Studio &lt;Vida&gt;");
    expect(e.html).not.toContain("<Vida>");
  });

  it("pedido pela academia diz que foi a academia", () => {
    const e = emailResponsavel({
      responsavelNome: "Maria Souza",
      alunoPrimeiroNome: "Ana",
      academia: "Studio Vida",
      propositos: ["biometria"],
      link: "https://app.arkefit.com.br/#/responsavel/abc",
      validoAte: "13/10/2026",
      pedidoPela: "academia",
    });
    expect(e.texto).toContain("A Studio Vida informou você como responsável legal de Ana");
  });
});
