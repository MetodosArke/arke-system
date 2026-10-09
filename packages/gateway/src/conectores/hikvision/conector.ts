import type { GatewayService } from "../../core/gatewayService";
import { enderecoLocalPara } from "../../core/rede";
import type { GestaoEquipamentos, ReplicacaoEquipamentos } from "../../equipamentos/controlidGestao";
import { logger } from "../../logger";
import { ipDoEquipamento } from "../../receptores/controlid";
import type { EquipamentoHikvision, TipoComando } from "../../types";
import { ClienteHikvision, ErroHikvision, type OpcoesClienteHikvision } from "./cliente";
import {
  ERROS_DE_INEXISTENTE,
  SITUACAO_DA_DIGITAL,
  apagarCartoesDoAluno,
  apagarDigitalDoAluno,
  apagarPessoaCompleta,
  apagarPessoaSimples,
  apagarRostoDoAluno,
  caminhos,
  cartaoDoAluno,
  configuracaoDeAcesso,
  digitalDoAluno,
  ehControladora,
  lerCapacidades,
  lerInfoDoAparelho,
  partesDoMultipart,
  rostoDoAluno,
  tagDoXml,
  usuarioDoAluno,
  xmlAbrirPorta,
  xmlCapturarDigital,
  xmlCapturarRosto,
  xmlHora,
  xmlServidorDeEventos,
  type CapacidadesHikvision,
  type InfoHikvision,
} from "./protocolo";

const ACERTAR_HORA_MS = 6 * 60 * 60_000;
const VERIFICAR_MS = 60_000;
/** Senha recusada: o aparelho bloqueia depois de algumas tentativas, então o Gateway espera antes de tentar de novo. */
const PAUSA_SENHA_RECUSADA_MS = 30 * 60_000;
/** O aluno na frente do aparelho: tempo para pôr o dedo, aproximar o cartão ou olhar para a câmera. */
const TEMPO_DE_CAPTURA_MS = 60_000;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O que o Gateway sabe de cada aparelho, para a telemetria e para escolher o caminho. */
export interface EstadoHikvision {
  nome: string;
  alcancavel: boolean;
  modelo: string | null;
  firmware: string | null;
  /** O aparelho pergunta ao Gateway a cada acesso (verificação remota ligada). */
  verificacaoRemota: boolean;
  vistoEm: Date | null;
  erro: string | null;
}

interface Aparelho {
  info: InfoHikvision | null;
  caps: CapacidadesHikvision | null;
  configurado: boolean;
  verificacaoRemota: boolean;
  alcancavel: boolean;
  vistoEm: Date | null;
  erro: string | null;
  pausaAte: number;
}

export interface OpcoesConectorHikvision {
  /** Porta de escuta do Gateway, que vai para o aparelho como servidor de eventos. */
  porta: number;
  /** Endereço a anunciar; vazio, descobre o que alcança cada aparelho. */
  endereco?: string | null;
  /** Configura o envio dos eventos e a verificação remota ao subir. */
  configurar?: boolean;
  cliente?: OpcoesClienteHikvision;
  /** De quanto em quanto tempo o Gateway confere cada aparelho (padrão 60 s). */
  verificarCadaMs?: number;
  /** Intervalo entre as consultas de progresso (digital, remoção, rosto). */
  intervaloProgressoMs?: number;
}

/**
 * Os aparelhos Hikvision da academia: o que cada um é e o que ele faz, a
 * configuração ao subir, a hora certa e o espelho da situação.
 *
 * O CAMINHO POR MODELO sai do próprio aparelho, e não de uma tabela de
 * modelos: o Gateway lê `deviceInfo` (modelo e firmware) e as capacidades de
 * controle de acesso, e é por elas que decide. O DS-K1T671 e o DS-K1T341
 * têm rosto e cartão (e digital nas versões com leitor); a DS-K2604 não tem
 * câmera: cartão e digital pelos leitores ligados a ela, e rosto só se um
 * terminal facial estiver ligado e o aparelho declarar a biblioteca de rostos.
 *
 * ESPELHO. Sem o Gateway (computador desligado), o aparelho decide com a
 * lista que tem. Então quem a academia barrou vai com a validade vencida, e
 * quem volta, com a validade de volta, a cada sincronização. Com o Gateway no
 * ar e a verificação remota ligada, a decisão é sempre da nuvem.
 */
export class ConectorHikvision {
  private readonly clientes = new Map<string, ClienteHikvision>();
  private readonly aparelhos = new Map<string, Aparelho>();
  /** O que já foi espelhado em cada aparelho: número → barrado. */
  private readonly espelhado = new Map<string, Map<string, boolean>>();
  private espelhando = false;
  private deNovo = false;
  private verificando: Promise<void> | null = null;
  private timerHora: NodeJS.Timeout | null = null;
  private timerVerificar: NodeJS.Timeout | null = null;
  readonly intervaloProgressoMs: number;

  constructor(
    private readonly gateway: GatewayService,
    readonly equipamentos: EquipamentoHikvision[],
    private readonly opcoes: OpcoesConectorHikvision
  ) {
    for (const eq of equipamentos) {
      this.clientes.set(eq.nome, new ClienteHikvision(eq, opcoes.cliente));
      this.aparelhos.set(eq.nome, {
        info: null,
        caps: null,
        configurado: false,
        verificacaoRemota: false,
        alcancavel: false,
        vistoEm: null,
        erro: null,
        pausaAte: 0,
      });
      this.espelhado.set(eq.nome, new Map());
    }
    this.intervaloProgressoMs = opcoes.intervaloProgressoMs ?? 1_000;
  }

  nomes(): string[] {
    return this.equipamentos.map((e) => e.nome);
  }

  cliente(nome: string): ClienteHikvision {
    const c = this.clientes.get(nome);
    if (!c) throw new Error(`Aparelho "${nome}" não está configurado neste Gateway.`);
    return c;
  }

  equipamento(nome: string): EquipamentoHikvision {
    const eq = this.equipamentos.find((e) => e.nome === nome);
    if (!eq) throw new Error(`Aparelho "${nome}" não está configurado neste Gateway.`);
    return eq;
  }

  /** O nome do aparelho pelo IP de quem chamou. */
  nomePorIp(ip: string): string | null {
    return this.equipamentos.find((e) => ipDoEquipamento(e.ip) === ipDoEquipamento(ip))?.nome ?? null;
  }

  /** As capacidades lidas do aparelho; null enquanto ele não respondeu. */
  capacidades(nome: string): CapacidadesHikvision | null {
    return this.aparelhos.get(nome)?.caps ?? null;
  }

  info(nome: string): InfoHikvision | null {
    return this.aparelhos.get(nome)?.info ?? null;
  }

  /**
   * Os leitores de saída: os do config, ou o padrão do tipo de aparelho. Na
   * controladora, cada porta tem o leitor de entrada (ímpar) e o de saída
   * (par); o terminal, sem a lista, só tem entrada.
   */
  leitoresDeSaida(nome: string): number[] {
    const eq = this.equipamentos.find((e) => e.nome === nome);
    if (!eq) return [];
    if (eq.leitores_saida) return eq.leitores_saida;
    return ehControladora(this.info(nome)) ? [2, 4, 6, 8] : [];
  }

  leitoresDeSaidaPorIp(ip: string): number[] {
    const nome = this.nomePorIp(ip);
    return nome ? this.leitoresDeSaida(nome) : [];
  }

  /** O que o aparelho é: modelo, firmware e as capacidades de controle de acesso. */
  async conhecer(eq: EquipamentoHikvision): Promise<void> {
    const c = this.cliente(eq.nome);
    const a = this.aparelhos.get(eq.nome)!;
    // Uma tentativa só: a conferência se repete a cada minuto.
    const info = lerInfoDoAparelho(await c.xml("GET", caminhos.infoDoAparelho, undefined, { tentativas: 1 }));
    const caps = lerCapacidades(await c.xml("GET", caminhos.capacidades, undefined, { tentativas: 1 }));
    const antes = a.caps;
    a.info = info;
    a.caps = caps;
    a.alcancavel = true;
    a.vistoEm = new Date();
    a.erro = null;
    if (!antes) {
      logger.info(
        {
          aparelho: eq.nome,
          modelo: info.modelo,
          firmware: info.firmware,
          rosto: caps.rosto,
          digital: caps.digital,
          cartao: caps.cartao,
          verificacaoRemota: caps.verificacaoRemota,
        },
        "Aparelho Hikvision reconhecido"
      );
    }
  }

  /**
   * Hora certa, servidor de eventos apontando para este Gateway e a
   * configuração de acesso (verificação remota e as fotos de cada acesso
   * desligadas). A hora importa: o Gateway separa o pedido de agora do
   * registro guardado pelo relógio do aparelho.
   */
  async configurar(eq: EquipamentoHikvision): Promise<void> {
    const c = this.cliente(eq.nome);
    const a = this.aparelhos.get(eq.nome)!;
    if (!a.caps) await this.conhecer(eq);
    await this.acertarHora(eq);
    const endereco = this.opcoes.endereco?.trim() || (await enderecoLocalPara(eq.ip, eq.porta));
    await c.xml("PUT", caminhos.servidorDeEventos, xmlServidorDeEventos(endereco, this.opcoes.porta));
    const caps = a.caps!;
    a.verificacaoRemota = false;
    if (caps.configuracao) {
      const atual = await c.json<{ AcsCfg?: Record<string, unknown> }>("GET", caminhos.configuracao);
      await c.json("PUT", caminhos.configuracao, configuracaoDeAcesso(atual.AcsCfg ?? {}, { verificacaoRemota: caps.verificacaoRemota, comRosto: caps.rosto }));
      a.verificacaoRemota = caps.verificacaoRemota;
    }
    a.configurado = true;
    if (a.verificacaoRemota) {
      logger.info({ aparelho: eq.nome, servidor: `${endereco}:${this.opcoes.porta}` }, "Aparelho Hikvision perguntando a este Gateway a cada acesso");
    } else {
      // O firmware sem verificação remota decide sozinho, pela lista que o
      // Gateway mantém; o Gateway recebe o evento e conta a presença.
      logger.warn(
        { aparelho: eq.nome, modelo: a.info?.modelo ?? null, servidor: `${endereco}:${this.opcoes.porta}` },
        "Aparelho Hikvision sem verificação remota: ele decide pela lista do Gateway, e a regra de agendamento não vale nele"
      );
    }
  }

  private async acertarHora(eq: EquipamentoHikvision): Promise<void> {
    await this.cliente(eq.nome).xml("PUT", caminhos.hora, xmlHora());
  }

  private async acertarHoras(): Promise<void> {
    for (const eq of this.equipamentos) {
      if (!this.aparelhos.get(eq.nome)?.alcancavel) continue;
      await this.acertarHora(eq).catch((err) => logger.warn({ aparelho: eq.nome, err: (err as Error).message }, "Hora do aparelho Hikvision não acertada"));
    }
  }

  /**
   * Confere cada aparelho: responde? o que ele é? E configura o que ainda
   * não foi configurado (o aparelho ligado depois do Gateway, ou trocado).
   */
  verificar(): Promise<void> {
    if (this.verificando) return this.verificando;
    this.verificando = (async () => {
      for (const eq of this.equipamentos) {
        const a = this.aparelhos.get(eq.nome)!;
        if (a.pausaAte > Date.now()) continue;
        try {
          await this.conhecer(eq);
          if (!a.configurado && this.opcoes.configurar !== false) await this.configurar(eq);
        } catch (err) {
          const e = err as Error;
          const estava = a.alcancavel;
          a.alcancavel = false;
          a.erro = e.message;
          // Configurar de novo quando ele voltar: pode ter sido reiniciado de fábrica.
          a.configurado = false;
          if (err instanceof ErroHikvision && err.senhaRecusada) a.pausaAte = Date.now() + PAUSA_SENHA_RECUSADA_MS;
          if (estava || !a.vistoEm) logger.warn({ aparelho: eq.nome, err: e.message }, "Aparelho Hikvision sem resposta — confira IP, usuário e senha");
        }
      }
    })().finally(() => {
      this.verificando = null;
    });
    return this.verificando;
  }

  async iniciar(): Promise<void> {
    await this.verificar();
    this.timerVerificar = setInterval(() => void this.verificar(), this.opcoes.verificarCadaMs ?? VERIFICAR_MS);
    this.timerVerificar.unref?.();
    if (this.opcoes.configurar !== false) {
      this.timerHora = setInterval(() => void this.acertarHoras(), ACERTAR_HORA_MS);
      this.timerHora.unref?.();
    }
    this.gateway.aoSincronizar(() => void this.espelhar());
    void this.espelhar();
  }

  parar(): void {
    if (this.timerHora) clearInterval(this.timerHora);
    if (this.timerVerificar) clearInterval(this.timerVerificar);
    this.timerHora = null;
    this.timerVerificar = null;
  }

  estados(): EstadoHikvision[] {
    return this.equipamentos.map((eq) => {
      const a = this.aparelhos.get(eq.nome)!;
      return {
        nome: eq.nome,
        alcancavel: a.alcancavel,
        modelo: a.info?.modelo ?? null,
        firmware: a.info?.firmware ?? null,
        verificacaoRemota: a.verificacaoRemota,
        vistoEm: a.vistoEm,
        erro: a.erro,
      };
    });
  }

  /** O aluno está barrado, pelo cache? */
  async barrado(identificador: string): Promise<boolean> {
    const alunos = await this.gateway.alunosNoEquipamento();
    return alunos.find((a) => a.identificador === identificador)?.barrado ?? false;
  }

  /** Cria ou atualiza o aluno no aparelho, já com a situação dele. */
  async garantirUsuario(nome: string, id: number | string, barrado: boolean): Promise<void> {
    const c = this.cliente(nome);
    const corpo = usuarioDoAluno(id, barrado, this.equipamento(nome).porta_acesso);
    try {
      await c.json("PUT", caminhos.aplicarUsuario, corpo);
      return;
    } catch (err) {
      if (!(err instanceof ErroHikvision) || !err.semFuncao) throw err;
    }
    // Firmware sem o "aplicar": incluir, e alterar se já existir.
    try {
      await c.json("POST", caminhos.incluirUsuario, corpo);
    } catch (err) {
      if (!(err instanceof ErroHikvision) || !/AlreadyExist/i.test(err.sub ?? "")) throw err;
      await c.json("PUT", caminhos.alterarUsuario, corpo);
    }
  }

  /** Registra o que acabou de ir ao aparelho, para o espelho não repetir. */
  marcarEspelhado(nome: string, identificador: string, barrado: boolean): void {
    this.espelhado.get(nome)?.set(identificador, barrado);
  }

  esquecer(identificador: string): void {
    for (const m of this.espelhado.values()) m.delete(identificador);
  }

  /**
   * Atualiza nos aparelhos quem mudou de situação desde a última vez. Só
   * altera quem já está no aparelho: quem não está entra pela ficha, já com
   * a situação certa. Aparelho fora do ar tenta de novo na próxima rodada.
   */
  async espelhar(): Promise<{ aparelho: string; enviados: number; falhou?: string }[]> {
    if (this.espelhando) {
      this.deNovo = true;
      return [];
    }
    this.espelhando = true;
    const relatorio: { aparelho: string; enviados: number; falhou?: string }[] = [];
    try {
      const alunos = await this.gateway.alunosNoEquipamento();
      const atuais = new Set(alunos.map((a) => a.identificador));
      for (const eq of this.equipamentos) {
        const feito = this.espelhado.get(eq.nome)!;
        for (const id of [...feito.keys()]) if (!atuais.has(id)) feito.delete(id);
        const mudou = alunos.filter((a) => feito.get(a.identificador) !== a.barrado);
        if (this.aparelhos.get(eq.nome)?.caps?.pessoa === false) continue;
        let enviados = 0;
        try {
          const c = this.cliente(eq.nome);
          for (const a of mudou) {
            try {
              await c.json("PUT", caminhos.alterarUsuario, usuarioDoAluno(a.identificador, a.barrado, eq.porta_acesso));
              enviados++;
            } catch (err) {
              // Aluno sem cadastro neste aparelho: entra pela ficha com a situação certa.
              if (!(err instanceof ErroHikvision) || !ERROS_DE_INEXISTENTE.has(err.sub ?? "")) throw err;
            }
            feito.set(a.identificador, a.barrado);
          }
          relatorio.push({ aparelho: eq.nome, enviados });
        } catch (err) {
          relatorio.push({ aparelho: eq.nome, enviados, falhou: (err as Error).message });
          logger.warn({ aparelho: eq.nome, err: (err as Error).message }, "Situação dos alunos não espelhada no aparelho Hikvision");
        }
        if (enviados) logger.info({ aparelho: eq.nome, enviados }, "Situação dos alunos espelhada no aparelho Hikvision");
      }
    } finally {
      this.espelhando = false;
    }
    if (this.deNovo) {
      this.deNovo = false;
      relatorio.push(...(await this.espelhar()));
    }
    return relatorio;
  }
}

/**
 * Gestão dos aparelhos Hikvision pela ficha do aluno: cadastrar e apagar o
 * aluno em todos, o rosto (pela foto do app ou pela câmera), o cartão e a
 * digital (com o aluno na frente do aparelho, copiados aos outros) e abrir a
 * porta a pedido da recepção. Cada função só é oferecida quando algum
 * aparelho declara a capacidade dela. Rosto e digital só chegam aqui com a
 * autorização do aluno: é a nuvem que confere antes de mandar a ordem.
 *
 * DADO BIOMÉTRICO. A foto do rosto e a digital capturadas atravessam só a
 * memória do Gateway, para chegar aos outros aparelhos pela rede local, e
 * são descartadas. Nada disso vai para log, para o resultado nem para a nuvem.
 */
export class GestaoHikvision implements GestaoEquipamentos {
  constructor(private readonly conector: ConectorHikvision) {}

  nomes(): string[] {
    return this.conector.nomes();
  }

  private com(teste: (c: CapacidadesHikvision) => boolean): string[] {
    return this.nomes().filter((n) => {
      const c = this.conector.capacidades(n);
      return !!c && teste(c);
    });
  }

  private faciais = () => this.com((c) => c.rosto);
  private comDigital = () => this.com((c) => c.digital);
  private comCartao = () => this.com((c) => c.cartao);

  capacidades(): TipoComando[] {
    const caps: TipoComando[] = ["cadastrar_usuario", "apagar_usuario", "liberar_catraca"];
    if (this.faciais().length) caps.push("enviar_foto_rosto");
    if (this.com((c) => c.rosto && c.capturaRosto).length) caps.push("cadastrar_rosto");
    if (this.com((c) => c.capturaDigital).length && this.comDigital().length) caps.push("cadastrar_digital");
    if (this.com((c) => c.capturaCartao).length && this.comCartao().length) caps.push("cadastrar_cartao");
    return caps;
  }

  /** Os aparelhos em que a recepção captura alguma credencial com o aluno na frente. */
  nomesDeCadastro(): string[] {
    const comCaptura = this.com((c) => (c.rosto && c.capturaRosto) || c.capturaDigital || c.capturaCartao);
    return comCaptura.length ? comCaptura : this.nomes();
  }

  temRosto(nome: string): boolean {
    const c = this.conector.capacidades(nome);
    return !!c && c.rosto && c.capturaRosto;
  }

  async testar(): Promise<{ equipamento: string; ok: boolean; erro?: string }[]> {
    const r: { equipamento: string; ok: boolean; erro?: string }[] = [];
    for (const nome of this.nomes()) {
      try {
        await this.conector.cliente(nome).xml("GET", caminhos.infoDoAparelho, undefined, { tentativas: 1 });
        r.push({ equipamento: nome, ok: true });
      } catch (err) {
        r.push({ equipamento: nome, ok: false, erro: (err as Error).message });
      }
    }
    return r;
  }

  async criarUsuario(userId: number): Promise<{ equipamentos: string[] }> {
    const barrado = await this.conector.barrado(String(userId));
    // Falha em um falha a ordem: ela continua pendente e é refeita inteira.
    for (const nome of this.nomes()) {
      await this.conector.garantirUsuario(nome, userId, barrado);
      this.conector.marcarEspelhado(nome, String(userId), barrado);
    }
    logger.info({ userId, aparelhos: this.nomes().length }, "Aluno cadastrado nos aparelhos Hikvision");
    return { equipamentos: this.nomes() };
  }

  /** Espera uma operação que o aparelho faz em segundo plano (apagar a pessoa, a digital). */
  private async aguardar(nome: string, caminho: string, ler: (j: Record<string, unknown>) => string | null, limiteMs = 30_000): Promise<void> {
    const c = this.conector.cliente(nome);
    const fim = Date.now() + limiteMs;
    for (;;) {
      const situacao = ler(await c.json("GET", caminho));
      if (situacao === "success" || situacao === null) return;
      if (situacao === "failed") throw new Error(`${nome}: o aparelho não terminou a remoção`);
      if (Date.now() > fim) throw new Error(`${nome}: o aparelho não terminou a remoção em ${Math.round(limiteMs / 1000)} s`);
      await dormir(this.conector.intervaloProgressoMs);
    }
  }

  /** Uma remoção em que "não existe" é o estado que se queria. */
  private async semErroDeInexistente(fazer: () => Promise<unknown>): Promise<void> {
    try {
      await fazer();
    } catch (err) {
      if (err instanceof ErroHikvision && (ERROS_DE_INEXISTENTE.has(err.sub ?? "") || err.semFuncao)) return;
      throw err;
    }
  }

  /**
   * Apaga do aparelho o rosto, a digital, o cartão e o aluno. A remoção
   * completa da documentação leva tudo o que está ligado à pessoa, mas o
   * rosto e a digital saem antes, cada um pela própria chamada: dado
   * biométrico não pode ficar órfão no aparelho se um firmware não apagar em
   * cascata. Quem já não está no aparelho conta como feito.
   */
  async apagarUsuario(userId: number): Promise<{ equipamentos: string[]; apagados: number }> {
    let apagados = 0;
    for (const nome of this.nomes()) {
      const c = this.conector.cliente(nome);
      const caps = this.conector.capacidades(nome);
      const eq = this.conector.equipamento(nome);
      if (!caps || caps.rosto) await this.semErroDeInexistente(() => c.json("PUT", caminhos.apagarRosto, apagarRostoDoAluno(userId)));
      if (caps?.digital && caps.apagarDigital) {
        await this.semErroDeInexistente(async () => {
          await c.json("PUT", caminhos.apagarDigital, apagarDigitalDoAluno(userId, eq.leitores_digital));
          await this.aguardar(nome, caminhos.progressoApagarDigital, (j) => statusDoProgresso(j, "FingerPrintDeleteProcess"));
        });
      }
      if (!caps || caps.cartao) await this.semErroDeInexistente(() => c.json("PUT", caminhos.apagarCartoes, apagarCartoesDoAluno(userId)));
      if (!caps || caps.apagarPessoa) {
        try {
          await c.json("PUT", caminhos.apagarPessoa, apagarPessoaCompleta(userId));
          await this.aguardar(nome, caminhos.progressoApagarPessoa, (j) => statusDoProgresso(j, "UserInfoDetailDeleteProcess"));
        } catch (err) {
          if (!(err instanceof ErroHikvision) || !err.semFuncao) throw err;
          await this.semErroDeInexistente(() => c.json("PUT", caminhos.apagarUsuario, apagarPessoaSimples(userId)));
        }
      } else {
        await this.semErroDeInexistente(() => c.json("PUT", caminhos.apagarUsuario, apagarPessoaSimples(userId)));
      }
      apagados++;
    }
    this.conector.esquecer(String(userId));
    logger.info({ userId, aparelhos: apagados }, "Aluno, rosto, digital e cartão apagados dos aparelhos Hikvision");
    return { equipamentos: this.nomes(), apagados };
  }

  async liberarCatraca(_sentido: "entrada" | "saida" | "ambos", equipamento?: string | null): Promise<{ equipamento: string }> {
    const eq = equipamento ? this.conector.equipamentos.find((e) => e.nome === equipamento) : this.conector.equipamentos[0];
    if (!eq) throw new Error(`Aparelho "${equipamento}" não está configurado neste Gateway.`);
    await this.conector.cliente(eq.nome).xml("PUT", caminhos.abrirPorta(eq.porta_acesso), xmlAbrirPorta());
    logger.info({ aparelho: eq.nome, porta: eq.porta_acesso }, "Porta aberta remotamente no aparelho Hikvision");
    return { equipamento: eq.nome };
  }

  /** O rosto no aparelho: "aplicar" (inclui ou troca); no firmware sem ele, incluir e, se já houver, alterar. */
  private async aplicarRosto(nome: string, userId: number, jpeg: Buffer): Promise<void> {
    const c = this.conector.cliente(nome);
    const partes = () => [
      { nome: "FaceDataRecord", tipo: "application/json", dados: Buffer.from(JSON.stringify(rostoDoAluno(userId))) },
      { nome: "img", tipo: "image/jpeg", dados: jpeg, arquivo: "rosto.jpg" },
    ];
    try {
      await c.multipart("PUT", caminhos.aplicarRosto, partes());
      return;
    } catch (err) {
      if (!(err instanceof ErroHikvision) || !err.semFuncao) throw err;
    }
    try {
      await c.multipart("POST", caminhos.incluirRosto, partes());
    } catch (err) {
      if (!(err instanceof ErroHikvision) || !/AlreadyExist/i.test(err.sub ?? "")) throw err;
      await c.multipart("PUT", caminhos.alterarRosto, partes());
    }
  }

  /**
   * A foto que o aluno mandou pelo app, em todos os aparelhos com rosto.
   * Falha em qualquer um falha a ordem, com o motivo de cada um: o aluno
   * tira outra foto, ou a recepção cadastra pela câmera.
   */
  async enviarFotoRosto(userId: number, jpeg: Buffer): Promise<{ equipamentos: string[] }> {
    const faciais = this.faciais();
    if (!faciais.length) throw new Error("Nenhum aparelho Hikvision com reconhecimento facial respondendo a este Gateway.");
    const barrado = await this.conector.barrado(String(userId));
    const feitos: string[] = [];
    const falhas: string[] = [];
    for (const nome of faciais) {
      try {
        await this.conector.garantirUsuario(nome, userId, barrado);
        this.conector.marcarEspelhado(nome, String(userId), barrado);
        await this.aplicarRosto(nome, userId, jpeg);
        feitos.push(nome);
      } catch (err) {
        falhas.push((err as Error).message);
      }
    }
    if (falhas.length) throw new Error(`A foto não entrou em todos os aparelhos — ${falhas.join("; ")}`);
    logger.info({ userId, aparelhos: feitos.length }, "Foto do rosto entregue aos aparelhos Hikvision");
    return { equipamentos: feitos };
  }

  private escolher(lista: string[], equipamento: string | null | undefined, oQue: string): string {
    if (!lista.length) throw new Error(`Nenhum aparelho Hikvision deste Gateway faz ${oQue}.`);
    if (!equipamento) return lista[0];
    if (!lista.includes(equipamento)) throw new Error(`O aparelho "${equipamento}" não faz ${oQue}.`);
    return equipamento;
  }

  /** Copia uma credencial para cada aparelho da lista; a origem tem de receber, os outros vão no relatório. */
  private async copiar(
    origem: string,
    destinos: string[],
    userId: number,
    aplicar: (nome: string) => Promise<void>
  ): Promise<ReplicacaoEquipamentos> {
    const barrado = await this.conector.barrado(String(userId));
    const saida: ReplicacaoEquipamentos = { replicado_em: [], falhou_em: [] };
    for (const nome of [origem, ...destinos.filter((d) => d !== origem)]) {
      try {
        await this.conector.garantirUsuario(nome, userId, barrado);
        this.conector.marcarEspelhado(nome, String(userId), barrado);
        await aplicar(nome);
        if (nome !== origem) saida.replicado_em.push(nome);
      } catch (err) {
        if (nome === origem) throw err;
        saida.falhou_em.push({ equipamento: nome, erro: (err as Error).message });
      }
    }
    return saida;
  }

  /**
   * Rosto pela câmera do aparelho, com o aluno na frente. A foto capturada
   * vem na resposta (ou fica pronta depois, pelo progresso) e vai a todos os
   * aparelhos com rosto, incluindo o que capturou: capturar não grava.
   */
  async cadastrarRosto(userId: number, equipamento?: string | null): Promise<{ equipamento: string } & ReplicacaoEquipamentos> {
    const nome = this.escolher(this.com((c) => c.rosto && c.capturaRosto), equipamento, "cadastro do rosto pela câmera");
    const foto = await this.capturarRosto(nome);
    try {
      const saida = await this.copiar(nome, this.faciais(), userId, (n) => this.aplicarRosto(n, userId, foto));
      logger.info({ aparelho: nome, replicado: saida.replicado_em.length, falhas: saida.falhou_em.length }, "Rosto cadastrado pela câmera do aparelho Hikvision");
      return { equipamento: nome, ...saida };
    } finally {
      foto.fill(0);
    }
  }

  private async capturarRosto(nome: string): Promise<Buffer> {
    const c = this.conector.cliente(nome);
    const r = await c.pedir(
      "POST",
      caminhos.capturarRosto,
      { tipo: "application/xml; charset=UTF-8", dados: Buffer.from(xmlCapturarRosto()) },
      { timeoutMs: TEMPO_DE_CAPTURA_MS, tentativas: 1 }
    );
    let foto = imagemDaResposta(r.corpo, r.tipo);
    r.corpo.fill(0);
    const fim = Date.now() + TEMPO_DE_CAPTURA_MS;
    while (!foto) {
      if (Date.now() > fim) throw new Error(`${nome}: o aluno não olhou para a câmera a tempo`);
      await dormir(this.conector.intervaloProgressoMs);
      const p = await c.pedir("GET", caminhos.progressoRosto, undefined, { tentativas: 1 });
      foto = imagemDaResposta(p.corpo, p.tipo);
      if (foto) {
        p.corpo.fill(0);
        break;
      }
      const xml = p.corpo.toString("utf8");
      const progresso = Number(tagDoXml(xml, "captureProgress") ?? "0");
      const terminou = /^true$/i.test(tagDoXml(xml, "isCurRequestOver") ?? "");
      const endereco = tagDoXml(xml, "faceDataUrl");
      if (progresso >= 100 && endereco) {
        foto = await this.baixarDoAparelho(nome, endereco);
        break;
      }
      if (terminou && progresso < 100) throw new Error(`${nome}: a câmera não conseguiu capturar o rosto; peça para o aluno olhar de frente e repita`);
    }
    if (foto.length < 1024 || foto[0] !== 0xff || foto[1] !== 0xd8) {
      foto.fill(0);
      throw new Error(`${nome}: o aparelho não devolveu uma foto válida do rosto`);
    }
    return foto;
  }

  /** A foto que o aparelho deixou num endereço dele mesmo: só do próprio aparelho, nunca de outro lugar. */
  private async baixarDoAparelho(nome: string, endereco: string): Promise<Buffer> {
    const eq = this.conector.equipamento(nome);
    let caminho = endereco;
    if (/^https?:\/\//i.test(endereco)) {
      const u = new URL(endereco);
      if (ipDoEquipamento(u.hostname) !== ipDoEquipamento(eq.ip)) throw new Error(`${nome}: o aparelho indicou a foto em outro endereço; não foi buscada`);
      caminho = `${u.pathname}${u.search}`;
    }
    const r = await this.conector.cliente(nome).pedir("GET", caminho, undefined, { tentativas: 1 });
    return r.corpo;
  }

  /**
   * A digital: o aparelho escolhido lê o dedo (o aluno na frente dele) e a
   * digital vai a todos os aparelhos com leitor de digital. O dado da
   * digital fica só na memória, durante a cópia.
   */
  async cadastrarDigital(userId: number, equipamento?: string | null): Promise<{ equipamento: string } & ReplicacaoEquipamentos> {
    const nome = this.escolher(this.com((c) => c.capturaDigital), equipamento, "cadastro da digital");
    const c = this.conector.cliente(nome);
    const resposta = await c.xml("POST", caminhos.capturarDigital, xmlCapturarDigital(), { timeoutMs: TEMPO_DE_CAPTURA_MS, tentativas: 1 });
    const dados = tagDoXml(resposta, "fingerData");
    if (!dados) throw new Error(`${nome}: o aparelho não leu a digital; peça para o aluno pôr o dedo de novo`);
    const saida = await this.copiar(nome, this.comDigital(), userId, (n) => this.aplicarDigital(n, userId, dados));
    logger.info({ aparelho: nome, replicado: saida.replicado_em.length, falhas: saida.falhou_em.length }, "Digital cadastrada no aparelho Hikvision");
    return { equipamento: nome, ...saida };
  }

  /**
   * Manda a digital ao aparelho e espera o leitor confirmar. Se o aluno já
   * tem digital ali (recadastro), a antiga sai e a nova entra.
   */
  private async aplicarDigital(nome: string, userId: number, dados: string, deNovo = false): Promise<void> {
    const c = this.conector.cliente(nome);
    const eq = this.conector.equipamento(nome);
    await c.json("POST", caminhos.enviarDigital, digitalDoAluno(userId, dados, eq.leitores_digital));
    const fim = Date.now() + 30_000;
    for (;;) {
      const p = await c.json<{ FingerPrintStatus?: { totalStatus?: number; StatusList?: { id?: number; cardReaderRecvStatus?: number }[] } }>(
        "GET",
        caminhos.progressoDigital
      );
      const st = p.FingerPrintStatus;
      if (st?.totalStatus === 1 || (st?.totalStatus === undefined && (st?.StatusList ?? []).length)) {
        const ruins = (st?.StatusList ?? []).filter((s) => s.cardReaderRecvStatus !== 1);
        if (!ruins.length) return;
        if (!deNovo && ruins.every((s) => s.cardReaderRecvStatus === 6)) {
          await c.json("PUT", caminhos.apagarDigital, apagarDigitalDoAluno(userId, eq.leitores_digital));
          await this.aguardar(nome, caminhos.progressoApagarDigital, (j) => statusDoProgresso(j, "FingerPrintDeleteProcess"));
          return this.aplicarDigital(nome, userId, dados, true);
        }
        const motivo = SITUACAO_DA_DIGITAL[ruins[0].cardReaderRecvStatus ?? -1] ?? `o leitor recusou a digital (situação ${ruins[0].cardReaderRecvStatus})`;
        throw new Error(`${nome}: ${motivo}`);
      }
      if (Date.now() > fim) throw new Error(`${nome}: o aparelho não confirmou a digital em 30 s`);
      await dormir(this.conector.intervaloProgressoMs);
    }
  }

  /**
   * O cartão: o aparelho escolhido lê o cartão (aproximado pelo aluno) e ele
   * vai a todos os aparelhos que aceitam cartão, no lugar do anterior do
   * aluno — o cartão perdido para de abrir a catraca. O número do cartão não
   * sobe para a nuvem: o aparelho reconhece o cartão e manda o número do aluno.
   */
  async cadastrarCartao(userId: number, equipamento?: string | null): Promise<{ equipamento: string; cartoes: number } & ReplicacaoEquipamentos> {
    const nome = this.escolher(this.com((c) => c.capturaCartao), equipamento, "leitura do cartão");
    const lido = await this.conector
      .cliente(nome)
      .json<{ CardInfo?: { cardNo?: string } }>("GET", caminhos.capturarCartao, undefined, { timeoutMs: TEMPO_DE_CAPTURA_MS, tentativas: 1 });
    const cartao = String(lido.CardInfo?.cardNo ?? "").trim();
    if (!cartao) throw new Error(`${nome}: o aparelho não leu o cartão; peça para o aluno aproximar de novo`);
    const saida = await this.copiar(nome, this.comCartao(), userId, async (n) => {
      const c = this.conector.cliente(n);
      await this.semErroDeInexistente(() => c.json("PUT", caminhos.apagarCartoes, apagarCartoesDoAluno(userId)));
      await c.json("POST", caminhos.incluirCartao, cartaoDoAluno(userId, cartao));
    });
    logger.info({ aparelho: nome, replicado: saida.replicado_em.length, falhas: saida.falhou_em.length }, "Cartão cadastrado no aparelho Hikvision");
    return { equipamento: nome, cartoes: 1, ...saida };
  }
}

/** "processing", "success" ou "failed" de uma operação em segundo plano; null se o aparelho não disser. */
function statusDoProgresso(j: Record<string, unknown>, chave: string): string | null {
  const bloco = j[chave] as { status?: unknown } | undefined;
  const s = bloco?.status;
  return typeof s === "string" ? s : null;
}

/** A foto JPEG de uma resposta de captura: a parte de imagem do multipart, ou o corpo, se ele for a imagem. */
function imagemDaResposta(corpo: Buffer, tipo: string | null): Buffer | null {
  const partes = partesDoMultipart(corpo, tipo);
  if (partes) {
    const img = partes.find((p) => /^image\//i.test(p.tipo ?? "") && p.corpo.length > 0);
    return img ? Buffer.from(img.corpo) : null;
  }
  if (/^image\//i.test(tipo ?? "") && corpo.length) return Buffer.from(corpo);
  return null;
}
