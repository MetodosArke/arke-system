import { describe, it, expect } from "vitest";
import { PASSOS_GUIA, quebrarLinhas } from "./guiaAluno";

// Medida fixa: cada caractere vale 10 px.
const medir = (t: string) => t.length * 10;

describe("guia do aluno", () => {
  it("quebra o texto em linhas que cabem na largura, sem cortar palavra", () => {
    expect(quebrarLinhas("Aponte a câmera do celular para o QR Code.", 200, medir)).toEqual([
      "Aponte a câmera do",
      "celular para o QR",
      "Code.",
    ]);
  });

  it("palavra maior que a largura fica sozinha na linha, em vez de sumir", () => {
    expect(quebrarLinhas("ver www.arkefit.com.br/p/academia agora", 100, medir)).toEqual(["ver", "www.arkefit.com.br/p/academia", "agora"]);
  });

  it("o passo a passo cobre câmera, e-mail ou celular, senha e instalação", () => {
    const texto = PASSOS_GUIA.join(" ");
    for (const trecho of ["câmera", "e-mail ou o celular", "senha", "Tela de Início", "Instalar app"]) expect(texto).toContain(trecho);
  });
});
