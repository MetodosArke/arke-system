import { describe, expect, it } from "vitest";
import { podePrescrever } from "./prescricaoPermitida";

const autonomo = (especialidade: string | null, papel: string) => ({ tipoOrganizacao: "profissional_autonomo", especialidade, papel });
const academia = (papel: string, adminArke = false) => ({ tipoOrganizacao: "academia", especialidade: null, papel, adminArke });

describe("podePrescrever", () => {
  it("o personal autônomo prescreve treino e não dieta", () => {
    expect(podePrescrever("treino", autonomo("professor", "gestor"))).toBe(true);
    expect(podePrescrever("dieta", autonomo("professor", "gestor"))).toBe(false);
  });

  it("a nutricionista autônoma prescreve dieta e não treino", () => {
    expect(podePrescrever("dieta", autonomo("nutricionista", "gestor"))).toBe(true);
    expect(podePrescrever("treino", autonomo("nutricionista", "gestor"))).toBe(false);
  });

  it("o parceiro convidado prescreve pelo papel dele, não pela especialidade do painel", () => {
    expect(podePrescrever("dieta", autonomo("professor", "nutricionista"))).toBe(true);
    expect(podePrescrever("treino", autonomo("professor", "nutricionista"))).toBe(false);
    expect(podePrescrever("treino", autonomo("nutricionista", "professor"))).toBe(true);
  });

  it("painel sem especialidade gravada é de personal", () => {
    expect(podePrescrever("treino", autonomo(null, "gestor"))).toBe(true);
    expect(podePrescrever("dieta", autonomo(null, "gestor"))).toBe(false);
  });

  it("na academia nada muda: gestor prescreve os dois, cada profissional a sua parte", () => {
    expect(podePrescrever("treino", academia("gestor"))).toBe(true);
    expect(podePrescrever("dieta", academia("gestor"))).toBe(true);
    expect(podePrescrever("dieta", academia("professor"))).toBe(false);
    expect(podePrescrever("dieta", academia("nutricionista"))).toBe(true);
    expect(podePrescrever("treino", academia("recepcao"))).toBe(false);
    expect(podePrescrever("dieta", academia("recepcao", true))).toBe(true);
  });
});
