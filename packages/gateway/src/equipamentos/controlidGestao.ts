import axios, { type AxiosInstance } from "axios";
import type { EquipamentoControlId, TipoComando } from "../types";
import { logger } from "../logger";
import { acoesDeLiberacao } from "../receptores/controlid";

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
  /**
   * Os equipamentos em que a ficha cadastra (a lista em que a recepção
   * escolhe o leitor). Sem o método, todos os de nomes(). A Toletus lista só
   * as catracas com leitor de digital.
   */
  nomesDeCadastro?(): string[];
  /**
   * As ordens que este equipamento aceita. A Control iD aceita todas; a
   * Toletus só a liberação, porque a placa não guarda cadastro de aluno. É
   * o que o Gateway anuncia à nuvem, e a nuvem não pede o que não estiver aqui.
   */
  capacidades(): TipoComando[];
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
  /**
   * Rosto pela câmera do equipamento, com o aluno na frente, copiado aos
   * outros leitores faciais da academia. Só quem anuncia "cadastrar_rosto".
   */
  cadastrarRosto?(userId: number, equipamento?: string | null): Promise<{ equipamento: string } & ReplicacaoEquipamentos>;
  /**
   * A foto que o aluno mandou pelo app, entregue a todos os leitores faciais
   * da academia. Só quem anuncia "enviar_foto_rosto". A foto vem em JPEG e
   * não sai daqui para log nem para o resultado.
   */
  enviarFotoRosto?(userId: number, jpeg: Buffer): Promise<{ equipamentos: string[] }>;
  /** O equipamento cadastra rosto? Vai na telemetria para a ficha oferecer só esses. */
  temRosto?(nome: string): boolean;
}

/** Os códigos de erro do cadastro facial por foto (API Control iD, "Cadastro facial por fotos"). */
const ERROS_FOTO_CONTROLID: Record<number, string> = {
  1: "foto em formato não reconhecido, ou o aluno não existe no equipamento",
  2: "nenhum rosto encontrado na foto",
  3: "este rosto já está cadastrado para outra pessoa",
  4: "rosto fora do centro da foto",
  5: "rosto muito longe",
  6: "rosto muito perto",
  7: "rosto virado: olhe de frente para a câmera",
  8: "foto sem nitidez",
  9: "rosto muito perto da borda da foto",
};

export function motivoDaFotoControlId(erros: unknown): string {
  const lista = Array.isArray(erros) ? (erros as { code?: number; message?: string }[]) : [];
  if (lista.length === 0) return "o equipamento recusou a foto";
  return lista.map((e) => ERROS_FOTO_CONTROLID[Number(e.code)] ?? e.message ?? `código ${e.code}`).join("; ");
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

  /**
   * Foto do rosto do aluno (POST /user_set_image.fcgi, corpo em
   * application/octet-stream). Firmware antigo não responde nada; o novo
   * responde `success` e `errors`. A foto não aparece em erro nem em log.
   */
  async enviarFoto(userId: number, jpeg: Buffer, verificarDuplicado: boolean): Promise<void> {
    const sessao = await this.sessaoValida();
    const timestamp = Math.floor(Date.now() / 1000);
    let data: { success?: boolean; errors?: unknown } | "" | undefined;
    try {
      ({ data } = await this.http.post(
        `/user_set_image.fcgi?user_id=${userId}&timestamp=${timestamp}&match=${verificarDuplicado ? 1 : 0}&session=${encodeURIComponent(sessao)}`,
        jpeg,
        { headers: { "Content-Type": "application/octet-stream" }, timeout: 20_000 }
      ));
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { errors?: unknown } } };
      if (e.response?.status === 401) this.sessao = null;
      if (e.response?.data?.errors) throw new Error(`${this.eq.nome}: ${motivoDaFotoControlId(e.response.data.errors)}`);
      throw new Error(`${this.eq.nome}: ${mensagemDeErro(err)}`);
    }
    if (data && typeof data === "object" && data.success === false) {
      throw new Error(`${this.eq.nome}: ${motivoDaFotoControlId(data.errors)}`);
    }
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

  capacidades(): TipoComando[] {
    const caps: TipoComando[] = ["liberar_catraca", "cadastrar_usuario", "cadastrar_digital", "cadastrar_cartao", "apagar_usuario"];
    if (this.faciais().length) caps.push("cadastrar_rosto", "enviar_foto_rosto");
    return caps;
  }

  temRosto(nome: string): boolean {
    return this.clientes.some((c) => c.eq.nome === nome && c.eq.rosto === true);
  }

  private faciais(): ClienteControlId[] {
    return this.clientes.filter((c) => c.eq.rosto === true);
  }

  /**
   * Por padrão a Control iD guarda a foto de cadastro de cada aluno. Com
   * `keep_user_image` em 0, ela gera o modelo do rosto e apaga a foto
   * (documentação, "Remoção de foto do usuário após o cadastro"). O ARKE
   * não precisa da foto no equipamento, então não deixa ficar. Uma vez por
   * equipamento a cada vez que o Gateway sobe; falha não impede o cadastro.
   */
  private readonly semFotoConfigurado = new Set<string>();
  private async naoGuardarFoto(c: ClienteControlId): Promise<void> {
    if (this.semFotoConfigurado.has(c.eq.nome)) return;
    try {
      await c.chamar("/set_configuration.fcgi", { general: { keep_user_image: "0" } });
      this.semFotoConfigurado.add(c.eq.nome);
    } catch (err) {
      logger.warn({ equipamento: c.eq.nome, err: (err as Error).message }, "Não foi possível desligar a foto guardada no equipamento");
    }
  }

  private escolherFacial(equipamento?: string | null): ClienteControlId {
    const faciais = this.faciais();
    if (faciais.length === 0) throw new Error("Nenhum equipamento Control iD com reconhecimento facial configurado (\"rosto\": true no config.json).");
    if (!equipamento) return faciais[0];
    const c = faciais.find((x) => x.eq.nome === equipamento);
    if (!c) throw new Error(`O equipamento "${equipamento}" não tem reconhecimento facial configurado neste Gateway.`);
    return c;
  }

  /** Garante o aluno no equipamento antes da foto: user_set_image exige usuário existente. */
  private async garantirUsuario(c: ClienteControlId, userId: number): Promise<void> {
    const atual = await c.chamar<{ users?: unknown[] }>("/load_objects.fcgi", { object: "users", where: { users: { id: userId } } });
    if ((atual.users ?? []).length === 0) {
      await c.chamar("/create_objects.fcgi", { object: "users", values: [{ id: userId, name: "Aluno", registration: "" }] });
    }
  }

  /**
   * Rosto pela câmera do equipamento (remote_enroll síncrono, com contagem
   * regressiva). A resposta traz a foto capturada (`user_image`): ela só
   * atravessa a memória do Gateway para ser copiada aos outros leitores
   * faciais da academia, pela rede local, e é descartada.
   */
  async cadastrarRosto(userId: number, equipamento?: string | null): Promise<{ equipamento: string } & ReplicacaoEquipamentos> {
    const c = this.escolherFacial(equipamento);
    await this.naoGuardarFoto(c);
    let foto: Buffer | null = null;
    try {
      const r = await c.chamar<{ success?: boolean; user_image?: string }>(
        "/remote_enroll.fcgi",
        { type: "face", user_id: userId, save: true, sync: true, auto: true, countdown: 3, msg: "Olhe para a camera" },
        this.timeoutCadastroMs
      );
      if (r?.success === false) throw new Error(`${c.eq.nome}: o cadastro do rosto não foi concluído.`);
      foto = typeof r?.user_image === "string" && r.user_image ? Buffer.from(r.user_image, "base64") : null;
    } catch (err) {
      await c.chamar("/cancel_remote_enroll.fcgi", {}).catch(() => undefined);
      throw err;
    }

    const saida: ReplicacaoEquipamentos = { replicado_em: [], falhou_em: [] };
    try {
      for (const outro of this.faciais()) {
        if (outro === c) continue;
        if (!foto) {
          saida.falhou_em.push({ equipamento: outro.eq.nome, erro: "o equipamento não devolveu a foto para copiar" });
          continue;
        }
        try {
          await this.naoGuardarFoto(outro);
          await this.garantirUsuario(outro, userId);
          await outro.enviarFoto(userId, foto, false);
          saida.replicado_em.push(outro.eq.nome);
        } catch (err) {
          saida.falhou_em.push({ equipamento: outro.eq.nome, erro: (err as Error).message });
        }
      }
    } finally {
      foto?.fill(0);
    }
    logger.info({ equipamento: c.eq.nome, replicado: saida.replicado_em.length, falhas: saida.falhou_em.length }, "Rosto cadastrado remotamente");
    return { equipamento: c.eq.nome, ...saida };
  }

  /**
   * A foto que o aluno mandou pelo app, em todos os equipamentos faciais. O
   * primeiro confere se o rosto já é de outra pessoa (`match`); os demais
   * não precisam repetir a conta. Falha em qualquer um falha a ordem, com o
   * motivo de cada um: o aluno tira outra foto, ou a recepção cadastra pela câmera.
   */
  async enviarFotoRosto(userId: number, jpeg: Buffer): Promise<{ equipamentos: string[] }> {
    const faciais = this.faciais();
    if (faciais.length === 0) throw new Error("Nenhum equipamento Control iD com reconhecimento facial neste Gateway.");
    const feitos: string[] = [];
    const falhas: string[] = [];
    for (const [i, c] of faciais.entries()) {
      try {
        await this.naoGuardarFoto(c);
        await this.garantirUsuario(c, userId);
        await c.enviarFoto(userId, jpeg, i === 0);
        feitos.push(c.eq.nome);
      } catch (err) {
        falhas.push((err as Error).message);
      }
    }
    if (falhas.length) throw new Error(`A foto não entrou em todos os leitores — ${falhas.join("; ")}`);
    logger.info({ equipamentos: feitos.length }, "Foto do rosto entregue aos equipamentos");
    return { equipamentos: feitos };
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
      // Rosto primeiro, nos faciais: a foto e o modelo do rosto são dado
      // biométrico, e apagar o usuário pode não levá-los junto.
      if (c.eq.rosto) await c.chamar("/user_destroy_image.fcgi", { user_id: userId }).catch(() => undefined);
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

  /**
   * A liberação a pedido da recepção, do jeito daquele equipamento: a
   * catraca da Control iD gira no sentido pedido; o leitor que libera pelo
   * relé ou pelo SecBox dá um pulso, sem sentido (a catraca de outra marca
   * decide o lado pela própria montagem).
   */
  async liberarCatraca(sentido: "entrada" | "saida" | "ambos", equipamento?: string | null): Promise<{ equipamento: string }> {
    const c = this.escolher(equipamento);
    const entrada = c.eq.sentido_entrada;
    const saida = entrada === "clockwise" ? "anticlockwise" : "clockwise";
    const allow = sentido === "ambos" ? "both" : sentido === "saida" ? saida : entrada;
    const como = { liberacao: c.eq.liberacao ?? "catraca", sentidoEntrada: entrada, rele: c.eq.rele ?? 1 } as const;
    await c.chamar("/execute_actions.fcgi", { actions: acoesDeLiberacao(como, { motivo: "remoto", sentido: allow }) });
    logger.info({ equipamento: c.eq.nome, sentido, liberacao: como.liberacao }, "Catraca liberada remotamente");
    return { equipamento: c.eq.nome };
  }
}
