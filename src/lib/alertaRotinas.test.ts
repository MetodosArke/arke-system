import { describe, it, expect } from "vitest";
import { montarEmail, type Item } from "../../supabase/functions/alertar-rotinas/email";

const PAINEL = "https://www.arkefit.com.br/#/superadmin";

describe("e-mail de alerta das rotinas", () => {
  it("problema novo: assunto conta as rotinas e o erro aparece", () => {
    const itens: Item[] = [
      { nome: "arke-sla-escalonamento", tipo: "novo", situacao: "falhou", ultima_execucao: "2026-09-21T13:00:00Z", ultimo_erro: "relation x does not exist" },
      { nome: "arke-snapshot-mrr", tipo: "lembrete", situacao: "atrasada", ultima_execucao: null, ultimo_erro: null },
    ];
    const { assunto, texto, html } = montarEmail(itens, PAINEL);
    expect(assunto).toBe("[ArkeFit] 2 rotina(s) com problema");
    expect(texto).toContain("arke-sla-escalonamento falhou na última execução");
    expect(texto).toContain("Erro: relation x does not exist");
    expect(texto).toContain("Ainda: arke-snapshot-mrr parou de rodar");
    expect(html).toContain(PAINEL);
  });

  it("só recuperação: assunto diz que voltou ao normal", () => {
    const { assunto, texto } = montarEmail(
      [{ nome: "arke-ativacao", tipo: "recuperou", situacao: "ok", ultima_execucao: "2026-09-21T14:00:00Z", ultimo_erro: null }],
      PAINEL
    );
    expect(assunto).toBe("[ArkeFit] 1 rotina(s) voltaram ao normal");
    expect(texto).toContain("Voltaram ao normal");
  });

  it("mensagem de erro do banco não vira HTML no e-mail", () => {
    const { html } = montarEmail(
      [{ nome: "x", tipo: "novo", situacao: "falhou", ultima_execucao: null, ultimo_erro: '<script>alert("x")</script>' }],
      PAINEL
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  describe("capacidade do banco", () => {
    const banco = (tipo: Item["tipo"], situacao: string, detalhe: string | null): Item => ({
      nome: "capacidade:banco", tipo, situacao, ultima_execucao: null, ultimo_erro: detalhe,
    });

    it("fala de banco, não de rotina: sem \"última execução\" nem \"Erro:\"", () => {
      const { assunto, texto, html } = montarEmail([banco("novo", "banco_85", "430,2 MB de 500 MB (86%)")], PAINEL);
      expect(assunto).toBe("[ArkeFit] banco de dados acima de 85% do limite");
      expect(texto).toContain("Banco de dados passou de 85% do limite");
      expect(texto).toContain("430,2 MB de 500 MB (86%)");
      expect(texto).not.toContain("última execução");
      expect(texto).not.toContain("Erro:");
      expect(texto).not.toContain("capacidade:banco");
      expect(html).not.toContain("As rotinas agendadas são");
    });

    it("rotina e banco no mesmo e-mail: o assunto conta os dois", () => {
      const { assunto, html } = montarEmail(
        [
          { nome: "arke-ativacao", tipo: "novo", situacao: "falhou", ultima_execucao: null, ultimo_erro: "x" },
          banco("lembrete", "banco_70", "360 MB de 500 MB (72%)"),
        ],
        PAINEL
      );
      expect(assunto).toBe("[ArkeFit] 1 rotina(s) com problema · banco de dados acima de 70% do limite");
      expect(html).toContain("<em>Ainda:</em> <strong>Banco de dados</strong>");
      expect(html).toContain("As rotinas agendadas são");
    });

    it("recuperação do banco tem assunto próprio", () => {
      const { assunto, texto } = montarEmail([banco("recuperou", "ok", "300 MB de 500 MB (60%)")], PAINEL);
      expect(assunto).toBe("[ArkeFit] banco de dados de volta abaixo de 70% do limite");
      expect(texto).toContain("Banco de dados voltou para abaixo de 70% do limite: 300 MB de 500 MB (60%)");
    });
  });
});
