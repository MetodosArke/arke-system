import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { carregarConfig, ConfigError } from "../src/config";

describe("carregarConfig", () => {
  const arquivos: string[] = [];

  afterEach(() => {
    for (const arquivo of arquivos.splice(0)) fs.rmSync(arquivo, { force: true });
  });

  function escreverConfig(conteudo: unknown): string {
    const arquivo = path.join(os.tmpdir(), `arke-gateway-config-${Date.now()}-${Math.random()}.json`);
    fs.writeFileSync(arquivo, JSON.stringify(conteudo));
    arquivos.push(arquivo);
    return arquivo;
  }

  it("carrega um config.json válido e aplica o default de tempo_timeout_ms", () => {
    const arquivo = escreverConfig({
      organization_id: "11111111-1111-1111-1111-111111111111",
      token_api_local: "token-valido-1234567890",
      supabase_url: "https://exemplo.supabase.co",
      catraca_ip: "192.168.0.10",
      catraca_porta: 3000,
      modelo_catraca: "mock",
    });

    const config = carregarConfig(arquivo);

    // 1000 ms: medido, não prometido — ver o comentário em config.ts.
    expect(config.tempo_timeout_ms).toBe(1000);
    expect(config.modelo_catraca).toBe("mock");
    // Sem Monitor configurado, a liberação já é a presença.
    expect(config.confirmacao_giro).toBe("decisao");
    expect(config.timeout_giro_ms).toBe(30_000);
  });

  it("rejeita um config.json com organization_id inválido", () => {
    const arquivo = escreverConfig({
      organization_id: "nao-e-um-uuid",
      token_api_local: "token-valido-1234567890",
      supabase_url: "https://exemplo.supabase.co",
      catraca_ip: "192.168.0.10",
      catraca_porta: 3000,
      modelo_catraca: "mock",
    });

    expect(() => carregarConfig(arquivo)).toThrow(ConfigError);
  });

  const BASE = {
    organization_id: "11111111-1111-1111-1111-111111111111",
    token_api_local: "token-valido-1234567890",
    supabase_url: "https://exemplo.supabase.co",
    catraca_ip: "192.168.0.10",
    catraca_porta: 3000,
  };

  it.each(["henry", "dimep"])("recusa subir com %s, que ainda não tem integração", (modelo) => {
    const arquivo = escreverConfig({ ...BASE, modelo_catraca: modelo });
    expect(() => carregarConfig(arquivo)).toThrow(/implantação do primeiro cliente/);
  });

  it("gestão remota da Control iD: vazia por padrão, com defaults por equipamento", () => {
    expect(carregarConfig(escreverConfig({ ...BASE, modelo_catraca: "controlid" })).controlid_equipamentos).toEqual([]);

    const config = carregarConfig(
      escreverConfig({
        ...BASE,
        modelo_catraca: "controlid",
        controlid_equipamentos: [{ nome: "Entrada", ip: "192.168.0.50", senha: "x" }],
      })
    );
    expect(config.controlid_equipamentos).toEqual([
      { nome: "Entrada", ip: "192.168.0.50", porta: 80, usuario: "admin", senha: "x", sentido_entrada: "clockwise" },
    ]);
  });

  it("recusa dois equipamentos com o mesmo nome — a recepção escolhe pelo nome", () => {
    const arquivo = escreverConfig({
      ...BASE,
      modelo_catraca: "controlid",
      controlid_equipamentos: [
        { nome: "Catraca", ip: "192.168.0.50", senha: "x" },
        { nome: "Catraca", ip: "192.168.0.51", senha: "x" },
      ],
    });
    expect(() => carregarConfig(arquivo)).toThrow(/nomes de equipamento repetidos/);
  });

  it("lança ConfigError quando o arquivo não existe", () => {
    expect(() => carregarConfig("/caminho/que/nao/existe.json")).toThrow(ConfigError);
  });
});
