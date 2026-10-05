import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayService } from "../src/core/gatewayService";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { ReceptorDriver } from "../src/drivers/ReceptorDriver";
import { criarServidorReceptor } from "../src/server/localServer";
import {
  acessoDoEvento,
  autorizacaoDigest,
  ehPedidoDeAcesso,
  extrairEventos,
  identificadorDoAcesso,
  lerDesafio,
  respostaOnline,
  usuarioDoAluno,
} from "../src/conectores/intelbras/protocolo";
import { ConectorIntelbras, GestaoIntelbras } from "../src/conectores/intelbras/conector";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import { TerminalIntelbrasFalso } from "./helpers/terminalIntelbrasFalso";
import type { AlunoCache, EquipamentoIntelbras, GatewayConfig } from "../src/types";

const CONFIG: GatewayConfig = {
  organization_id: "00000000-0000-0000-0000-000000000000",
  token_api_local: "token-de-teste",
  supabase_url: "https://example.supabase.co",
  catraca_ip: "127.0.0.1",
  catraca_porta: 80,
  modelo_catraca: "intelbras",
  tempo_timeout_ms: 300,
  sincronizar_alunos_intervalo_ms: 300_000,
  escuta_host: "127.0.0.1",
  escuta_porta: 4571,
  confirmacao_giro: "catra_event",
  timeout_giro_ms: 30_000,
};

const agoraUtc = () => Math.floor(Date.now() / 1000);

describe("Intelbras: protocolo", () => {
  it("lê o evento do multipart e deixa a foto de fora", () => {
    const foto = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from("UserID-falso-na-foto"), Buffer.from([0xff, 0xd9])]);
    const corpo = TerminalIntelbrasFalso.corpoTentativa({ UserID: "42", Method: 15, Type: "Entry", Status: 1, UTC: agoraUtc() }, foto);
    const eventos = extrairEventos(corpo, "multipart/mixed; boundary=myboundary");
    expect(eventos).toHaveLength(1);
    expect(eventos[0].code).toBe("AccessControl");
    expect(JSON.stringify(eventos)).not.toContain("UserID-falso-na-foto");
    expect(acessoDoEvento(eventos[0])).toMatchObject({ userId: "42", metodo: 15, entrada: true });
  });

  it("aceita o corpo com LF e o corpo que já é o JSON", () => {
    const json = JSON.stringify({ Events: [{ Code: "AccessControl", Data: { UserID: "7" } }] });
    const lf = Buffer.from(`--myboundary\nContent-Type: text/plain\nContent-Length: ${Buffer.byteLength(json)}\n\n${json}\n--myboundary--\n`);
    expect(extrairEventos(lf, null)[0].data.UserID).toBe("7");
    expect(extrairEventos(Buffer.from(json), "application/json")[0].data.UserID).toBe("7");
    expect(extrairEventos(Buffer.from("lixo"), null)).toEqual([]);
  });

  it("sem usuário, vale o cartão lido, sem zeros à esquerda e em maiúsculas", () => {
    const a = acessoDoEvento({ code: "AccessControl", action: "Pulse", data: { UserID: "", CardNo: "000ec56d271" }, mac: null })!;
    expect(identificadorDoAcesso(a)).toBe("EC56D271");
    expect(acessoDoEvento({ code: "DoorStatus", action: null, data: {}, mac: null })).toBeNull();
  });

  it("tentativa de agora versus registro guardado sem o Gateway", () => {
    const ev = (utc: number) => ({ code: "AccessControl", action: "Pulse", data: { UserID: "1", UTC: utc }, mac: null });
    const agora = ev(agoraUtc());
    expect(ehPedidoDeAcesso([agora], acessoDoEvento(agora)!)).toBe(true);
    const velho = ev(agoraUtc() - 15 * 60);
    expect(ehPedidoDeAcesso([velho], acessoDoEvento(velho)!)).toBe(false);
    expect(ehPedidoDeAcesso([agora, agora], acessoDoEvento(agora)!)).toBe(false);
  });

  it("a resposta do Modo Online: display sem nome, code em texto, auth em texto", () => {
    expect(respostaOnline(true, "Ana Souza")).toEqual({ message: "Bem-vindo!", code: "200", auth: "true" });
    const negado = respostaOnline(false, "Mensalidade em atraso");
    expect(negado.auth).toBe("false");
    expect(negado.message).not.toMatch(/atraso|mensalidade/i);
  });

  it("aluno no terminal: nome genérico, e desativado quando barrado", () => {
    expect(usuarioDoAluno(42)).toMatchObject({ UserID: "42", UserName: "Aluno", UserType: 0 });
    expect(usuarioDoAluno(42, true).UserType).toBe(1);
    // O 5 é acessibilidade: o aluno barrado nunca pode ir com ele.
    expect(usuarioDoAluno(42, true).UserType).not.toBe(5);
  });

  it("Digest: o exemplo da RFC 2617", () => {
    const d = lerDesafio('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"')!;
    expect(d.qop).toBe("auth");
    const h = autorizacaoDigest({ usuario: "Mufasa", senha: "Circle Of Life", metodo: "GET", uri: "/dir/index.html", desafio: d, nc: 1, cnonce: "0a4f113b" });
    expect(h).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(h).toContain("nc=00000001");
    expect(lerDesafio('Basic realm="x"')).toBeNull();
  });
});

function ambiente(alunos: AlunoCache[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-intelbras-test-"));
  const cache = new AlunosCache(dir);
  const cloud = new FakeCloudClient();
  cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Ana", log_id: "log-1" };
  const gateway = new GatewayService(CONFIG, new ReceptorDriver("intelbras"), cloud, cache, new LogsQueue(dir));
  return { dir, cache, cloud, gateway, alunos };
}

describe("Intelbras: receptor do Modo Online", () => {
  let amb: ReturnType<typeof ambiente>;
  let app: ReturnType<typeof criarServidorReceptor>["app"];
  beforeEach(() => {
    amb = ambiente();
    app = criarServidorReceptor(amb.gateway, { host: "127.0.0.1", porta: 0, intelbras: { nomePorIp: (ip) => (ip === "10.0.0.20" ? "Catraca da entrada" : null) } }).app;
  });
  afterEach(async () => {
    await app.close();
    fs.rmSync(amb.dir, { recursive: true, force: true });
  });

  const tentar = (dados: Record<string, unknown>, ip = "10.0.0.20") =>
    app.inject({
      method: "POST",
      url: "/notification",
      remoteAddress: ip,
      headers: { "content-type": "multipart/mixed; boundary=myboundary" },
      payload: TerminalIntelbrasFalso.corpoTentativa(dados),
    });

  it("keepalive responde OK e o terminal aparece na telemetria pelo nome", async () => {
    const r = await app.inject({ method: "GET", url: "/keepalive", remoteAddress: "10.0.0.20" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe("OK");
    const t = amb.gateway.equipamentos.paraTelemetria().equipamentos;
    expect(t).toContainEqual(expect.objectContaining({ nome: "Catraca da entrada", tipo: "intelbras" }));
  });

  it("aluno liberado: auth true, e à nuvem vai só o número do usuário", async () => {
    const r = await tentar({ UserID: "42", Method: 15, Type: "Entry", Status: 0, UTC: agoraUtc() });
    expect(r.json()).toEqual({ message: "Bem-vindo!", code: "200", auth: "true" });
    expect(amb.cloud.credenciaisRecebidas).toEqual([{ tipo: "identificador_catraca", valor: "42" }]);
    expect(amb.cloud.opcoesRecebidas[0].aguardarGiro).toBe(false);
  });

  it("aluno barrado: auth false, sem o motivo no display", async () => {
    amb.cloud.respostaValidarAcesso = { liberado: false, motivo: "Mensalidade em atraso." };
    const r = await tentar({ UserID: "43", Method: 6, Type: "Entry", UTC: agoraUtc() });
    expect(r.json().auth).toBe("false");
    expect(r.json().message).not.toMatch(/atraso/i);
  });

  it("cartão sem usuário vai à nuvem pelo número lido", async () => {
    await tentar({ UserID: "", CardNo: "0012AB", Method: 1, Type: "Entry", UTC: agoraUtc() });
    expect(amb.cloud.credenciaisRecebidas[0]).toEqual({ tipo: "identificador_catraca", valor: "12AB" });
  });

  it("saída passa sem consultar ninguém", async () => {
    const r = await tentar({ UserID: "43", Method: 15, Type: "Exit", UTC: agoraUtc() });
    expect(r.json().auth).toBe("true");
    expect(amb.cloud.credenciaisRecebidas).toEqual([]);
  });

  it("aviso de porta não pede decisão nem vai à nuvem", async () => {
    const json = JSON.stringify({ Events: [{ Code: "DoorStatus", Data: { Status: "Open" } }] });
    const r = await app.inject({
      method: "POST",
      url: "/notification",
      headers: { "content-type": "multipart/mixed; boundary=myboundary" },
      payload: TerminalIntelbrasFalso.multipart(json, Buffer.alloc(0)),
    });
    expect(r.json().auth).toBe("false");
    expect(amb.cloud.credenciaisRecebidas).toEqual([]);
  });

  it("registros guardados sem o Gateway: as entradas aceitas viram presença na hora em que aconteceram", async () => {
    const quando = agoraUtc() - 3600;
    const json = JSON.stringify({
      Events: [
        { Code: "AccessControl", Data: { UserID: "42", Type: "Entry", Status: 1, UTC: quando } },
        { Code: "AccessControl", Data: { UserID: "43", Type: "Entry", Status: 0, UTC: quando + 60 } },
        { Code: "AccessControl", Data: { UserID: "44", Type: "Exit", Status: 1, UTC: quando + 120 } },
      ],
    });
    const r = await app.inject({
      method: "POST",
      url: "/notification",
      headers: { "content-type": "multipart/mixed; boundary=myboundary" },
      payload: TerminalIntelbrasFalso.multipart(json, Buffer.alloc(0)),
    });
    expect(r.json().auth).toBe("false");
    expect(amb.cloud.credenciaisRecebidas).toEqual([]);
    await new Promise((res) => setTimeout(res, 100));
    expect(amb.cloud.logsRecebidos.map((l) => [l.cpf_consultado, l.giro, l.ocorrido_em])).toEqual([
      ["id:42", "confirmado", new Date(quando * 1000).toISOString()],
    ]);
  });
});

describe("Intelbras: gestão e espelho da situação", () => {
  let term: TerminalIntelbrasFalso;
  let amb: ReturnType<typeof ambiente>;
  let conector: ConectorIntelbras;
  let gestao: GestaoIntelbras;
  const eq = (extra: Partial<EquipamentoIntelbras> = {}): EquipamentoIntelbras => ({
    nome: "Catraca da entrada",
    ip: "127.0.0.1",
    porta: term.porta,
    usuario: "admin",
    senha: "admin123",
    canal: 1,
    rosto: true,
    ...extra,
  });
  const aluno = (id: string, barrado = false): AlunoCache => ({
    aluno_id: `a-${id}`,
    cpf: `000000000${id}`.slice(-11),
    nome: `Aluno ${id}`,
    inadimplente: barrado,
    identificador_catraca: id,
  });

  beforeEach(async () => {
    term = new TerminalIntelbrasFalso();
    await term.iniciar();
    amb = ambiente();
    conector = new ConectorIntelbras(amb.gateway, [eq()], { porta: 4571, endereco: "192.168.0.9" });
    gestao = new GestaoIntelbras(conector);
  });
  afterEach(async () => {
    conector.parar();
    await term.parar();
    fs.rmSync(amb.dir, { recursive: true, force: true });
  });

  it("configura o terminal: hora, servidor de eventos apontando para o Gateway e Modo Online", async () => {
    await conector.configurar(eq());
    expect(term.hora).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(term.configs[0]).toContain("UploadServerList[0].Address=192.168.0.9");
    expect(term.configs[0]).toContain("UploadServerList[0].Port=4571");
    expect(term.configs[0]).toContain("Uploadpath=/notification");
    expect(term.configs[1]).toContain("DeviceMode=2");
    expect(term.configs[1]).toContain("KeepAlive.Path=/keepalive");
  });

  it("senha errada aparece no teste do terminal, sem derrubar nada", async () => {
    const errado = new GestaoIntelbras(new ConectorIntelbras(amb.gateway, [eq({ senha: "outra" })], { porta: 4571 }));
    const [r] = await errado.testar();
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/usuário ou senha/);
    expect((await gestao.testar())[0].ok).toBe(true);
  });

  it("o Digest troca de nonce no meio e segue funcionando", async () => {
    await gestao.criarUsuario(1);
    term.trocarNonce();
    await gestao.criarUsuario(2);
    expect([...term.usuarios.keys()]).toEqual(["1", "2"]);
  });

  it("cadastra o aluno já com a situação do cache; repetir só atualiza", async () => {
    await amb.cache.substituirTodos([aluno("42", true)]);
    await gestao.criarUsuario(42);
    expect(term.usuarios.get("42")).toMatchObject({ UserName: "Aluno", UserType: 1 });
    await amb.cache.substituirTodos([aluno("42", false)]);
    await gestao.criarUsuario(42);
    expect(term.usuarios.get("42")?.UserType).toBe(0);
  });

  it("apaga o rosto e o aluno; apagar quem não está conta como feito", async () => {
    await gestao.criarUsuario(7);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000, 1), Buffer.from([0xff, 0xd9])]);
    await gestao.enviarFotoRosto(7, jpeg);
    const r = await gestao.apagarUsuario(7);
    expect(r.apagados).toBe(1);
    expect(term.usuarios.has("7")).toBe(false);
    expect(term.rostos.has("7")).toBe(false);
    const caminhos = term.chamadas.map((c) => c.caminho).filter((c) => /removeMulti/.test(c));
    expect(caminhos[0]).toContain("AccessFace");
    expect((await gestao.apagarUsuario(7)).apagados).toBe(0);
  });

  it("abre a porta no relé configurado", async () => {
    await new GestaoIntelbras(new ConectorIntelbras(amb.gateway, [eq({ canal: 2 })], { porta: 4571 })).liberarCatraca("entrada");
    expect(term.portasAbertas).toEqual([2]);
  });

  it("foto do rosto: cria o aluno se preciso, troca a anterior, e recusa acima de 100 KB antes de chamar o terminal", async () => {
    const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(n, 2), Buffer.from([0xff, 0xd9])]);
    await gestao.enviarFotoRosto(9, jpeg(5000));
    await gestao.enviarFotoRosto(9, jpeg(6000));
    expect(term.rostos.get("9")).toBe(6004);
    const antes = term.chamadas.length;
    await expect(gestao.enviarFotoRosto(9, jpeg(101 * 1024))).rejects.toThrow(/100 KB/);
    expect(term.chamadas.length).toBe(antes);
    expect(gestao.capacidades()).toContain("enviar_foto_rosto");
    expect(new GestaoIntelbras(new ConectorIntelbras(amb.gateway, [eq({ rosto: false })], { porta: 4571 })).capacidades()).not.toContain("enviar_foto_rosto");
  });

  it("espelho: bloqueia quem está barrado, ignora quem não está no terminal, e só reenvia o que mudou", async () => {
    await gestao.criarUsuario(1);
    await gestao.criarUsuario(2);
    // O 3 tem número no ARKE e não está neste terminal.
    await amb.cache.substituirTodos([aluno("1"), aluno("2", true), aluno("3", true)]);
    const r1 = await conector.espelhar();
    expect(r1[0].falhou).toBeUndefined();
    expect(term.usuarios.get("1")?.UserType).toBe(0);
    expect(term.usuarios.get("2")?.UserType).toBe(1);
    expect(term.usuarios.has("3")).toBe(false);

    const antes = term.chamadas.length;
    await conector.espelhar();
    expect(term.chamadas.length).toBe(antes);

    await amb.cache.substituirTodos([aluno("1", true), aluno("2", true), aluno("3", true)]);
    await conector.espelhar();
    expect(term.usuarios.get("1")?.UserType).toBe(1);
    const novas = term.chamadas.slice(antes);
    expect(novas).toHaveLength(1);
    expect((novas[0].corpo as { UserList: { UserID: string }[] }).UserList.map((u) => u.UserID)).toEqual(["1"]);
  });

  it("espelho com o terminal fora do ar tenta de novo na próxima rodada", async () => {
    await amb.cache.substituirTodos([aluno("1", true)]);
    await gestao.criarUsuario(1);
    await amb.cache.substituirTodos([aluno("1", false)]);
    await term.parar();
    const r = await conector.espelhar();
    expect(r[0].falhou).toBeTruthy();
    await term.iniciar();
    const reaberto = new ConectorIntelbras(amb.gateway, [eq()], { porta: 4571 });
    // O mesmo conector, com a porta nova do terminal reiniciado, reenvia.
    (conector as unknown as { clientes: Map<string, unknown> }).clientes = (reaberto as unknown as { clientes: Map<string, unknown> }).clientes;
    term.usuarios.set("1", usuarioDoAluno(1, true));
    await conector.espelhar();
    expect(term.usuarios.get("1")?.UserType).toBe(0);
  });

  it("o espelho roda sozinho depois de cada sincronização", async () => {
    await gestao.criarUsuario(5);
    await conector.iniciar();
    amb.cloud.respostaSincronizarAlunos = { alunos: [aluno("5", true)], sincronizado_em: new Date().toISOString() };
    await amb.gateway.sincronizarAlunosComTratamento();
    for (let i = 0; i < 50 && term.usuarios.get("5")?.UserType !== 1; i++) await new Promise((r) => setTimeout(r, 20));
    expect(term.usuarios.get("5")?.UserType).toBe(1);
  });
});
