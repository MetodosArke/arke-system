import type { ICanalComandos } from "../cloud/client";
import type { GestaoEquipamentos } from "../equipamentos/controlidGestao";
import type { ComandoGateway, ResultadoComando, TelemetriaGateway, TipoComando } from "../types";
import type { GatewayService } from "./gatewayService";
import { VERSAO_GATEWAY } from "../versao";
import { logger } from "../logger";

/**
 * Executa as ordens que a nuvem manda pelo canal `catraca-comandos` e leva
 * de volta os resultados e a telemetria.
 *
 * Quem abre a conexão é sempre o Gateway (escuta longa): a rede da academia
 * não precisa abrir porta nenhuma, e a ordem chega em ~1 s. Uma chamada
 * fica pendurada esperando ordem; quando um resultado fica pronto no meio
 * dessa espera, sai numa chamada curta à parte, para a recepção que está
 * cadastrando a digital com o aluno na frente não esperar 20 s pela
 * confirmação.
 *
 * Duas filas, porque as ordens têm pesos muito diferentes:
 *   - as do equipamento (cadastrar, apagar) andam UMA DE CADA VEZ: o cadastro
 *     remoto prende o leitor por até 90 s, e dois ao mesmo tempo no mesmo
 *     aparelho se atropelariam;
 *   - as rápidas (liberar a catraca, sincronizar, diagnóstico) não esperam
 *     ninguém — liberar a catraca atrás de um cadastro de digital deixaria
 *     alguém parado na borboleta por um minuto e meio.
 */

const TIPOS_DO_EQUIPAMENTO = new Set<string>([
  "cadastrar_usuario",
  "cadastrar_digital",
  "cadastrar_cartao",
  "apagar_usuario",
]);

const CAPACIDADES_BASE: TipoComando[] = ["sincronizar_completo", "enviar_logs", "diagnostico"];
const CAPACIDADES_GESTAO: TipoComando[] = [
  "liberar_catraca",
  "cadastrar_usuario",
  "cadastrar_digital",
  "cadastrar_cartao",
  "apagar_usuario",
];

export interface OpcoesExecutor {
  modelo: string;
  /** Quanto a nuvem pode segurar cada chamada esperando ordem. */
  aguardarMs?: number;
  /** Espera depois de uma falha; dobra a cada falha seguida, até o teto. */
  esperaFalhaMs?: number;
  esperaFalhaMaxMs?: number;
}

function numeroDoUsuario(valor: unknown): number {
  const texto = String(valor ?? "");
  if (!/^\d{1,15}$/.test(texto)) throw new Error(`Número de usuário inválido para o equipamento: "${texto}".`);
  return Number(texto);
}

function equipamentoDe(p: Record<string, unknown>): string | null {
  return typeof p.equipamento === "string" && p.equipamento.trim() ? p.equipamento.trim() : null;
}

export class ExecutorComandos {
  private rodando = false;
  private resultados: ResultadoComando[] = [];
  /** Resultados que, entregues, pedem uma sincronização (o identificador novo do aluno vai para o cache). */
  private readonly sincronizarAposEntrega = new Set<string>();
  private filaEquipamento: Promise<unknown> = Promise.resolve();
  private envioImediato: Promise<void> | null = null;
  private envioImediatoDeNovo = false;
  private acordar: (() => void) | null = null;
  private readonly ativoDesde = new Date().toISOString();
  private readonly aguardarMs: number;
  private readonly esperaFalhaMs: number;
  private readonly esperaFalhaMaxMs: number;

  constructor(
    private readonly canal: ICanalComandos,
    private readonly gateway: GatewayService,
    private readonly gestao: GestaoEquipamentos | null,
    private readonly opcoes: OpcoesExecutor
  ) {
    this.aguardarMs = opcoes.aguardarMs ?? 20_000;
    this.esperaFalhaMs = opcoes.esperaFalhaMs ?? 5_000;
    this.esperaFalhaMaxMs = opcoes.esperaFalhaMaxMs ?? 60_000;
  }

  /** O que este Gateway sabe fazer. A nuvem só aceita pedir o que estiver aqui. */
  capacidades(): TipoComando[] {
    return this.temGestao() ? [...CAPACIDADES_BASE, ...CAPACIDADES_GESTAO] : [...CAPACIDADES_BASE];
  }

  private temGestao(): boolean {
    return !!this.gestao && this.gestao.nomes().length > 0;
  }

  async telemetria(): Promise<TelemetriaGateway> {
    const estado = await this.gateway.estado();
    const vistos = this.gateway.equipamentos.paraTelemetria();
    // Os equipamentos com gestão remota vão pelo nome do config: é por ele
    // que a recepção escolhe em qual leitor o aluno vai pôr o dedo. Sem IP
    // nem senha — só o nome.
    const equipamentos = [
      ...(this.temGestao()
        ? this.gestao!.nomes().map((nome) => ({ nome, tipo: "controlid-gestao", visto_em: null }))
        : []),
      ...vistos.equipamentos,
    ];
    const ponte = vistos.ponte;
    return {
      versao: VERSAO_GATEWAY,
      modelo: this.opcoes.modelo,
      estado: estado.status,
      fila_offline: estado.filaOffline,
      cache_alunos: estado.cacheAlunos,
      ultima_sincronizacao: estado.ultimaSincronizacao,
      ultimo_erro: estado.ultimoErro?.mensagem ?? null,
      ultimo_erro_em: estado.ultimoErro?.em ?? null,
      equipamentos,
      ponte,
      capacidades: this.capacidades(),
    };
  }

  /** Uma troca com a nuvem. Devolve quantas ordens chegaram. */
  async trocar(aguardarMs: number): Promise<number> {
    const enviados = this.resultados.splice(0, 20);
    let comandos: ComandoGateway[];
    try {
      const resposta = await this.canal.trocar({ resultados: enviados, telemetria: await this.telemetria(), aguardarMs });
      comandos = resposta.comandos ?? [];
    } catch (err) {
      // Não entregou: os resultados voltam para a frente da fila.
      this.resultados.unshift(...enviados);
      throw err;
    }

    if (enviados.some((r) => this.sincronizarAposEntrega.delete(r.id))) {
      void this.gateway.sincronizarAlunosComTratamento();
    }
    for (const c of comandos) this.despachar(c);
    return comandos.length;
  }

  private despachar(c: ComandoGateway): void {
    logger.info({ comando: c.tipo, id: c.id }, "Ordem recebida da nuvem");
    const executar = async () => {
      const r = await this.executar(c);
      if (r.sucesso && c.tipo === "cadastrar_usuario") this.sincronizarAposEntrega.add(r.id);
      this.resultados.push(r);
      this.enviarJa();
    };
    if (TIPOS_DO_EQUIPAMENTO.has(c.tipo)) {
      this.filaEquipamento = this.filaEquipamento.then(executar, executar);
    } else {
      void executar();
    }
  }

  /** Executa uma ordem. Nunca lança: falha vira resultado com erro, que a nuvem registra. */
  async executar(c: ComandoGateway): Promise<ResultadoComando> {
    try {
      const resultado = await this.executarTipo(c);
      logger.info({ comando: c.tipo, id: c.id }, "Ordem executada");
      return { id: c.id, sucesso: true, resultado };
    } catch (err) {
      const erro = ((err as Error)?.message ?? String(err)).slice(0, 500);
      logger.warn({ comando: c.tipo, id: c.id, erro }, "Ordem da nuvem falhou");
      return { id: c.id, sucesso: false, erro };
    }
  }

  private exigirGestao(): GestaoEquipamentos {
    if (!this.gestao || !this.temGestao()) {
      throw new Error(
        "Este Gateway não tem equipamento Control iD configurado para gestão remota (controlid_equipamentos no config.json)."
      );
    }
    return this.gestao;
  }

  private async executarTipo(c: ComandoGateway): Promise<Record<string, unknown>> {
    const p = (c.parametros ?? {}) as Record<string, unknown>;
    switch (c.tipo) {
      case "sincronizar_completo":
        return this.gateway.forcarSincronizacaoCompleta();
      case "enviar_logs":
        return { enviados: await this.gateway.enviarLogsPendentes() };
      case "diagnostico": {
        const estado = await this.gateway.estado();
        const conexoes = this.gestao ? await this.gestao.testar() : [];
        return {
          versao: VERSAO_GATEWAY,
          modelo: this.opcoes.modelo,
          node: process.version,
          sistema: `${process.platform} ${process.arch}`,
          ativo_desde: this.ativoDesde,
          memoria_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          ...estado,
          ...this.gateway.equipamentos.paraTelemetria(),
          equipamentos_gestao: conexoes,
        };
      }
      case "liberar_catraca": {
        const sentido = p.sentido === "saida" || p.sentido === "ambos" ? p.sentido : "entrada";
        return this.exigirGestao().liberarCatraca(sentido, equipamentoDe(p));
      }
      case "cadastrar_usuario": {
        const userId = numeroDoUsuario(p.user_id);
        const nome = String(p.nome ?? "Aluno").slice(0, 60) || "Aluno";
        const matricula = String(p.matricula ?? userId).slice(0, 30);
        return this.exigirGestao().criarUsuario(userId, nome, matricula);
      }
      case "cadastrar_digital":
        return this.exigirGestao().cadastrarDigital(numeroDoUsuario(p.user_id), equipamentoDe(p));
      case "cadastrar_cartao":
        return this.exigirGestao().cadastrarCartao(numeroDoUsuario(p.user_id), equipamentoDe(p));
      case "apagar_usuario":
        return this.exigirGestao().apagarUsuario(numeroDoUsuario(p.user_id));
      default:
        throw new Error(`Este Gateway não conhece a ordem "${c.tipo}". Atualize o Gateway Local.`);
    }
  }

  /** Entrega os resultados prontos sem esperar a escuta longa em curso. */
  private enviarJa(): void {
    if (!this.rodando) return;
    if (this.envioImediato) {
      this.envioImediatoDeNovo = true;
      return;
    }
    this.envioImediato = (async () => {
      do {
        this.envioImediatoDeNovo = false;
        try {
          await this.trocar(0);
        } catch (err) {
          // Os resultados ficam na fila; a próxima chamada do laço leva.
          logger.warn({ err: (err as Error).message }, "Não foi possível entregar o resultado agora — vai na próxima chamada");
          break;
        }
      } while (this.envioImediatoDeNovo && this.resultados.length > 0);
    })().finally(() => {
      this.envioImediato = null;
    });
  }

  iniciar(): void {
    if (this.rodando) return;
    this.rodando = true;
    void this.rodar();
  }

  parar(): void {
    this.rodando = false;
    this.acordar?.();
  }

  private async rodar(): Promise<void> {
    let espera = this.esperaFalhaMs;
    while (this.rodando) {
      try {
        await this.trocar(this.aguardarMs);
        espera = this.esperaFalhaMs;
      } catch (err) {
        logger.warn({ err: (err as Error).message, novaTentativaEmMs: espera }, "Canal de comandos com a nuvem falhou");
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, espera);
          t.unref?.();
          this.acordar = () => {
            clearTimeout(t);
            resolve();
          };
        });
        this.acordar = null;
        espera = Math.min(espera * 2, this.esperaFalhaMaxMs);
      }
    }
  }
}
