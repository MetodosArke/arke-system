import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayService } from "../src/core/gatewayService";
import { ExecutorComandos } from "../src/core/executorComandos";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { MockDriver } from "../src/drivers/MockDriver";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import type { ICanalComandos, PedidoCanalComandos } from "../src/cloud/client";
import type { GestaoEquipamentos } from "../src/equipamentos/controlidGestao";
import type { ComandoGateway, GatewayConfig, RespostaComandosCloud } from "../src/types";
import { VERSAO_GATEWAY } from "../src/versao";

const CONFIG: GatewayConfig = {
  organization_id: "00000000-0000-0000-0000-000000000000",
  token_api_local: "token-de-teste",
  supabase_url: "https://example.supabase.co",
  catraca_ip: "127.0.0.1",
  catraca_porta: 3000,
  modelo_catraca: "controlid",
  tempo_timeout_ms: 300,
  sincronizar_alunos_intervalo_ms: 300_000,
  escuta_host: "127.0.0.1",
  escuta_porta: 4571,
  confirmacao_giro: "decisao",
  timeout_giro_ms: 30_000,
};

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ate(condicao: () => boolean, limiteMs = 3_000): Promise<void> {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error("condição não aconteceu a tempo");
    await esperar(10);
  }
}

/**
 * Nuvem de mentira do canal: devolve as ordens enfileiradas pelo teste e
 * guarda cada pedido. A chamada longa espera até ter ordem ou o teste
 * encerrar — como a função publicada.
 */
class CanalFalso implements ICanalComandos {
  pedidos: PedidoCanalComandos[] = [];
  ordens: ComandoGateway[] = [];
  falharProximas = 0;
  encerrado = false;

  async trocar(pedido: PedidoCanalComandos): Promise<RespostaComandosCloud> {
    this.pedidos.push(JSON.parse(JSON.stringify(pedido)));
    if (this.falharProximas > 0) {
      this.falharProximas--;
      throw new Error("rede fora");
    }
    const fim = Date.now() + pedido.aguardarMs;
    while (this.ordens.length === 0 && Date.now() < fim && !this.encerrado) await esperar(5);
    return { comandos: this.ordens.splice(0) };
  }

  resultados() {
    return this.pedidos.flatMap((p) => p.resultados);
  }
}

class GestaoFalsa implements GestaoEquipamentos {
  chamadas: string[] = [];
  demoraCadastroMs = 0;
  nomes() {
    return ["Entrada"];
  }
  async testar() {
    return [{ equipamento: "Entrada", ok: true }];
  }
  async criarUsuario(userId: number, nome: string) {
    this.chamadas.push(`criar:${userId}:${nome}`);
    return { equipamentos: ["Entrada"] };
  }
  async apagarUsuario(userId: number) {
    this.chamadas.push(`apagar:${userId}`);
    return { equipamentos: ["Entrada"], apagados: 3 };
  }
  async cadastrarDigital(userId: number) {
    this.chamadas.push(`digital-inicio:${userId}`);
    await esperar(this.demoraCadastroMs);
    this.chamadas.push(`digital-fim:${userId}`);
    return { equipamento: "Entrada", replicado_em: [], falhou_em: [] };
  }
  async cadastrarCartao(userId: number) {
    this.chamadas.push(`cartao:${userId}`);
    return { equipamento: "Entrada", cartoes: 1, replicado_em: [], falhou_em: [] };
  }
  async liberarCatraca(sentido: "entrada" | "saida" | "ambos") {
    this.chamadas.push(`liberar:${sentido}`);
    return { equipamento: "Entrada" };
  }
}

function criar(gestao: GestaoEquipamentos | null = new GestaoFalsa()) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-executor-test-"));
  const cloud = new FakeCloudClient();
  const gateway = new GatewayService(CONFIG, new MockDriver(), cloud, new AlunosCache(dataDir), new LogsQueue(dataDir));
  const canal = new CanalFalso();
  const executor = new ExecutorComandos(canal, gateway, gestao, {
    modelo: "controlid",
    aguardarMs: 200,
    esperaFalhaMs: 20,
    esperaFalhaMaxMs: 40,
  });
  return { dataDir, cloud, gateway, canal, executor, gestao };
}

describe("ExecutorComandos", () => {
  let amb: ReturnType<typeof criar>;

  beforeEach(() => {
    amb = criar();
  });

  afterEach(() => {
    amb.executor.parar();
    amb.canal.encerrado = true;
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("anuncia a gestão do equipamento só quando há Control iD configurada", () => {
    expect(amb.executor.capacidades()).toEqual([
      "sincronizar_completo",
      "enviar_logs",
      "diagnostico",
      "liberar_catraca",
      "cadastrar_usuario",
      "cadastrar_digital",
      "cadastrar_cartao",
      "apagar_usuario",
    ]);
    const sem = criar(null);
    expect(sem.executor.capacidades()).toEqual(["sincronizar_completo", "enviar_logs", "diagnostico"]);
    fs.rmSync(sem.dataDir, { recursive: true, force: true });
  });

  it("toda chamada leva a telemetria, com versão, estado e fila offline", async () => {
    amb.executor.iniciar();
    await ate(() => amb.canal.pedidos.length > 0);
    const tel = amb.canal.pedidos[0].telemetria;
    expect(tel.versao).toBe(VERSAO_GATEWAY);
    expect(tel.modelo).toBe("controlid");
    expect(tel.estado).toBe("offline");
    expect(tel.fila_offline).toBe(0);
    expect(tel.capacidades).toContain("apagar_usuario");
    expect(amb.canal.pedidos[0].aguardarMs).toBe(200);
    // O nome do equipamento de gestão vai, para a recepção escolher o leitor;
    // IP e senha, não.
    expect(tel.equipamentos).toContainEqual({ nome: "Entrada", tipo: "controlid-gestao", visto_em: null });
    expect(JSON.stringify(tel)).not.toMatch(/senha|127\.0\.0\.1/);
  });

  it("executa a ordem e entrega o resultado sem esperar a escuta longa em curso", async () => {
    amb.cloud.respostaSincronizarAlunos = {
      alunos: [{ aluno_id: "a1", cpf: "1", nome: "A", inadimplente: false }],
      sincronizado_em: new Date().toISOString(),
    };
    amb.executor.iniciar();
    amb.canal.ordens.push({ id: "c1", tipo: "sincronizar_completo", parametros: {} });

    await ate(() => amb.canal.resultados().some((r) => r.id === "c1"));
    const r = amb.canal.resultados().find((x) => x.id === "c1")!;
    expect(r).toEqual({ id: "c1", sucesso: true, resultado: { total: 1 } });
    // A entrega saiu numa chamada curta, não na próxima longa.
    const pedido = amb.canal.pedidos.find((p) => p.resultados.some((x) => x.id === "c1"))!;
    expect(pedido.aguardarMs).toBe(0);
    expect(amb.cloud.pedidosSincronizacao).toContainEqual({ completo: true });
  });

  it("ordem desconhecida e gestão sem equipamento viram erro, não exceção", async () => {
    const r1 = await amb.executor.executar({ id: "x", tipo: "formatar_disco", parametros: {} });
    expect(r1.sucesso).toBe(false);
    expect(r1.erro).toMatch(/não conhece a ordem "formatar_disco"/);

    const sem = criar(null);
    const r2 = await sem.executor.executar({ id: "y", tipo: "apagar_usuario", parametros: { user_id: "42" } });
    expect(r2.sucesso).toBe(false);
    expect(r2.erro).toMatch(/controlid_equipamentos/);
    fs.rmSync(sem.dataDir, { recursive: true, force: true });
  });

  it("número de usuário que não é número é recusado antes de tocar no equipamento", async () => {
    const r = await amb.executor.executar({ id: "z", tipo: "apagar_usuario", parametros: { user_id: "12a" } });
    expect(r.sucesso).toBe(false);
    expect((amb.gestao as GestaoFalsa).chamadas).toEqual([]);
  });

  it("ordens do equipamento andam uma de cada vez; a liberação não espera o cadastro", async () => {
    const gestao = amb.gestao as GestaoFalsa;
    gestao.demoraCadastroMs = 300;
    amb.executor.iniciar();
    amb.canal.ordens.push({ id: "d1", tipo: "cadastrar_digital", parametros: { user_id: "1" } });
    await ate(() => gestao.chamadas.includes("digital-inicio:1"));

    // Com o aluno ainda com o dedo no leitor, chegam outro cadastro e uma liberação.
    amb.canal.ordens.push(
      { id: "u2", tipo: "cadastrar_usuario", parametros: { user_id: "2", nome: "Bia" } },
      { id: "l1", tipo: "liberar_catraca", parametros: { sentido: "saida" } }
    );

    await ate(() => amb.canal.resultados().length === 3);
    expect(gestao.chamadas).toEqual(["digital-inicio:1", "liberar:saida", "digital-fim:1", "criar:2:Bia"]);
    expect(amb.canal.resultados().every((r) => r.sucesso)).toBe(true);
  });

  it("resultado que não foi entregue volta para a fila e sai na próxima chamada", async () => {
    const r = await amb.executor.executar({ id: "c9", tipo: "enviar_logs", parametros: {} });
    // Simula o resultado pronto esperando entrega, e a rede fora.
    (amb.executor as unknown as { resultados: unknown[] }).resultados.push(r);
    amb.canal.falharProximas = 1;
    amb.executor.iniciar();

    const comC9 = () => amb.canal.pedidos.filter((p) => p.resultados.some((x) => x.id === "c9"));
    await ate(() => comC9().length >= 2);
    // A primeira tentativa levou e falhou; a segunda levou de novo. Depois
    // da entrega, não vai mais.
    expect(amb.canal.pedidos[0].resultados.map((x) => x.id)).toEqual(["c9"]);
    await esperar(50);
    expect(comC9()).toHaveLength(2);
  });

  it("aluno criado no equipamento: depois da entrega, o cache sincroniza para pegar o número", async () => {
    amb.cloud.respostaSincronizarAlunos = { alunos: [], sincronizado_em: new Date().toISOString() };
    amb.executor.iniciar();
    amb.canal.ordens.push({ id: "u1", tipo: "cadastrar_usuario", parametros: { user_id: "42", nome: "Maria" } });

    await ate(() => amb.canal.resultados().some((r) => r.id === "u1"));
    await ate(() => amb.cloud.pedidosSincronizacao.length > 0);
  });

  it("diagnóstico devolve o estado e o teste de conexão com cada equipamento", async () => {
    const r = await amb.executor.executar({ id: "g", tipo: "diagnostico", parametros: {} });
    expect(r.sucesso).toBe(true);
    expect(r.resultado).toMatchObject({
      versao: VERSAO_GATEWAY,
      status: "offline",
      filaOffline: 0,
      equipamentos_gestao: [{ equipamento: "Entrada", ok: true }],
    });
  });

  it("a rede caindo não derruba o laço: ele tenta de novo com espera crescente", async () => {
    amb.canal.falharProximas = 3;
    amb.executor.iniciar();
    await ate(() => amb.canal.pedidos.length >= 4);
  });
});
