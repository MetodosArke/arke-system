import http from "node:http";
import { autorizacaoDigest, lerDesafio, type DesafioDigest } from "../../core/digest";
import { comVariacao } from "../../core/espera";
import type { EquipamentoHikvision } from "../../types";
import { ERROS_DE_FUNCAO, lerStatus, mensagemDoErro, montarMultipart, statusOk, textoDaResposta, type ParteEnvio, type StatusIsapi } from "./protocolo";

/**
 * Erro do aparelho, já em português e sem nada do aluno. `sub` é o código do
 * aparelho, para quem chamou decidir (aluno que não existe, função que o
 * firmware não tem); `transitorio` diz se vale tentar de novo.
 */
export class ErroHikvision extends Error {
  constructor(
    message: string,
    readonly status: StatusIsapi | null,
    readonly http: number,
    readonly transitorio = false,
    readonly senhaRecusada = false
  ) {
    super(message);
    this.name = "ErroHikvision";
  }
  get sub(): string | null {
    return this.status?.subStatusCode ?? null;
  }
  /** O aparelho não tem esta chamada: vale a outra forma da mesma operação. */
  get semFuncao(): boolean {
    return this.http === 404 || this.http === 405 || ERROS_DE_FUNCAO.has(this.sub ?? "");
  }
}

export interface OpcoesClienteHikvision {
  /** Prazo de cada chamada (padrão 8 s). */
  timeoutMs?: number;
  /** Quantas vezes tentar quando a falha é passageira (rede, aparelho ocupado). Padrão 3. */
  tentativas?: number;
  /** Espera antes da segunda tentativa; dobra a cada falha, com variação (`comVariacao`). */
  esperaMs?: number;
}

export interface OpcoesChamada {
  timeoutMs?: number;
  tentativas?: number;
}

interface Resposta {
  status: number;
  corpo: Buffer;
  tipo: string | null;
  desafio: string | null;
}

const ERROS_DE_REDE = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "EPIPE", "EAI_AGAIN"]);

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A API ISAPI de um aparelho Hikvision, com autenticação Digest.
 *
 * O primeiro pedido volta 401 com o desafio (é o protocolo, não erro); os
 * seguintes reaproveitam o desafio, contando o `nc`, até o aparelho trocar o
 * nonce. Recusado com a nossa assinatura de um desafio que ele mesmo deu é
 * senha errada, e o cliente para ali: a Hikvision bloqueia o usuário depois
 * de algumas senhas erradas seguidas, e insistir trancaria a recepção para
 * fora do aparelho.
 *
 * Toda chamada tem prazo. Falha passageira (rede, aparelho ocupado) tenta de
 * novo, com a espera dobrando e variando (o padrão do Gateway). Feito sobre
 * o `http` do Node, como o da Intelbras, para o caminho assinado ser o
 * enviado. A senha não vai para log nem para mensagem de erro.
 */
export class ClienteHikvision {
  private desafio: DesafioDigest | null = null;
  private nc = 0;
  private readonly timeoutMs: number;
  private readonly tentativas: number;
  private readonly esperaMs: number;

  constructor(
    readonly eq: EquipamentoHikvision,
    opcoes: OpcoesClienteHikvision = {}
  ) {
    this.timeoutMs = opcoes.timeoutMs ?? 8_000;
    this.tentativas = Math.max(1, opcoes.tentativas ?? 3);
    this.esperaMs = opcoes.esperaMs ?? 500;
  }

  private enviar(metodo: string, caminho: string, corpo: { tipo: string; dados: Buffer } | undefined, autorizacao: string | null, timeoutMs: number) {
    return new Promise<Resposta>((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (autorizacao) headers.Authorization = autorizacao;
      if (corpo) {
        headers["Content-Type"] = corpo.tipo;
        headers["Content-Length"] = String(corpo.dados.length);
      }
      const req = http.request({ host: this.eq.ip, port: this.eq.porta, path: caminho, method: metodo, headers, timeout: timeoutMs }, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (d: Buffer) => partes.push(d));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            corpo: Buffer.concat(partes),
            tipo: (res.headers["content-type"] as string | undefined) ?? null,
            desafio: (res.headers["www-authenticate"] as string | undefined) ?? null,
          })
        );
        res.on("error", reject);
      });
      req.on("timeout", () => {
        const e = new Error(`${this.eq.nome}: o aparelho não respondeu em ${Math.round(timeoutMs / 1000)} s`) as NodeJS.ErrnoException;
        e.code = "ETIMEDOUT";
        req.destroy(e);
      });
      req.on("error", reject);
      if (corpo) req.write(corpo.dados);
      req.end();
    });
  }

  /** Um pedido com o Digest resolvido: o 401 do desafio é respondido aqui. */
  private async autenticado(metodo: string, caminho: string, corpo: { tipo: string; dados: Buffer } | undefined, timeoutMs: number): Promise<Resposta> {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const autorizacao = this.desafio
        ? autorizacaoDigest({ usuario: this.eq.usuario, senha: this.eq.senha, metodo, uri: caminho, desafio: this.desafio, nc: ++this.nc })
        : null;
      const r = await this.enviar(metodo, caminho, corpo, autorizacao, timeoutMs);
      if (r.status !== 401) return r;
      const d = lerDesafio(r.desafio);
      if (!d) throw new ErroHikvision(`${this.eq.nome}: o aparelho pediu uma autenticação que não é Digest`, null, 401);
      const recusouAssinatura = !!autorizacao && this.desafio?.nonce === d.nonce && !d.stale;
      this.desafio = d;
      this.nc = 0;
      if (recusouAssinatura || tentativa === 1) {
        throw new ErroHikvision(
          `${this.eq.nome}: usuário ou senha do aparelho recusados (confira no config.json; depois de algumas tentativas erradas o aparelho bloqueia o acesso por um tempo)`,
          lerStatus(r.corpo.toString("utf8")),
          401,
          false,
          true
        );
      }
    }
    throw new ErroHikvision(`${this.eq.nome}: não foi possível autenticar no aparelho`, null, 401);
  }

  /**
   * Um pedido completo: Digest, prazo e as novas tentativas. Devolve a
   * resposta 2xx; o resto vira `ErroHikvision`, com a frase do erro.
   */
  async pedir(metodo: string, caminho: string, corpo?: { tipo: string; dados: Buffer }, opcoes: OpcoesChamada = {}): Promise<{ corpo: Buffer; tipo: string | null }> {
    const tentativas = Math.max(1, opcoes.tentativas ?? this.tentativas);
    const timeoutMs = opcoes.timeoutMs ?? this.timeoutMs;
    let espera = this.esperaMs;
    for (let n = 1; ; n++) {
      let erro: ErroHikvision;
      try {
        const r = await this.autenticado(metodo, caminho, corpo, timeoutMs);
        const texto = r.status >= 300 || /json|xml|text/i.test(r.tipo ?? "") ? textoDaResposta(r.corpo, r.tipo) : "";
        const status = texto ? lerStatus(texto) : null;
        if (r.status >= 200 && r.status < 300 && statusOk(status)) return { corpo: r.corpo, tipo: r.tipo };
        const ocupado = r.status === 503 || status?.statusCode === 2;
        erro = new ErroHikvision(`${this.eq.nome}: ${mensagemDoErro(status, r.status)}`, status, r.status, ocupado);
      } catch (err) {
        if (err instanceof ErroHikvision) throw err;
        const e = err as NodeJS.ErrnoException;
        const rede = ERROS_DE_REDE.has(e.code ?? "") || /socket hang up/i.test(e.message);
        const frase = e.code === "ECONNREFUSED" ? "o aparelho recusou a conexão (desligado, ou a porta HTTP está errada)" : e.message.replace(`${this.eq.nome}: `, "");
        erro = new ErroHikvision(`${this.eq.nome}: ${frase}`, null, 0, rede);
      }
      if (!erro.transitorio || n >= tentativas) throw erro;
      await dormir(comVariacao(espera));
      espera *= 2;
    }
  }

  /** Pedido e resposta em JSON. */
  async json<T = Record<string, unknown>>(metodo: string, caminho: string, corpo?: unknown, opcoes?: OpcoesChamada): Promise<T> {
    const envio = corpo === undefined ? undefined : { tipo: "application/json", dados: Buffer.from(JSON.stringify(corpo)) };
    const r = await this.pedir(metodo, caminho, envio, opcoes);
    const texto = textoDaResposta(r.corpo, r.tipo).trim();
    if (!texto) return {} as T;
    try {
      return JSON.parse(texto) as T;
    } catch {
      throw new ErroHikvision(`${this.eq.nome}: o aparelho respondeu algo que não é JSON`, null, 200);
    }
  }

  /** Pedido e resposta em XML (o texto da resposta). */
  async xml(metodo: string, caminho: string, corpo?: string, opcoes?: OpcoesChamada): Promise<string> {
    const envio = corpo === undefined ? undefined : { tipo: "application/xml; charset=UTF-8", dados: Buffer.from(corpo) };
    const r = await this.pedir(metodo, caminho, envio, opcoes);
    return textoDaResposta(r.corpo, r.tipo);
  }

  /** Pedido em multipart (o rosto), resposta em JSON. */
  async multipart(metodo: string, caminho: string, partes: ParteEnvio[], opcoes?: OpcoesChamada): Promise<void> {
    const { corpo, tipo } = montarMultipart(partes);
    await this.pedir(metodo, caminho, { tipo, dados: corpo }, opcoes);
  }
}
