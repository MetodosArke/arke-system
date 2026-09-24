import { describe, it, expect } from "vitest";
import * as catalogo from "../../supabase/functions/_shared/vigiaAnalise";
import {
  ROTULO_CAUSA,
  ROTULO_CLASSE,
  ROTULO_FERRAMENTA,
  ROTULO_RECUSA,
  desfechoOcorrencia,
  executando,
  modosDaRegra,
  periodoSombra,
  type OcorrenciaVigia,
} from "./vigia";

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
  modo: "sombra",
  decisao: null,
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

  it("executando: diz o que fez, e o nível 2 diz se foi aprovado", () => {
    expect(desfechoOcorrencia(ocorrencia({ modo: "automatica", acao_prevista_em: "x", tentativas_previstas: 1 })).texto).toBe("agiu");
    expect(desfechoOcorrencia(ocorrencia({ modo: "automatica", acao_prevista_em: "x", tentativas_previstas: 2, fechada_em: "y" })).texto).toBe(
      "agiu (2 tentativas), e resolveu",
    );
    expect(desfechoOcorrencia(ocorrencia({ modo: "automatica", acao_prevista_em: "x", tentativas_previstas: 3, escalaria_em: "z" })).texto).toBe(
      "foi para uma pessoa",
    );
    const n2 = { nivel: 2, modo: "aprovacao" as const, acao_prevista_em: "x" };
    expect(desfechoOcorrencia(ocorrencia(n2)).texto).toBe("aguardando aprovação");
    expect(desfechoOcorrencia(ocorrencia({ ...n2, decisao: "aprovada" })).texto).toBe("aprovada");
    expect(desfechoOcorrencia(ocorrencia({ ...n2, decisao: "dispensada" })).texto).toBe("dispensada");
    expect(desfechoOcorrencia(ocorrencia({ ...n2, fechada_em: "y" })).texto).toBe("resolveu antes da aprovação");
  });

  it("modos por nível: nível 1 nunca pede aprovação, nível 2 nunca age sozinho", () => {
    expect(modosDaRegra(1)).toEqual(["automatica", "sombra", "desligada"]);
    expect(modosDaRegra(2)).toEqual(["aprovacao", "sombra", "desligada"]);
    expect(executando([{ modo: "sombra" }, { modo: "desligada" }])).toBe(false);
    expect(executando([{ modo: "sombra" }, { modo: "automatica" }])).toBe(true);
  });

  it("período do modo sombra", () => {
    expect(periodoSombra({ dia: 3, dias_avaliacao: 14 })).toBe("Dia 3 de 14 da avaliação");
    expect(periodoSombra({ dia: 15, dias_avaliacao: 14 })).toBe("Avaliação de 14 dias concluída — aguardando a decisão");
  });
});
