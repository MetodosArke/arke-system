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
