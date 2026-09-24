import { describe, it, expect } from "vitest";
import * as catalogo from "../../supabase/functions/_shared/vigiaAnalise";
import { ROTULO_CAUSA, ROTULO_CLASSE, ROTULO_FERRAMENTA, ROTULO_RECUSA, desfechoOcorrencia, periodoSombra, type OcorrenciaVigia } from "./vigia";

describe("rótulos da tela espelham o catálogo do Vigia", () => {
  it("cada ferramenta do catálogo tem o mesmo nome na tela", () => {
    expect(ROTULO_FERRAMENTA).toEqual(
      Object.fromEntries(Object.entries(catalogo.FERRAMENTAS).map(([k, f]) => [k, f.rotulo])),
    );
  });

  it("causas, classes e recusas também", () => {
    expect(ROTULO_CAUSA).toEqual(catalogo.ROTULO_CAUSA);
    expect(ROTULO_CLASSE).toEqual(catalogo.ROTULO_CLASSE);
    expect(ROTULO_RECUSA).toEqual(catalogo.ROTULO_RECUSA);
  });
});

const ocorrencia = (extra: Partial<OcorrenciaVigia>): OcorrenciaVigia => ({
  id: 1,
  regra: "gateway_sincronizacao_atrasada",
  nivel: 1,
  titulo: "Gateway com a lista de alunos atrasada",
  descricao: "Recepção (Tietê): lista sincronizada há 30 min",
  aberta_em: "2026-09-24T12:00:00Z",
  fechada_em: null,
  acao_prevista_em: null,
  tentativas_previstas: 0,
  escalaria_em: null,
  freio_em: null,
  ...extra,
});

describe("desfecho de uma ocorrência", () => {
  it("diz o que teria acontecido", () => {
    expect(desfechoOcorrencia(ocorrencia({})).texto).toBe("aguardando a hora de agir");
    expect(desfechoOcorrencia(ocorrencia({ fechada_em: "x" })).texto).toBe("sumiu antes da hora de agir");
    expect(desfechoOcorrencia(ocorrencia({ acao_prevista_em: "x", tentativas_previstas: 1 })).texto).toBe("teria agido");
    expect(desfechoOcorrencia(ocorrencia({ acao_prevista_em: "x", tentativas_previstas: 3 })).texto).toBe("teria agido (3 tentativas)");
    expect(desfechoOcorrencia(ocorrencia({ acao_prevista_em: "x", fechada_em: "y", tentativas_previstas: 1 })).texto).toBe(
      "teria agido, e resolveu",
    );
    expect(desfechoOcorrencia(ocorrencia({ nivel: 2, acao_prevista_em: "x" })).texto).toBe("teria pedido aprovação");
    expect(desfechoOcorrencia(ocorrencia({ acao_prevista_em: "x", tentativas_previstas: 3, escalaria_em: "z" })).texto).toBe(
      "iria para uma pessoa",
    );
    expect(desfechoOcorrencia(ocorrencia({ freio_em: "x" })).texto).toBe("segurada pelo freio de falha geral");
  });

  it("período do modo sombra", () => {
    expect(periodoSombra({ dia: 3, dias_avaliacao: 14 })).toBe("Dia 3 de 14 da avaliação");
    expect(periodoSombra({ dia: 15, dias_avaliacao: 14 })).toBe("Avaliação de 14 dias concluída — aguardando a decisão");
  });
});
