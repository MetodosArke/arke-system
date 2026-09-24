import axios, { type AxiosInstance } from "axios";
import type { EquipamentoControlId } from "../types";
import { logger } from "../logger";

/**
 * Gestão remota do equipamento Control iD — o lado que o receptor não cobre.
 *
 * O receptor (receptores/controlid.ts) é o equipamento chamando o Gateway a
 * cada leitura. Aqui é o contrário: o Gateway chamando o equipamento, pela
 * API HTTP documentada da linha de acesso, para o que antes era todo manual:
 *
 *   - criar o aluno no equipamento, com o mesmo número que o ARKE usa como
 *     `identificador_catraca` (create_objects / modify_objects);
 *   - cadastrar a digital ou o cartão com o aluno na frente do leitor
 *     (remote_enroll, síncrono), e copiar para as outras catracas da
 *     academia — cada equipamento guarda as próprias digitais;
 *   - apagar o aluno, as digitais e os cartões dele — obrigação da LGPD
 *     depois da revogação ou da saída (destroy_objects);
 *   - liberar a catraca a pedido da recepção (execute_actions → catra).
 *
 * Referências (conferidas em 23/09/2026):
 *   /docs/access-api-pt/primeiros-passos/realizar-login/
 *   /docs/access-api-pt/objetos/{criar,carregar,modificar,destruir}-objetos/
 *   /docs/access-api-pt/objetos/lista-de-objetos/ (users, templates, cards)
 *   /docs/access-api-pt/acoes/cadastro-remoto-biometria-facial-cartao/
 *   /docs/access-api-pt/acoes/abertura-remota-porta-e-catraca/
 *
 * DADO BIOMÉTRICO. A resposta síncrona do cadastro de digital traz as
 * imagens das digitais lidas (`fingerprints`), e a cópia entre equipamentos
 * passa o template pela memória do Gateway. Nada disso vai para log, para o
 * resultado do comando ou para a nuvem: este módulo lê só `success` da
 * resposta, e o template atravessa a rede local da academia de um
 * equipamento para o outro, sem ser guardado. É o mesmo princípio da
 * decisão de acesso: dado biométrico não sai do equipamento para decidir
 * nada.
 *
 * O que só a bancada confirma: o tempo real do cadastro remoto e as
 * mensagens de erro exatas de cada firmware. Por isso os erros do
 * equipamento sobem crus para a nuvem — é o texto que o suporte precisa ver.
 */

export type ReplicacaoEquipamentos = {
  /** Equipamentos que receberam a cópia, além do que fez a leitura. */
  replicado_em: string[];
  falhou_em: { equipamento: string; erro: string }[];
};

export interface GestaoEquipamentos {
  /** Nomes dos equipamentos configurados, na ordem do config. */
  nomes(): string[];
  /** Faz login em cada equipamento: é o "está alcançável e com a senha certa?" do suporte. */
  testar(): Promise<{ equipamento: string; ok: boolean; erro?: string }[]>;
  criarUsuario(userId: number, nome: string, matricula: string): Promise<{ equipamentos: string[] }>;
  apagarUsuario(userId: number): Promise<{ equipamentos: string[]; apagados: number }>;
  cadastrarDigital(userId: number, equipamento?: string | null): Promise<{ equipamento: string } & ReplicacaoEquipamentos>;
  cadastrarCartao(
    userId: number,
    equipamento?: string | null
  ): Promise<{ equipamento: string; cartoes: number } & ReplicacaoEquipamentos>;
  liberarCatraca(sentido: "entrada" | "saida" | "ambos", equipamento?: string | null): Promise<{ equipamento: string }>;
}

/** Tempo máximo do cadastro remoto: o aluno precisa pôr o dedo três vezes. */
const TIMEOUT_CADASTRO_MS = 90_000;

function mensagemDeErro(err: unknown): string {
  const e = err as { response?: { data?: { error?: unknown } }; message?: string };
  const doEquipamento = e.response?.data?.error;
  return typeof doEquipamento === "string" && doEquipamento ? doEquipamento : e.message ?? String(err);
}

export class ClienteControlId {
  private sessao: string | null = null;
  private readonly http: AxiosInstance;

  constructor(readonly eq: EquipamentoControlId) {
    this.http = axios.create({
      baseURL: `http://${eq.ip}:${eq.porta}`,
      timeout: 10_000,
      headers: { "Content-Type": "application/json" },
    });
  }

  async login(): Promise<string> {
    let data: { session?: string };
    try {
      ({ data } = await this.http.post<{ session?: string }>("/login.fcgi", {
        login: this.eq.usuario,
        password: this.eq.senha,
      }));
    } catch (err) {
      throw new Error(`${this.eq.nome}: ${mensagemDeErro(err)}`);
    }
    if (!data?.session) throw new Error(`${this.eq.nome}: o equipamento recusou o login (confira usuário e senha).`);
    this.sessao = data.session;
    return data.session;
  }

  /** Sessão válida, renovada só quando o equipamento diz que venceu. */
  private async sessaoValida(): Promise<string> {
    if (this.sessao) {
      try {
        const { data } = await this.http.post<{ session_is_valid?: boolean }>(
          `/session_is_valid.fcgi?session=${encodeURIComponent(this.sessao)}`,
          {}
        );
        if (data?.session_is_valid) return this.sessao;
      } catch {
        // Sessão que nem responde: tenta login de novo abaixo.
      }
    }
    return this.login();
  }

  async chamar<T>(caminho: string, corpo: unknown, timeoutMs?: number): Promise<T> {
    const sessao = await this.sessaoValida();
    let data: T & { error?: unknown };
    try {
      ({ data } = await this.http.post<T & { error?: unknown }>(
        `${caminho}?session=${encodeURIComponent(sessao)}`,
        corpo,
        timeoutMs ? { timeout: timeoutMs } : undefined
      ));
    } catch (err) {
      const e = err as { response?: { status?: number } };
      if (e.response?.status === 401) this.sessao = null;
      throw new Error(`${this.eq.nome}: ${mensagemDeErro(err)}`);
    }
    if (data && typeof data === "object" && typeof data.error === "string" && data.error) {
      throw new Error(`${this.eq.nome}: ${data.error}`);
    }
    return data;
  }
}

export class GestaoControlId implements GestaoEquipamentos {
  private readonly clientes: ClienteControlId[];
  private readonly timeoutCadastroMs: number;

  constructor(equipamentos: EquipamentoControlId[], opcoes: { timeoutCadastroMs?: number } = {}) {
    this.clientes = equipamentos.map((e) => new ClienteControlId(e));
    this.timeoutCadastroMs = opcoes.timeoutCadastroMs ?? TIMEOUT_CADASTRO_MS;
  }

  nomes(): string[] {
    return this.clientes.map((c) => c.eq.nome);
  }

  async testar(): Promise<{ equipamento: string; ok: boolean; erro?: string }[]> {
    return Promise.all(
      this.clientes.map(async (c) => {
        try {
          await c.login();
          return { equipamento: c.eq.nome, ok: true };
        } catch (err) {
          return { equipamento: c.eq.nome, ok: false, erro: (err as Error).message };
        }
      })
    );
  }

  private escolher(equipamento?: string | null): ClienteControlId {
    if (this.clientes.length === 0) throw new Error("Nenhum equipamento Control iD configurado neste Gateway.");
    if (!equipamento) return this.clientes[0];
    const c = this.clientes.find((x) => x.eq.nome === equipamento);
    if (!c) throw new Error(`Equipamento "${equipamento}" não está configurado neste Gateway.`);
    return c;
  }

  /**
   * O aluno precisa existir em TODOS os equipamentos da academia, com o
   * mesmo número, para ser reconhecido em qualquer catraca. Cria onde não
   * existe e atualiza o nome onde já existe — repetir o comando é seguro.
   */
  async criarUsuario(userId: number, nome: string, matricula: string): Promise<{ equipamentos: string[] }> {
    const feitos: string[] = [];
    for (const c of this.clientes) {
      const atual = await c.chamar<{ users?: unknown[] }>("/load_objects.fcgi", {
        object: "users",
        where: { users: { id: userId } },
      });
      if ((atual.users ?? []).length > 0) {
        await c.chamar("/modify_objects.fcgi", {
          object: "users",
          values: { name: nome, registration: matricula },
          where: { users: { id: userId } },
        });
      } else {
        await c.chamar("/create_objects.fcgi", {
          object: "users",
          values: [{ id: userId, name: nome, registration: matricula }],
        });
      }
      feitos.push(c.eq.nome);
    }
    return { equipamentos: feitos };
  }

  /**
   * Apaga digitais, cartões e o usuário, nessa ordem, em todos os
   * equipamentos. Digitais e cartões primeiro de propósito: a documentação
   * não diz se apagar o usuário apaga em cascata, e o dado biométrico não
   * pode ficar órfão no aparelho. Usuário que já não existe conta como
   * apagado — o objetivo é que não exista.
   */
  async apagarUsuario(userId: number): Promise<{ equipamentos: string[]; apagados: number }> {
    const feitos: string[] = [];
    let apagados = 0;
    for (const c of this.clientes) {
      for (const objeto of ["templates", "cards"]) {
        const r = await c.chamar<{ changes?: number }>("/destroy_objects.fcgi", {
          object: objeto,
          where: { [objeto]: { user_id: userId } },
        });
        apagados += r?.changes ?? 0;
      }
      const r = await c.chamar<{ changes?: number }>("/destroy_objects.fcgi", {
        object: "users",
        where: { users: { id: userId } },
      });
      apagados += r?.changes ?? 0;
      feitos.push(c.eq.nome);
    }
    return { equipamentos: feitos, apagados };
  }

  /**
   * Cadastro remoto síncrono. Se o aluno não terminar a tempo, o equipamento
   * fica preso na tela de cadastro até alguém cancelar — por isso o
   * cancelamento em qualquer falha.
   */
  private async cadastroRemoto(
    c: ClienteControlId,
    tipo: "biometry" | "card",
    userId: number,
    msg: string
  ): Promise<{ success?: boolean; card_value?: number | string }> {
    try {
      // Só `success` e `card_value` saem daqui. A resposta de biometria traz
      // `fingerprints` (imagens das digitais), descartado nesta linha.
      const r = await c.chamar<{ success?: boolean; card_value?: number | string }>(
        "/remote_enroll.fcgi",
        { type: tipo, user_id: userId, save: true, sync: true, msg },
        this.timeoutCadastroMs
      );
      return { success: r?.success, card_value: r?.card_value };
    } catch (err) {
      await c.chamar("/cancel_remote_enroll.fcgi", {}).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Copia os objetos de um aluno (digitais ou cartões) do equipamento que
   * fez a leitura para os demais, substituindo o que houver lá. Falha num
   * equipamento não desfaz o cadastro nos outros: a resposta diz onde
   * faltou, e repetir o cadastro resolve.
   */
  private async replicar(
    origem: ClienteControlId,
    objeto: "templates" | "cards",
    userId: number
  ): Promise<ReplicacaoEquipamentos & { quantidade: number }> {
    const campos = objeto === "templates" ? ["finger_position", "finger_type", "template", "user_id"] : ["value", "user_id"];
    const lidos = await origem.chamar<Record<string, Record<string, unknown>[] | undefined>>("/load_objects.fcgi", {
      object: objeto,
      fields: campos,
      where: { [objeto]: { user_id: userId } },
    });
    const itens = (lidos?.[objeto] ?? []).map((o) => Object.fromEntries(campos.map((k) => [k, o[k]])));

    const saida: ReplicacaoEquipamentos & { quantidade: number } = { replicado_em: [], falhou_em: [], quantidade: itens.length };
    for (const c of this.clientes) {
      if (c === origem) continue;
      try {
        await c.chamar("/destroy_objects.fcgi", { object: objeto, where: { [objeto]: { user_id: userId } } });
        if (itens.length > 0) await c.chamar("/create_objects.fcgi", { object: objeto, values: itens });
        saida.replicado_em.push(c.eq.nome);
      } catch (err) {
        saida.falhou_em.push({ equipamento: c.eq.nome, erro: (err as Error).message });
      }
    }
    return saida;
  }

  async cadastrarDigital(userId: number, equipamento?: string | null): Promise<{ equipamento: string } & ReplicacaoEquipamentos> {
    const c = this.escolher(equipamento);
    const r = await this.cadastroRemoto(c, "biometry", userId, "Coloque o dedo no leitor");
    if (r.success === false) throw new Error(`${c.eq.nome}: o cadastro da digital não foi concluído.`);
    const { replicado_em, falhou_em } = await this.replicar(c, "templates", userId);
    logger.info({ equipamento: c.eq.nome, replicado: replicado_em.length, falhas: falhou_em.length }, "Digital cadastrada remotamente");
    return { equipamento: c.eq.nome, replicado_em, falhou_em };
  }

  /**
   * O número do cartão não sobe para a nuvem: no modo Pro quem reconhece o
   * cartão é o equipamento, que manda à nuvem o número do usuário, igual à
   * digital. Guardar o número do cartão no ARKE seria dado a mais sem uso.
   */
  async cadastrarCartao(
    userId: number,
    equipamento?: string | null
  ): Promise<{ equipamento: string; cartoes: number } & ReplicacaoEquipamentos> {
    const c = this.escolher(equipamento);
    const r = await this.cadastroRemoto(c, "card", userId, "Aproxime o cartão do leitor");
    if (r.success === false) throw new Error(`${c.eq.nome}: o cadastro do cartão não foi concluído.`);
    const { replicado_em, falhou_em, quantidade } = await this.replicar(c, "cards", userId);
    logger.info({ equipamento: c.eq.nome, replicado: replicado_em.length, falhas: falhou_em.length }, "Cartão cadastrado remotamente");
    return { equipamento: c.eq.nome, cartoes: quantidade, replicado_em, falhou_em };
  }

  async liberarCatraca(sentido: "entrada" | "saida" | "ambos", equipamento?: string | null): Promise<{ equipamento: string }> {
    const c = this.escolher(equipamento);
    const entrada = c.eq.sentido_entrada;
    const saida = entrada === "clockwise" ? "anticlockwise" : "clockwise";
    const allow = sentido === "ambos" ? "both" : sentido === "saida" ? saida : entrada;
    await c.chamar("/execute_actions.fcgi", { actions: [{ action: "catra", parameters: `allow=${allow}` }] });
    logger.info({ equipamento: c.eq.nome, sentido }, "Catraca liberada remotamente");
    return { equipamento: c.eq.nome };
  }
}
