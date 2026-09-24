import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GestaoControlId } from "../src/equipamentos/controlidGestao";
import { EquipamentoControlIdFalso } from "./helpers/equipamentoControlIdFalso";
import type { EquipamentoControlId } from "../src/types";

/**
 * Gestão remota da Control iD contra dois equipamentos falsos que falam a
 * API documentada. O que se prova aqui é a CONVERSA (o que pedimos, em que
 * ordem, o que chega ao resultado); o firmware de verdade é item de
 * bancada.
 */

function config(nome: string, porta: number, senha = "admin"): EquipamentoControlId {
  return { nome, ip: "127.0.0.1", porta, usuario: "admin", senha, sentido_entrada: "clockwise" };
}

describe("GestaoControlId", () => {
  let entrada: EquipamentoControlIdFalso;
  let saida: EquipamentoControlIdFalso;
  let gestao: GestaoControlId;

  beforeEach(async () => {
    entrada = new EquipamentoControlIdFalso("entrada");
    saida = new EquipamentoControlIdFalso("saida");
    await entrada.iniciar();
    await saida.iniciar();
    gestao = new GestaoControlId([config("Entrada", entrada.porta), config("Saída", saida.porta)], {
      timeoutCadastroMs: 500,
    });
  });

  afterEach(async () => {
    await entrada.parar();
    await saida.parar();
  });

  it("cria o aluno em todos os equipamentos com o mesmo número, e repetir só atualiza", async () => {
    const r = await gestao.criarUsuario(42, "Maria", "abc12345");
    expect(r.equipamentos).toEqual(["Entrada", "Saída"]);
    for (const eq of [entrada, saida]) {
      expect(eq.tabelas.users).toEqual([{ id: 42, name: "Maria", registration: "abc12345" }]);
    }

    await gestao.criarUsuario(42, "Maria Souza", "abc12345");
    expect(entrada.tabelas.users).toHaveLength(1);
    expect(entrada.tabelas.users[0].name).toBe("Maria Souza");
    expect(entrada.rotas()).toContain("/modify_objects.fcgi");
  });

  it("apaga digitais e cartões ANTES do usuário, em todos os equipamentos", async () => {
    await gestao.criarUsuario(7, "João", "x");
    await gestao.cadastrarDigital(7);
    await gestao.cadastrarCartao(7);
    expect(saida.tabelas.templates).toHaveLength(1);

    for (const eq of [entrada, saida]) eq.chamadas.length = 0;
    const r = await gestao.apagarUsuario(7);

    expect(r.equipamentos).toEqual(["Entrada", "Saída"]);
    for (const eq of [entrada, saida]) {
      expect(eq.tabelas.users).toHaveLength(0);
      expect(eq.tabelas.templates).toHaveLength(0);
      expect(eq.tabelas.cards).toHaveLength(0);
      const destruir = eq.chamadas.filter((c) => c.rota === "/destroy_objects.fcgi");
      expect(destruir.map((c) => c.corpo.object)).toEqual(["templates", "cards", "users"]);
    }
  });

  it("apagar quem já não existe no equipamento conta como feito", async () => {
    const r = await gestao.apagarUsuario(999);
    expect(r).toEqual({ equipamentos: ["Entrada", "Saída"], apagados: 0 });
  });

  it("cadastra a digital no equipamento escolhido e copia para os outros, sem devolver a imagem", async () => {
    await gestao.criarUsuario(42, "Maria", "m");
    const r = await gestao.cadastrarDigital(42, "Saída");

    expect(r).toEqual({ equipamento: "Saída", replicado_em: ["Entrada"], falhou_em: [] });
    expect(saida.rotas()).toContain("/remote_enroll.fcgi");
    expect(entrada.rotas()).not.toContain("/remote_enroll.fcgi");
    expect(entrada.tabelas.templates).toHaveLength(1);
    expect(entrada.tabelas.templates[0]).toMatchObject({ user_id: 42, template: "TEMPLATE-BASE64-DO-DEDO" });
    // A imagem da digital que o equipamento devolveu não chega ao resultado,
    // que é o que sobe para a nuvem.
    expect(JSON.stringify(r)).not.toContain("IMAGEM");
    expect(JSON.stringify(r)).not.toContain("TEMPLATE");
  });

  it("recadastrar a digital substitui a cópia nos outros equipamentos, sem acumular", async () => {
    await gestao.criarUsuario(42, "Maria", "m");
    await gestao.cadastrarDigital(42);
    entrada.tabelas.templates = [];
    await gestao.cadastrarDigital(42);
    expect(saida.tabelas.templates).toHaveLength(1);
  });

  it("cartão: cadastra, copia e devolve só a quantidade, não o número", async () => {
    entrada.cadastro.cartao = 123456789;
    await gestao.criarUsuario(5, "Ana", "a");
    const r = await gestao.cadastrarCartao(5);

    expect(r).toEqual({ equipamento: "Entrada", cartoes: 1, replicado_em: ["Saída"], falhou_em: [] });
    expect(saida.tabelas.cards[0]).toMatchObject({ user_id: 5, value: 123456789 });
    expect(JSON.stringify(r)).not.toContain("123456789");
  });

  it("falha na cópia para um equipamento não desfaz o cadastro, e a resposta diz onde faltou", async () => {
    await gestao.criarUsuario(5, "Ana", "a");
    saida.recusarCriacao = "memória cheia";
    const r = await gestao.cadastrarDigital(5);

    expect(r.equipamento).toBe("Entrada");
    expect(r.replicado_em).toEqual([]);
    expect(r.falhou_em).toEqual([{ equipamento: "Saída", erro: "Saída: memória cheia" }]);
    expect(entrada.tabelas.templates).toHaveLength(1);
  });

  it("aluno que não termina o cadastro a tempo: erro e cancelamento no equipamento", async () => {
    entrada.cadastro.demoraMs = 1_500;
    await expect(gestao.cadastrarDigital(42)).rejects.toThrow(/Entrada:/);
    expect(entrada.rotas()).toContain("/cancel_remote_enroll.fcgi");
  });

  it("cadastro recusado pelo equipamento sobe com a mensagem dele", async () => {
    entrada.cadastro.falhar = true;
    await expect(gestao.cadastrarDigital(42)).rejects.toThrow("Entrada: Enrollment canceled");
  });

  it("senha errada do equipamento vira mensagem clara, e testar() aponta qual", async () => {
    const errada = new GestaoControlId([config("Entrada", entrada.porta, "errada"), config("Saída", saida.porta)]);
    await expect(errada.criarUsuario(1, "x", "x")).rejects.toThrow("Entrada: Invalid login or password");
    expect(await errada.testar()).toEqual([
      { equipamento: "Entrada", ok: false, erro: "Entrada: Invalid login or password" },
      { equipamento: "Saída", ok: true },
    ]);
  });

  it("sessão vencida no equipamento (reiniciou) é renovada sem o chamador perceber", async () => {
    await gestao.criarUsuario(1, "x", "x");
    const logins = entrada.rotas().filter((r) => r === "/login.fcgi").length;
    entrada.expirarSessoes();
    await gestao.criarUsuario(2, "y", "y");
    expect(entrada.rotas().filter((r) => r === "/login.fcgi").length).toBe(logins + 1);
    expect(entrada.tabelas.users.map((u) => u.id)).toEqual([1, 2]);
  });

  it("liberação remota respeita o sentido de entrada da montagem", async () => {
    await gestao.liberarCatraca("entrada");
    await gestao.liberarCatraca("saida");
    await gestao.liberarCatraca("ambos", "Saída");
    const acoes = [...entrada.chamadas, ...saida.chamadas]
      .filter((c) => c.rota === "/execute_actions.fcgi")
      .map((c) => (c.corpo.actions as { parameters: string }[])[0].parameters);
    expect(acoes).toEqual(["allow=clockwise", "allow=anticlockwise", "allow=both"]);
  });

  it("equipamento que não está no config é recusado pelo nome", async () => {
    await expect(gestao.cadastrarDigital(1, "Academia vizinha")).rejects.toThrow(/não está configurado/);
  });
});
