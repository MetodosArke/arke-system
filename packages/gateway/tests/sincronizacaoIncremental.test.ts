import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { GatewayService } from "../src/core/gatewayService";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { MockDriver } from "../src/drivers/MockDriver";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import type { AlunoCache, GatewayConfig } from "../src/types";

const CONFIG: GatewayConfig = {
  organization_id: "00000000-0000-0000-0000-000000000000",
  token_api_local: "token-de-teste",
  supabase_url: "https://example.supabase.co",
  catraca_ip: "127.0.0.1",
  catraca_porta: 3000,
  modelo_catraca: "mock",
  tempo_timeout_ms: 300,
  sincronizar_alunos_intervalo_ms: 300_000,
  escuta_host: "127.0.0.1",
  escuta_porta: 4571,
  confirmacao_giro: "decisao",
  timeout_giro_ms: 30_000,
};

// Ids escolhidos para a ordem de texto não coincidir com a de inserção.
const A = "c0000000-0000-4000-8000-000000000001";
const B = "0a000000-0000-4000-8000-000000000002";
const C = "7f000000-0000-4000-8000-000000000003";

const aluno = (id: string, nome: string, extra: Partial<AlunoCache> = {}): AlunoCache => ({
  aluno_id: id,
  cpf: id.slice(0, 11).replace(/\D/g, "0").padEnd(11, "0"),
  // Identificador = id, só para os testes acharem o aluno pelo cache.
  identificador_catraca: id,
  nome,
  inadimplente: false,
  ...extra,
});

/** O mesmo cálculo de public.alunos_catraca_hash(). */
const hashDe = (ids: string[]) => createHash("md5").update([...ids].sort().join(","), "utf8").digest("hex");

describe("Sincronização incremental do cache de alunos", () => {
  let dataDir: string;
  let cache: AlunosCache;
  let cloud: FakeCloudClient;
  let gateway: GatewayService;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-gateway-sync-"));
    cache = new AlunosCache(dataDir);
    cloud = new FakeCloudClient();
    gateway = new GatewayService(CONFIG, new MockDriver(), cloud, cache, new LogsQueue(dataDir));
  });

  afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const nomes = async () =>
    (await Promise.all([A, B, C].map(async (id) => [id, (await cache.buscarPorIdentificador(id))?.nome])))
      .filter(([, n]) => n);

  it("o hash do cache é o mesmo que o banco calcula (ids ordenados, separados por vírgula)", async () => {
    await cache.substituirTodos([aluno(A, "Ana"), aluno(B, "Bia"), aluno(C, "Caio")]);
    expect(await cache.hashIds()).toBe(hashDe([A, B, C]));
    // Conferência independente da ordem: B < C < A em texto.
    expect(await cache.hashIds()).toBe(createHash("md5").update(`${B},${C},${A}`).digest("hex"));
  });

  it("primeira sincronização pede a lista inteira; a seguinte pede a diferença desde o marco", async () => {
    cloud.respostaSincronizarAlunos = {
      completo: true,
      alunos: [aluno(A, "Ana")],
      ids_hash: hashDe([A]),
      sincronizado_em: "2026-09-23T10:00:00.000Z",
    };
    await gateway.sincronizarAlunosComTratamento();

    cloud.respostaSincronizarAlunos = {
      completo: false,
      alunos: [],
      remover: [],
      ids_hash: hashDe([A]),
      sincronizado_em: "2026-09-23T10:05:00.000Z",
    };
    await gateway.sincronizarAlunosComTratamento();
    await gateway.sincronizarAlunosComTratamento();

    expect(cloud.pedidosSincronizacao).toEqual([
      {},
      { desde: "2026-09-23T10:00:00.000Z" },
      { desde: "2026-09-23T10:05:00.000Z" },
    ]);
  });

  it("aplica a diferença: atualiza quem mudou, inclui quem chegou e tira quem saiu", async () => {
    await cache.substituirTodos([aluno(A, "Ana"), aluno(B, "Bia")]);
    cloud.respostaSincronizarAlunos = {
      completo: false,
      alunos: [aluno(A, "Ana", { inadimplente: true }), aluno(C, "Caio")],
      remover: [B],
      ids_hash: hashDe([A, C]),
      sincronizado_em: "2026-09-23T10:05:00.000Z",
    };

    await gateway.sincronizarAlunosComTratamento();

    expect(await cache.contar()).toBe(2);
    expect((await cache.buscarPorIdentificador(A))?.inadimplente).toBe(true);
    expect(await nomes()).toEqual([[A, "Ana"], [C, "Caio"]]);
    // Hash bateu: ninguém pediu a lista inteira.
    expect(cloud.pedidosSincronizacao.some((p) => p.completo)).toBe(false);
  });

  it("receber o mesmo aluno duas vezes (sobreposição de 2 min) não duplica", async () => {
    await cache.substituirTodos([aluno(A, "Ana")]);
    cloud.respostaSincronizarAlunos = {
      completo: false,
      alunos: [aluno(A, "Ana Maria")],
      remover: [],
      ids_hash: hashDe([A]),
      sincronizado_em: "2026-09-23T10:05:00.000Z",
    };
    await gateway.sincronizarAlunosComTratamento();
    await gateway.sincronizarAlunosComTratamento();

    expect(await cache.contar()).toBe(1);
    expect((await cache.buscarPorIdentificador(A))?.nome).toBe("Ana Maria");
  });

  it("hash divergente (aluno excluído, que não aparece na diferença) força a lista inteira na mesma rodada", async () => {
    // B foi excluído na nuvem: não há linha dele para vir em `remover`.
    await cache.substituirTodos([aluno(A, "Ana"), aluno(B, "Bia")]);
    cloud.respostaSincronizarAlunos = {
      completo: false,
      alunos: [],
      remover: [],
      ids_hash: hashDe([A]),
      sincronizado_em: "2026-09-23T10:05:00.000Z",
    };
    cloud.respostaSincronizarCompleto = {
      completo: true,
      alunos: [aluno(A, "Ana")],
      ids_hash: hashDe([A]),
      sincronizado_em: "2026-09-23T10:05:01.000Z",
    };

    await gateway.sincronizarAlunosComTratamento();

    expect(cloud.pedidosSincronizacao).toEqual([{}, { completo: true }]);
    expect(await cache.contar()).toBe(1);
    expect(await cache.buscarPorIdentificador(B)).toBeNull();

    // O marco que vale é o da lista inteira.
    cloud.respostaSincronizarAlunos = { ...cloud.respostaSincronizarCompleto, completo: false, remover: [] };
    await gateway.sincronizarAlunosComTratamento();
    expect(cloud.pedidosSincronizacao[2]).toEqual({ desde: "2026-09-23T10:05:01.000Z" });
  });

  it("resposta de nuvem antiga, sem `completo`, é tratada como lista inteira", async () => {
    await cache.substituirTodos([aluno(A, "Ana"), aluno(B, "Bia")]);
    cloud.respostaSincronizarAlunos = { alunos: [aluno(C, "Caio")], sincronizado_em: "2026-09-23T10:05:00.000Z" };

    await gateway.sincronizarAlunosComTratamento();

    expect(await cache.contar()).toBe(1);
    expect(await nomes()).toEqual([[C, "Caio"]]);
  });

  it("falha na nuvem não avança o marco: a próxima rodada pede a partir do anterior", async () => {
    cloud.respostaSincronizarAlunos = {
      completo: true,
      alunos: [aluno(A, "Ana")],
      ids_hash: hashDe([A]),
      sincronizado_em: "2026-09-23T10:00:00.000Z",
    };
    await gateway.sincronizarAlunosComTratamento();

    cloud.respostaSincronizarAlunos = { error: "Falha ao listar alunos." };
    await gateway.sincronizarAlunosComTratamento();
    await gateway.sincronizarAlunosComTratamento();

    expect(cloud.pedidosSincronizacao.slice(1)).toEqual([
      { desde: "2026-09-23T10:00:00.000Z" },
      { desde: "2026-09-23T10:00:00.000Z" },
    ]);
    // E o cache segue de pé para a contingência.
    expect(await cache.contar()).toBe(1);
  });

  it("duas rodadas ao mesmo tempo não se sobrepõem", async () => {
    cloud.respostaSincronizarAlunos = { completo: true, alunos: [], sincronizado_em: "2026-09-23T10:00:00.000Z" };
    await Promise.all([gateway.sincronizarAlunosComTratamento(), gateway.sincronizarAlunosComTratamento()]);
    expect(cloud.pedidosSincronizacao).toHaveLength(1);
  });
});
