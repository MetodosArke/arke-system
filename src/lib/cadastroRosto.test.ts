import { describe, it, expect } from "vitest";
import { bytesDoDataUrl, dimensoesDaFoto, fotoGrandeOBastante, lerCadastroRosto, situacaoDoRosto } from "./cadastroRosto";

describe("cadastro do rosto", () => {
  it("lê o que get_cadastro_rosto devolve, e o que vier torto vira 'não'", () => {
    expect(lerCadastroRosto(null)).toEqual({ foto_pelo_app: false, texto_cobre_rosto: false, autorizado: false, pode_enviar_pelo_app: false, ultimo: null });
    const c = lerCadastroRosto({
      foto_pelo_app: true,
      texto_cobre_rosto: true,
      autorizado: true,
      pode_enviar_pelo_app: false,
      ultimo: { tipo: "enviar_foto_rosto", enviado_em: "2026-10-03T14:00:00-03:00", catracas: 2, pendentes: 0, concluidas: 2, falhas: 0, erro: null },
    });
    expect(c.autorizado).toBe(true);
    expect(c.ultimo?.concluidas).toBe(2);
    expect(c.pode_enviar_pelo_app).toBe(false);
  });

  it("a frase acompanha o envio: chegando, cadastrado, parcial e recusado", () => {
    const base = { tipo: "enviar_foto_rosto" as const, enviado_em: "2026-10-03T14:00:00-03:00", catracas: 2, pendentes: 0, concluidas: 0, falhas: 0, erro: null };
    expect(situacaoDoRosto(null)).toBeNull();
    expect(situacaoDoRosto({ ...base, pendentes: 2 })).toEqual({ tom: "andamento", texto: "Foto enviada em 03/10: chegando às catracas." });
    expect(situacaoDoRosto({ ...base, concluidas: 2 })).toEqual({ tom: "ok", texto: "Rosto cadastrado nas catracas em 03/10." });
    expect(situacaoDoRosto({ ...base, concluidas: 1, falhas: 1, erro: "Saída: rosto muito longe" })?.texto).toBe(
      "Rosto cadastrado em 1 de 2 catracas. Faltou: Saída: rosto muito longe"
    );
    expect(situacaoDoRosto({ ...base, falhas: 2, erro: "nenhum rosto encontrado na foto" })).toEqual({
      tom: "falhou",
      texto: "A foto não entrou: nenhum rosto encontrado na foto. Tente outra foto.",
    });
    expect(situacaoDoRosto({ ...base, tipo: "cadastrar_rosto", pendentes: 1 })?.texto).toBe("Cadastro pela câmera do leitor em andamento.");
  });

  it("a foto cabe em 480x640 sem aumentar a pequena nem cortar", () => {
    expect(dimensoesDaFoto(3000, 4000)).toEqual({ largura: 480, altura: 640 });
    expect(dimensoesDaFoto(4000, 3000)).toEqual({ largura: 640, altura: 480 });
    expect(dimensoesDaFoto(1080, 1920)).toEqual({ largura: 360, altura: 640 });
    expect(dimensoesDaFoto(400, 500)).toEqual({ largura: 400, altura: 500 });
    expect(() => dimensoesDaFoto(0, 10)).toThrow();
    expect(fotoGrandeOBastante(160, 300)).toBe(true);
    expect(fotoGrandeOBastante(120, 300)).toBe(false);
  });

  it("tamanho do arquivo a partir do data URL", () => {
    expect(bytesDoDataUrl("data:image/jpeg;base64,QUJD")).toBe(3);
    expect(bytesDoDataUrl("data:image/jpeg;base64,QUI=")).toBe(2);
    expect(bytesDoDataUrl("data:image/jpeg;base64,QQ==")).toBe(1);
  });
});
