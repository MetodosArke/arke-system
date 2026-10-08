import { describe, expect, it } from "vitest";
import { ACESSOS_ARKEFIT, PAPEIS_ARKEFIT, acessoDosPapeis, acessoPorId, estadoDaConta } from "./acessosArkefit";
import {
  ACESSOS_ARKEFIT as ACESSOS_DA_FUNCAO,
  JA_TEM_CONTA,
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
    expect(nomeDoAcesso(["admin_arke", "superadmin"])).toBe("Sócio");
    expect(nomeDoAcesso(["admin_arke"])).toBe("admin_arke");
  });

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
