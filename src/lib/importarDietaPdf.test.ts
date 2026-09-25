import { describe, it, expect } from "vitest";
import {
  avaliarLeitura,
  conferirNoOriginal,
  lerResposta,
  temTextoSuficiente,
  tirarIdentificacao,
  type DietaLida,
} from "../../supabase/functions/importar-dieta-pdf/fluxo";

// O texto que o navegador extrai de um plano alimentar comum.
const ORIGINAL = `Plano Alimentar — Fase de Adaptação
Paciente: Maria Exemplo · Nutricionista: Dra. Ana Teste (CRN-3 00000) · Validade: 30 dias
Café da manhã — 07:00
Pão integral — 2 fatias (substituir por: tapioca 3 colheres de sopa ou cuscuz 100 g)
Ovo mexido — 2 unidades
Café sem açúcar — 1 xícara
Lanche da manhã — 10:00
Banana — 1 unidade média (ou maçã 1 unidade)
Castanha-do-pará — 2 unidades
Almoço — 12:30
Arroz integral — 4 colheres de sopa
Feijão — 1 concha
Frango grelhado — 120 g (pode trocar por peixe 150 g ou carne magra 100 g)
Salada de folhas à vontade
Azeite — 1 colher de chá
Orientações gerais: beber 2,5 L de água por dia; evitar frituras.`;

// O que o modelo devolveu para esse texto (conferido em 25/09/2026).
const FIEL: DietaLida = {
  titulo_dieta: "Plano Alimentar — Fase de Adaptação",
  observacoes_gerais: "beber 2,5 L de água por dia; evitar frituras.",
  refeicoes: [
    {
      nome: "Café da manhã",
      horario: "07:00",
      itens: [
        { alimento: "Pão integral", quantidade: "2 fatias", substituicoes: ["tapioca 3 colheres de sopa", "cuscuz 100 g"] },
        { alimento: "Ovo mexido", quantidade: "2 unidades", substituicoes: [] },
        { alimento: "Café sem açúcar", quantidade: "1 xícara", substituicoes: [] },
      ],
    },
    {
      nome: "Lanche da manhã",
      horario: "10:00",
      itens: [
        { alimento: "Banana", quantidade: "1 unidade média", substituicoes: ["maçã 1 unidade"] },
        { alimento: "Castanha-do-pará", quantidade: "2 unidades", substituicoes: [] },
      ],
    },
    {
      nome: "Almoço",
      horario: "12:30",
      itens: [
        { alimento: "Arroz integral", quantidade: "4 colheres de sopa", substituicoes: [] },
        { alimento: "Feijão", quantidade: "1 concha", substituicoes: [] },
        { alimento: "Frango grelhado", quantidade: "120 g", substituicoes: ["peixe 150 g", "carne magra 100 g"] },
        { alimento: "Salada de folhas", quantidade: "à vontade", substituicoes: [] },
        { alimento: "Azeite", quantidade: "1 colher de chá", substituicoes: [] },
      ],
    },
  ],
};

// O que o modelo devolveu para o PDF escaneado, que não tinha texto nenhum.
const INVENTADA: DietaLida = {
  titulo_dieta: "Plano Alimentar para Perda de Peso",
  observacoes_gerais: null,
  refeicoes: [
    {
      nome: "Café da Manhã",
      horario: "7h00",
      itens: [
        { alimento: "Aveia em flocos", quantidade: "50g", substituicoes: ["Granola integral", "Quinoa"] },
        { alimento: "Iogurte natural", quantidade: "200g", substituicoes: ["Leite desnatado"] },
        { alimento: "Morango", quantidade: "100g", substituicoes: ["Maca", "Banana"] },
      ],
    },
    {
      nome: "Almoço",
      horario: "12h00",
      itens: [
        { alimento: "Peito de frango grelhado", quantidade: "150g", substituicoes: ["Peixe", "Ovo"] },
        { alimento: "Brócolis", quantidade: "100g", substituicoes: [] },
      ],
    },
  ],
};

describe("antes de chamar o modelo", () => {
  it("PDF sem texto (escaneado) nem chega ao modelo", () => {
    expect(temTextoSuficiente("")).toBe(false);
    expect(temTextoSuficiente("  \n 1 2 3 \n ")).toBe(false);
    expect(temTextoSuficiente(ORIGINAL)).toBe(true);
  });

  it("tira as linhas e os números que identificam a pessoa, e deixa a dieta", () => {
    const texto = `${ORIGINAL}\nCPF: 123.456.789-09\nContato: maria@exemplo.com ou (11) 98888-7777`;
    const { texto: limpo, removidas } = tirarIdentificacao(texto);
    expect(limpo).not.toContain("Maria Exemplo");
    expect(limpo).not.toContain("123.456.789-09");
    expect(limpo).not.toContain("maria@exemplo.com");
    expect(limpo).not.toContain("98888-7777");
    expect(limpo).toContain("Frango grelhado — 120 g");
    expect(limpo).toContain("Café da manhã — 07:00");
    expect(removidas).toBeGreaterThanOrEqual(4);
  });
});

describe("a resposta do modelo", () => {
  it("lê o JSON mesmo com cerca de código e texto em volta", () => {
    const d = lerResposta('Aqui está:\n```json\n{"titulo_dieta":"X","observacoes_gerais":"","refeicoes":[{"nome":"Jantar","horario":"","itens":[{"alimento":"Omelete","quantidade":"2 ovos"},{"quantidade":"sem alimento"}]}]}\n```');
    expect(d.refeicoes[0].horario).toBeNull();
    expect(d.observacoes_gerais).toBeNull();
    expect(d.refeicoes[0].itens).toEqual([{ alimento: "Omelete", quantidade: "2 ovos", substituicoes: [] }]);
  });

  it("recusa o que não é dieta", () => {
    expect(() => lerResposta("não consigo")).toThrow();
    expect(() => lerResposta('{"titulo_dieta":"X"}')).toThrow();
  });
});

describe("conferência contra o PDF", () => {
  it("a leitura fiel passa inteira, sem nada para conferir", () => {
    const r = conferirNoOriginal(FIEL, ORIGINAL);
    expect(r.itens).toBe(10);
    expect(r.semAncora).toBe(0);
    expect(avaliarLeitura(r.itens, r.semAncora)).toEqual({ ok: true });
  });

  it("a dieta inventada é recusada inteira", () => {
    const r = conferirNoOriginal(INVENTADA, ORIGINAL);
    expect(r.semAncora / r.itens).toBeGreaterThan(0.3);
    expect(avaliarLeitura(r.itens, r.semAncora).ok).toBe(false);
  });

  it("uma quantidade trocada marca só aquele item", () => {
    const trocada = structuredClone(FIEL);
    trocada.refeicoes[2].itens[2].quantidade = "180 g";
    const r = conferirNoOriginal(trocada, ORIGINAL);
    expect(r.semAncora).toBe(1);
    expect(r.dieta.refeicoes[2].itens[2].conferir).toBe(true);
    expect(r.dieta.refeicoes[2].itens[1].conferir).toBeUndefined();
    expect(avaliarLeitura(r.itens, r.semAncora)).toEqual({ ok: true });
  });

  it("uma substituição inventada também marca o item", () => {
    const inventada = structuredClone(FIEL);
    inventada.refeicoes[0].itens[1].substituicoes = ["queijo cottage 2 colheres"];
    const r = conferirNoOriginal(inventada, ORIGINAL);
    expect(r.dieta.refeicoes[0].itens[1].conferir).toBe(true);
  });

  it("sem refeição nenhuma, não há o que importar", () => {
    expect(avaliarLeitura(0, 0).ok).toBe(false);
  });
});
