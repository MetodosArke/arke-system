import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { carregarConfig, ConfigError, equipamentosToletus, leitoresFaciais } from "../src/config";

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
      {
        nome: "Entrada",
        ip: "192.168.0.50",
        porta: 80,
        usuario: "admin",
        senha: "x",
        sentido_entrada: "clockwise",
        rosto: false,
        liberacao: "catraca",
        rele: 1,
      },
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

  it("Toletus com uma catraca só: basta o catraca_ip, na porta 7878 da placa", () => {
    // catraca_porta (3000 na BASE) não entra: nos outros modelos é outra coisa.
    const config = carregarConfig(escreverConfig({ ...BASE, modelo_catraca: "toletus" }));
    expect(equipamentosToletus(config)).toEqual([
      { nome: "Catraca", ip: "192.168.0.10", porta: 7878, liberar: "entrada", placa: "litenet2" },
    ]);
    // Uma LiteNet3 só: o tipo da placa basta, e a porta onde ela disca tem padrão.
    const l3 = carregarConfig(escreverConfig({ ...BASE, modelo_catraca: "toletus", toletus_placa: "litenet3" }));
    expect(equipamentosToletus(l3)[0]).toMatchObject({ ip: "192.168.0.10", placa: "litenet3" });
    expect(l3.toletus_litenet3_porta).toBe(7880);
    expect(l3.toletus_litenet3_endereco).toBeUndefined();
  });

  it("LiteNet3 na lista: serial opcional, sem repetir", () => {
    const config = carregarConfig(
      escreverConfig({
        ...BASE,
        modelo_catraca: "toletus",
        toletus_equipamentos: [
          { nome: "Entrada", ip: "192.168.0.60", placa: "litenet3", serial: "00000002" },
          { nome: "Antiga", ip: "192.168.0.61" },
        ],
      })
    );
    expect(equipamentosToletus(config)).toEqual([
      { nome: "Entrada", ip: "192.168.0.60", porta: 7878, liberar: "entrada", placa: "litenet3", serial: "00000002" },
      { nome: "Antiga", ip: "192.168.0.61", porta: 7878, liberar: "entrada", placa: "litenet2" },
    ]);
    expect(() =>
      carregarConfig(
        escreverConfig({
          ...BASE,
          modelo_catraca: "toletus",
          toletus_equipamentos: [
            { nome: "A", ip: "192.168.0.60", placa: "litenet3", serial: "1" },
            { nome: "B", ip: "192.168.0.61", placa: "litenet3", serial: "1" },
          ],
        })
      )
    ).toThrow(/seriais de placa repetidos/);
  });

  it("leitores faciais Topdata: linha Easy com um só usa o catraca_ip; a lista vale com defaults", () => {
    const um = carregarConfig(escreverConfig({ ...BASE, modelo_catraca: "topdata_facial" }));
    expect(leitoresFaciais(um)).toEqual([{ nome: "Catraca", ip: "192.168.0.10", porta_http: 80 }]);
    expect(um.topdata_facial_porta).toBe(7792);

    const lista = carregarConfig(
      escreverConfig({
        ...BASE,
        modelo_catraca: "topdata_facial",
        topdata_faciais: [
          { nome: "Entrada", ip: "192.168.0.70", sn: "AYSH01", senha: "1234" },
          { nome: "Saída", ip: "192.168.0.71" },
        ],
      })
    );
    expect(leitoresFaciais(lista)).toEqual([
      { nome: "Entrada", ip: "192.168.0.70", sn: "AYSH01", senha: "1234", porta_http: 80 },
      { nome: "Saída", ip: "192.168.0.71", porta_http: 80 },
    ]);

    // Na ponte (linha Inner), sem lista não há leitor facial a administrar.
    expect(leitoresFaciais(carregarConfig(escreverConfig({ ...BASE, modelo_catraca: "topdata" })))).toEqual([]);

    expect(() =>
      carregarConfig(
        escreverConfig({
          ...BASE,
          modelo_catraca: "topdata_facial",
          topdata_faciais: [
            { nome: "A", ip: "192.168.0.70", sn: "X" },
            { nome: "B", ip: "192.168.0.71", sn: "X" },
          ],
        })
      )
    ).toThrow(/números de série de leitor repetidos/);
  });

  it("Toletus com várias catracas: a lista do config vale, com defaults por placa", () => {
    const config = carregarConfig(
      escreverConfig({
        ...BASE,
        modelo_catraca: "toletus",
        toletus_equipamentos: [
          { nome: "Entrada", ip: "192.168.0.60" },
          { nome: "Fundos", ip: "192.168.0.61", liberar: "ambos" },
        ],
      })
    );
    expect(equipamentosToletus(config)).toEqual([
      { nome: "Entrada", ip: "192.168.0.60", porta: 7878, liberar: "entrada", placa: "litenet2" },
      { nome: "Fundos", ip: "192.168.0.61", porta: 7878, liberar: "ambos", placa: "litenet2" },
    ]);
    expect(() =>
      carregarConfig(
        escreverConfig({
          ...BASE,
          modelo_catraca: "toletus",
          toletus_equipamentos: [
            { nome: "Catraca", ip: "192.168.0.60" },
            { nome: "Catraca", ip: "192.168.0.61" },
          ],
        })
      )
    ).toThrow(/nomes de equipamento repetidos/);
  });

  it("lança ConfigError quando o arquivo não existe", () => {
    expect(() => carregarConfig("/caminho/que/nao/existe.json")).toThrow(ConfigError);
  });
});
