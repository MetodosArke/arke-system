import http from "node:http";
import { createHash, randomBytes } from "node:crypto";

/**
 * Terminal Intelbras (linha Bio-T) de mentira, escrito a partir da
 * documentação de integração (coleção oficial do portal e os exemplos em
 * github.com/integracaoca), sem importar o código do Gateway.
 *
 * Serve a API CGI com autenticação Digest (RFC 2617) e guarda usuários e
 * rostos como o terminal: inserir quem já existe e atualizar quem não existe
 * são recusados com 400. E faz o papel do terminal no Modo Online: manda as
 * tentativas em multipart, com a foto, e o keepalive.
 */
export class TerminalIntelbrasFalso {
  usuario = "admin";
  senha = "admin123";
  readonly realm = "Login to TERMINAL";
  private nonce = randomBytes(8).toString("hex");
  /** Cada chamada CGI autenticada: caminho e corpo. */
  chamadas: { caminho: string; corpo: unknown }[] = [];
  /** Tentativas recusadas pela senha (Digest errado). */
  recusasDeSenha = 0;
  usuarios = new Map<string, Record<string, unknown>>();
  rostos = new Map<string, number>();
  portasAbertas: number[] = [];
  configs: string[] = [];
  hora: string | null = null;
  private servidor: http.Server | null = null;
  porta = 0;

  trocarNonce(): void {
    this.nonce = randomBytes(8).toString("hex");
  }

  private digestValido(cabecalho: string | undefined, metodo: string, uri: string): boolean {
    if (!cabecalho?.startsWith("Digest ")) return false;
    const campo = (n: string) => new RegExp(`${n}="?([^",]+)"?`).exec(cabecalho)?.[1];
    if (campo("username") !== this.usuario || campo("nonce") !== this.nonce || campo("uri") !== uri) return false;
    const md5 = (s: string) => createHash("md5").update(s).digest("hex");
    const ha1 = md5(`${this.usuario}:${this.realm}:${this.senha}`);
    const ha2 = md5(`${metodo}:${uri}`);
    const esperado = md5(`${ha1}:${this.nonce}:${campo("nc")}:${campo("cnonce")}:auth:${ha2}`);
    return campo("response") === esperado;
  }

  async iniciar(): Promise<void> {
    this.servidor = http.createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on("data", (d: Buffer) => partes.push(d));
      req.on("end", () => {
        const uri = req.url ?? "";
        if (!this.digestValido(req.headers.authorization, req.method ?? "GET", uri)) {
          if (req.headers.authorization) this.recusasDeSenha++;
          res.writeHead(401, { "WWW-Authenticate": `Digest realm="${this.realm}", qop="auth", nonce="${this.nonce}", opaque="abc123"` });
          return res.end();
        }
        const corpo = partes.length ? JSON.parse(Buffer.concat(partes).toString("utf8")) : null;
        this.chamadas.push({ caminho: uri, corpo });
        const [status, texto] = this.atender(uri, corpo);
        res.writeHead(status, { "Content-Type": "text/plain", "Content-Length": Buffer.byteLength(texto) });
        res.end(texto);
      });
    });
    await new Promise<void>((r) => this.servidor!.listen(0, "127.0.0.1", r));
    this.porta = (this.servidor.address() as { port: number }).port;
  }

  async parar(): Promise<void> {
    await new Promise<void>((r) => (this.servidor ? this.servidor.close(() => r()) : r()));
  }

  private atender(uri: string, corpo: { UserList?: Record<string, unknown>[]; FaceList?: { UserID: string; PhotoData: string[] }[] } | null): [number, string] {
    const ok: [number, string] = [200, "OK\r\n"];
    const erro: [number, string] = [400, "Error\r\n"];
    const q = new URL(uri, "http://x").searchParams;
    const acao = q.get("action");
    if (uri.startsWith("/cgi-bin/magicBox.cgi")) return [200, "version=2.000.0000000.5.R,build:2024-03-01\r\n"];
    if (uri.startsWith("/cgi-bin/global.cgi") && acao === "setCurrentTime") {
      this.hora = q.get("time");
      return ok;
    }
    if (uri.startsWith("/cgi-bin/configManager.cgi") && acao === "setConfig") {
      this.configs.push(uri);
      return ok;
    }
    if (uri.startsWith("/cgi-bin/accessControl.cgi") && acao === "openDoor") {
      this.portasAbertas.push(Number(q.get("channel")));
      return ok;
    }
    if (uri.startsWith("/cgi-bin/AccessUser.cgi")) {
      if (acao === "insertMulti") {
        if (corpo!.UserList!.some((u) => this.usuarios.has(String(u.UserID)))) return erro;
        for (const u of corpo!.UserList!) this.usuarios.set(String(u.UserID), u);
        return ok;
      }
      if (acao === "updateMulti") {
        if (corpo!.UserList!.some((u) => !this.usuarios.has(String(u.UserID)))) return erro;
        for (const u of corpo!.UserList!) this.usuarios.set(String(u.UserID), u);
        return ok;
      }
      if (acao === "removeMulti") {
        const id = q.get("UserIDList[0]")!;
        return this.usuarios.delete(id) ? ok : erro;
      }
    }
    if (uri.startsWith("/cgi-bin/AccessFace.cgi")) {
      if (acao === "removeMulti") return this.rostos.delete(q.get("UserIDList[0]")!) ? ok : erro;
      const f = corpo!.FaceList![0];
      if (!this.usuarios.has(f.UserID)) return erro;
      const bytes = Buffer.from(f.PhotoData[0], "base64");
      // JPEG até 100 KB, como a documentação pede.
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.length > 100 * 1024) return erro;
      if (acao === "insertMulti" && this.rostos.has(f.UserID)) return erro;
      if (acao === "updateMulti" && !this.rostos.has(f.UserID)) return erro;
      this.rostos.set(f.UserID, bytes.length);
      return ok;
    }
    return [404, "Not Found"];
  }

  // ——— O terminal chamando o Gateway ———

  /** Uma tentativa de acesso, como o terminal manda: multipart/mixed, CRLF, com a foto. */
  static corpoTentativa(dados: Record<string, unknown>, foto = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x10, 0x20, 0xff, 0xd9])): Buffer {
    const json = JSON.stringify({
      Events: [{ Action: "Pulse", Code: "AccessControl", Data: dados, Index: 0, PhysicalAddress: "c0:39:5a:62:64:c9" }],
      Time: "03-10-2026 10:00:00",
    });
    return TerminalIntelbrasFalso.multipart(json, foto);
  }

  static multipart(json: string, foto: Buffer): Buffer {
    return Buffer.concat([
      Buffer.from(`--myboundary\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}\r\n`),
      Buffer.from(`--myboundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${foto.length}\r\n\r\n`),
      foto,
      Buffer.from("\r\n--myboundary--\r\n"),
    ]);
  }
}
