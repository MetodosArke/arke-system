import { describe, expect, it } from "vitest";
import {
  ACESSOS_ARKEFIT,
  NIVEIS,
  NIVEIS_ABERTOS,
  NIVEIS_DA_AREA,
  PAPEIS_ARKEFIT,
  acessoDosPapeis,
  acessoPorId,
  estadoDaConta,
  lerNiveis,
  nomeDoAcessoDaPessoa,
  nomeDosNiveis,
  podeAbrirNaVisaoMaster,
  podeArea,
  rotaInicial,
  temAcessoArkefit,
  type AreaArkefit,
} from "./acessosArkefit";
import { resolveHomePath } from "./authRouting";
import {
  ACESSOS_ARKEFIT as ACESSOS_DA_FUNCAO,
  JA_TEM_CONTA,
  NIVEIS as NIVEIS_DA_FUNCAO,
  avisoAosSocios,
  emailDeNovoConvite,
  lerPedido,
  nomeDoAcesso,
} from "../../supabase/functions/equipe-arkefit-convidar/fluxo";

/**
 * Os níveis de acesso da equipe da ArkeFit moram num lugar só, com o espelho
 * que a função do convite lê (08/10/2026). Nível novo é uma entrada a mais nos
 * dois; este teste falha se um mudar sem o outro.
 */
describe("os níveis de acesso da equipe da ArkeFit", () => {
  it("o espelho da função tem os mesmos níveis, com os mesmos papéis", () => {
    const daTela = ACESSOS_ARKEFIT.map(({ id, nome, papeis }) => ({ id, nome, papeis: [...papeis] }));
    const daFuncao = ACESSOS_DA_FUNCAO.map(({ id, nome, papeis }) => ({ id, nome, papeis: [...papeis] }));
    expect(daFuncao).toEqual(daTela);
  });

  it("hoje há só o Sócio, com os dois papéis das contas de hoje", () => {
    expect(ACESSOS_ARKEFIT.map((a) => a.id)).toEqual(["socio"]);
    expect([...acessoPorId("socio")!.papeis].sort()).toEqual(["admin_arke", "superadmin"]);
    expect([...PAPEIS_ARKEFIT].sort()).toEqual(["admin_arke", "superadmin"]);
  });

  it("os ids não se repetem e todo nível tem descrição", () => {
    expect(new Set(ACESSOS_ARKEFIT.map((a) => a.id)).size).toBe(ACESSOS_ARKEFIT.length);
    for (const a of ACESSOS_ARKEFIT) expect(a.descricao.length, a.id).toBeGreaterThan(20);
  });

  it("o nível de uma conta sai dos papéis dela, em qualquer ordem", () => {
    expect(acessoDosPapeis(["superadmin", "admin_arke"])?.id).toBe("socio");
    expect(acessoDosPapeis(["admin_arke", "superadmin", "admin_arke"])?.id).toBe("socio");
    expect(acessoDosPapeis(["admin_arke"])).toBeNull();
    expect(acessoDosPapeis([])).toBeNull();
    expect(nomeDoAcesso(["admin_arke", "superadmin"])).toBe("Sócio");
    expect(nomeDoAcesso(["admin_arke"])).toBe("admin_arke");
    // A equipe contratada: sem papel, pelos níveis.
    expect(nomeDoAcesso([], ["suporte", "mentor"])).toBe("Suporte e Mentor");
    expect(nomeDoAcesso(["admin_arke", "superadmin"], ["mentor"])).toBe("Sócio");
  });
});

describe("os níveis da equipe contratada", () => {
  it("o espelho da função tem os mesmos níveis, com os mesmos nomes e o mesmo 'aberto'", () => {
    expect(NIVEIS_DA_FUNCAO.map(({ id, nome, aberto }) => ({ id, nome, aberto }))).toEqual(
      NIVEIS.map(({ id, nome, aberto }) => ({ id, nome, aberto })),
    );
  });

  it("com a entrega 2, os quatro níveis estão no ar", () => {
    expect([...NIVEIS_ABERTOS].sort()).toEqual(["comercial", "financeiro", "mentor", "suporte"]);
    expect(NIVEIS.filter((n) => !n.aberto)).toEqual([]);
    for (const n of NIVEIS) {
      expect(n.descricao.length, n.id).toBeGreaterThan(20);
      expect(n.nunca.length, n.id).toBeGreaterThan(20);
    }
  });

  it("cada nível abre as áreas do mapa, e o Sócio abre todas", () => {
    const areas = Object.keys(NIVEIS_DA_AREA) as AreaArkefit[];
    const abre = (niveis: string[]) => areas.filter((a) => podeArea({ socio: false, niveis }, a)).sort();
    expect(abre(["suporte"])).toEqual(["carteira", "operacao", "suporte"]);
    expect(abre(["mentor"])).toEqual(["mentoria"]);
    expect(abre(["comercial"])).toEqual(["cadastro", "carteira", "comercial"]);
    expect(abre(["financeiro"])).toEqual(["carteira", "financeiro"]);
    expect(abre(["mentor", "suporte"])).toEqual(["carteira", "mentoria", "operacao", "suporte"]);
    expect(abre([])).toEqual([]);
    expect(abre(["superadmin"])).toEqual([]);
    expect(areas.every((a) => podeArea({ socio: true, niveis: [] }, a))).toBe(true);
    // Ninguém além do Sócio abre a área do Sócio.
    expect(NIVEIS_DA_AREA.socio).toEqual([]);
  });

  it("lê os níveis do banco sem repetir, na ordem da lista, e sem o desconhecido", () => {
    expect(lerNiveis(["mentor", "suporte", "mentor", "dono"])).toEqual(["suporte", "mentor"]);
    expect(lerNiveis(null)).toEqual([]);
    expect(lerNiveis("mentor")).toEqual([]);
    expect(nomeDosNiveis(["financeiro", "suporte", "mentor"])).toBe("Suporte, Mentor e Financeiro");
    expect(nomeDosNiveis([])).toBe("");
  });

  it("entra na Visão Master o Sócio, ou quem tem nível; o nome no cabeçalho diz qual", () => {
    expect(temAcessoArkefit({ socio: true, niveis: [] })).toBe(true);
    expect(temAcessoArkefit({ socio: false, niveis: ["mentor"] })).toBe(true);
    expect(temAcessoArkefit({ socio: false, niveis: [] })).toBe(false);
    expect(temAcessoArkefit({ socio: false, niveis: ["gestor"] })).toBe(false);
    expect(nomeDoAcessoDaPessoa({ socio: true, niveis: [] })).toBe("Sócio");
    expect(nomeDoAcessoDaPessoa({ socio: false, niveis: ["suporte"] })).toBe("Suporte");
  });
});

describe("as rotas da Visão Master por nível", () => {
  const mentor = { socio: false, niveis: ["mentor"] };
  const suporte = { socio: false, niveis: ["suporte"] };
  const socio = { socio: true, niveis: [] };
  const ninguem = { socio: false, niveis: [] };

  it("o Mentor abre a Mentoria e a ficha do aluno, e não a Visão Geral, a Equipe ou os Equipamentos", () => {
    expect(podeAbrirNaVisaoMaster("/superadmin/mentoria", mentor)).toBe(true);
    expect(podeAbrirNaVisaoMaster("/superadmin/mentoria/aluno/abc", mentor)).toBe(true);
    expect(podeAbrirNaVisaoMaster("/superadmin/ajuda/vm-mentoria", mentor)).toBe(true);
    for (const r of ["/superadmin", "/superadmin/equipe", "/superadmin/equipamentos", "/superadmin/suporte", "/superadmin/configuracoes"]) {
      expect(podeAbrirNaVisaoMaster(r, mentor), r).toBe(false);
    }
  });

  it("o Suporte abre a Visão Geral, o Suporte, a Implantação, os Equipamentos, o Vigia e as rotinas; não a Mentoria nem a Equipe", () => {
    for (const r of ["/superadmin", "/superadmin/suporte", "/superadmin/implantacao", "/superadmin/equipamentos", "/superadmin/vigia", "/superadmin/webhooks", "/superadmin/profissionais"]) {
      expect(podeAbrirNaVisaoMaster(r, suporte), r).toBe(true);
    }
    for (const r of ["/superadmin/mentoria", "/superadmin/equipe", "/superadmin/auditoria", "/superadmin/comercial", "/superadmin/ia", "/superadmin/acervo"]) {
      expect(podeAbrirNaVisaoMaster(r, suporte), r).toBe(false);
    }
  });

  it("rota fora da tabela não abre (falha fechada), nem para o Sócio; quem não tem acesso não abre nada", () => {
    expect(podeAbrirNaVisaoMaster("/superadmin/nova-tela", socio)).toBe(false);
    expect(podeAbrirNaVisaoMaster("/superadmin/ajuda", ninguem)).toBe(false);
    expect(podeAbrirNaVisaoMaster("/superadmin/equipe", socio)).toBe(true);
  });

  it("a rota inicial: o Mentor vai para a Mentoria; o Suporte e o Sócio, para a Visão Geral", () => {
    expect(rotaInicial(mentor)).toBe("/superadmin/mentoria");
    expect(rotaInicial(suporte)).toBe("/superadmin");
    expect(rotaInicial(socio)).toBe("/superadmin");
    expect(rotaInicial({ socio: false, niveis: ["mentor", "suporte"] })).toBe("/superadmin");
  });

  it("depois do login: o Sócio e a equipe com nível vão à Visão Master; a gestão e o aluno, como antes", () => {
    expect(resolveHomePath(["superadmin", "admin_arke"], null)).toBe("/superadmin");
    expect(resolveHomePath([], null, null, ["mentor"])).toBe("/superadmin/mentoria");
    expect(resolveHomePath([], null, null, ["suporte"])).toBe("/superadmin");
    expect(resolveHomePath([], "gestor", "academia", [])).toBe("/admin/dashboard");
    expect(resolveHomePath([], "aluno", "academia")).toBe("/app");
    // Nível desconhecido não é acesso.
    expect(resolveHomePath([], "aluno", "academia", ["dono"])).toBe("/app");
  });
});

describe("o acesso e o estado da conta", () => {
  it("acesso que não está na lista é recusado", () => {
    expect(acessoPorId("admin")).toBeNull();
    expect(acessoPorId(undefined)).toBeNull();
    expect(estadoDaConta("ativo")).toBe("ativo");
    expect(estadoDaConta("outro")).toBeNull();
  });
});

describe("o pedido do convite", () => {
  it("convite: nome, e-mail em minúsculas e o acesso da lista", () => {
    const r = lerPedido({ acao: "convidar", nome: "  Ana   Souza ", email: " Ana@Exemplo.COM ", acesso: "socio" });
    expect(r).toEqual({ ok: true, pedido: { acao: "convidar", nome: "Ana Souza", email: "ana@exemplo.com", acesso: ACESSOS_DA_FUNCAO[0] } });
  });

  it("recusa o acesso fora da lista, o e-mail inválido e o nome vazio", () => {
    expect(lerPedido({ nome: "Ana", email: "ana@exemplo.com", acesso: "superadmin" }).ok).toBe(false);
    expect(lerPedido({ nome: "Ana", email: "ana@", acesso: "socio" }).ok).toBe(false);
    expect(lerPedido({ nome: " ", email: "ana@exemplo.com", acesso: "socio" }).ok).toBe(false);
    expect(lerPedido(null).ok).toBe(false);
    expect(lerPedido({ acao: "apagar", user_id: "x" }).ok).toBe(false);
  });

  it("convite da equipe: os níveis abertos, sem repetir, e o registro só do Mentor", () => {
    const r = lerPedido({
      acao: "convidar",
      nome: "Bia",
      email: "bia@exemplo.com",
      niveis: ["mentor", "suporte", "mentor"],
      cref: " 012345-G/SP ",
      crn: "",
    });
    expect(r).toEqual({
      ok: true,
      pedido: { acao: "convidar", nome: "Bia", email: "bia@exemplo.com", niveis: ["mentor", "suporte"], cref: "012345-G/SP", crn: null },
    });
    const soSuporte = lerPedido({ nome: "Bia", email: "bia@exemplo.com", niveis: ["suporte"], cref: "012345-G/SP" });
    expect(soSuporte.ok && "niveis" in soSuporte.pedido && soSuporte.pedido.cref).toBe(null);
  });

  it("o convite da equipe aceita o Comercial e o Financeiro, sem o registro profissional", () => {
    expect(lerPedido({ nome: "Bia", email: "bia@exemplo.com", niveis: ["financeiro", "comercial"], cref: "012345-G/SP" })).toEqual({
      ok: true,
      pedido: { acao: "convidar", nome: "Bia", email: "bia@exemplo.com", niveis: ["financeiro", "comercial"], cref: null, crn: null },
    });
  });

  it("o convite da equipe recusa o desconhecido, a lista vazia, o registro inválido e os dois acessos juntos", () => {
    expect(lerPedido({ nome: "Bia", email: "bia@exemplo.com", niveis: ["superadmin"] }).ok).toBe(false);
    expect(lerPedido({ nome: "Bia", email: "bia@exemplo.com", niveis: [] }).ok).toBe(false);
    expect(lerPedido({ nome: "Bia", email: "bia@exemplo.com", niveis: "mentor" }).ok).toBe(false);
    expect(lerPedido({ nome: "Bia", email: "bia@exemplo.com", niveis: ["mentor"], cref: "12" }).ok).toBe(false);
    expect(lerPedido({ nome: "Bia", email: "bia@exemplo.com", niveis: ["mentor"], crn: "x".repeat(31) }).ok).toBe(false);
    expect(lerPedido({ nome: "Bia", email: "bia@exemplo.com", niveis: ["mentor"], acesso: "socio" }).ok).toBe(false);
  });

  it("reenviar e retirar pedem o id da conta", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(lerPedido({ acao: "reenviar", user_id: id })).toEqual({ ok: true, pedido: { acao: "reenviar", userId: id } });
    expect(lerPedido({ acao: "retirar", user_id: id.toUpperCase() })).toEqual({ ok: true, pedido: { acao: "retirar", userId: id } });
    expect(lerPedido({ acao: "retirar", user_id: "1 or 1=1" }).ok).toBe(false);
  });

  it("a recusa da conta que existe diz o que fazer", () => {
    expect(JA_TEM_CONTA).toMatch(/já tem conta/);
    expect(JA_TEM_CONTA).toMatch(/e-mail que ainda não tenha conta/);
  });
});

describe("os e-mails", () => {
  const base = { ator: "Bruno", pessoa: "Carla <b>", acesso: "Sócio", quando: "08/10/2026 10:00", painel: "https://app.arkefit.com.br/#/superadmin/equipe" };

  it("o aviso do convite diz quem, quem entrou, o acesso, a data e o que fazer", () => {
    const e = avisoAosSocios({ evento: "convidada", ...base });
    expect(e.texto).toContain("Bruno convidou Carla <b> para a equipe da ArkeFit, com o acesso Sócio, em 08/10/2026 10:00.");
    expect(e.texto).toMatch(/tire o acesso em Visão Master → Equipe ArkeFit/);
    expect(e.html).toContain("Carla &lt;b&gt;");
    expect(e.html).not.toContain("<b>");
    expect(e.html).toContain('href="https://app.arkefit.com.br/#/superadmin/equipe"');
  });

  it("o aviso da retirada diz quem tirou, de quem e as sessões encerradas", () => {
    const e = avisoAosSocios({ evento: "acesso_retirado", ...base });
    expect(e.assunto).toBe("ArkeFit: Carla <b> saiu da equipe");
    expect(e.texto).toMatch(/Bruno tirou o acesso de Carla <b> \(Sócio\)/);
    expect(e.texto).toMatch(/sessões abertas da pessoa foram encerradas/);
  });

  it("o convite de novo leva o link e avisa das duas etapas", () => {
    const e = emailDeNovoConvite({ nome: "Carla", ator: "Bruno", link: "https://exemplo/verify?token=1&type=recovery" });
    expect(e.texto).toContain("Criar minha senha: https://exemplo/verify?token=1&type=recovery");
    expect(e.html).toContain('href="https://exemplo/verify?token=1&amp;type=recovery"');
    expect(e.texto).toMatch(/verificação em duas etapas/);
  });
});
