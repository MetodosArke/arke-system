import axios, { type AxiosInstance } from "axios";
import type { EquipamentoFacialTopdata } from "./leitor";

/**
 * A API HTTP do próprio leitor facial (o "WebService" da linha F4), que o
 * Gateway chama pela rede local da academia. Documentada em
 * integrador.topdata.com.br/suporte/protocolo-facial-web-api/, conferida em
 * 02/10/2026.
 *
 * Ela NÃO decide acesso (a página é explícita: a API HTTP não faz validação
 * online) — isso é o WebSocket. Aqui ficam só as ordens que o WebSocket não
 * tem: abrir a catraca a pedido da recepção e as configurações de foto.
 *
 * Todas as chamadas levam a senha de gerenciamento do menu do leitor. Ela
 * mora só no config.json e não vai para log nem para a nuvem.
 */

export interface RespostaApiFacial {
  ret?: string;
  sn?: string;
  result?: boolean;
  reason?: number;
  msg?: string;
  [chave: string]: unknown;
}

/** Os códigos de erro da página da API, para a recepção entender a falha. */
const MOTIVOS: Record<number, string> = {
  1: "usuário não encontrado ou parâmetro inválido",
  2: "senha do leitor incorreta",
  3: "leitor ocupado (há um cadastro em andamento)",
  5: "nenhum rosto na imagem",
  6: "mais de um rosto na imagem",
  7: "imagem grande demais",
  8: "rosto muito perto",
  9: "rosto muito longe",
  10: "imagem de baixa qualidade",
  11: "rosto fora do centro",
  12: "este rosto já está cadastrado para outra pessoa",
};

export function motivoDaFalha(reason: unknown, msg?: unknown): string {
  const n = Number(reason);
  if (Number.isFinite(n) && MOTIVOS[n]) return MOTIVOS[n];
  const texto = typeof msg === "string" && msg.trim() ? msg.trim() : null;
  return texto ?? (Number.isFinite(n) ? `código ${n}` : "sem detalhe do leitor");
}

export class ApiHttpFacial {
  private readonly http: AxiosInstance;

  constructor(private readonly eq: EquipamentoFacialTopdata, timeoutMs = 8_000) {
    this.http = axios.create({
      baseURL: `http://${eq.ip}:${eq.porta_http ?? 80}`,
      timeout: timeoutMs,
      headers: { "Content-Type": "application/json" },
    });
  }

  get configurada(): boolean {
    return !!this.eq.senha;
  }

  async chamar(cmd: string, parametros: Record<string, unknown> = {}): Promise<RespostaApiFacial> {
    if (!this.eq.senha) {
      throw new Error(`O leitor "${this.eq.nome}" está sem a senha de gerenciamento no config.json.`);
    }
    let dados: RespostaApiFacial;
    try {
      const r = await this.http.post<RespostaApiFacial>("/api", { cmd, password: this.eq.senha, ...parametros });
      dados = r.data ?? {};
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      // 503 é o leitor ocupado (até 20 conexões); 408, a conexão parada.
      throw new Error(
        `O leitor "${this.eq.nome}" não respondeu à API HTTP${status ? ` (HTTP ${status})` : ""}: ${(err as Error).message}`
      );
    }
    if (dados.result === false) {
      throw new Error(`O leitor "${this.eq.nome}" recusou "${cmd}": ${motivoDaFalha(dados.reason, dados.msg)}.`);
    }
    return dados;
  }

  /** Abre a catraca, com a mensagem por uns 3 segundos na tela. */
  async abrir(mensagem: string): Promise<void> {
    await this.chamar("opendoor", { msg: mensagem });
  }

  /**
   * Rosto pela câmera do leitor: `adduser` abre a tela de cadastro no
   * próprio leitor, e `checkregstatus` diz como foi (0 em andamento, 1
   * sucesso, -1 cancelado, outro valor falha). A imagem de pré-visualização
   * que o checkregstatus pode trazer é ignorada.
   */
  async cadastrarRosto(enrollid: number, timeoutMs: number, intervaloMs = 1_000): Promise<void> {
    await this.chamar("adduser", { enrollid, name: "Aluno", admin: 0, backupnum: 50, flag: 0 });
    const fim = Date.now() + timeoutMs;
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, intervaloMs));
        const r = await this.chamar("checkregstatus");
        const status = Number(r.status);
        if (status === 1) return;
        if (status === -1) throw new Error(`O cadastro do rosto foi cancelado no leitor "${this.eq.nome}".`);
        if (status !== 0) throw new Error(`O leitor "${this.eq.nome}" não concluiu o cadastro do rosto${r.msg ? `: ${String(r.msg)}` : ""}.`);
        if (Date.now() > fim) throw new Error(`O aluno não terminou o cadastro do rosto no leitor "${this.eq.nome}" a tempo.`);
      }
    } catch (err) {
      // O leitor fica preso na tela de cadastro até alguém cancelar.
      await this.chamar("adduser", { cancel: true }).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Desliga a foto em cada registro de acesso e a foto de desconhecido.
   * O leitor guardaria o rosto de cada pessoa que passa na frente dele,
   * aluno ou não, e o ARKE não precisa disso para nada.
   */
  async desligarFotos(): Promise<void> {
    await this.chamar("setdevinfo", { use_logphoto: 0, stranger_photo: 0 });
  }
}
