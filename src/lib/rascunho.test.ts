import { describe, it, expect, beforeEach } from "vitest";
import {
  chaveRascunho,
  gravarRascunho,
  lerRascunho,
  descartarRascunho,
  rascunhoExpirado,
  armazenamentoPadrao,
  descreverQuandoSalvou,
  type ArmazenamentoLocal,
} from "./rascunho";

function criarArmazenamentoFake(): ArmazenamentoLocal & { dados: Map<string, string>; falhar?: boolean } {
  const dados = new Map<string, string>();
  return {
    dados,
    getItem(chave) {
      if (this.falhar) throw new Error("armazenamento indisponível");
      return dados.get(chave) ?? null;
    },
    setItem(chave, valor) {
      if (this.falhar) throw new Error("cota cheia");
      dados.set(chave, valor);
    },
    removeItem(chave) {
      if (this.falhar) throw new Error("armazenamento indisponível");
      dados.delete(chave);
    },
  };
}

describe("chaveRascunho", () => {
  it("separa por escopo e por id, para rascunhos de alunos diferentes não se misturarem", () => {
    expect(chaveRascunho("avaliacao", "aluno-1")).not.toBe(chaveRascunho("avaliacao", "aluno-2"));
    expect(chaveRascunho("treino", "aluno-1")).not.toBe(chaveRascunho("avaliacao", "aluno-1"));
  });

  it("aceita escopo sem id", () => {
    expect(chaveRascunho("importacao")).toContain("importacao");
  });
});

describe("gravar e ler", () => {
  let store: ReturnType<typeof criarArmazenamentoFake>;

  beforeEach(() => {
    store = criarArmazenamentoFake();
  });

  it("devolve o que foi gravado", () => {
    gravarRascunho("k", { peso: "82", cintura: "91" }, store);
    expect(lerRascunho<{ peso: string }>("k", store)?.dados).toEqual({ peso: "82", cintura: "91" });
  });

  it("devolve null quando não há nada gravado", () => {
    expect(lerRascunho("inexistente", store)).toBeNull();
  });

  it("descarta JSON corrompido em vez de entregar dado pela metade", () => {
    store.dados.set("k", "{isso não é json");
    expect(lerRascunho("k", store)).toBeNull();
  });

  it("descarta envelope de outra versão, em vez de adivinhar o formato antigo", () => {
    store.dados.set("k", JSON.stringify({ v: 99, salvoEm: new Date().toISOString(), dados: { x: 1 } }));
    expect(lerRascunho("k", store)).toBeNull();
  });

  it("descarta conteúdo alheio que por acaso esteja na mesma chave", () => {
    store.dados.set("k", JSON.stringify({ qualquer: "coisa" }));
    expect(lerRascunho("k", store)).toBeNull();
  });

  it("descarta data inválida", () => {
    store.dados.set("k", JSON.stringify({ v: 1, salvoEm: "não é data", dados: { x: 1 } }));
    expect(lerRascunho("k", store)).toBeNull();
  });

  it("descartar remove de verdade", () => {
    gravarRascunho("k", { a: 1 }, store);
    descartarRascunho("k", store);
    expect(lerRascunho("k", store)).toBeNull();
  });
});

describe("armazenamento indisponível", () => {
  it("não estoura ao gravar — perder o autosave é ruim, derrubar o formulário é pior", () => {
    const store = criarArmazenamentoFake();
    store.falhar = true;
    expect(() => gravarRascunho("k", { a: 1 }, store)).not.toThrow();
    expect(gravarRascunho("k", { a: 1 }, store)).toBe(false);
  });

  it("não estoura ao ler nem ao descartar", () => {
    const store = criarArmazenamentoFake();
    store.falhar = true;
    expect(() => lerRascunho("k", store)).not.toThrow();
    expect(lerRascunho("k", store)).toBeNull();
    expect(() => descartarRascunho("k", store)).not.toThrow();
  });

  it("funciona com armazenamento ausente (SSR, modo privado)", () => {
    expect(gravarRascunho("k", { a: 1 }, null)).toBe(false);
    expect(lerRascunho("k", null)).toBeNull();
    expect(() => descartarRascunho("k", null)).not.toThrow();
  });
});

describe("rascunhoExpirado", () => {
  const agora = new Date("2026-09-20T12:00:00Z");

  it("considera válido o que é recente", () => {
    expect(rascunhoExpirado(new Date("2026-09-20T09:00:00Z"), 48, agora)).toBe(false);
  });

  it("expira o que é velho demais para ser da tarefa de agora", () => {
    // Oferecer restaurar algo de duas semanas atrás faz a pessoa aceitar
    // sem ler e descobrir o engano depois de salvar.
    expect(rascunhoExpirado(new Date("2026-09-05T12:00:00Z"), 48, agora)).toBe(true);
  });

  it("respeita a janela configurada", () => {
    const tresHorasAtras = new Date("2026-09-20T09:00:00Z");
    expect(rascunhoExpirado(tresHorasAtras, 2, agora)).toBe(true);
    expect(rascunhoExpirado(tresHorasAtras, 4, agora)).toBe(false);
  });
});

describe("descreverQuandoSalvou", () => {
  const agora = new Date("2026-09-20T12:00:00Z");

  it.each([
    ["2026-09-20T11:59:40Z", "salvo agora"],
    ["2026-09-20T11:59:00Z", "salvo há 1 minuto"],
    ["2026-09-20T11:40:00Z", "salvo há 20 minutos"],
    ["2026-09-20T11:00:00Z", "salvo há 1 hora"],
    ["2026-09-20T07:00:00Z", "salvo há 5 horas"],
    ["2026-09-19T10:00:00Z", "salvo ontem"],
    ["2026-09-17T10:00:00Z", "salvo há 3 dias"],
  ])("descreve %s como %s", (quando, esperado) => {
    expect(descreverQuandoSalvou(new Date(quando), agora)).toBe(esperado);
  });
});

describe("escopo de armazenamento", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("usa sessionStorage por padrão — o rascunho morre com a sessão de trabalho", () => {
    // A escolha é deliberada: em PC de recepção compartilhado, rascunho de
    // avaliação física carrega dado de saúde (LGPD art. 5º, II). Ele não
    // pode esperar o próximo turno no disco.
    gravarRascunho("k", { peso: "82" }, armazenamentoPadrao());
    expect(window.sessionStorage.getItem("k")).not.toBeNull();
    expect(window.localStorage.getItem("k")).toBeNull();
  });

  it("escopo persistente vai para o localStorage, para quem escolher explicitamente", () => {
    gravarRascunho("k", { a: 1 }, armazenamentoPadrao("persistente"));
    expect(window.localStorage.getItem("k")).not.toBeNull();
    expect(window.sessionStorage.getItem("k")).toBeNull();
  });

  it("os dois escopos não se enxergam", () => {
    gravarRascunho("k", { onde: "sessao" }, armazenamentoPadrao("sessao"));
    expect(lerRascunho<{ onde: string }>("k", armazenamentoPadrao("persistente"))).toBeNull();
  });
});
