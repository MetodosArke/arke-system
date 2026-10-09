import http from "node:http";
import { createHash, randomBytes } from "node:crypto";

/**
 * Aparelho Hikvision de mentira (ISAPI), escrito a partir da documentação
 * ISAPI da Hikvision, sem importar o código do Gateway.
 *
 * Três tipos: o terminal facial com digital (como o DS-K1T671MF), o terminal
 * sem digital (como o DS-K1T341) e a controladora (DS-K2604), sem câmera e,
 * se quiser, com um terminal facial ligado. Serve a API com Digest (RFC 2617),
 * guarda pessoas, rostos, cartões e digitais como o aparelho, responde os
 * erros no formato dele e manda eventos ao servidor de escuta.
 */
export type TipoAparelho = "terminal" | "terminal_sem_digital" | "controladora";

type Objeto = Record<string, unknown>;
type Usuario = { employeeNo: string; name: string; Valid?: { beginTime?: string; endTime?: string; enable?: boolean } } & Objeto;

const ERRO = {
  naoExiste: [400, 6, "Invalid Content", "employeeNoNotExist", 0x6000601f],
  jaExiste: [400, 6, "Invalid Content", "employeeNoAlreadyExist", 0x60006020],
  cartaoDeOutro: [400, 6, "Invalid Content", "cardNoAlreadyExist", 0x60006033],
  semRosto: [400, 6, "Invalid Content", "pictureFaceDetectZero", 0x6000604c],
  semFuncao: [403, 4, "Invalid Operation", "notSupport", 0x40000001],
  ocupado: [503, 2, "Device Busy", "deviceBusy", 0x20000004],
  formato: [400, 5, "Invalid Format", "badJsonFormat", 0x50000002],
} as const;

export class AparelhoHikvisionFalso {
  usuario = "admin";
  senha = "Senha12345";
  readonly realm = "DS-FALSO";
  private nonce = randomBytes(12).toString("hex");
  porta = 0;
  private servidor: http.Server | null = null;

  /** Cada chamada autenticada: método, caminho e o JSON (ou texto) do corpo. */
  chamadas: { metodo: string; caminho: string; corpo: unknown }[] = [];
  recusasDeSenha = 0;
  usuarios = new Map<string, Usuario>();
  /** Rosto de cada pessoa: o tamanho do JPEG (a foto em si não é guardada pelo falso). */
  rostos = new Map<string, number>();
  /** Partes do último multipart de rosto: nome e tipo. */
  partesDoUltimoRosto: { nome: string | null; tipo: string | null }[] = [];
  cartoes = new Map<string, string>(); // número → pessoa
  digitais = new Map<string, string>(); // pessoa → dados
  portasAbertas: number[] = [];
  hora: string | null = null;
  servidorDeEventos: { ip: string | null; porta: number | null; url: string | null; formato: string | null; reenvio: boolean } | null = null;
  acsCfg: Objeto = { uploadVerificationPic: true, saveVerificationPic: true, saveFacePic: true, showName: true };

  /** Próximas chamadas que respondem "ocupado". */
  ocupadoPor = 0;
  /** Caminhos (prefixo) que este firmware não tem. */
  semFuncao = new Set<string>();
  /** Cartão que vai "passar" na próxima leitura. */
  cartaoParaLer: string | null = "3141592653";
  /** Dedo que vai "pousar" na próxima leitura. */
  digitalParaLer: string | null = Buffer.from("modelo-da-digital-falso").toString("base64");

  constructor(readonly tipo: TipoAparelho = "terminal", private readonly comTerminalFacial = false) {}

  get modelo(): string {
    return this.tipo === "controladora" ? "DS-K2604" : this.tipo === "terminal" ? "DS-K1T671MF" : "DS-K1T341AM";
  }

  get temRosto(): boolean {
    return this.tipo !== "controladora" || this.comTerminalFacial;
  }

  trocarNonce(): void {
    this.nonce = randomBytes(12).toString("hex");
  }

  private digestValido(cab: string | undefined, metodo: string, uri: string): boolean {
    if (!cab?.startsWith("Digest ")) return false;
    const c = (n: string) => new RegExp(`(?:^|[\\s,])${n}="?([^",]+)"?`).exec(cab.slice(6))?.[1];
    if (c("username") !== this.usuario || c("nonce") !== this.nonce || c("uri") !== uri) return false;
    const md5 = (s: string) => createHash("md5").update(s).digest("hex");
    const ha1 = md5(`${this.usuario}:${this.realm}:${this.senha}`);
    const ha2 = md5(`${metodo}:${uri}`);
    return c("response") === md5(`${ha1}:${this.nonce}:${c("nc")}:${c("cnonce")}:auth:${ha2}`);
  }

  async iniciar(): Promise<void> {
    this.servidor = http.createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on("data", (d: Buffer) => partes.push(d));
      req.on("end", () => {
        const uri = req.url ?? "";
        const metodo = req.method ?? "GET";
        if (!this.digestValido(req.headers.authorization, metodo, uri)) {
          if (req.headers.authorization) this.recusasDeSenha++;
          res.writeHead(401, { "WWW-Authenticate": `Digest qop="auth", realm="${this.realm}", nonce="${this.nonce}", stale="FALSE"` });
          return res.end();
        }
        const bruto = Buffer.concat(partes);
        const tipo = String(req.headers["content-type"] ?? "");
        let corpo: unknown = null;
        if (/json/i.test(tipo)) {
          try {
            corpo = JSON.parse(bruto.toString("utf8"));
          } catch {
            return this.erro(res, ERRO.formato);
          }
        } else if (/xml/i.test(tipo)) corpo = bruto.toString("utf8");
        else if (/multipart/i.test(tipo)) corpo = { multipart: true };
        this.chamadas.push({ metodo, caminho: uri, corpo });
        if (this.ocupadoPor > 0) {
          this.ocupadoPor--;
          return this.erro(res, ERRO.ocupado);
        }
        const caminho = uri.split("?")[0];
        if ([...this.semFuncao].some((p) => caminho.startsWith(p))) return this.erro(res, ERRO.semFuncao);
        this.atender(metodo, uri, corpo, bruto, tipo, res);
      });
    });
    await new Promise<void>((r) => this.servidor!.listen(0, "127.0.0.1", r));
    this.porta = (this.servidor.address() as { port: number }).port;
  }

  async parar(): Promise<void> {
    await new Promise<void>((r) => (this.servidor ? this.servidor.close(() => r()) : r()));
  }

  private ok(res: http.ServerResponse, extra: Objeto = {}) {
    const corpo = JSON.stringify({ statusCode: 1, statusString: "OK", subStatusCode: "ok", ...extra });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(corpo);
  }

  private okXml(res: http.ServerResponse, xml: string) {
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`);
  }

  private erro(res: http.ServerResponse, [http, codigo, texto, sub, numero]: readonly [number, number, string, string, number]) {
    res.writeHead(http, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ statusCode: codigo, statusString: texto, subStatusCode: sub, errorCode: numero, errorMsg: sub }));
  }

  private capacidadesXml(): string {
    const c = this.tipo === "controladora";
    const sim = (v: boolean) => (v ? "true" : "false");
    return (
      `<AccessControl version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">` +
      `<isSupportUserInfo>true</isSupportUserInfo><isSupportCardInfo>true</isSupportCardInfo>` +
      `<isSupportFDLib>${sim(this.temRosto)}</isSupportFDLib><isSupportFDLibAsyncResults>true</isSupportFDLibAsyncResults>` +
      `<isSupportFingerPrintCfg>${sim(this.tipo !== "terminal_sem_digital")}</isSupportFingerPrintCfg>` +
      `<isSupportFingerPrintDelete>${sim(this.tipo !== "terminal_sem_digital")}</isSupportFingerPrintDelete>` +
      `<isSupportCaptureCardInfo>${sim(!c)}</isSupportCaptureCardInfo>` +
      `<isSupportCaptureFace>${sim(!c)}</isSupportCaptureFace>` +
      `<isSupportCaptureFingerPrint>${sim(this.tipo === "terminal")}</isSupportCaptureFingerPrint>` +
      `<isSupportRemoteCheck>${sim(!c)}</isSupportRemoteCheck><isSupportAcsCfg>true</isSupportAcsCfg>` +
      `<isSupportUserInfoDetailDelete>true</isSupportUserInfoDetailDelete>` +
      `</AccessControl>`
    );
  }

  private apagarTudo(id: string) {
    this.usuarios.delete(id);
    this.rostos.delete(id);
    this.digitais.delete(id);
    for (const [n, p] of this.cartoes) if (p === id) this.cartoes.delete(n);
  }

  private atender(metodo: string, uri: string, corpo: unknown, bruto: Buffer, tipo: string, res: http.ServerResponse): void {
    const [caminho, consulta = ""] = uri.split("?");
    const q = new URLSearchParams(consulta);
    const j = (corpo ?? {}) as Objeto;
    switch (`${metodo} ${caminho}`) {
      case "GET /ISAPI/System/deviceInfo":
        return this.okXml(
          res,
          `<DeviceInfo version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><deviceName>Falso</deviceName>` +
            `<model>${this.modelo}</model><serialNumber>${this.modelo}FALSO0001</serialNumber>` +
            `<firmwareVersion>V3.9.0</firmwareVersion><deviceType>ACS</deviceType></DeviceInfo>`
        );
      case "GET /ISAPI/AccessControl/capabilities":
        return this.okXml(res, this.capacidadesXml());
      case "PUT /ISAPI/System/time":
        this.hora = /<localTime>([^<]+)</.exec(String(corpo))?.[1] ?? null;
        return this.ok(res);
      case "PUT /ISAPI/Event/notification/httpHosts": {
        const x = String(corpo);
        const tag = (n: string) => new RegExp(`<${n}>([^<]*)<`).exec(x)?.[1] ?? null;
        this.servidorDeEventos = {
          ip: tag("ipAddress") ?? tag("ipv6Address"),
          porta: Number(tag("portNo")),
          url: tag("url"),
          formato: tag("parameterFormatType"),
          reenvio: tag("httpBroken") === "true",
        };
        return this.ok(res);
      }
      case "GET /ISAPI/AccessControl/AcsCfg":
        res.writeHead(200, { "Content-Type": "application/json" });
        return void res.end(JSON.stringify({ AcsCfg: this.acsCfg }));
      case "PUT /ISAPI/AccessControl/AcsCfg":
        this.acsCfg = { ...((j.AcsCfg as Objeto) ?? {}) };
        return this.ok(res);
      case "PUT /ISAPI/AccessControl/UserInfo/SetUp":
      case "POST /ISAPI/AccessControl/UserInfo/Record":
      case "PUT /ISAPI/AccessControl/UserInfo/Modify": {
        const u = j.UserInfo as Usuario | undefined;
        if (!u?.employeeNo) return this.erro(res, ERRO.formato);
        const existe = this.usuarios.has(u.employeeNo);
        if (caminho.endsWith("Record") && existe) return this.erro(res, ERRO.jaExiste);
        if (caminho.endsWith("Modify") && !existe) return this.erro(res, ERRO.naoExiste);
        this.usuarios.set(u.employeeNo, u);
        return this.ok(res);
      }
      case "PUT /ISAPI/AccessControl/UserInfo/Delete": {
        const lista = ((j.UserInfoDelCond as Objeto)?.EmployeeNoList ?? []) as { employeeNo: string }[];
        for (const e of lista) this.usuarios.delete(e.employeeNo);
        return this.ok(res);
      }
      case "PUT /ISAPI/AccessControl/UserInfoDetail/Delete": {
        const lista = ((j.UserInfoDetail as Objeto)?.EmployeeNoList ?? []) as { employeeNo: string }[];
        // Apaga a pessoa com tudo o que é dela, como a documentação descreve.
        for (const e of lista) this.apagarTudo(e.employeeNo);
        return this.ok(res);
      }
      case "GET /ISAPI/AccessControl/UserInfoDetail/DeleteProcess":
        res.writeHead(200, { "Content-Type": "application/json" });
        return void res.end(JSON.stringify({ UserInfoDetailDeleteProcess: { status: "success" } }));
      case "POST /ISAPI/AccessControl/CardInfo/Record": {
        const c = j.CardInfo as { employeeNo: string; cardNo: string };
        if (!this.usuarios.has(c.employeeNo)) return this.erro(res, ERRO.naoExiste);
        const dono = this.cartoes.get(c.cardNo);
        if (dono && dono !== c.employeeNo) return this.erro(res, ERRO.cartaoDeOutro);
        this.cartoes.set(c.cardNo, c.employeeNo);
        return this.ok(res);
      }
      case "PUT /ISAPI/AccessControl/CardInfo/Delete": {
        const lista = ((j.CardInfoDelCond as Objeto)?.EmployeeNoList ?? []) as { employeeNo: string }[];
        for (const e of lista) for (const [n, p] of this.cartoes) if (p === e.employeeNo) this.cartoes.delete(n);
        return this.ok(res);
      }
      case "GET /ISAPI/AccessControl/CaptureCardInfo": {
        if (!this.cartaoParaLer) return this.erro(res, [400, 4, "Invalid Operation", "invalidOperation", 0x40000006]);
        res.writeHead(200, { "Content-Type": "application/json" });
        return void res.end(JSON.stringify({ CardInfo: { cardNo: this.cartaoParaLer } }));
      }
      case "POST /ISAPI/AccessControl/CaptureFingerPrint": {
        if (!this.digitalParaLer) return this.erro(res, [400, 3, "Device Error", "fingerPrintLowQulity", 0x3000600b]);
        return this.okXml(
          res,
          `<CaptureFingerPrint version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><fingerData>${this.digitalParaLer}</fingerData>` +
            `<fingerNo>1</fingerNo><fingerPrintQuality>88</fingerPrintQuality></CaptureFingerPrint>`
        );
      }
      case "POST /ISAPI/AccessControl/FingerPrintDownload": {
        const f = j.FingerPrintCfg as { employeeNo: string; fingerData: string };
        if (!this.usuarios.has(f.employeeNo)) return this.erro(res, ERRO.naoExiste);
        // Dedo já usado pelo aluno: o leitor recusa (situação 6) até a antiga sair.
        this.ultimaDigital = this.digitais.has(f.employeeNo) ? 6 : 1;
        if (this.ultimaDigital === 1) this.digitais.set(f.employeeNo, f.fingerData);
        return this.ok(res);
      }
      case "GET /ISAPI/AccessControl/FingerPrintProgress":
        res.writeHead(200, { "Content-Type": "application/json" });
        return void res.end(JSON.stringify({ FingerPrintStatus: { totalStatus: 1, StatusList: [{ id: 1, cardReaderRecvStatus: this.ultimaDigital }] } }));
      case "PUT /ISAPI/AccessControl/FingerPrint/Delete": {
        const d = (j.FingerPrintDelete as Objeto)?.EmployeeNoDetail as { employeeNo: string } | undefined;
        if (d) this.digitais.delete(d.employeeNo);
        return this.ok(res);
      }
      case "GET /ISAPI/AccessControl/FingerPrint/DeleteProcess":
        res.writeHead(200, { "Content-Type": "application/json" });
        return void res.end(JSON.stringify({ FingerPrintDeleteProcess: { status: "success" } }));
      case "PUT /ISAPI/Intelligent/FDLib/FDSetUp":
      case "POST /ISAPI/Intelligent/FDLib/FaceDataRecord":
      case "PUT /ISAPI/Intelligent/FDLib/FDModify": {
        if (!this.temRosto) return this.erro(res, ERRO.semFuncao);
        const partes = AparelhoHikvisionFalso.partes(bruto, tipo);
        this.partesDoUltimoRosto = partes.map((p) => ({ nome: p.nome, tipo: p.tipo }));
        const dados = partes.find((p) => /json/i.test(p.tipo ?? ""));
        const img = partes.find((p) => /image/i.test(p.tipo ?? ""));
        const r = dados ? (JSON.parse(dados.corpo.toString("utf8")) as { FPID?: string; FDID?: string }) : null;
        if (!r?.FPID || r.FDID !== "1") return this.erro(res, ERRO.formato);
        if (!this.usuarios.has(r.FPID)) return this.erro(res, ERRO.naoExiste);
        // JPEG de verdade, com pelo menos 1 KB: o resto é "nenhum rosto na foto".
        if (!img || img.corpo.length < 1024 || img.corpo[0] !== 0xff || img.corpo[1] !== 0xd8) return this.erro(res, ERRO.semRosto);
        if (caminho.endsWith("FaceDataRecord") && this.rostos.has(r.FPID)) return this.erro(res, [400, 6, "Invalid Content", "deviceUserAlreadyExistFace", 0x60007004]);
        this.rostos.set(r.FPID, img.corpo.length);
        return this.ok(res, { FPID: r.FPID });
      }
      case "PUT /ISAPI/Intelligent/FDLib/FDSearch/Delete": {
        if (!this.temRosto) return this.erro(res, ERRO.semFuncao);
        if (q.get("FDID") !== "1") return this.erro(res, ERRO.formato);
        for (const f of (j.FPID ?? []) as { value: string }[]) this.rostos.delete(f.value);
        return this.ok(res);
      }
      case "POST /ISAPI/AccessControl/CaptureFaceData": {
        if (!this.temRosto || this.tipo === "controladora") return this.erro(res, ERRO.semFuncao);
        const foto = AparelhoHikvisionFalso.jpeg(4000);
        const xml = `<CaptureFaceData version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><captureProgress>100</captureProgress></CaptureFaceData>`;
        const fronteira = "fronteiraFalsa";
        const resposta = Buffer.concat([
          Buffer.from(`--${fronteira}\r\nContent-Disposition: form-data; name="CaptureFace"\r\nContent-Type: application/xml\r\nContent-Length: ${xml.length}\r\n\r\n${xml}\r\n`),
          Buffer.from(`--${fronteira}\r\nContent-Disposition: form-data; name="FaceData"; filename="FaceData.jpg"\r\nContent-Type: image/jpeg\r\nContent-Length: ${foto.length}\r\n\r\n`),
          foto,
          Buffer.from(`\r\n--${fronteira}--\r\n`),
        ]);
        res.writeHead(200, { "Content-Type": `multipart/form-data; boundary=${fronteira}` });
        return void res.end(resposta);
      }
      default:
        if (metodo === "PUT" && caminho.startsWith("/ISAPI/AccessControl/RemoteControl/door/")) {
          if (!/<cmd>open<\/cmd>/.test(String(corpo))) return this.erro(res, ERRO.formato);
          this.portasAbertas.push(Number(caminho.split("/").pop()));
          return this.ok(res);
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        return void res.end(JSON.stringify({ statusCode: 4, statusString: "Invalid Operation", subStatusCode: "notSupport", errorCode: 0x40000001 }));
    }
  }

  private ultimaDigital = 1;

  /** A pessoa está dentro da validade agora? (o que o aparelho confere sozinho, sem o Gateway) */
  dentroDaValidade(id: string, agora = new Date()): boolean {
    const v = this.usuarios.get(id)?.Valid;
    if (!v?.enable) return !!this.usuarios.get(id);
    const t = agora.toISOString().slice(0, 19);
    return (v.beginTime ?? "") <= t && t <= (v.endTime ?? "");
  }

  // ——— O aparelho chamando o Gateway ———

  static jpeg(n: number): Buffer {
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7), Buffer.from([0xff, 0xd9])]);
  }

  static partes(corpo: Buffer, tipo: string): { nome: string | null; tipo: string | null; corpo: Buffer }[] {
    const fronteira = /boundary=([^;]+)/.exec(tipo)?.[1];
    if (!fronteira) return [];
    const marca = Buffer.from(`--${fronteira}`);
    const saida: { nome: string | null; tipo: string | null; corpo: Buffer }[] = [];
    let pos = corpo.indexOf(marca);
    while (pos >= 0) {
      const ini = pos + marca.length;
      if (corpo.subarray(ini, ini + 2).toString() === "--") break;
      const prox = corpo.indexOf(marca, ini);
      const bloco = corpo.subarray(ini, prox);
      pos = prox;
      const fim = bloco.indexOf("\r\n\r\n");
      const cab = bloco.subarray(0, fim).toString();
      const tam = Number(/Content-Length: (\d+)/i.exec(cab)?.[1]);
      saida.push({
        nome: /name="([^"]+)"/.exec(cab)?.[1] ?? null,
        tipo: /Content-Type: ([^\r\n;]+)/i.exec(cab)?.[1] ?? null,
        corpo: bloco.subarray(fim + 4, fim + 4 + tam),
      });
    }
    return saida;
  }

  /**
   * Um evento de acesso como o aparelho manda ao servidor de escuta:
   * multipart/form-data, o JSON do evento e, se houver, a foto.
   */
  static corpoEvento(dados: Objeto, foto: Buffer | null = null, quando = new Date()): { corpo: Buffer; tipo: string } {
    const json = JSON.stringify({
      ipAddress: "10.0.0.30",
      portNo: 80,
      protocol: "HTTP",
      channelID: 1,
      dateTime: quando.toISOString(),
      activePostCount: 1,
      eventType: "AccessControllerEvent",
      AccessControllerEvent: { deviceName: "Falso", majorEventType: 5, currentEvent: true, cardReaderNo: 1, ...dados },
    });
    const fronteira = "MIME_boundary";
    const partes: Buffer[] = [Buffer.from(`--${fronteira}\r\nContent-Disposition: form-data; name="AccessControllerEvent"\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}\r\n`)];
    if (foto) {
      partes.push(Buffer.from(`--${fronteira}\r\nContent-Disposition: form-data; name="Picture"; filename="Picture.jpg"\r\nContent-Type: image/jpeg\r\nContent-Length: ${foto.length}\r\n\r\n`), foto, Buffer.from("\r\n"));
    }
    partes.push(Buffer.from(`--${fronteira}--\r\n`));
    return { corpo: Buffer.concat(partes), tipo: `multipart/form-data; boundary=${fronteira}` };
  }
}
