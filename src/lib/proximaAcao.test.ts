import { describe, it, expect } from "vitest";
import { definirProximaAcao, type EstadoAluno } from "./proximaAcao";

const BASE: EstadoAluno = {
  temTreinoAtivo: true,
  treinoDeHojeConcluido: false,
  respondeuCheckinHoje: false,
  aguaMl: 0,
  metaAguaMl: 2000,
  tituloTreino: "Treino A — Superiores",
};

describe("definirProximaAcao", () => {
  // Regressão real: a home chamava esta função antes das consultas
  // responderem, `undefined` virava `false` num `Boolean()`, e todo aluno
  // lia "Sua ficha está sendo preparada" a cada carregamento — inclusive
  // quem treinava há meses. Os dois testes abaixo existem para que
  // "ainda não sei" nunca mais seja confundido com "não tem".
  it("devolve estado de carregando enquanto não sabe se há treino", () => {
    const acao = definirProximaAcao({ ...BASE, temTreinoAtivo: undefined });
    expect(acao.chave).toBe("carregando");
    expect(acao.acao).toBeUndefined();
  });

  it("não confunde desconhecido com ausência de ficha", () => {
    const desconhecido = definirProximaAcao({ ...BASE, temTreinoAtivo: undefined });
    const semFicha = definirProximaAcao({ ...BASE, temTreinoAtivo: false });
    expect(desconhecido.chave).not.toBe(semFicha.chave);
    // Nada de conselho inventado enquanto a resposta não chegou.
    expect(desconhecido.titulo).toBe("");
  });

  it("diz que a ficha está sendo preparada quando não há treino publicado", () => {
    const acao = definirProximaAcao({ ...BASE, temTreinoAtivo: false });
    expect(acao.chave).toBe("aguardando_ficha");
    // Sem botão: a bola está com a academia, não com o aluno.
    expect(acao.acao).toBeUndefined();
    expect(acao.destino).toBeUndefined();
  });

  it("manda para o treino quando ele ainda não foi registrado hoje", () => {
    const acao = definirProximaAcao(BASE);
    expect(acao.chave).toBe("treinar_hoje");
    expect(acao.destino).toBe("/app/treinos");
    expect(acao.descricao).toContain("Treino A — Superiores");
  });

  it("cai para o check-in depois do treino concluído", () => {
    const acao = definirProximaAcao({ ...BASE, treinoDeHojeConcluido: true });
    expect(acao.chave).toBe("check_in");
    expect(acao.ancora).toBe("check-in-do-dia");
    expect(acao.titulo).toBe("Como está sendo seguir seu plano?");
  });

  it("sugere água quando treino e check-in já foram feitos", () => {
    const acao = definirProximaAcao({
      ...BASE,
      treinoDeHojeConcluido: true,
      respondeuCheckinHoje: true,
      aguaMl: 500,
    });
    expect(acao.chave).toBe("hidratacao");
    expect(acao.ancora).toBe("diario-agua");
    expect(acao.descricao).toContain("1,5 L");
  });

  it("reconhece o dia em dia em vez de inventar pendência", () => {
    const acao = definirProximaAcao({
      ...BASE,
      treinoDeHojeConcluido: true,
      respondeuCheckinHoje: true,
      aguaMl: 2000,
    });
    expect(acao.chave).toBe("em_dia");
    expect(acao.acao).toBeUndefined();
  });

  it("não cobra água quando não há meta definida", () => {
    const acao = definirProximaAcao({
      ...BASE,
      treinoDeHojeConcluido: true,
      respondeuCheckinHoje: true,
      aguaMl: 0,
      metaAguaMl: 0,
    });
    expect(acao.chave).toBe("em_dia");
  });

  it("não trata o treino não registrado como falha do aluno", () => {
    const acao = definirProximaAcao(BASE);
    const texto = `${acao.titulo} ${acao.descricao}`.toLowerCase();
    for (const punicao of ["falhou", "perdeu", "atrasado", "faltou", "pendência"]) {
      expect(texto).not.toContain(punicao);
    }
  });
});
