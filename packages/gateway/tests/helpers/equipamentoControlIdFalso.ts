import Fastify, { type FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";

type Objeto = Record<string, unknown> & { id: number };
type Tabela = "users" | "templates" | "cards";

/**
 * Equipamento Control iD de mentira, com a API de gestão que o Gateway usa
 * (login, objetos, cadastro remoto, ações), no formato da documentação.
 * Guarda usuários, digitais e cartões em memória e anota cada chamada, para
 * os testes afirmarem O QUE o Gateway pediu e EM QUE ORDEM.
 */
export class EquipamentoControlIdFalso {
  readonly app: FastifyInstance = Fastify({ logger: false });
  readonly tabelas: Record<Tabela, Objeto[]> = { users: [], templates: [], cards: [] };
  readonly chamadas: { rota: string; corpo: Record<string, unknown>; query: Record<string, string> }[] = [];
  /** Fotos de rosto por usuário (bytes recebidos em user_set_image ou capturados pela câmera). */
  readonly rostos = new Map<number, Buffer>();
  /** Configurações recebidas por set_configuration. */
  readonly configuracoes: Record<string, unknown>[] = [];
  /** Recusa a próxima foto com estes erros (formato da documentação). */
  recusarFoto: { code: number; message: string }[] | null = null;
  private proximoId = 1000;
  private sessoes = new Set<string>();

  senha = "admin";
  /** Resposta do próximo cadastro remoto: demora, falha ou valor de cartão. */
  cadastro: { demoraMs?: number; falhar?: boolean; cartao?: number } = {};
  /** Recusa o próximo create_objects com esta mensagem. */
  recusarCriacao: string | null = null;

  porta = 0;

  constructor(readonly nome = "Equipamento falso") {
    this.app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, corpo, pronto) => pronto(null, corpo));
    const autenticar = (sessao: unknown) => typeof sessao === "string" && this.sessoes.has(sessao);

    this.app.addHook("preHandler", async (req, reply) => {
      const rota = req.url.split("?")[0];
      const corpo = Buffer.isBuffer(req.body) ? { bytes: (req.body as Buffer).length } : ((req.body ?? {}) as Record<string, unknown>);
      this.chamadas.push({ rota, corpo, query: { ...(req.query as Record<string, string>) } });
      if (rota === "/login.fcgi") return;
      const sessao = (req.query as Record<string, string>).session;
      if (!autenticar(sessao)) {
        // O equipamento responde 401 para sessão inválida.
        return reply.code(401).send({ error: "Invalid session" });
      }
    });

    this.app.post("/login.fcgi", async (req, reply) => {
      const corpo = req.body as { login?: string; password?: string };
      if (corpo?.login !== "admin" || corpo?.password !== this.senha) {
        return reply.code(401).send({ error: "Invalid login or password" });
      }
      const sessao = `sessao-${Math.random().toString(36).slice(2)}`;
      this.sessoes.add(sessao);
      return { session: sessao };
    });

    this.app.post("/session_is_valid.fcgi", async () => ({ session_is_valid: true }));

    const filtrar = (tabela: Tabela, where: unknown) => {
      const cond = ((where as Record<string, Record<string, unknown>> | undefined)?.[tabela] ?? {}) as Record<string, unknown>;
      return this.tabelas[tabela].filter((o) => Object.entries(cond).every(([k, v]) => o[k] === v));
    };

    this.app.post("/load_objects.fcgi", async (req) => {
      const { object, where, fields } = req.body as { object: Tabela; where?: unknown; fields?: string[] };
      const itens = filtrar(object, where).map((o) =>
        fields ? Object.fromEntries(fields.map((f) => [f, o[f]])) : { ...o }
      );
      return { [object]: itens };
    });

    this.app.post("/create_objects.fcgi", async (req, reply) => {
      const { object, values } = req.body as { object: Tabela; values: Record<string, unknown>[] };
      if (this.recusarCriacao) {
        const erro = this.recusarCriacao;
        this.recusarCriacao = null;
        return reply.code(400).send({ error: erro });
      }
      const ids: number[] = [];
      for (const v of values) {
        const id = typeof v.id === "number" ? v.id : this.proximoId++;
        if (this.tabelas[object].some((o) => o.id === id)) {
          return reply.code(400).send({ error: "UNIQUE constraint failed" });
        }
        this.tabelas[object].push({ ...v, id });
        ids.push(id);
      }
      return { ids };
    });

    this.app.post("/modify_objects.fcgi", async (req) => {
      const { object, values, where } = req.body as { object: Tabela; values: Record<string, unknown>; where?: unknown };
      const alvo = filtrar(object, where);
      for (const o of alvo) Object.assign(o, values);
      return { changes: alvo.length };
    });

    this.app.post("/destroy_objects.fcgi", async (req) => {
      const { object, where } = req.body as { object: Tabela; where?: unknown };
      const alvo = new Set(filtrar(object, where));
      this.tabelas[object] = this.tabelas[object].filter((o) => !alvo.has(o));
      return { changes: alvo.size };
    });

    this.app.post("/remote_enroll.fcgi", async (req, reply) => {
      const corpo = req.body as { type: string; user_id: number };
      const { demoraMs, falhar, cartao } = this.cadastro;
      if (demoraMs) await new Promise((r) => setTimeout(r, demoraMs));
      if (falhar) return reply.code(400).send({ error: "Enrollment canceled" });
      if (corpo.type === "face") {
        const foto = EquipamentoControlIdFalso.jpegFalso("ROSTO-CAPTURADO-PELA-CAMERA");
        this.rostos.set(corpo.user_id, foto);
        // O que o equipamento de verdade devolve: a foto capturada.
        return { success: true, user_id: corpo.user_id, device_id: 1, user_image: foto.toString("base64") };
      }
      if (corpo.type === "biometry") {
        this.tabelas.templates.push({
          id: this.proximoId++,
          user_id: corpo.user_id,
          finger_position: 0,
          finger_type: 0,
          template: "TEMPLATE-BASE64-DO-DEDO",
        });
        // O que o equipamento de verdade devolve: imagens da digital.
        return {
          success: true,
          user_id: corpo.user_id,
          device_id: 1,
          finger_type: 0,
          fingerprints: [{ width: 256, height: 288, image: "IMAGEM-DA-DIGITAL-BASE64" }],
        };
      }
      const valor = cartao ?? 4294967297;
      this.tabelas.cards.push({ id: this.proximoId++, user_id: corpo.user_id, value: valor });
      return { success: true, user_id: corpo.user_id, device_id: 1, card_value: valor };
    });

    this.app.post("/user_set_image.fcgi", async (req) => {
      const userId = Number((req.query as Record<string, string>).user_id);
      if (!this.tabelas.users.some((u) => u.id === userId)) {
        return { user_id: userId, success: false, errors: [{ code: 1, message: "User does not exist" }] };
      }
      if (this.recusarFoto) {
        const errors = this.recusarFoto;
        this.recusarFoto = null;
        return { user_id: userId, success: false, errors };
      }
      this.rostos.set(userId, Buffer.from(req.body as Buffer));
      return { user_id: userId, scores: { bounds_width: 300 }, success: true };
    });
    this.app.post("/user_destroy_image.fcgi", async (req) => {
      this.rostos.delete(Number((req.body as { user_id?: number | string }).user_id));
      return {};
    });
    this.app.post("/set_configuration.fcgi", async (req) => {
      this.configuracoes.push(req.body as Record<string, unknown>);
      return {};
    });
    this.app.post("/cancel_remote_enroll.fcgi", async () => ({}));
    this.app.post("/execute_actions.fcgi", async () => ({}));
  }

  /** Um "JPEG" de teste: começa com FF D8, como todo JPEG, e carrega uma marca legível. */
  static jpegFalso(marca: string): Buffer {
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(marca), Buffer.alloc(1500, 7)]);
  }

  /** Derruba todas as sessões — como o equipamento faz ao reiniciar. */
  expirarSessoes(): void {
    this.sessoes.clear();
  }

  rotas(): string[] {
    return this.chamadas.map((c) => c.rota);
  }

  async iniciar(): Promise<number> {
    await this.app.listen({ port: 0, host: "127.0.0.1" });
    this.porta = (this.app.server.address() as AddressInfo).port;
    return this.porta;
  }

  async parar(): Promise<void> {
    await this.app.close();
  }
}
