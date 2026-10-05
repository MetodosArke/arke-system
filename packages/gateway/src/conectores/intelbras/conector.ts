import dgram from "node:dgram";
import type { GatewayService } from "../../core/gatewayService";
import type { GestaoEquipamentos, ReplicacaoEquipamentos } from "../../equipamentos/controlidGestao";
import { logger } from "../../logger";
import { ipDoEquipamento } from "../../receptores/controlid";
import type { EquipamentoIntelbras, TipoComando } from "../../types";
import { ClienteIntelbras } from "./cliente";
import { FOTO_MAXIMA_BYTES, caminhos, horaDoTerminal, respostaOk, usuarioDoAluno } from "./protocolo";

/** O endereço deste computador que alcança o terminal (o mesmo truque da LiteNet3: UDP "conectado" não manda nada). */
export function enderecoLocalPara(ip: string, porta = 80): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket(ip.includes(":") ? "udp6" : "udp4");
    s.once("error", (e) => {
      s.close();
      reject(e);
    });
    s.connect(porta, ip, () => {
      const a = s.address().address;
      s.close();
      resolve(a);
    });
  });
}

const LOTE = 20;
const ACERTAR_HORA_MS = 6 * 60 * 60_000;

export interface OpcoesConectorIntelbras {
  /** Porta de escuta do Gateway, que vai para o terminal como servidor. */
  porta: number;
  /** Endereço a anunciar; vazio, descobre o que alcança cada terminal. */
  endereco?: string | null;
  /** Configura o Modo Online em cada terminal ao subir. */
  configurar?: boolean;
  timeoutMs?: number;
}

/**
 * Os terminais Intelbras da academia: configuração ao subir, hora certa e o
 * espelho da situação.
 *
 * ESPELHO. Sem o Gateway (computador desligado ou fora da rede), o terminal
 * decide sozinho e, pela documentação, libera todo usuário cadastrado nele.
 * O terminal não libera o usuário bloqueado (`UserType` 1), nem sem o
 * servidor, como a Intelbras confirmou em 05/10/2026. Então o Gateway bloqueia
 * quem a academia barrou (pausado, inadimplente fora da tolerância) e
 * desbloqueia quem volta, a cada sincronização (decisão do responsável de
 * 02/10/2026). Com o Gateway no ar, a decisão é sempre da nuvem.
 */
export class ConectorIntelbras {
  private readonly clientes = new Map<string, ClienteIntelbras>();
  /** O que já foi espelhado em cada terminal: número → bloqueado. */
  private readonly espelhado = new Map<string, Map<string, boolean>>();
  private espelhando = false;
  private deNovo = false;
  private timerHora: NodeJS.Timeout | null = null;

  constructor(
    private readonly gateway: GatewayService,
    readonly equipamentos: EquipamentoIntelbras[],
    private readonly opcoes: OpcoesConectorIntelbras
  ) {
    for (const eq of equipamentos) {
      this.clientes.set(eq.nome, new ClienteIntelbras(eq, opcoes.timeoutMs));
      this.espelhado.set(eq.nome, new Map());
    }
  }

  nomes(): string[] {
    return this.equipamentos.map((e) => e.nome);
  }

  cliente(nome: string): ClienteIntelbras {
    const c = this.clientes.get(nome);
    if (!c) throw new Error(`Terminal "${nome}" não está configurado neste Gateway.`);
    return c;
  }

  /** O nome do terminal pelo IP de quem chamou. */
  nomePorIp(ip: string): string | null {
    return this.equipamentos.find((e) => ipDoEquipamento(e.ip) === ipDoEquipamento(ip))?.nome ?? null;
  }

  async iniciar(): Promise<void> {
    if (this.opcoes.configurar !== false) {
      for (const eq of this.equipamentos) {
        await this.configurar(eq).catch((err) =>
          logger.warn({ terminal: eq.nome, err: (err as Error).message }, "Não foi possível configurar o terminal Intelbras — confira IP, usuário e senha")
        );
      }
      this.timerHora = setInterval(() => void this.acertarHoras(), ACERTAR_HORA_MS);
      this.timerHora.unref?.();
    }
    this.gateway.aoSincronizar(() => void this.espelhar());
    void this.espelhar();
  }

  parar(): void {
    if (this.timerHora) clearInterval(this.timerHora);
    this.timerHora = null;
  }

  /**
   * Hora certa e Modo Online apontando para este Gateway. A hora importa:
   * o Gateway separa a tentativa de agora do registro guardado pelo
   * relógio do terminal.
   */
  async configurar(eq: EquipamentoIntelbras): Promise<void> {
    const c = this.cliente(eq.nome);
    await this.acertarHora(eq);
    const endereco = this.opcoes.endereco?.trim() || (await enderecoLocalPara(eq.ip, eq.porta));
    for (const caminho of [caminhos.servidorEventos(endereco, this.opcoes.porta), caminhos.modoOnline]) {
      const r = await c.chamar(caminho);
      if (!respostaOk(r)) throw new Error(`${eq.nome}: o terminal não aceitou a configuração do Modo Online`);
    }
    logger.info({ terminal: eq.nome, servidor: `${endereco}:${this.opcoes.porta}` }, "Terminal Intelbras no Modo Online, apontando para este Gateway");
  }

  private async acertarHora(eq: EquipamentoIntelbras): Promise<void> {
    const r = await this.cliente(eq.nome).chamar(caminhos.acertarHora(horaDoTerminal()));
    if (!respostaOk(r)) throw new Error(`${eq.nome}: o terminal não aceitou a hora`);
  }

  private async acertarHoras(): Promise<void> {
    for (const eq of this.equipamentos) {
      await this.acertarHora(eq).catch((err) => logger.warn({ terminal: eq.nome, err: (err as Error).message }, "Hora do terminal Intelbras não acertada"));
    }
  }

  /** O aluno está barrado, pelo cache? */
  async barrado(identificador: string): Promise<boolean> {
    const alunos = await this.gateway.alunosNoEquipamento();
    return alunos.find((a) => a.identificador === identificador)?.barrado ?? false;
  }

  /** Registra o que acabou de ir ao terminal, para o espelho não repetir. */
  marcarEspelhado(nome: string, identificador: string, bloqueado: boolean): void {
    this.espelhado.get(nome)?.set(identificador, bloqueado);
  }

  esquecer(identificador: string): void {
    for (const m of this.espelhado.values()) m.delete(identificador);
  }

  /** Atualiza nos terminais quem mudou de situação desde a última vez. */
  async espelhar(): Promise<{ terminal: string; enviados: number; falhou?: string }[]> {
    if (this.espelhando) {
      this.deNovo = true;
      return [];
    }
    this.espelhando = true;
    const relatorio: { terminal: string; enviados: number; falhou?: string }[] = [];
    try {
      const alunos = await this.gateway.alunosNoEquipamento();
      const atuais = new Set(alunos.map((a) => a.identificador));
      for (const eq of this.equipamentos) {
        const feito = this.espelhado.get(eq.nome)!;
        for (const id of [...feito.keys()]) if (!atuais.has(id)) feito.delete(id);
        const mudou = alunos.filter((a) => feito.get(a.identificador) !== a.barrado);
        let enviados = 0;
        try {
          for (let i = 0; i < mudou.length; i += LOTE) {
            const lote = mudou.slice(i, i + LOTE);
            const c = this.cliente(eq.nome);
            const emLote = await c.chamar(caminhos.atualizarUsuarios, { UserList: lote.map((a) => usuarioDoAluno(a.identificador, a.barrado)) });
            if (respostaOk(emLote)) {
              for (const a of lote) feito.set(a.identificador, a.barrado);
              enviados += lote.length;
              continue;
            }
            // Um do lote que não está no terminal derruba o lote: um por vez.
            // Recusa de um só é aluno sem cadastro neste terminal; quando ele
            // for cadastrado pela ficha, já entra com a situação certa.
            for (const a of lote) {
              await c.chamar(caminhos.atualizarUsuarios, { UserList: [usuarioDoAluno(a.identificador, a.barrado)] });
              feito.set(a.identificador, a.barrado);
              enviados++;
            }
          }
          relatorio.push({ terminal: eq.nome, enviados });
        } catch (err) {
          // Terminal fora do ar: o que não foi marcado vai na próxima rodada.
          relatorio.push({ terminal: eq.nome, enviados, falhou: (err as Error).message });
          logger.warn({ terminal: eq.nome, err: (err as Error).message }, "Situação dos alunos não espelhada no terminal Intelbras");
        }
        if (enviados) logger.info({ terminal: eq.nome, enviados }, "Situação dos alunos espelhada no terminal Intelbras");
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
 * Gestão dos terminais Intelbras pela ficha do aluno: cadastrar e apagar o
 * aluno em todos, abrir a porta a pedido da recepção e entregar a foto do
 * rosto que o aluno mandou pelo app. Digital e cartão ficam no próprio
 * terminal (a captura remota de digital só existe no SS 3430, e a de cartão
 * não existe na API); o cadastro do rosto pela câmera é item da próxima
 * etapa, depois da bancada.
 */
export class GestaoIntelbras implements GestaoEquipamentos {
  constructor(private readonly conector: ConectorIntelbras) {}

  nomes(): string[] {
    return this.conector.nomes();
  }

  capacidades(): TipoComando[] {
    const base: TipoComando[] = ["cadastrar_usuario", "apagar_usuario", "liberar_catraca"];
    return this.conector.equipamentos.some((e) => e.rosto) ? [...base, "enviar_foto_rosto"] : base;
  }

  temRosto(nome: string): boolean {
    return !!this.conector.equipamentos.find((e) => e.nome === nome)?.rosto;
  }

  async testar(): Promise<{ equipamento: string; ok: boolean; erro?: string }[]> {
    const r: { equipamento: string; ok: boolean; erro?: string }[] = [];
    for (const nome of this.nomes()) {
      try {
        await this.conector.cliente(nome).chamar(caminhos.versao);
        r.push({ equipamento: nome, ok: true });
      } catch (err) {
        r.push({ equipamento: nome, ok: false, erro: (err as Error).message });
      }
    }
    return r;
  }

  /** Cria ou atualiza o aluno no terminal, já com a situação dele. */
  private async garantirUsuario(nome: string, userId: number, bloqueado: boolean): Promise<void> {
    const c = this.conector.cliente(nome);
    const corpo = { UserList: [usuarioDoAluno(userId, bloqueado)] };
    if (respostaOk(await c.chamar(caminhos.inserirUsuarios, corpo))) return;
    if (respostaOk(await c.chamar(caminhos.atualizarUsuarios, corpo))) return;
    throw new Error(`${nome}: o terminal recusou o cadastro do aluno`);
  }

  async criarUsuario(userId: number): Promise<{ equipamentos: string[] }> {
    const bloqueado = await this.conector.barrado(String(userId));
    // Falha em um falha a ordem: ela continua pendente e é refeita inteira.
    for (const nome of this.nomes()) {
      await this.garantirUsuario(nome, userId, bloqueado);
      this.conector.marcarEspelhado(nome, String(userId), bloqueado);
    }
    logger.info({ userId, terminais: this.nomes().length }, "Aluno cadastrado nos terminais Intelbras");
    return { equipamentos: this.nomes() };
  }

  async apagarUsuario(userId: number): Promise<{ equipamentos: string[]; apagados: number }> {
    let apagados = 0;
    for (const nome of this.nomes()) {
      const c = this.conector.cliente(nome);
      // O rosto antes do usuário: a documentação não diz se apagar o usuário
      // apaga o rosto junto. Recusa aqui é de quem já não tem rosto.
      await c.chamar(caminhos.removerRosto(userId));
      // Recusa ao apagar o usuário é de quem já não está no terminal: conta
      // como feito, que é o estado que se queria.
      if (respostaOk(await c.chamar(caminhos.removerUsuario(userId)))) apagados++;
    }
    this.conector.esquecer(String(userId));
    logger.info({ userId, apagados }, "Aluno apagado dos terminais Intelbras");
    return { equipamentos: this.nomes(), apagados };
  }

  async liberarCatraca(_sentido: "entrada" | "saida" | "ambos", equipamento?: string | null): Promise<{ equipamento: string }> {
    const eq = equipamento ? this.conector.equipamentos.find((e) => e.nome === equipamento) : this.conector.equipamentos[0];
    if (!eq) throw new Error(`Terminal "${equipamento}" não está configurado neste Gateway.`);
    const r = await this.conector.cliente(eq.nome).chamar(caminhos.abrirPorta(eq.canal));
    if (!respostaOk(r)) throw new Error(`${eq.nome}: o terminal não abriu a porta`);
    logger.info({ terminal: eq.nome }, "Porta aberta remotamente no terminal Intelbras");
    return { equipamento: eq.nome };
  }

  async enviarFotoRosto(userId: number, jpeg: Buffer): Promise<{ equipamentos: string[] }> {
    if (jpeg.length > FOTO_MAXIMA_BYTES) {
      throw new Error("A foto passa de 100 KB, o limite dos terminais Intelbras. Mande outra pelo app.");
    }
    const faciais = this.conector.equipamentos.filter((e) => e.rosto);
    if (!faciais.length) throw new Error("Nenhum terminal Intelbras com reconhecimento facial neste Gateway.");
    const bloqueado = await this.conector.barrado(String(userId));
    const corpo = { FaceList: [{ UserID: String(userId), PhotoData: [jpeg.toString("base64")] }] };
    for (const eq of faciais) {
      await this.garantirUsuario(eq.nome, userId, bloqueado);
      this.conector.marcarEspelhado(eq.nome, String(userId), bloqueado);
      const c = this.conector.cliente(eq.nome);
      if (respostaOk(await c.chamar(caminhos.inserirRostos, corpo))) continue;
      if (respostaOk(await c.chamar(caminhos.atualizarRostos, corpo))) continue;
      throw new Error(
        `${eq.nome}: o terminal recusou a foto. Ele pede um rosto só, de frente, em JPEG de até 100 KB, entre 150x300 e 600x1200.`
      );
    }
    logger.info({ userId, terminais: faciais.length }, "Foto do rosto entregue aos terminais Intelbras");
    return { equipamentos: faciais.map((e) => e.nome) };
  }

  private naoSuportado(o: string): never {
    throw new Error(`${o} pelo ARKE ainda não existe nos terminais Intelbras: cadastre no próprio terminal.`);
  }

  async cadastrarDigital(): Promise<{ equipamento: string } & ReplicacaoEquipamentos> {
    return this.naoSuportado("O cadastro da digital");
  }

  async cadastrarCartao(): Promise<{ equipamento: string; cartoes: number } & ReplicacaoEquipamentos> {
    return this.naoSuportado("O cadastro do cartão");
  }
}
