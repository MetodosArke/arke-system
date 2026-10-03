import http from "node:http";
import { autorizacaoDigest, lerDesafio, type DesafioDigest } from "./protocolo";
import type { EquipamentoIntelbras } from "../../types";

/**
 * A API CGI de um terminal Intelbras, com autenticação Digest. O primeiro
 * pedido volta 401 com o desafio (é o protocolo, não erro); os seguintes
 * reaproveitam o desafio, contando o `nc`, até o terminal trocar o nonce.
 *
 * Feito sobre o `http` do Node, e não com o axios da Control iD, porque o
 * Digest assina o caminho exato: aqui o caminho que sai é o que foi
 * assinado, sem nenhuma normalização no meio. A senha não vai para log.
 */
export class ClienteIntelbras {
  private desafio: DesafioDigest | null = null;
  private nc = 0;

  constructor(
    readonly eq: EquipamentoIntelbras,
    private readonly timeoutMs = 8_000
  ) {}

  private pedir(metodo: string, caminho: string, corpo: string | undefined, autorizacao: string | null) {
    return new Promise<{ status: number; corpo: string; desafio: string | null }>((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (autorizacao) headers.Authorization = autorizacao;
      if (corpo !== undefined) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = String(Buffer.byteLength(corpo));
      }
      const req = http.request(
        { host: this.eq.ip, port: this.eq.porta, path: caminho, method: metodo, headers, timeout: this.timeoutMs },
        (res) => {
          const partes: Buffer[] = [];
          res.on("data", (d: Buffer) => partes.push(d));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              corpo: Buffer.concat(partes).toString("utf8"),
              desafio: (res.headers["www-authenticate"] as string | undefined) ?? null,
            })
          );
        }
      );
      req.on("timeout", () => req.destroy(new Error(`${this.eq.nome}: o terminal não respondeu em ${this.timeoutMs / 1000} s`)));
      req.on("error", (e) => reject(e));
      if (corpo !== undefined) req.write(corpo);
      req.end();
    });
  }

  /** GET sem corpo; POST com JSON. Devolve o texto da resposta. */
  async chamar(caminho: string, corpo?: unknown): Promise<string> {
    const metodo = corpo === undefined ? "GET" : "POST";
    const texto = corpo === undefined ? undefined : JSON.stringify(corpo);
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const autorizacao = this.desafio
        ? autorizacaoDigest({ usuario: this.eq.usuario, senha: this.eq.senha, metodo, uri: caminho, desafio: this.desafio, nc: ++this.nc })
        : null;
      const r = await this.pedir(metodo, caminho, texto, autorizacao);
      if (r.status === 401) {
        const d = lerDesafio(r.desafio);
        if (!d) throw new Error(`${this.eq.nome}: o terminal pediu autenticação que não é Digest`);
        // Com desafio novo, tenta de novo uma vez. Recusado com a nossa
        // assinatura de um desafio que ele mesmo deu é senha errada.
        const recusouAssinatura = !!autorizacao && this.desafio?.nonce === d.nonce;
        this.desafio = d;
        this.nc = 0;
        if (recusouAssinatura || tentativa === 1) throw new Error(`${this.eq.nome}: usuário ou senha do terminal recusados`);
        continue;
      }
      // 400 e 404 são o terminal recusando o comando (a documentação avisa
      // que alguns modelos respondem 404 a todo cadastro recusado): volta como
      // resposta, que não é "OK", e quem chamou decide. O resto é falha.
      if (r.status === 400 || r.status === 404) return `RECUSADO ${r.status}: ${r.corpo.trim()}`;
      if (r.status >= 400) throw new Error(`${this.eq.nome}: o terminal respondeu ${r.status}`);
      return r.corpo;
    }
    throw new Error(`${this.eq.nome}: não foi possível autenticar no terminal`);
  }
}
